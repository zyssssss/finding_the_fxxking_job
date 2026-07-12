#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';

const parseYaml = yaml.load;
const PORTALS_PATH = 'portals.yml';
const OUTPUT_JSON = 'data/kdocs-full.json';
const OUTPUT_MD = 'data/kdocs-full.md';

const args = process.argv.slice(2);
let startRow = 4;
let endRow = 1969;
let chunkSize = 100;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--start-row') startRow = Number(args[++i] || '4');
  if (arg === '--end-row') endRow = Number(args[++i] || '1969');
  if (arg === '--chunk-size') chunkSize = Number(args[++i] || '100');
}

function runAutoCli(commandParts) {
  const [command, ...rest] = commandParts;
  const result = spawnSync(command, rest, {
    encoding: 'utf-8',
    shell: false,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `exit ${result.status}`).trim());
  }
  return JSON.parse((result.stdout || '').trim());
}

function main() {
  mkdirSync('data', { recursive: true });
  const portals = parseYaml(readFileSync(PORTALS_PATH, 'utf-8'));
  const autocliPath = String(portals.autocli_sources?.[0]?.command?.[0] || '').trim();
  if (!autocliPath) {
    throw new Error('AutoCLI path not found in portals.yml');
  }

  const rows = [];
  for (let current = startRow; current <= endRow; current += chunkSize) {
    const chunkEnd = Math.min(endRow, current + chunkSize - 1);
    console.log(`Reading rows ${current}-${chunkEnd}`);
    const chunk = runAutoCli([
      autocliPath,
      'kdocs',
      'full',
      '--start_row',
      String(current),
      '--end_row',
      String(chunkEnd),
      '--format',
      'json'
    ]);
    rows.push(...chunk);
  }

  const nonEmptyRows = rows.filter(row => String(row.company_name || '').trim() !== '');
  const payload = {
    stats: {
      requested_start_row: startRow,
      requested_end_row: endRow,
      total_rows_read: rows.length,
      non_empty_company_rows: nonEmptyRows.length,
    },
    rows,
  };

  writeFileSync(OUTPUT_JSON, JSON.stringify(payload, null, 2), 'utf-8');

  const industryCounts = {};
  const natureCounts = {};
  for (const row of nonEmptyRows) {
    const ind = String(row.industry || '未知行业');
    industryCounts[ind] = (industryCounts[ind] || 0) + 1;
    const nat = String(row.company_nature || '未知性质');
    natureCounts[nat] = (natureCounts[nat] || 0) + 1;
  }

  const lines = [
    '# KDocs Full Extraction',
    '',
    `- Requested Start Row: ${startRow}`,
    `- Requested End Row: ${endRow}`,
    `- Total Rows Read: ${rows.length}`,
    `- Non-empty Company Rows: ${nonEmptyRows.length}`,
    '',
    '## 企业性质分布',
    '',
    ...Object.entries(natureCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `- ${k}: ${v} 家`),
    '',
    '## 行业分布',
    '',
    ...Object.entries(industryCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `- ${k}: ${v} 家`),
    '',
    '## 全部公司',
    '',
  ];
  for (const row of nonEmptyRows) {
    lines.push(`- Row ${row.row} | ${row.company_name} | ${row.industry} | ${row.company_nature} | ${row.location}`);
  }
  writeFileSync(OUTPUT_MD, lines.join('\n') + '\n', 'utf-8');
  console.log(`Saved ${OUTPUT_JSON} and ${OUTPUT_MD}`);
}

main();
