#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';

const parseYaml = yaml.load;

const PORTALS_PATH = 'portals.yml';
const DISCOVERY_CONFIG_PATH = 'config/company-discovery.yml';
const INPUT_PATH = 'data/company-seeds.filtered.json';
const OUTPUT_JSON_PATH = 'data/company-opportunities.json';
const OUTPUT_MD_PATH = 'data/company-opportunities.md';
const PIPELINE_PATH = 'data/pipeline.md';
const SCAN_HISTORY_PATH = 'data/scan-history.tsv';
const JDS_DIR = 'jds';

mkdirSync('data', { recursive: true });
mkdirSync(JDS_DIR, { recursive: true });

function parseArgs(argv) {
  const args = { limit: 20, writePipeline: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--limit') args.limit = Number(argv[++i] || '20');
    if (arg === '--company') args.company = argv[++i] || '';
    if (arg === '--no-pipeline') args.writePipeline = false;
  }
  return args;
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function compactCompany(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function buildTitleFilter(titleFilter) {
  const positive = (titleFilter?.positive || []).map(k => k.toLowerCase());
  const negative = (titleFilter?.negative || []).map(k => k.toLowerCase());

  return (title) => {
    const lower = String(title || '').toLowerCase();
    const hasPositive = positive.length === 0 || positive.some(k => lower.includes(k));
    const hasNegative = negative.some(k => lower.includes(k));
    return hasPositive && !hasNegative;
  };
}

function parseJsonOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) throw new Error('command produced empty output');
  try {
    return JSON.parse(text);
  } catch {
    const startCandidates = ['[', '{'].map(token => text.indexOf(token)).filter(index => index !== -1);
    const start = startCandidates.length > 0 ? Math.min(...startCandidates) : -1;
    const end = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'));
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('output was not valid JSON');
    }
    return JSON.parse(text.slice(start, end + 1));
  }
}

function runAutoCli(commandParts) {
  const [command, ...args] = commandParts;
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

function renderTemplate(template, vars) {
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => String(vars[key] || ''));
}

function isLikelyCompanyMatch(seedCompany, resultCompany) {
  const left = compactCompany(seedCompany);
  const right = compactCompany(resultCompany);
  return left && right && (left.includes(right) || right.includes(left));
}

function scoreOfficialResult(result, company, ignoredDomains) {
  let score = 0;
  const title = String(result.title || '');
  const snippet = String(result.snippet || '');
  const url = String(result.url || '');
  let hostname = '';
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return -100;
  }

  if (ignoredDomains.some(domain => hostname.includes(domain))) return -100;
  if (title.includes(company.company_name) || snippet.includes(company.company_name)) score += 15;
  if (/career|careers|join|job|jobs|招聘|招贤纳士|社会招聘/i.test(`${title} ${snippet} ${url}`)) score += 12;
  if (/greenhouse|lever|ashby|workday|moka|beisen|smartrecruiters/i.test(hostname)) score += 8;
  if (/official|官网/i.test(`${title} ${snippet}`)) score += 4;
  return score;
}

function rankLocation(location, config) {
  const value = String(location || '');
  if ((config.location_priority?.high || []).some(token => value.includes(token))) return 'high';
  if ((config.location_priority?.medium || []).some(token => value.includes(token))) return 'medium';
  return 'low';
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'job';
}

function createJdMarkdown(detail, job, company, officialCareerUrl) {
  const lines = [
    `# ${job.title}`,
    '',
    `- Company: ${company.company_name}`,
    `- Industry: ${company.industry}`,
    `- Company Nature: ${company.company_nature}`,
    `- Location: ${detail.city || job.location || 'N/A'}`,
    `- Salary: ${detail.salary || 'N/A'}`,
    `- Experience: ${detail.experience || 'N/A'}`,
    `- Degree: ${detail.degree || 'N/A'}`,
    `- Boss URL: ${job.apply_url}`,
  ];
  if (officialCareerUrl) lines.push(`- Official Careers: ${officialCareerUrl}`);
  if (detail.industry) lines.push(`- Company Industry: ${detail.industry}`);
  if (detail.scale) lines.push(`- Company Size: ${detail.scale}`);
  if (detail.stage) lines.push(`- Stage: ${detail.stage}`);
  if (detail.skills) lines.push(`- Skills: ${detail.skills}`);
  if (detail.boss_name || detail.boss_title) {
    lines.push(`- Hiring Contact: ${[detail.boss_name, detail.boss_title].filter(Boolean).join(' | ')}`);
  }
  lines.push('', '## Job Description', '', String(detail.description || '').trim());
  return lines.join('\n') + '\n';
}

