import { spawnSync } from 'node:child_process';

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
    discovery_path: task.company ? 'company_seed' : 'platform_search',
    company: String(item.company || item.brandName || item.companyName || task.company || '').trim(),
    title: String(title).trim(),
    location: String(item.location || item.area || item.cityName || task.location || '').trim(),
    url: String(url).trim(),
  };
}

function commandArgs(task, resultLimit) {
  const args = [task.source, 'search', task.query];
  if (task.location) {
    args.push(task.source === 'linkedin' ? '--location' : '--city', task.location);
  }
  args.push('--limit', String(resultLimit), '--format', 'json');
  return args;
}

export function collectAutoCliTasks(tasks, { executable, resultLimit = 20 }) {
  const jobs = [];
  const errors = [];

  for (const task of tasks.filter(item => item.source === 'boss' || item.source === 'linkedin')) {
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
        if (job) jobs.push(job);
      }
    } catch (error) {
      errors.push({ task, error: `invalid JSON: ${error.message}` });
    }
  }

  const uniqueJobs = [...new Map(jobs.map(job => [job.url, job])).values()];
  return { jobs: uniqueJobs, errors };
}
