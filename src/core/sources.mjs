export const SOURCE_DEFINITIONS = Object.freeze({
  official: Object.freeze({ execution: 'manual' }),
  boss: Object.freeze({ execution: 'autocli', locationFlag: '--city' }),
  linkedin: Object.freeze({ execution: 'manual' }),
});

export function linkedinSearchUrl(query, location = '') {
  const url = new URL('https://www.linkedin.com/jobs/search/');
  url.searchParams.set('keywords', query);
  if (location) url.searchParams.set('location', location);
  return url.toString();
}

export function buildSearchTasks({ searchPlan, roles, locations, company = '', discoveryPath }) {
  const tasks = [];
  for (const source of ['boss', 'linkedin']) {
    if (!searchPlan.sources[source]) continue;
    const definition = SOURCE_DEFINITIONS[source];
    for (const location of locations.length > 0 ? locations : ['']) {
      for (const role of roles) {
        const query = company ? `${company} ${role}` : role;
        tasks.push({
          source,
          execution: definition.execution,
          discovery_path: discoveryPath,
          company,
          title: role,
          location,
          query,
          ...(source === 'linkedin' ? { url: linkedinSearchUrl(query, location) } : {}),
        });
      }
    }
  }
  return tasks;
}

export function selectTasks(tasks, taskLimit) {
  if (!(taskLimit > 0)) return tasks;

  const references = tasks.filter(task => task.execution !== 'autocli');
  const queues = new Map();
  for (const task of tasks.filter(item => item.execution === 'autocli')) {
    const key = task.discovery_path || 'unknown';
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key).push(task);
  }

  const selected = [];
  while (selected.length < taskLimit && [...queues.values()].some(queue => queue.length > 0)) {
    for (const queue of queues.values()) {
      if (selected.length >= taskLimit) break;
      const task = queue.shift();
      if (task) selected.push(task);
    }
  }
  return [...references, ...selected];
}

export function referenceFromTask(task) {
  return {
    source: task.source,
    discovery_path: task.discovery_path,
    company: task.company || '',
    title: task.title || '',
    location: task.location || '',
    url: task.url,
  };
}
