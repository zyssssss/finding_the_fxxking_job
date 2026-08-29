function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '').trim();
}

function includesAny(value, keywords) {
  const text = normalize(value);
  return (keywords || []).some(keyword => text.includes(normalize(keyword)));
}

export function selectCompanies(rows, intent, searchPlan, limit) {
  const preferredIndustries = intent.industries?.preferred || [];
  const rejectedIndustries = intent.industries?.rejected || [];
  const preferredLocations = intent.locations?.preferred || [];
  const allowedNatures = intent.company_preferences?.natures || [];
  const byCompany = new Map();

  for (const row of rows || []) {
    const companyName = String(row.company_name || '').trim();
    if (!companyName || String(row.status || '').includes('已截止')) continue;
    if (includesAny(row.industry, rejectedIndustries)) continue;
    if (allowedNatures.length > 0 && !includesAny(row.company_nature, allowedNatures)) continue;

    let score = 1;
    if (includesAny(row.industry, preferredIndustries)) score += 4;
    if (includesAny(row.location, preferredLocations)) score += 2;
    if (includesAny(row.roles, searchPlan.roles)) score += 3;

    const candidate = { ...row, company_score: score };
    const key = normalize(companyName);
    const existing = byCompany.get(key);
    if (!existing || candidate.company_score > existing.company_score) {
      byCompany.set(key, candidate);
    }
  }

  return [...byCompany.values()]
    .sort((left, right) => right.company_score - left.company_score || left.company_name.localeCompare(right.company_name))
    .slice(0, limit);
}

export function buildCompanyTasks(companies, searchPlan) {
  const tasks = [];

  for (const company of companies) {
    const matchingRoles = searchPlan.roles.filter(role => includesAny(company.roles, [role]));
    const roles = matchingRoles.length > 0 ? matchingRoles.slice(0, 3) : searchPlan.roles.slice(0, 2);
    const matchingLocations = searchPlan.locations.filter(location => includesAny(company.location, [location]));
    const locations = matchingLocations.length > 0
      ? matchingLocations.slice(0, 2)
      : (searchPlan.locations.slice(0, 1).length > 0 ? searchPlan.locations.slice(0, 1) : ['']);

    if (searchPlan.sources.official && company.apply_url) {
      tasks.push({ source: 'official', company: company.company_name, url: company.apply_url });
    }
    for (const source of ['boss', 'linkedin']) {
      if (!searchPlan.sources[source]) continue;
      for (const location of locations) {
        for (const role of roles) {
          tasks.push({
            source,
            company: company.company_name,
            query: `${company.company_name} ${role}`,
            location,
          });
        }
      }
    }
  }

  return tasks;
}
