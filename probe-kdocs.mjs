#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const options = {
  url: 'https://www.kdocs.cn/l/cuzbVRqQI45a',
  channel: 'msedge',
  headed: true,
  userDataDir: '',
  output: 'data/kdocs-probe.json',
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--url') options.url = args[++i] || options.url;
  if (arg === '--channel') options.channel = args[++i] || options.channel;
  if (arg === '--user-data-dir') options.userDataDir = args[++i] || '';
  if (arg === '--output') options.output = args[++i] || options.output;
  if (arg === '--headless') options.headed = false;
}

function ensureParentDir(path) {
  const parts = path.split(/[\\/]/);
  parts.pop();
  const dir = parts.join('/');
  if (dir) mkdirSync(dir, { recursive: true });
}

async function main() {
  const requests = [];
  const browserOrContext = options.userDataDir
    ? await chromium.launchPersistentContext(options.userDataDir, {
        channel: options.channel,
        headless: !options.headed,
      })
    : await chromium.launch({ channel: options.channel, headless: !options.headed });

  const context = typeof browserOrContext.newPage === 'function' && typeof browserOrContext.pages === 'function'
    ? browserOrContext
    : null;
  const browser = context ? null : browserOrContext;
  const page = context ? (context.pages()[0] || await context.newPage()) : await browser.newPage();

  page.on('response', async response => {
    const url = response.url();
    if (!/kdocs|wps|office/i.test(url)) return;
    requests.push({ url, status: response.status() });
  });

  await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(10000);

  const bodyText = await page.locator('body').innerText().catch(() => '');
  const links = await page.locator('a').evaluateAll(nodes => nodes.slice(0, 50).map(node => ({
    text: node.textContent || '',
    href: node.href || '',
  }))).catch(() => []);

  const payload = {
    title: await page.title(),
    url: page.url(),
    login_required: /登录后即可访问/.test(bodyText),
    body_excerpt: bodyText.slice(0, 5000),
    links,
    requests,
  };

  ensureParentDir(options.output);
  writeFileSync(options.output, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`Saved ${options.output}`);

  if (context) {
    await context.close();
  } else {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
