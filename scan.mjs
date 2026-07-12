#!/usr/bin/env node

/**
 * scan.mjs — Hybrid portal scanner
 *
 * Fetches Greenhouse, Ashby, and Lever APIs directly, and can also
 * ingest JSON search results produced by AutoCLI (for Boss/LinkedIn).
 * Applies title filters from portals.yml, deduplicates against existing
 * history, and appends new offers to pipeline.md + scan-history.tsv.
 *
 * Zero Claude API tokens — pure HTTP + JSON / local CLI.
 *
 * Usage:
 *   node scan.mjs                  # scan all enabled companies
 *   node scan.mjs --dry-run        # preview without writing files
 *   node scan.mjs --company Cohere # scan a single company
 *   node scan.mjs --source boss    # run matching AutoCLI sources only
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';
const parseYaml = yaml.load;

// ── Config ──────────────────────────────────────────────────────────

const PORTALS_PATH = 'portals.yml';
const SCAN_HISTORY_PATH = 'data/scan-history.tsv';
const PIPELINE_PATH = 'data/pipeline.md';
const APPLICATIONS_PATH = 'data/applications.md';
const JDS_DIR = 'jds';

// Ensure required directories exist (fresh setup)
mkdirSync('data', { recursive: true });
mkdirSync(JDS_DIR, { recursive: true });

function ensurePipelineFile() {
  if (!existsSync(PIPELINE_PATH)) {
    writeFileSync(
      PIPELINE_PATH,
      '# Pipeline\n\n## Pendientes\n\n## Procesadas\n',
      'utf-8'
    );
  }
}

ensurePipelineFile();

const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 10_000;

// ── API detection ───────────────────────────────────────────────────

function detectApi(company) {
  // Greenhouse: explicit api field
  if (company.api && company.api.includes('greenhouse')) {
    return { type: 'greenhouse', url: company.api };
  }

  const url = company.careers_url || '';

  // Ashby
  const ashbyMatch = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (ashbyMatch) {
    return {
      type: 'ashby',
      url: `https://api.ashbyhq.com/posting-api/job-board/${ashbyMatch[1]}?includeCompensation=true`,
    };
  }

  // Lever
  const leverMatch = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  if (leverMatch) {
    return {
      type: 'lever',
      url: `https://api.lever.co/v0/postings/${leverMatch[1]}`,
    };
  }

  // Greenhouse EU boards
  const ghEuMatch = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
  if (ghEuMatch && !company.api) {
    return {
      type: 'greenhouse',
      url: `https://boards-api.greenhouse.io/v1/boards/${ghEuMatch[1]}/jobs`,
    };
  }

  return null;
}

// ── API parsers ─────────────────────────────────────────────────────

function parseGreenhouse(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.absolute_url || '',
    company: companyName,
    location: j.location?.name || '',
  }));
}

function parseAshby(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.jobUrl || '',
    company: companyName,
    location: j.location || '',
  }));
}

function parseLever(json, companyName) {
  if (!Array.isArray(json)) return [];
  return json.map(j => ({
    title: j.text || '',
    url: j.hostedUrl || '',
    company: companyName,
    location: j.categories?.location || '',
  }));
}

const PARSERS = { greenhouse: parseGreenhouse, ashby: parseAshby, lever: parseLever };

// ── Fetch with timeout ──────────────────────────────────────────────

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Title filter ────────────────────────────────────────────────────

function buildTitleFilter(titleFilter) {
  const positive = (titleFilter?.positive || []).map(k => k.toLowerCase());
  const negative = (titleFilter?.negative || []).map(k => k.toLowerCase());

  return (title) => {
    const lower = title.toLowerCase();
    const hasPositive = positive.length === 0 || positive.some(k => lower.includes(k));
    const hasNegative = negative.some(k => lower.includes(k));
    return hasPositive && !hasNegative;
  };
}

function getByPath(value, path) {
  if (!path) return undefined;
  return path.split('.').reduce((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    if (/^\d+$/.test(key)) return acc[Number(key)];
    return acc[key];
  }, value);
}

function coerceArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function parseJsonOutput(stdout) {
  const text = stdout.trim();
  if (!text) throw new Error('command produced empty output');

  try {
    return JSON.parse(text);
  } catch {
    const candidates = ['[', '{']
      .map(char => text.indexOf(char))
      .filter(index => index !== -1);
    const start = candidates.length > 0 ? Math.min(...candidates) : -1;
    const end = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'));

    if (start === -1 || end === -1 || end <= start) {
      throw new Error('output was not valid JSON');
    }
    return JSON.parse(text.slice(start, end + 1));
  }
}

function extractItems(payload, resultsPath) {
  if (!resultsPath) return coerceArray(payload);
  return coerceArray(getByPath(payload, resultsPath));
}

function normalizeAutoCliOffer(item, source) {
  const fields = source.fields || {};
  const title = getByPath(item, fields.title || 'title');
  const url = getByPath(item, fields.url || 'url');
  const company = getByPath(item, fields.company || 'company') || source.default_company || source.name;
  const location = getByPath(item, fields.location || 'location') || '';
  const detailId = getByPath(item, fields.detail_id || 'detail_id');

  if (!title || !url) return null;
  return {
    title: String(title).trim(),
    url: String(url).trim(),
    company: String(company).trim(),
    location: String(location).trim(),
    sourceUrl: String(url).trim(),
    detailId: detailId ? String(detailId).trim() : '',
  };
}

function renderCommandValue(value, variables) {
  if (typeof value !== 'string') return value;
  return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const resolved = getByPath(variables, key);
    return resolved === undefined || resolved === null ? '' : String(resolved);
  });
}

function buildCommandSpec(command, variables) {
  if (Array.isArray(command)) {
    return command.map(part => renderCommandValue(part, variables));
  }
  if (typeof command === 'string') {
    return renderCommandValue(command, variables);
  }
  throw new Error('command must be a string or array');
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'job';
}

function createJdMarkdown(detail, offer, source) {
  const description = String(detail.description || '').trim();
  const lines = [
    `# ${offer.title}`,
    '',
    `- Company: ${offer.company}`,
    `- Location: ${detail.city || offer.location || 'N/A'}`,
    `- Salary: ${detail.salary || 'N/A'}`,
    `- Experience: ${detail.experience || 'N/A'}`,
    `- Degree: ${detail.degree || 'N/A'}`,
    `- Source: ${source.platform || source.name || 'autocli'}`,
    `- URL: ${offer.sourceUrl || offer.url}`,
  ];

  if (detail.industry) lines.push(`- Industry: ${detail.industry}`);
  if (detail.scale) lines.push(`- Company Size: ${detail.scale}`);
  if (detail.stage) lines.push(`- Stage: ${detail.stage}`);
  if (detail.boss_name || detail.boss_title) {
    lines.push(`- Hiring Contact: ${[detail.boss_name, detail.boss_title].filter(Boolean).join(' | ')}`);
  }
  if (detail.skills) lines.push(`- Skills: ${detail.skills}`);
  if (detail.welfare) lines.push(`- Welfare: ${detail.welfare}`);

  lines.push('', '## Job Description', '', description);
  return lines.join('\n') + '\n';
}

function fetchAutoCliDetail(source, offer) {
  if (!source.detail_command || !offer.detailId) return null;
  const commandSpec = buildCommandSpec(source.detail_command, { offer });
  const payload = runAutoCliCommand({ command: commandSpec });
  const items = extractItems(payload, source.detail_results_path);
  return items[0] || null;
}

function materializeOfferWithJd(source, offer, date, dryRun) {
  if (!source.detail_command) return offer;

  const detail = fetchAutoCliDetail(source, offer);
  const description = String(getByPath(detail, source.detail_fields?.description || 'description') || '').trim();
  if (!description) {
    throw new Error(`detail fetch returned no JD for ${offer.title}`);
  }

  if (dryRun) {
    return { ...offer, hasJd: true };
  }

  const companySlug = slugify(offer.company);
  const roleSlug = slugify(offer.title);
  const jdPath = `${JDS_DIR}/${companySlug}-${roleSlug}-${date}.md`;
  writeFileSync(jdPath, createJdMarkdown(detail, offer, source), 'utf-8');

  return {
    ...offer,
    url: `local:${jdPath}`,
    historyUrl: offer.sourceUrl || offer.url,
    hasJd: true,
  };
}

function runAutoCliCommand(source) {
  if (!source.command) {
    throw new Error('missing command');
  }

  if (Array.isArray(source.command)) {
    const [command, ...args] = source.command;
    const result = spawnSync(command, args, {
      encoding: 'utf-8',
      shell: false,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || `exit ${result.status}`).trim());
    }
    return parseJsonOutput(result.stdout || '');
  }

  if (typeof source.command === 'string') {
    const result = spawnSync(source.command, [], {
      encoding: 'utf-8',
      shell: true,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || `exit ${result.status}`).trim());
    }
    return parseJsonOutput(result.stdout || '');
  }

  throw new Error('command must be a string or array');
}

// ── Dedup ───────────────────────────────────────────────────────────

function loadSeenUrls() {
  const seen = new Set();

  // scan-history.tsv
  if (existsSync(SCAN_HISTORY_PATH)) {
    const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
    for (const line of lines.slice(1)) { // skip header
      const url = line.split('\t')[0];
      if (url) seen.add(url);
    }
  }

  // pipeline.md — extract URLs from checkbox lines
  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    for (const match of text.matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) {
      seen.add(match[1]);
    }
  }

  // applications.md — extract URLs from report links and any inline URLs
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    for (const match of text.matchAll(/https?:\/\/[^\s|)]+/g)) {
      seen.add(match[0]);
    }
  }

  return seen;
}

function loadSeenCompanyRoles() {
  const seen = new Set();
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    // Parse markdown table rows: | # | Date | Company | Role | ...
    for (const match of text.matchAll(/\|[^|]+\|[^|]+\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g)) {
      const company = match[1].trim().toLowerCase();
      const role = match[2].trim().toLowerCase();
      if (company && role && company !== 'company') {
        seen.add(`${company}::${role}`);
      }
    }
  }
  return seen;
}

// ── Pipeline writer ─────────────────────────────────────────────────

function appendToPipeline(offers) {
  if (offers.length === 0) return;

  let text = readFileSync(PIPELINE_PATH, 'utf-8');
  const formatOfferLine = (offer) => {
    const applyUrl = offer.sourceUrl || offer.historyUrl;
    const applyPart = applyUrl ? ` | apply: ${applyUrl}` : '';
    return `- [ ] ${offer.url} | ${offer.company} | ${offer.title}${applyPart}`;
  };

  // Find "## Pendientes" section and append after it
  const marker = '## Pendientes';
  const idx = text.indexOf(marker);
  if (idx === -1) {
    // No Pendientes section — append at end before Procesadas
    const procIdx = text.indexOf('## Procesadas');
    const insertAt = procIdx === -1 ? text.length : procIdx;
    const block = `\n${marker}\n\n` + offers.map(o =>
      formatOfferLine(o)
    ).join('\n') + '\n\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  } else {
    // Find the end of existing Pendientes content (next ## or end)
    const afterMarker = idx + marker.length;
    const nextSection = text.indexOf('\n## ', afterMarker);
    const insertAt = nextSection === -1 ? text.length : nextSection;

    const block = '\n' + offers.map(o => formatOfferLine(o)).join('\n') + '\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  }

  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

function appendToScanHistory(offers, date) {
  // Ensure file + header exist
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n', 'utf-8');
  }

  const lines = offers.map(o =>
    `${o.historyUrl || o.sourceUrl || o.url}\t${date}\t${o.source}\t${o.title}\t${o.company}\tadded`
  ).join('\n') + '\n';

  appendFileSync(SCAN_HISTORY_PATH, lines, 'utf-8');
}

// ── Parallel fetch with concurrency limit ───────────────────────────

async function parallelFetch(tasks, limit) {
  const results = [];
  let i = 0;

  async function next() {
    while (i < tasks.length) {
      const task = tasks[i++];
      results.push(await task());
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => next());
  await Promise.all(workers);
  return results;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const companyFlag = args.indexOf('--company');
  const sourceFlag = args.indexOf('--source');
  const filterCompany = companyFlag !== -1 ? args[companyFlag + 1]?.toLowerCase() : null;
  const filterSource = sourceFlag !== -1 ? args[sourceFlag + 1]?.toLowerCase() : null;

  // 1. Read portals.yml
  if (!existsSync(PORTALS_PATH)) {
    console.error('Error: portals.yml not found. Run onboarding first.');
    process.exit(1);
  }

  const config = parseYaml(readFileSync(PORTALS_PATH, 'utf-8'));
  const companies = config.tracked_companies || [];
  const autocliSources = config.autocli_sources || [];
  const titleFilter = buildTitleFilter(config.title_filter);

  // 2. Filter to enabled companies with detectable APIs
  const targets = companies
    .filter(c => c.enabled !== false)
    .filter(c => !filterCompany || c.name.toLowerCase().includes(filterCompany))
    .map(c => ({ ...c, _api: detectApi(c) }))
    .filter(c => c._api !== null);
  const apiTargets = filterSource ? [] : targets;

  const skippedCount = companies.filter(c => c.enabled !== false).length - targets.length;
  const enabledAutoCliSources = autocliSources
    .filter(source => source.enabled !== false)
    .filter(source => {
      if (!filterSource) return true;
      const haystack = [source.name, source.platform].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(filterSource);
    });

  console.log(`Scanning ${apiTargets.length} companies via API (${skippedCount} skipped — no API detected)`);
  if (enabledAutoCliSources.length > 0) {
    console.log(`Scanning ${enabledAutoCliSources.length} AutoCLI source(s)`);
  }
  if (dryRun) console.log('(dry run — no files will be written)\n');

  // 3. Load dedup sets
  const seenUrls = loadSeenUrls();
  const seenCompanyRoles = loadSeenCompanyRoles();

  // 4. Fetch all APIs
  const date = new Date().toISOString().slice(0, 10);
  let totalFound = 0;
  let totalFiltered = 0;
  let totalDupes = 0;
  let totalJdFetched = 0;
  const newOffers = [];
  const errors = [];

  const tasks = apiTargets.map(company => async () => {
    const { type, url } = company._api;
    try {
      const json = await fetchJson(url);
      const jobs = PARSERS[type](json, company.name);
      totalFound += jobs.length;

      for (const job of jobs) {
        if (!titleFilter(job.title)) {
          totalFiltered++;
          continue;
        }
        if (seenUrls.has(job.url)) {
          totalDupes++;
          continue;
        }
        const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
        if (seenCompanyRoles.has(key)) {
          totalDupes++;
          continue;
        }
        // Mark as seen to avoid intra-scan dupes
        seenUrls.add(job.url);
        seenCompanyRoles.add(key);
        newOffers.push({ ...job, source: `${type}-api` });
      }
    } catch (err) {
      errors.push({ company: company.name, error: err.message });
    }
  });

  await parallelFetch(tasks, CONCURRENCY);

  for (const source of enabledAutoCliSources) {
    try {
      const payload = runAutoCliCommand(source);
      const items = extractItems(payload, source.results_path);
      totalFound += items.length;

      for (const item of items) {
        const offer = normalizeAutoCliOffer(item, source);
        if (!offer) continue;
        if (!titleFilter(offer.title)) {
          totalFiltered++;
          continue;
        }
        if (seenUrls.has(offer.sourceUrl || offer.url)) {
          totalDupes++;
          continue;
        }
        const key = `${offer.company.toLowerCase()}::${offer.title.toLowerCase()}`;
        if (seenCompanyRoles.has(key)) {
          totalDupes++;
          continue;
        }

        seenUrls.add(offer.sourceUrl || offer.url);
        seenCompanyRoles.add(key);
        const prepared = {
          ...offer,
          source: `autocli-${source.platform || source.name || 'source'}`,
        };
        const enriched = materializeOfferWithJd(source, prepared, date, dryRun);
        if (enriched?.hasJd) totalJdFetched++;
        newOffers.push(enriched);
      }
    } catch (err) {
      errors.push({
        company: source.name || source.platform || 'AutoCLI source',
        error: err.message,
      });
    }
  }

  // 5. Write results
  if (!dryRun && newOffers.length > 0) {
    appendToPipeline(newOffers);
    appendToScanHistory(newOffers, date);
  }

  // 6. Print summary
  console.log(`\n${'━'.repeat(45)}`);
  console.log(`Portal Scan — ${date}`);
  console.log(`${'━'.repeat(45)}`);
  console.log(`Companies scanned:     ${apiTargets.length}`);
  console.log(`AutoCLI sources:       ${enabledAutoCliSources.length}`);
  console.log(`Total jobs found:      ${totalFound}`);
  console.log(`Filtered by title:     ${totalFiltered} removed`);
  console.log(`Duplicates:            ${totalDupes} skipped`);
  console.log(`JD fetched:            ${totalJdFetched}`);
  console.log(`New offers added:      ${newOffers.length}`);

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) {
      console.log(`  ✗ ${e.company}: ${e.error}`);
    }
  }

  if (newOffers.length > 0) {
    console.log('\nNew offers:');
    for (const o of newOffers) {
      console.log(`  + ${o.company} | ${o.title} | ${o.location || 'N/A'}`);
    }
    if (dryRun) {
      console.log('\n(dry run — run without --dry-run to save results)');
    } else {
      console.log(`\nResults saved to ${PIPELINE_PATH} and ${SCAN_HISTORY_PATH}`);
    }
  }

  console.log(`\n→ Run /career-ops pipeline to evaluate new offers.`);
  console.log('→ Share results and get help: https://discord.gg/8pRpHETxa4');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
