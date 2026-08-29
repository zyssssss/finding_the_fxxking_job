import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const USER_CONFIG_FILES = ['capability-profile.yml', 'job-intent.yml'];

export function initializeFromExample({ configDir, exampleDir, sourceFiles = {} }) {
  const existing = USER_CONFIG_FILES.find(file => existsSync(join(configDir, file)));
  if (existing) {
    throw new Error(`${join(configDir, existing)} already exists; refusing to overwrite user configuration.`);
  }

  mkdirSync(configDir, { recursive: true });
  for (const file of USER_CONFIG_FILES) {
    const source = join(exampleDir, sourceFiles[file] || file);
    if (!existsSync(source)) throw new Error(`Example file not found: ${source}`);
    copyFileSync(source, join(configDir, file));
  }
}
