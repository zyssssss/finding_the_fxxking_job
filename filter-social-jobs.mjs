#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';

const INPUT = 'data/kdocs-full.filtered.json';
const OUT_JSON = 'data/social-jobs-shortlist.json';

function isCampusLike(text) {
  return /校招|校园|campus|school|graduate|应届|intern|实习|xiaozhao|校園/i.test(String(text || ''));
}

const d = JSON.parse(readFileSync(INPUT, 'utf-8'));
const companies = (d.recommended || []).filter(c => {
  const campus = isCampusLike(`${c.apply_url || ''} ${c.roles || ''} ${c.target || ''} ${c.batch || ''}`);
  return !campus;
});

const out = {
  stats: {
    recommended_total: (d.recommended || []).length,
    campus_filtered_out: (d.recommended || []).length - companies.length,
    kept_for_social: companies.length,
  },
  companies: companies.map(c => ({
    company_name: c.company_name,
    company_nature: c.company_nature,
    industry: c.industry,
    roles: c.roles,
    location: c.location,
    score: c.score,
    apply_url: c.apply_url,
    official_notice_url: c.official_notice_url,
    deadline: c.deadline,
    target: c.target,
    status: c.status,
  })),
};

writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), 'utf-8');
console.log(JSON.stringify(out.stats));
console.log(`Saved ${OUT_JSON}`);
