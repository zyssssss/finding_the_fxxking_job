#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import yaml from 'js-yaml';

const parseYaml = yaml.load;
const INPUT_PATH = process.argv[2] || 'data/company-seeds.json';
const OUTPUT_PATH = process.argv[3] || 'data/company-seeds.filtered.json';
const CONFIG_PATH = 'config/company-discovery.yml';

function normalize(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function ensureParentDir(path) {
  const parts = path.split(/[\\/]/);
  parts.pop();
  const dir = parts.join('/');
  if (dir) mkdirSync(dir, { recursive: true });
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function classifyIndustry(industry, config) {
  const value = normalize(industry);
  if (!value) return 'unknown';

  const containsAny = keywords => keywords.some(keyword => value.includes(normalize(keyword)));
  if (containsAny(config.excluded_industries || [])) return 'excluded';
  if (containsAny(config.priority_industries || [])) return 'priority';
  if (containsAny(config.secondary_industries || [])) return 'secondary';
  return 'unknown';
}

function main() {
  if (!existsSync(INPUT_PATH)) {
    console.error(`Input not found: ${INPUT_PATH}`);
    process.exit(1);
  }
  if (!existsSync(CONFIG_PATH)) {
    console.error(`Config not found: ${CONFIG_PATH}`);
    process.exit(1);
  }

  const seeds = loadJson(INPUT_PATH);
  const config = parseYaml(readFileSync(CONFIG_PATH, 'utf-8'));
  const allowedNatures = new Set((config.allowed_company_natures || []).map(normalize));
  const seen = new Set();

  const filtered = [];
  const stats = {
    total: Array.isArray(seeds) ? seeds.length : 0,
    kept: 0,
    filtered_nature: 0,
    filtered_industry: 0,
    duplicates: 0,
  };

  for (const seed of Array.isArray(seeds) ? seeds : []) {
    const companyName = String(seed.company_name || '').trim();
    const companyNature = normalize(seed.company_nature);
    const industryClass = classifyIndustry(seed.industry, config);
    if (!companyName) continue;
    if (!allowedNatures.has(companyNature)) {
      stats.filtered_nature++;
      continue;
    }
    if (industryClass === 'excluded' || industryClass === 'unknown') {
      stats.filtered_industry++;
      continue;
    }

    const key = normalize(companyName);
    if (seen.has(key)) {
      stats.duplicates++;
      continue;
    }
    seen.add(key);

    filtered.push({
      ...seed,
      company_name: companyName,
      company_nature: String(seed.company_nature || '').trim(),
      industry: String(seed.industry || '').trim(),
      industry_class: industryClass,
    });
  }

  stats.kept = filtered.length;
  ensureParentDir(OUTPUT_PATH);
  writeFileSync(OUTPUT_PATH, JSON.stringify({ stats, companies: filtered }, null, 2), 'utf-8');

  console.log(`Filtered companies saved to ${OUTPUT_PATH}`);
  console.log(JSON.stringify(stats, null, 2));
}

main();