function ensurePipelineFile() {
  if (!existsSync(PIPELINE_PATH)) {
    writeFileSync(PIPELINE_PATH, '# Pipeline\n\n## Pendientes\n\n## Procesadas\n', 'utf-8');
  }
}

function appendToPipeline(offers) {
  if (offers.length === 0) return;
  ensurePipelineFile();
  let text = readFileSync(PIPELINE_PATH, 'utf-8');
  const marker = '## Pendientes';
  const idx = text.indexOf(marker);
  const lines = offers.map(offer => `- [ ] ${offer.local_jd} | ${offer.company} | ${offer.title} | apply: ${offer.apply_url}${offer.official_careers_url ? ` | careers: ${offer.official_careers_url}` : ''}`);
  if (idx === -1) {
    text += `\n## Pendientes\n\n${lines.join('\n')}\n`;
  } else {
    const nextSection = text.indexOf('\n## ', idx + marker.length);
    const insertAt = nextSection === -1 ? text.length : nextSection;
    text = `${text.slice(0, insertAt)}\n${lines.join('\n')}\n${text.slice(insertAt)}`;
  }
  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

function appendToScanHistory(offers, date) {
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n', 'utf-8');
  }
  appendFileSync(
    SCAN_HISTORY_PATH,
    offers.map(offer => `${offer.apply_url}\t${date}\tseed-discovery\t${offer.title}\t${offer.company}\tadded`).join('\n') + '\n',
    'utf-8'
  );
}

function loadSeenUrls() {
  const seen = new Set();
  if (existsSync(SCAN_HISTORY_PATH)) {
    const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n').slice(1);
    for (const line of lines) {
      const url = line.split('\t')[0];
      if (url) seen.add(url);
    }
  }
  return seen;
}

function loadFilteredCompanies(args) {
  const payload = JSON.parse(readFileSync(INPUT_PATH, 'utf-8'));
  let companies = payload.companies || [];
  if (args.company) {
    const needle = compactCompany(args.company);
    companies = companies.filter(company => compactCompany(company.company_name).includes(needle));
  }
  return companies.slice(0, args.limit);
}

function discoverOfficialCareer(company, config, autocliPath) {
  const candidates = new Map();
  for (const template of config.official_search_queries || []) {
    const query = renderTemplate(template, company);
    const results = runAutoCli([autocliPath, 'google', 'search', query, '--lang', 'zh', '--limit', '5', '--format', 'json']);
    for (const result of Array.isArray(results) ? results : []) {
      const url = String(result.url || '');
      if (!url) continue;
      const score = scoreOfficialResult(result, company, (config.ignored_domains || []).map(normalize));
      if (score < 0) continue;
      const existing = candidates.get(url);
      if (!existing || existing.score < score) {
        candidates.set(url, { ...result, score, query });
      }
    }
  }
  return [...candidates.values()].sort((a, b) => b.score - a.score)[0] || null;
}

