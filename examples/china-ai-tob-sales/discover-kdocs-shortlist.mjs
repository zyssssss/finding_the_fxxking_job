#!/usr/bin/env node

// Example-only legacy discovery flow. The generic runtime does not import this file.

import { readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';

const parseYaml = yaml.load;
const INPUT_PATH = 'data/kdocs-full.filtered.json';
const PORTALS_PATH = 'portals.yml';
const OUTPUT_JSON = 'data/kdocs-top-shortlist.json';
const OUTPUT_MD = 'data/kdocs-top-shortlist.md';

const args = process.argv.slice(2);
let limit = 0;
let offset = 0;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit') limit = Number(args[++i] || '10');
  if (args[i] === '--offset') offset = Number(args[++i] || '0');
}

function runAutoCli(commandParts) {
  const [command, ...rest] = commandParts;
  const result = spawnSync(command, rest, {
    encoding: 'utf-8',
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `exit ${result.status}`).trim());
  }
  return JSON.parse((result.stdout || '').trim());
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '').trim();
}

function isCampusLike(text) {
  return /校招|校园|应届生|管培生|实习|campus|xiaozhao|graduates|students/i.test(String(text || ''));
}

function parseBossSalaryFloor(text) {
  const value = String(text || '');
  const match = value.match(/(\d+(?:\.\d+)?)\s*[-~]\s*(\d+(?:\.\d+)?)\s*[Kk]/);
  if (!match) return null;
  return Number(match[1]);
}

function scoreOfficial(result, companyName) {
  const url = String(result.url || '');
  const title = String(result.title || '');
  const snippet = String(result.snippet || '');
  let score = 0;
  if (!url) return -100;
  if (/zhipin|boss|liepin|51job|zhaopin|yingjiesheng|jobui|kanzhun|niuqi|nowcoder|shushuqiuzhi|upcv|cuhk/i.test(url)) return -100;
  if (isCampusLike(`${url} ${title} ${snippet}`)) return -100;
  if (title.includes(companyName) || snippet.includes(companyName)) score += 10;
  if (/招聘|招贤纳士|社会招聘|careers|career|jobs|join/i.test(`${title} ${snippet} ${url}`)) score += 10;
  if (/moka|workday|greenhouse|lever|ashby|zhiye|hotjob|feishu/i.test(url)) score += 6;
  return score;
}

function discoverOfficial(company, autocliPath) {
  const queries = [
    `${company.company_name} 社会招聘 官网`,
    `${company.company_name} careers`
  ];
  const candidates = [];
  for (const query of queries) {
    let results = [];
    try {
      results = runAutoCli([autocliPath, 'google', 'search', query, '--lang', 'zh', '--limit', '5', '--format', 'json']);
    } catch {
      continue;
    }
    for (const result of results) {
      const score = scoreOfficial(result, company.company_name);
      if (score > 0) candidates.push({ ...result, score, query });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

function discoverBoss(company, autocliPath) {
  const queries = [
    `site:zhipin.com ${company.company_name} 深圳 销售`,
    `site:zhipin.com ${company.company_name} 商务拓展`
  ];
  const urls = [];
  const seen = new Set();
  for (const query of queries) {
    let results = [];
    try {
      results = runAutoCli([autocliPath, 'google', 'search', query, '--lang', 'zh', '--limit', '5', '--format', 'json']);
    } catch {
      continue;
    }
    for (const result of results) {
      const url = String(result.url || '');
      if (!/zhipin\.com/.test(url)) continue;
      const salaryFloor = parseBossSalaryFloor(`${result.title || ''} ${result.snippet || ''}`);
      if (salaryFloor !== null && salaryFloor < 15) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
      if (urls.length >= 5) return urls;
    }
  }
  return urls;
}

function main() {
  const payload = JSON.parse(readFileSync(INPUT_PATH, 'utf-8'));
  const portals = parseYaml(readFileSync(PORTALS_PATH, 'utf-8'));
  const autocliPath = String(portals.autocli_sources?.[0]?.command?.[0] || '').trim();
  if (!autocliPath) throw new Error('AutoCLI path not found in portals.yml');

  const source = payload.recommended || [];
  const selected = limit > 0 ? source.slice(offset, offset + limit) : source.slice(offset);
  let existing = { stats: {}, shortlist: [] };
  try {
    existing = JSON.parse(readFileSync(OUTPUT_JSON, 'utf-8'));
  } catch {}
  const done = new Set((existing.shortlist || []).map(item => item.company_name));
  const shortlist = [...(existing.shortlist || [])];

  const persist = () => {
    const out = {
      stats: {
        source_recommended_count: (payload.recommended || []).length,
        shortlist_count: shortlist.length,
        total_with_official: shortlist.filter(item => item.official_careers_url).length,
        total_with_boss: shortlist.filter(item => item.boss_urls.length > 0).length,
        processed_offset: offset,
        processed_limit: limit || selected.length,
      },
      shortlist,
    };
    writeFileSync(OUTPUT_JSON, JSON.stringify(out, null, 2), 'utf-8');

    const lines = [
      '# KDocs Top Shortlist',
      '',
      `- Source Recommended Count: ${out.stats.source_recommended_count}`,
      `- Shortlist Count: ${out.stats.shortlist_count}`,
      `- With Official Careers: ${out.stats.total_with_official}`,
      `- With Boss URLs: ${out.stats.total_with_boss}`,
      `- Processed Offset: ${out.stats.processed_offset}`,
      `- Processed Limit: ${out.stats.processed_limit}`,
      ''
    ];
    for (const item of shortlist) {
      lines.push(`## ${item.company_name}`);
      lines.push(`- Industry: ${item.industry}`);
      lines.push(`- Company Nature: ${item.company_nature}`);
      lines.push(`- Score: ${item.score}`);
      lines.push(`- Roles: ${item.roles}`);
      lines.push(`- Location: ${item.location}`);
      lines.push(`- KDocs Apply: ${item.apply_url}`);
      if (item.official_careers_url) lines.push(`- Official Careers: ${item.official_careers_url}`);
      if (item.official_notice_url) lines.push(`- Official Notice: ${item.official_notice_url}`);
      if (item.boss_urls.length > 0) {
        lines.push('- Boss URLs:');
        for (const url of item.boss_urls) lines.push(`  - ${url}`);
      }
      lines.push('');
    }
    writeFileSync(OUTPUT_MD, lines.join('\n'), 'utf-8');
  };

  const companies = selected.filter(company => !done.has(company.company_name));
  for (const company of companies) {
    const official = discoverOfficial(company, autocliPath);
    const bossUrls = discoverBoss(company, autocliPath);
    shortlist.push({
      company_name: company.company_name,
      industry: company.industry,
      company_nature: company.company_nature,
      roles: company.roles,
      location: company.location,
      score: company.score,
      apply_url: company.apply_url,
      official_notice_url: company.official_notice_url,
      official_careers_url: official?.url || '',
      official_query: official?.query || '',
      boss_urls: bossUrls,
    });
    persist();
    console.log(`${company.company_name}: official=${official?.url || 'N/A'} boss=${bossUrls.length}`);
  }
  persist();
  console.log(`Saved ${OUTPUT_JSON} and ${OUTPUT_MD}`);
}

main();
