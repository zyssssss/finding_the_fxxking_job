import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const cliPath = new URL('../src/cli/jobs.mjs', import.meta.url).pathname;
const scanPath = new URL('../scan.mjs', import.meta.url).pathname;

test('collect refuses to run without explicit user configuration', () => {
  const configDir = mkdtempSync(join(tmpdir(), 'career-ops-empty-config-'));
  const result = spawnSync(
    process.execPath,
    [cliPath, 'collect', '--route', 'company', '--config-dir', configDir, '--dry-run'],
    { encoding: 'utf-8' },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /job-intent\.yml not found/);
  assert.doesNotMatch(result.stderr, /china-ai-tob-sales/);
});

test('company route derives discovery tasks from explicit capability and intent files', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-company-route-'));
  const configDir = join(root, 'config');
  const datasetPath = join(root, 'kdocs.json');
  mkdirSync(configDir);

  writeFileSync(join(configDir, 'capability-profile.yml'), [
    'qualified_roles:',
    '  - 客户成功',
    '  - Java开发',
  ].join('\n'));
  writeFileSync(join(configDir, 'job-intent.yml'), [
    'target_roles:',
    '  - 渠道销售',
    'locations:',
    '  preferred:',
    '    - 深圳',
    '    - 北京',
    'industries:',
    '  preferred:',
    '    - 人工智能',
    'sources:',
    '  official: true',
    '  boss: true',
    '  linkedin: false',
  ].join('\n'));
  writeFileSync(datasetPath, JSON.stringify({
    rows: [
      {
        company_name: 'AlphaAI',
        company_nature: '民营企业',
        industry: '人工智能/企业服务',
        location: '深圳',
        roles: '渠道销售 客户成功',
        status: '招聘中',
        apply_url: 'https://alpha.example/careers',
      },
      {
        company_name: 'BetaBank',
        company_nature: '民营企业',
        industry: '银行',
        location: '北京',
        roles: 'Java开发',
        status: '招聘中',
        apply_url: 'https://beta.example/jobs',
      },
      {
        company_name: 'ClosedAI',
        company_nature: '民营企业',
        industry: '人工智能',
        location: '深圳',
        roles: '渠道销售',
        status: '已截止',
        apply_url: 'https://closed.example/jobs',
      },
    ],
  }));

  const result = spawnSync(process.execPath, [
    cliPath,
    'collect',
    '--route', 'company',
    '--config-dir', configDir,
    '--dataset', datasetPath,
    '--limit', '1',
    '--dry-run',
  ], { encoding: 'utf-8' });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.route, 'company');
  assert.deepEqual(output.companies.map(company => company.company_name), ['AlphaAI']);
  assert.deepEqual(output.tasks, [
    {
      source: 'official', execution: 'manual', discovery_path: 'company_seed', company: 'AlphaAI',
      title: '渠道销售 / 客户成功', location: '深圳', url: 'https://alpha.example/careers',
    },
    {
      source: 'boss', execution: 'autocli', discovery_path: 'company_seed', company: 'AlphaAI',
      title: '渠道销售', query: 'AlphaAI 渠道销售', location: '深圳',
    },
    {
      source: 'boss', execution: 'autocli', discovery_path: 'company_seed', company: 'AlphaAI',
      title: '客户成功', query: 'AlphaAI 客户成功', location: '深圳',
    },
  ]);
});

test('platform route uses the current user intent without loading the sales example', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-platform-route-'));
  const configDir = join(root, 'config');
  mkdirSync(configDir);
  writeFileSync(join(configDir, 'capability-profile.yml'), 'qualified_roles:\n  - Python工程师\n');
  writeFileSync(join(configDir, 'job-intent.yml'), [
    'target_roles:',
    '  - 数据工程师',
    'locations:',
    '  preferred:',
    '    - 上海',
    'sources:',
    '  official: false',
    '  boss: true',
    '  linkedin: true',
  ].join('\n'));

  const result = spawnSync(process.execPath, [
    cliPath,
    'collect',
    '--route', 'platform',
    '--config-dir', configDir,
    '--task-limit', '2',
    '--dry-run',
  ], { encoding: 'utf-8' });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.tasks.filter(task => task.execution === 'autocli').length, 2);
  assert.equal(output.tasks.filter(task => task.source === 'linkedin').length, 2);
  assert.ok(output.tasks
    .filter(task => task.source === 'linkedin')
    .every(task => task.execution === 'manual' && task.url.startsWith('https://www.linkedin.com/jobs/search/')));
  assert.doesNotMatch(result.stdout, /深圳|销售|商务拓展/);
});