function discoverBossJobs(company, config, titleFilter, autocliPath, seenUrls, officialCareerUrl, writePipeline) {
  const date = new Date().toISOString().slice(0, 10);
  const discovered = [];

  for (const template of config.boss_query_templates || []) {
    const query = renderTemplate(template, company);
    let results = [];
    try {
      results = runAutoCli([autocliPath, 'boss', 'search', query, '--limit', '10', '--format', 'json']);
    } catch {
      continue;
    }

    for (const result of Array.isArray(results) ? results : []) {
      const title = String(result.name || '').trim();
      const applyUrl = String(result.url || '').trim();
      const companyName = String(result.company || '').trim();
      const securityId = String(result.security_id || '').trim();
      if (!title || !applyUrl || !securityId) continue;
      if (!isLikelyCompanyMatch(company.company_name, companyName)) continue;
      if (!titleFilter(title)) continue;
      if (seenUrls.has(applyUrl)) continue;

      let detail;
      try {
        const payload = runAutoCli([autocliPath, 'boss', 'detail', securityId, '--format', 'json']);
        detail = Array.isArray(payload) ? payload[0] : payload;
      } catch {
        continue;
      }

      const description = String(detail?.description || '').trim();
      if (!description) continue;

      seenUrls.add(applyUrl);
      const fileName = `${slugify(company.company_name)}-${slugify(title)}-${date}.md`;
      const jdPath = `jds/${fileName}`;
      writeFileSync(jdPath, createJdMarkdown(detail, {
        title,
        location: result.area || '',
        apply_url: applyUrl,
      }, company, officialCareerUrl), 'utf-8');

      discovered.push({
        company: company.company_name,
        industry: company.industry,
        company_nature: company.company_nature,
        title,
        location: result.area || detail.city || '',
        location_rank: rankLocation(result.area || detail.city || '', config),
        salary: detail.salary || '',
        apply_url: applyUrl,
        official_careers_url: officialCareerUrl || '',
        local_jd: `local:${jdPath}`,
      });
    }
  }

  if (writePipeline && discovered.length > 0) {
    appendToPipeline(discovered);
    appendToScanHistory(discovered, date);
  }

  return discovered;
}

function writeReport(companies) {
  writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(companies, null, 2), 'utf-8');

  const lines = ['# Company Opportunities', ''];
  for (const company of companies) {
    lines.push(`## ${company.company_name}`);
    lines.push(`- Industry: ${company.industry}`);
    lines.push(`- Company Nature: ${company.company_nature}`);
    lines.push(`- Industry Class: ${company.industry_class}`);
    if (company.official_careers_url) lines.push(`- Official Careers: ${company.official_careers_url}`);
    if (company.official_careers_query) lines.push(`- Discovery Query: ${company.official_careers_query}`);
    lines.push(`- Boss Matches: ${company.boss_matches.length}`);
    lines.push('');
    for (const match of company.boss_matches) {
      lines.push(`- ${match.title} | ${match.location || 'N/A'} | ${match.apply_url}`);
      if (match.official_careers_url) lines.push(`  careers: ${match.official_careers_url}`);
    }
    lines.push('');
  }
  writeFileSync(OUTPUT_MD_PATH, lines.join('\n'), 'utf-8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(INPUT_PATH)) {
    console.error(`Input not found: ${INPUT_PATH}`);
    process.exit(1);
  }
  const portals = parseYaml(readFileSync(PORTALS_PATH, 'utf-8'));
  const discoveryConfig = parseYaml(readFileSync(DISCOVERY_CONFIG_PATH, 'utf-8'));
  const titleFilter = buildTitleFilter(portals.title_filter);
  const autocliPath = String(portals.autocli_sources?.[0]?.command?.[0] || '').trim();
  if (!autocliPath) {
    console.error('AutoCLI path not found in portals.yml');
    process.exit(1);
  }

  const seenUrls = loadSeenUrls();
  const companies = loadFilteredCompanies(args);
  const results = [];

  for (const company of companies) {
    let officialCareer = null;
    try {
      officialCareer = discoverOfficialCareer(company, discoveryConfig, autocliPath);
    } catch {
      officialCareer = null;
    }

    const officialCareerUrl = officialCareer?.url || company.official_notice_url || company.apply_url || '';
    const bossMatches = discoverBossJobs(
      company,
      discoveryConfig,
      titleFilter,
      autocliPath,
      seenUrls,
      officialCareerUrl,
      args.writePipeline
    );

    results.push({
      ...company,
      official_careers_url: officialCareerUrl,
      official_careers_query: officialCareer?.query || '',
      boss_matches: bossMatches,
    });
    console.log(`${company.company_name}: official=${officialCareerUrl || 'N/A'} boss=${bossMatches.length}`);
  }

  writeReport(results);
  console.log(`Saved ${OUTPUT_JSON_PATH} and ${OUTPUT_MD_PATH}`);
}

main();
