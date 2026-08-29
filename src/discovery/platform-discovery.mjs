export function buildPlatformTasks(searchPlan) {
  const tasks = [];
  const locations = searchPlan.locations.length > 0 ? searchPlan.locations : [''];

  for (const source of ['boss', 'linkedin']) {
    if (!searchPlan.sources[source]) continue;
    for (const location of locations) {
      for (const role of searchPlan.roles) {
        tasks.push({ source, query: role, location });
      }
    }
  }

  return tasks;
}
