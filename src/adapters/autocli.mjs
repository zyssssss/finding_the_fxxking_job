import { spawnSync } from 'node:child_process';
import { SOURCE_DEFINITIONS } from '../core/sources.mjs';

function itemsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['results', 'items', 'jobs', 'data']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function normalizeJob(item, task) {
  const title = item.title || item.name || item.jobName;
  const url = item.url || item.jobUrl || item.link;
  if (!title || !url) return null;
  return {
    source: task.source,
    discovery_path: task.discovery_path || (task.company ? 'company_seed' : 'platform_search'),
    company: String(item.company || item.brandName || item.companyName || '').trim(),
    title: String(title).trim(),
    location: String(item.location || item.area || item.cityName || '').trim(),
    url: String(url).trim(),
  };
}

function commandArgs(task, resultLimit) {
  const args = [task.source, 'search', task.query];
  if (task.location) {
    args.push(SOURCE_DEFINITIONS[task.source].locationFlag, task.location);
  }
  args.push('--limit', String(resultLimit), '--format', 'json');
  return args;
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function includesEither(left, right) {
  const normalizedLeft = normalizeKey(left);
  const normalizedRight = normalizeKey(right);
  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function termSignals(value) {
  const genericSignals = new Set(['工程', '程师', '经理', '专员', '总监', '主管', '助理', '实习', '管培', '顾问']);
  const signals = new Set(String(value || '').toLowerCase().match(/[a-z0-9]{2,}/g) || []);
  for (const run of String(value || '').match(/[\p{Script=Han}]+/gu) || []) {
    if (run.length === 1) signals.add(run);
    for (let index = 0; index < run.length - 1; index += 1) {
      signals.add(run.slice(index, index + 2));
    }
  }
  for (const signal of genericSignals) signals.delete(signal);
  return signals;
}

function relatedTerms(left, right) {
  if (includesEither(left, right)) return true;
  const rightSignals = termSignals(right);
  return [...termSignals(left)].some(signal => rightSignals.has(signal));
}

function matchesTask(job, task) {
  if (task.title && !relatedTerms(job.title, task.title)) return false;
  if (task.location && (!job.location || !includesEither(job.location, task.location))) return false;
  if (task.company && (!job.company || !includesEither(job.company, task.company))) return false;
  return true;
}

export function collectAutoCliTasks(tasks, { executable, resultLimit = 20 }) {
  const jobs = [];
  const errors = [];

  for (const task of tasks.filter(item => item.execution === 'autocli')) {
    const result = spawnSync(executable, commandArgs(task, resultLimit), {
      encoding: 'utf-8',
      shell: false,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      errors.push({
        task,
        error: String(result.error?.message || result.stderr || result.stdout || `exit ${result.status}`).trim(),
      });
      continue;
    }

    try {
      const payload = JSON.parse((result.stdout || '').trim());
      for (const item of itemsFrom(payload)) {
        const itemUrl = String(item.url || item.jobUrl || item.link || '');
        if (String(item.name || item.title || '').toLowerCase() === 'error' || !/^https?:\/\//.test(itemUrl)) {
          errors.push({ task, error: itemUrl || String(item.message || 'AutoCLI returned an invalid job record') });
          continue;
        }
        const job = normalizeJob(item, task);
        if (job && matchesTask(job, task)) jobs.push(job);
      }
    } catch (error) {
      errors.push({ task, error: `invalid JSON: ${error.message}` });
    }
  }

  const uniqueJobs = [];
  const seenKeys = new Set();
  const seenUrls = new Set();
  for (const job of jobs) {
    const key = [job.company, job.title, job.location].map(normalizeKey).join('|') || job.url;
    if (seenUrls.has(job.url) || seenKeys.has(key)) continue;
    seenUrls.add(job.url);
    seenKeys.add(key);
    uniqueJobs.push(job);
  }
  return { jobs: uniqueJobs, errors };
}
