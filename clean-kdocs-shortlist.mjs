#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';

const INPUT_PATH = 'data/kdocs-top-shortlist.json';
const OUTPUT_JSON = 'data/kdocs-top-shortlist.cleaned.json';
const OUTPUT_MD = 'data/kdocs-top-shortlist.cleaned.md';

const blacklistHosts = [
  'linkedin.com',
  'indeed.com',
  'qcc.com',
  'bebee.com',
  'nowcoder.com',
  'shushuqiuzhi.com',
  'iguopin.com',
  'job.mohrss.gov.cn',
  'remote-info.cn',
  'upcv.tech',
  'gaoxiaojob.com',
  'goodjobs.cn',
  'jrzp.com',
  'career.xujc.com',
  'career.nankai.edu.cn',
  'career.sues.edu.cn',
  'career.zju.edu.cn',
  'job.lzu.edu.cn',
  'job.tju.edu.cn',
  'job.gzus.edu.cn',
  'jobcareer.sdu.edu.cn',
  'ncss.cn',
  'sme-career.cuhk.edu.cn',
  'zjgsu.edu.cn',
  'xjhr.com',
  'sohu.com',
  'sina.com.cn',
  'money.finance.sina.com.cn',
  'yingjiesheng.com',
  'liepin.com',
  '51haojob.com',
  'offertoday.com',
  'lingshangdao.com',
  'university-hr.com',
  'bendibao.com',
];

const trustedAtsHosts = [
  'zhiye.com',
  'hotjob.cn',
  'feishu.cn',
  'myworkdayjobs.com',
  'workdayjobs.com',
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'csod.com',
  'moka.com',
  'mokahr.com',
  'smartrecruiters.com',
];

function normalizeHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

function hostMatches(hostname, patterns) {
  const host = normalizeHost(hostname);
  return patterns.some(pattern => host === pattern || host.endsWith(`.${pattern}`));
}

function hasCareerSignal(url) {
  return /career|careers|jobs|job|join|recruit|recruitment|talent|hire|social|shzp|campus-recruitment/i.test(String(url || ''));
}

function isDocumentLike(pathname) {
  return /\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/i.test(String(pathname || ''));
}

function isNewsLike(url) {
  return /\/news|\/article|\/info|\/detail|\/content|\/company-info|\/view\//i.test(String(url || ''));
}

function cleanOfficialUrl(rawUrl) {
  if (!rawUrl) return '';
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return '';
  }

  const host = normalizeHost(parsed.hostname);
  const href = parsed.toString();

  if (host.endsWith('.edu.cn')) return '';
  if (hostMatches(host, blacklistHosts)) return '';
  if (isDocumentLike(parsed.pathname)) return '';
  if (isNewsLike(href) && !hasCareerSignal(href)) return '';

  if (hostMatches(host, trustedAtsHosts)) return href;
  if (hasCareerSignal(href)) return href;

  return href;
}

function main() {
  const payload = JSON.parse(readFileSync(INPUT_PATH, 'utf-8'));
  const cleaned = (payload.shortlist || []).map(item => ({
    ...item,
    official_careers_url: cleanOfficialUrl(item.official_careers_url),
  }));

  const stats = {
    ...payload.stats,
    cleaned_shortlist_count: cleaned.length,
    cleaned_with_official: cleaned.filter(item => item.official_careers_url).length,
    cleaned_without_official: cleaned.filter(item => !item.official_careers_url).length,
  };

  const out = { stats, shortlist: cleaned };
  writeFileSync(OUTPUT_JSON, JSON.stringify(out, null, 2), 'utf-8');

  const lines = [
    '# KDocs Top Shortlist Cleaned',
    '',
    `- Source Recommended Count: ${stats.source_recommended_count}`,
    `- Shortlist Count: ${stats.shortlist_count}`,
    `- With Official Careers Before Clean: ${stats.total_with_official}`,
    `- With Official Careers After Clean: ${stats.cleaned_with_official}`,
    `- Without Official Careers After Clean: ${stats.cleaned_without_official}`,
    `- With Boss URLs: ${stats.total_with_boss}`,
    ''
  ];

  for (const item of cleaned) {
    lines.push(`## ${item.company_name}`);
    lines.push(`- Industry: ${item.industry}`);
    lines.push(`- Company Nature: ${item.company_nature}`);
    lines.push(`- Score: ${item.score}`);
    lines.push(`- Roles: ${item.roles}`);
    lines.push(`- Location: ${item.location}`);
    lines.push(`- KDocs Apply: ${item.apply_url}`);
    if (item.official_careers_url) lines.push(`- Official Careers: ${item.official_careers_url}`);
    else lines.push('- Official Careers: [filtered out during cleanup]');
    if (item.official_notice_url) lines.push(`- Official Notice: ${item.official_notice_url}`);
    if ((item.boss_urls || []).length > 0) {
      lines.push('- Boss URLs:');
      for (const url of item.boss_urls) lines.push(`  - ${url}`);
    }
    lines.push('');
  }

  writeFileSync(OUTPUT_MD, lines.join('\n'), 'utf-8');
  console.log(`Saved ${OUTPUT_JSON} and ${OUTPUT_MD}`);
}

main();
