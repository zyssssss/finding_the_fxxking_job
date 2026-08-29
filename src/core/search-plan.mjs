function unique(values) {
  return [...new Set((values || []).map(value => String(value).trim()).filter(Boolean))];
}

export function buildSearchPlan({ capability, intent }) {
  return {
    roles: unique([...(intent.target_roles || []), ...(capability.qualified_roles || [])]),
    locations: unique(intent.locations?.preferred || []),
    sources: {
      official: intent.sources?.official === true,
      boss: intent.sources?.boss === true,
      linkedin: intent.sources?.linkedin === true,
    },
  };
}
