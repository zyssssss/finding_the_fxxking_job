#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';

const parseYaml = yaml.load;
const INPUT = 'data/kdocs-full.filtered.json';
const PORTALS = 'portals.yml';
const OUT_JSON = 'data/social-jobs-shortlist.json';

function run(cmd) {
  const [bin, ...args] = cmd;
  const r = spawnSync(bin, args, { encoding: 'utf-8', shell: false, maxBuffer: 10 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.status}`).trim());
  return JSON.parse((r.stdout || '').trim());
}

function hasSignal(text) {
  return /社招|社会招聘|careers|career|jobs|join|recruit|talent|hire/i.test(String(text));
}

function official(url, title, name) {
  const u = String(url || ''), t = String(title || '');
  if (!u) return 0;
  if (/zhipin|boss|liepin|51job|zhaopin|yingjiesheng|kanzhun|nowcoder|shushuqiuzhi|upcv|bebee|indeed|qcc|linkedin|edu\.cn/i.test(u)) return 0;
  if (/校招|校园|campus|school|graduate|xiaozhao/i.test(u + t)) return 0;
  let s = 0;
  if (t.includes(name)) s += 8;
  if (hasSignal(u + t)) s += 10;
  if (/zhiye\.com|hotjob\.cn|feishu\.cn|mokahr\.com|workday/i.test(u)) s += 6;
  return s;
}

function findOfficial(c, bin) {
  const qs = [`${c.company_name} 社会招聘 官网`, `${c.company_name} 社招`, `${c.company_name} careers`];
  const cand = [];
  for (const q of qs) {
    try {
      for (const r of run([bin, 'google', 'search', q, '--lang', 'zh', '--limit', '5', '--format', 'json'])) {
        const s = official(r.url, r.title, c.company_name);
        if (s > 0) cand.push({ url: r.url, title: r.title, score: s });
      }
    } catch {}
  }
  cand.sort((a, b) => b.score - a.score);
  return cand[0] || null;
}

function findBoss(c, bin) {
  const qs = [`site:zhipin.com ${c.company_name} 销售`, `site:zhipin.com ${c.company_name} 商务拓展`, `site:zhipin.com ${c.company_name} 产品经理`, `site:zhipin.com ${c.company_name} 渠道`];
  const seen = new Set();
  const out = [];
  for (const q of qs) {
    try {
      for (const r of run([bin, 'google', 'search', q, '--lang', 'zh', '--limit', '3', '--format', 'json'])) {
        const u = String(r.url || '');
        if (!/zhipin\.com/.test(u)) continue;
        const m = (r.snippet || '').match(/(\d+(?:\.\d+)?)\s*[-~]\s*(\d+(?:\.\d+)?)\s*[Kk]/);
        if (m && Number(m[1]) < 15) continue;
        if (seen.has(u)) continue;
        seen.add(u);
        out.push({ url: u, title: r.title, snippet: (r.snippet || '').slice(0, 120) });
        if (out.length >= 5) break;
      }
    } catch {}
  }
  return out;
}

function main() {
  const d = JSON.parse(readFileSync(INPUT, 'utf-8'));
  const portals = parseYaml(readFileSync(PORTALS, 'utf-8'));
  const bin = String(portals.autocli_sources?.[0]?.command?.[0] || '').trim();
  if (!bin) throw new Error('AutoCLI path not found');

  const companies = d.recommended || [];
  const shortlist = [];
  for (const c of companies) {
    const official = findOfficial(c, bin);
    const boss = findBoss(c, bin);
    shortlist.push({
      company_name: c.company_name,
      company_nature: c.company_nature,
      industry: c.industry,
      roles: c.roles,
      location: c.location,
      score: c.score,
      kdocs_apply: c.apply_url,
      social_careers_url: official?.url || '',
      social_careers_title: official?.title || '',
      boss_positions: boss,
    });
    console.log(`${c.company_name}: 社招=${official?.url || 'N/A'} boss=${boss.length}`);
    writeFileSync(OUT_JSON, JSON.stringify({
      stats: { total: companies.length, with_social: shortlist.filter(i => i.social_careers_url).length, with_boss: shortlist.filter(i => i.boss_positions.length).length },
      shortlist
    }, null, 2), 'utf-8');
  }
  console.log(`Saved ${OUT_JSON}`);
}

main();
