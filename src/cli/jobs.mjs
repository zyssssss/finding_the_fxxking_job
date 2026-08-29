#!/usr/bin/env node

import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadUserConfig } from '../core/config.mjs';
import { initializeFromExample } from '../core/init-config.mjs';
import { buildSearchPlan } from '../core/search-plan.mjs';
import { buildCompanyTasks, selectCompanies } from '../discovery/company-discovery.mjs';
import { buildPlatformTasks } from '../discovery/platform-discovery.mjs';
import { collectAutoCliTasks } from '../adapters/autocli.mjs';
import { referenceFromTask, selectTasks } from '../core/sources.mjs';

function option(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const configDir = resolve(option(args, '--config-dir', 'config'));

  if (command === 'init') {
    const example = option(args, '--example');
    const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
    initializeFromExample({
      configDir,
      exampleDir: example ? resolve(repoRoot, 'examples', example) : resolve(repoRoot, 'config'),
      sourceFiles: example ? {} : {
        'capability-profile.yml': 'capability-profile.example.yml',
        'job-intent.yml': 'job-intent.example.yml',
      },
    });
    console.log(`Initialized user configuration in ${configDir}`);
    return;
  }

  if (command !== 'collect') {
    throw new Error('Usage: jobs.mjs init|collect');
  }

  const route = option(args, '--route');
  if (!['company', 'platform', 'all'].includes(route)) {
    throw new Error('--route must be company, platform, or all');
  }
  const config = loadUserConfig(configDir);
  const searchPlan = buildSearchPlan(config);
  const dryRun = args.includes('--dry-run');
  const tasks = [];
  let companies = [];

  if (route === 'company' || route === 'all') {
    const datasetPath = resolve(option(args, '--dataset', 'data/kdocs-full.json'));
    if (!existsSync(datasetPath)) throw new Error(`KDocs dataset not found: ${datasetPath}`);
    const dataset = JSON.parse(readFileSync(datasetPath, 'utf-8'));
    const limit = Number(option(args, '--limit', '20'));
    companies = selectCompanies(dataset.rows, config.intent, searchPlan, limit);
    tasks.push(...buildCompanyTasks(companies, searchPlan));
  }

  if (route === 'platform' || route === 'all') {
    tasks.push(...buildPlatformTasks(searchPlan));
  }

  const taskLimit = Number(option(args, '--task-limit', '0'));
  const selectedTasks = selectTasks(tasks, taskLimit);

  if (dryRun) {
    console.log(JSON.stringify({ route, companies, tasks: selectedTasks }, null, 2));
    return;
  }

  const executable = resolve(option(args, '--autocli', '.local/bin/autocli'));
  const resultLimit = Number(option(args, '--result-limit', '20'));
  const collected = collectAutoCliTasks(selectedTasks, { executable, resultLimit });
  const references = selectedTasks
    .filter(task => task.execution !== 'autocli')
    .map(referenceFromTask);
  console.log(JSON.stringify({ route, companies, references, ...collected }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
