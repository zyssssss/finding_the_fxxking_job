import { buildSearchTasks } from '../core/sources.mjs';

export function buildPlatformTasks(searchPlan) {
  return buildSearchTasks({
    searchPlan,
    roles: searchPlan.roles,
    locations: searchPlan.locations,
    discoveryPath: 'platform_search',
  });
}
