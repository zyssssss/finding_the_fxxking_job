#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';

const INPUT_PATH = 'data/kdocs-full.filtered.json';
const OUTPUT_JSON = 'data/kdocs-second-pass.json';
const OUTPUT_MD = 'data/kdocs-second-pass.md';

const priorityIndustryKeywords = [
  '半导体',
  '芯片',
  '集成电路',
  '人工智能',
  'ai',
  '云计算',
  '软件',
  '网络安全',
  '通信',
  '云通讯',
  '互联网',
  '电商',
  '跨境电商',
  '出海营销',
  '供应链',
  '进出口贸易',
  '物流',
  '支付',
  '跨境支付',
  'web3',
  '区块链',
];

const priorityRoleKeywords = [
  '销售',
  '商务',
  '渠道',
  '客户经理',
  '大客户',
  'bd',
  '商务拓展',
  '解决方案',
  '售前',
  '海外',
  '出海',
  '国际化',
  '营销',
  '客户成功',
  '管培生',
];

function includesAny(text, keywords) {
  const value = String(text || '').toLowerCase();
  return keywords.some(keyword => value.includes(String(keyword).toLowerCase()));
}

function classifyCompany(row) {
  const notes = [];
  let score = 0;

  if (row.company_nature && String(row.company_nature).includes('外企')) {
    score += 4;
    notes.push('foreign_company');
  } else if (row.company_nature && String(row.company_nature).includes('港澳')) {
    score += 3;
    notes.push('hk_macao_joint_venture');
  } else {
    score += 2;
    notes.push('private_company');
  }

  if (includesAny(row.industry, priorityIndustryKeywords)) {
    score += 4;
    notes.push('priority_industry_keyword');
  }

  if (includesAny(row.location, ['深圳'])) {
    score += 4;
    notes.push('shenzhen');
  } else if (includesAny(row.location, ['广州', '东莞', '珠海', '香港', '全国', '海外', '全球'])) {
    score += 2;
    notes.push('location_adjacent_or_travel');
  }

  if (includesAny(row.roles, priorityRoleKeywords)) {
    score += 4;
    notes.push('role_priority_keyword');
  }

  if (String(row.official_notice_text || '').includes('补录')) {
    score -= 1;
    notes.push('supplemental_hiring');
  }

  let tier = 'watchlist';
  if (score >= 12) tier = 'tier1';
  else if (score >= 9) tier = 'tier2';
  else if (score >= 7) tier = 'tier3';

  return { ...row, second_pass_score: score, second_pass_tier: tier, second_pass_notes: notes };
}

function main() {
  const payload = JSON.parse(readFileSync(INPUT_PATH, 'utf-8'));
  const source = payload.strong_company_industry || [];
  const enriched = source.map(classifyCompany).sort((a, b) => b.second_pass_score - a.second_pass_score || b.score - a.score || a.row - b.row);

  const tier1 = enriched.filter(item => item.second_pass_tier === 'tier1');
  const tier2 = enriched.filter(item => item.second_pass_tier === 'tier2');
  const tier3 = enriched.filter(item => item.second_pass_tier === 'tier3');

  const out = {
    stats: {
      strong_company_industry_source_count: source.length,
      tier1_count: tier1.length,
      tier2_count: tier2.length,
      tier3_count: tier3.length,
      watchlist_count: enriched.length - tier1.length - tier2.length - tier3.length,
    },
    tier1,
    tier2,
    tier3,
    companies: enriched,
  };

  writeFileSync(OUTPUT_JSON, JSON.stringify(out, null, 2), 'utf-8');

  const lines = [
    '# KDocs Second Pass',
    '',
    `- Strong Company + Industry Source Count: ${out.stats.strong_company_industry_source_count}`,
    `- Tier1 Count: ${out.stats.tier1_count}`,
    `- Tier2 Count: ${out.stats.tier2_count}`,
    `- Tier3 Count: ${out.stats.tier3_count}`,
    `- Watchlist Count: ${out.stats.watchlist_count}`,
    '',
    '## Tier1',
    ''
  ];

  for (const item of tier1.slice(0, 200)) {
    lines.push(`- ${item.company_name} | ${item.company_nature} | ${item.industry} | score=${item.second_pass_score}`);
    lines.push(`  roles: ${item.roles}`);
    lines.push(`  location: ${item.location}`);
    lines.push(`  apply: ${item.apply_url}`);
  }

  lines.push('', '## Tier2', '');
  for (const item of tier2.slice(0, 200)) {
    lines.push(`- ${item.company_name} | ${item.company_nature} | ${item.industry} | score=${item.second_pass_score}`);
    lines.push(`  roles: ${item.roles}`);
    lines.push(`  location: ${item.location}`);
    lines.push(`  apply: ${item.apply_url}`);
  }

  writeFileSync(OUTPUT_MD, lines.join('\n') + '\n', 'utf-8');
  console.log(`Saved ${OUTPUT_JSON} and ${OUTPUT_MD}`);
}

main();
