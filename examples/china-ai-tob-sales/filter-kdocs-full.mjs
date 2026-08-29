#!/usr/bin/env node

// Example-only legacy filter. The generic runtime does not import this file.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import yaml from 'js-yaml';

const parseYaml = yaml.load;
const INPUT_PATH = 'data/kdocs-full.json';
const DISCOVERY_CONFIG_PATH = 'config/company-discovery.yml';
const PORTALS_PATH = 'portals.yml';
const OUTPUT_JSON = 'data/kdocs-full.filtered.json';
const OUTPUT_MD = 'data/kdocs-full.filtered.md';

function normalize(value) {
  return String(value || '').replace(/\s+/g, '').trim().toLowerCase();
}

function includesAny(value, keywords) {
  const text = String(value || '');
  return (keywords || []).some(keyword => text.includes(String(keyword)));
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

function companyNatureAllowed(value, allowed) {
  const normalized = normalize(value);
  if (allowed.map(normalize).includes(normalized)) return true;
  if (normalized.includes('港澳') && normalized.includes('合资')) return true;
  return false;
}

function classifyIndustry(industry, config) {
  if (includesAny(industry, config.excluded_industries)) return 'excluded';
  if (includesAny(industry, config.priority_industries)) return 'priority';
  if (includesAny(industry, config.secondary_industries)) return 'secondary';
  return 'unknown';
}

function classifyLocation(location, config) {
  if (includesAny(location, config.location_priority?.high)) return 'high';
  if (includesAny(location, config.location_priority?.medium)) return 'medium';
  return 'low';
}

function computeRowScore(row, config, titleFilter) {
  const natureOk = companyNatureAllowed(row.company_nature, config.allowed_company_natures || []);
  const industryClass = classifyIndustry(row.industry, config);
  const rolesMatch = titleFilter(row.roles || '');
  const locationClass = classifyLocation(row.location, config);

  let score = 0;
  const notes = [];

  if (natureOk) {
    score += 3;
    notes.push('company_nature_ok');
  } else {
    notes.push('company_nature_filtered');
  }

  if (industryClass === 'priority') {
    score += 4;
    notes.push('industry_priority');
  } else if (industryClass === 'secondary') {
    score += 2;
    notes.push('industry_secondary');
  } else if (industryClass === 'excluded') {
    notes.push('industry_excluded');
  } else {
    notes.push('industry_unknown');
  }

  if (rolesMatch) {
    score += 3;
    notes.push('roles_match_interest');
  } else {
    notes.push('roles_not_match_interest');
  }

  if (locationClass === 'high') {
    score += 2;
    notes.push('location_high');
  } else if (locationClass === 'medium') {
    score += 1;
    notes.push('location_medium');
  } else {
    notes.push('location_low');
  }

  const strongCompanyIndustry = natureOk && (industryClass === 'priority' || industryClass === 'secondary');
  const recommended = strongCompanyIndustry && rolesMatch;
  const nearMatch = !recommended && natureOk && industryClass === 'priority' && score >= 6;

  return {
    ...row,
    recommended,
    near_match: nearMatch,
    strong_company_industry: strongCompanyIndustry,
    score,
    notes,
    industry_class: industryClass,
    location_class: locationClass,
  };
}

function dedupeByCompany(rows) {
  const byCompany = new Map();
  for (const row of rows) {
    const key = normalize(row.company_name);
    if (!key) continue;
    const existing = byCompany.get(key);
    if (!existing || existing.score < row.score || (existing.score === row.score && row.recommended && !existing.recommended)) {
      byCompany.set(key, row);
    }
  }
  return [...byCompany.values()].sort((a, b) => b.score - a.score || a.row - b.row);
}

function main() {
  for (const path of [INPUT_PATH, DISCOVERY_CONFIG_PATH, PORTALS_PATH]) {
    if (!existsSync(path)) throw new Error(`Required file not found: ${path}`);
  }
  mkdirSync('data', { recursive: true });
  const input = JSON.parse(readFileSync(INPUT_PATH, 'utf-8'));
  const config = parseYaml(readFileSync(DISCOVERY_CONFIG_PATH, 'utf-8'));
  const portals = parseYaml(readFileSync(PORTALS_PATH, 'utf-8'));
  const titleFilter = buildTitleFilter(portals.title_filter);

  const scoredRows = (input.rows || []).map(row => computeRowScore(row, config, titleFilter));
  const nonEmptyRows = scoredRows.filter(row => String(row.company_name || '').trim() !== '');
  const dedupedCompanies = dedupeByCompany(nonEmptyRows);
  const recommended = dedupedCompanies.filter(row => row.recommended);
  const nearMatch = dedupedCompanies.filter(row => row.near_match);
  const strongCompanyIndustry = dedupedCompanies.filter(row => row.strong_company_industry);

  const payload = {
    stats: {
      total_rows: nonEmptyRows.length,
      unique_companies: dedupedCompanies.length,
      recommended_count: recommended.length,
      near_match_count: nearMatch.length,
      strong_company_industry_count: strongCompanyIndustry.length,
    },
    recommended,
    near_match: nearMatch,
    strong_company_industry: strongCompanyIndustry,
    companies: dedupedCompanies,
  };

  writeFileSync(OUTPUT_JSON, JSON.stringify(payload, null, 2), 'utf-8');

  const lines = [
    '# KDocs Full Filtered',
    '',
    `- Total Rows: ${payload.stats.total_rows}`,
    `- Unique Companies: ${payload.stats.unique_companies}`,
    `- Recommended Count: ${payload.stats.recommended_count}`,
    `- Near Match Count: ${payload.stats.near_match_count}`,
    `- Strong Company + Industry Count: ${payload.stats.strong_company_industry_count}`,
    '',
    '## Recommended',
    '',
  ];

  for (const row of recommended.slice(0, 100)) {
    lines.push(`- ${row.company_name} | ${row.industry} | ${row.company_nature} | score=${row.score}`);
    lines.push(`  roles: ${row.roles}`);
    lines.push(`  location: ${row.location}`);
    lines.push(`  apply: ${row.apply_url}`);
  }

  lines.push('', '## Near Match', '');
  for (const row of nearMatch.slice(0, 100)) {
    lines.push(`- ${row.company_name} | ${row.industry} | ${row.company_nature} | score=${row.score}`);
    lines.push(`  roles: ${row.roles}`);
    lines.push(`  location: ${row.location}`);
    lines.push(`  apply: ${row.apply_url}`);
  }

  lines.push('', '## Strong Company + Industry', '');
  for (const row of strongCompanyIndustry.slice(0, 150)) {
    lines.push(`- ${row.company_name} | ${row.industry} | ${row.company_nature} | score=${row.score}`);
    lines.push(`  roles: ${row.roles}`);
    lines.push(`  location: ${row.location}`);
    lines.push(`  apply: ${row.apply_url}`);
  }

  writeFileSync(OUTPUT_MD, lines.join('\n') + '\n', 'utf-8');
  console.log(`Saved ${OUTPUT_JSON} and ${OUTPUT_MD}`);
}

main();