test('company route reports a missing KDocs dataset gracefully', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-missing-dataset-'));
  const configDir = join(root, 'config');
  mkdirSync(configDir);
  writeFileSync(join(configDir, 'capability-profile.yml'), 'qualified_roles:\n  - 数据工程师\n');
  writeFileSync(join(configDir, 'job-intent.yml'), 'target_roles: []\nsources:\n  boss: true\n');

  const result = spawnSync(process.execPath, [
    cliPath,
    'collect',
    '--route', 'company',
    '--config-dir', configDir,
    '--dataset', join(root, 'missing.json'),
    '--dry-run',
  ], { encoding: 'utf-8' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /KDocs dataset not found/);
  assert.doesNotMatch(result.stderr, /ENOENT/);
});

test('all route applies task limit to network work and shares it across both routes', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-all-route-'));
  const configDir = join(root, 'config');
  const datasetPath = join(root, 'kdocs.json');
  mkdirSync(configDir);
  writeFileSync(join(configDir, 'capability-profile.yml'), 'qualified_roles:\n  - 数据工程师\n');
  writeFileSync(join(configDir, 'job-intent.yml'), [
    'target_roles: []',
    'locations:',
    '  preferred:',
    '    - 上海',
    'sources:',
    '  official: true',
    '  boss: true',
    '  linkedin: true',
  ].join('\n'));
  writeFileSync(datasetPath, JSON.stringify({ rows: [{
    company_name: '示例科技', location: '上海', roles: '数据工程师', status: '招聘中',
    apply_url: 'https://example.com/jobs',
  }] }));

  const result = spawnSync(process.execPath, [
    cliPath, 'collect', '--route', 'all', '--config-dir', configDir,
    '--dataset', datasetPath, '--limit', '1', '--task-limit', '2', '--dry-run',
  ], { encoding: 'utf-8' });

  assert.equal(result.status, 0, result.stderr);
  const tasks = JSON.parse(result.stdout).tasks;
  assert.equal(tasks.filter(task => task.execution === 'autocli').length, 2);
  assert.deepEqual(
    new Set(tasks.filter(task => task.execution === 'autocli').map(task => task.discovery_path)),
    new Set(['company_seed', 'platform_search']),
  );
  assert.ok(tasks.some(task => task.source === 'official'));
  assert.equal(tasks.filter(task => task.source === 'linkedin').length, 2);
});

test('init copies an explicitly selected example and refuses to overwrite it', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-init-'));
  const configDir = join(root, 'config');
  const args = [
    cliPath,
    'init',
    '--example', 'china-ai-tob-sales',
    '--config-dir', configDir,
  ];

  const first = spawnSync(process.execPath, args, { encoding: 'utf-8' });
  assert.equal(first.status, 0, first.stderr);
  assert.match(readFileSync(join(configDir, 'job-intent.yml'), 'utf-8'), /AI ToB销售/);
  assert.match(readFileSync(join(configDir, 'capability-profile.yml'), 'utf-8'), /大客户销售/);

  const second = spawnSync(process.execPath, args, { encoding: 'utf-8' });
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /already exists/);
});

test('init without an example creates neutral templates', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-neutral-init-'));
  const configDir = join(root, 'config');
  const result = spawnSync(process.execPath, [
    cliPath,
    'init',
    '--config-dir', configDir,
  ], { encoding: 'utf-8' });

  assert.equal(result.status, 0, result.stderr);
  const intent = readFileSync(join(configDir, 'job-intent.yml'), 'utf-8');
  const capability = readFileSync(join(configDir, 'capability-profile.yml'), 'utf-8');
  assert.match(intent, /target_roles: \[\]/);
  assert.match(capability, /qualified_roles: \[\]/);
  assert.doesNotMatch(`${intent}\n${capability}`, /深圳|销售|商务拓展/);
});

