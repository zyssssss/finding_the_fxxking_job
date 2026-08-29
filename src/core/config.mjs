import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

export function loadUserConfig(configDir) {
  const capabilityPath = join(configDir, 'capability-profile.yml');
  const intentPath = join(configDir, 'job-intent.yml');
  if (!existsSync(intentPath)) {
    throw new Error(`job-intent.yml not found in ${configDir}. Run npm run jobs:init first.`);
  }
  if (!existsSync(capabilityPath)) {
    throw new Error(`capability-profile.yml not found in ${configDir}. Run npm run jobs:init first.`);
  }

  const config = {
    capability: yaml.load(readFileSync(capabilityPath, 'utf-8')) || {},
    intent: yaml.load(readFileSync(intentPath, 'utf-8')) || {},
  };
  const roles = [
    ...(config.capability.qualified_roles || []),
    ...(config.intent.target_roles || []),
  ].filter(Boolean);
  if (roles.length === 0) {
    throw new Error('At least one qualified_roles or target_roles entry is required.');
  }
  return config;
}
