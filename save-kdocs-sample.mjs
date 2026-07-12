#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';

const parseYaml = yaml.load;
const PORTALS_PATH = 'portals.yml';
const DISCOVERY_CONFIG_PATH = 'config/company-discovery.yml';
const OUTPUT_JSON = 'data/kdocs-sample-10.json';
const OUTPUT_MD = 'data/kdocs-sample-10.md';

function normalize(value) {
  return String(value || '').replace(/\s+/g, '').trim().toLowerCase();
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
  return JSON.parse((result.stdout || '').trim());
}

function classifyIndustry(industry, config) {
  const value = String(industry || '');
  const containsAny = keywords => (keywords || []).some(keyword => value.includes(String(keyword)));
  if (containsAny(config.excluded_industries)) return 'excluded';
  if (containsAny(config.priority_industries)) return 'priority';
  if (containsAny(config.secondary_industries)) return 'secondary';
  return 'unknown';
}

function classifyDirection(sample, config, titleFilter) {
  const notes = [];
  const companyNatureOk = (config.allowed_company_natures || []).map(normalize).includes(normalize(sample.company_nature));
  if (companyNatureOk) notes.push('company_nature_ok');
  else notes.push('company_nature_filtered');

  const industryClass = classifyIndustry(sample.industry, config);
  notes.push(`industry_${industryClass}`);

  const roleMatch = titleFilter(String(sample.roles || ''));
  if (roleMatch) notes.push('roles_match_interest');
  else notes.push('roles_not_match_interest');

  const location = String(sample.location || '');
  const locationHigh = (config.location_priority?.high || []).some(token => location.includes(token));
  const locationMedium = (config.location_priority?.medium || []).some(token => location.includes(token));
  if (locationHigh) notes.push('location_high');
  else if (locationMedium) notes.push('location_medium');
  else notes.push('location_low');

  let score = 0;
  if (companyNatureOk) score += 3;
  if (industryClass === 'priority') score += 3;
  if (industryClass === 'secondary') score += 1;
  if (roleMatch) score += 3;
  if (locationHigh) score += 2;
  if (locationMedium) score += 1;

  const recommended = companyNatureOk && industryClass !== 'excluded' && roleMatch;
  return { recommended, score, notes, industry_class: industryClass };
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

function main() {
  mkdirSync('data', { recursive: true });
  const portals = parseYaml(readFileSync(PORTALS_PATH, 'utf-8'));
  const discoveryConfig = parseYaml(readFileSync(DISCOVERY_CONFIG_PATH, 'utf-8'));
  const titleFilter = buildTitleFilter(portals.title_filter);
  const autocliPath = String(portals.autocli_sources?.[0]?.command?.[0] || '').trim();
  if (!autocliPath) throw new Error('AutoCLI path not found in portals.yml');

  const rows = runAutoCli([autocliPath, 'kdocs', 'sample-ten', '--format', 'json']);
  const enriched = rows.map(row => ({
    ...row,
    ...classifyDirection(row, discoveryConfig, titleFilter),
  }));

  const stats = {
    total_captured: enriched.length,
    recommended_count: enriched.filter(item => item.recommended).length,
    near_match_count: enriched.filter(item => !item.recommended && item.score >= 6).length,
  };

  writeFileSync(OUTPUT_JSON, JSON.stringify({ stats, companies: enriched }, null, 2), 'utf-8');

  const lines = [
    '# KDocs Sample 10',
    '',
    `- Total Captured: ${stats.total_captured}`,
    `- Recommended Count: ${stats.recommended_count}`,
    `- Near Match Count: ${stats.near_match_count}`,
    ''
  ];
  for (const item of enriched) {
    lines.push(`## Row ${item.row} - ${item.company_name}`);
    lines.push(`- Company Nature: ${item.company_nature}`);
    lines.push(`- Industry: ${item.industry}`);
    lines.push(`- Industry Class: ${item.industry_class}`);
    lines.push(`- Roles: ${item.roles}`);
    lines.push(`- Location: ${item.location}`);
    lines.push(`- Recommended: ${item.recommended ? 'yes' : 'no'}`);
    lines.push(`- Score: ${item.score}`);
    lines.push(`- Notes: ${item.notes.join(', ')}`);
    if (item.official_notice_url) lines.push(`- Official Notice: ${item.official_notice_url}`);
    if (item.apply_url) lines.push(`- Apply URL: ${item.apply_url}`);
    lines.push('');
  }
  writeFileSync(OUTPUT_MD, lines.join('\n'), 'utf-8');

  console.log(`Saved ${OUTPUT_JSON} and ${OUTPUT_MD}`);
}

main();