test('platform collection runs Boss only, exposes LinkedIn as a manual reference, and filters results', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-autocli-'));
  const configDir = join(root, 'config');
  const fakeAutoCli = join(root, 'autocli-fixture');
  mkdirSync(configDir);
  writeFileSync(join(configDir, 'capability-profile.yml'), 'qualified_roles:\n  - 数据工程师\n');
  writeFileSync(join(configDir, 'job-intent.yml'), [
    'target_roles: []',
    'locations:',
    '  preferred:',
    '    - 上海',
    'sources:',
    '  official: false',
    '  boss: true',
    '  linkedin: true',
  ].join('\n'));
  writeFileSync(fakeAutoCli, [
    '#!/bin/sh',
    'test "$1" = "boss" || exit 9',
    'test "$2" = "search" || exit 9',
    'test "$3" = "数据工程师" || exit 9',
    'test "$4" = "--city" || exit 9',
    'test "$5" = "上海" || exit 9',
    "printf '%s\\n' '[{\"name\":\"数据开发工程师\",\"url\":\"https://www.zhipin.com/job/1\",\"company\":\"示例科技\",\"area\":\"上海\"},{\"name\":\"数据开发工程师\",\"url\":\"https://www.zhipin.com/job/2\",\"company\":\"示例科技\",\"area\":\"上海\"},{\"name\":\"高级数据开发工程师\",\"url\":\"https://www.zhipin.com/job/1\",\"company\":\"示例科技\",\"area\":\"上海\"},{\"name\":\"产品工程师\",\"url\":\"https://www.zhipin.com/job/3\",\"company\":\"示例科技\",\"area\":\"上海\"},{\"name\":\"数据工程师\",\"url\":\"https://www.zhipin.com/job/4\",\"company\":\"示例科技\"}]'",
  ].join('\n'));
  chmodSync(fakeAutoCli, 0o755);

  const result = spawnSync(process.execPath, [
    cliPath,
    'collect',
    '--route', 'platform',
    '--config-dir', configDir,
    '--autocli', fakeAutoCli,
    '--result-limit', '5',
  ], { encoding: 'utf-8' });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.jobs, [{
    source: 'boss',
    discovery_path: 'platform_search',
    company: '示例科技',
    title: '数据开发工程师',
    location: '上海',
    url: 'https://www.zhipin.com/job/1',
  }]);
  assert.equal(output.references.length, 1);
  assert.deepEqual(output.references[0], {
    source: 'linkedin',
    discovery_path: 'platform_search',
    company: '',
    title: '数据工程师',
    location: '上海',
    url: 'https://www.linkedin.com/jobs/search/?keywords=%E6%95%B0%E6%8D%AE%E5%B7%A5%E7%A8%8B%E5%B8%88&location=%E4%B8%8A%E6%B5%B7',
  });
});

test('platform collection reports AutoCLI login errors instead of treating them as jobs', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-autocli-error-'));
  const configDir = join(root, 'config');
  const fakeAutoCli = join(root, 'autocli-fixture');
  mkdirSync(configDir);
  writeFileSync(join(configDir, 'capability-profile.yml'), 'qualified_roles:\n  - 数据工程师\n');
  writeFileSync(join(configDir, 'job-intent.yml'), [
    'target_roles: []',
    'locations:',
    '  preferred:',
    '    - 上海',
    'sources:',
    '  official: false',
    '  boss: true',
    '  linkedin: false',
  ].join('\n'));
  writeFileSync(fakeAutoCli, [
    '#!/bin/sh',
    "printf '%s\\n' '[{\"name\":\"Error\",\"url\":\"您的环境存在异常，请登录后使用.\"}]'",
  ].join('\n'));
  chmodSync(fakeAutoCli, 0o755);

  const result = spawnSync(process.execPath, [
    cliPath,
    'collect',
    '--route', 'platform',
    '--config-dir', configDir,
    '--autocli', fakeAutoCli,
  ], { encoding: 'utf-8' });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.jobs, []);
  assert.match(output.errors[0].error, /登录后使用/);
});

test('legacy scanner refuses LinkedIn AutoCLI collection', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-linkedin-block-'));
  writeFileSync(join(root, 'portals.yml'), JSON.stringify({
    tracked_companies: [],
    autocli_sources: [{
      name: 'LinkedIn fixture',
      platform: 'linkedin',
      enabled: true,
      command: [process.execPath, '-e', 'console.log("[]")'],
      fields: { title: 'title', url: 'url' },
    }],
  }));

  const result = spawnSync(process.execPath, [scanPath, '--source', 'linkedin', '--dry-run'], {
    cwd: root,
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /LinkedIn AutoCLI collection is disabled/);
  assert.match(result.stdout, /Total jobs found:\s+0/);
});
