import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire('/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.json');
const { chromium } = require('/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');

const URL = 'http://localhost:3000';
const EXECUTABLE_PATH = '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell';

async function runTest() {
  const browser = await chromium.launch({
    executablePath: EXECUTABLE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Piano Roll', exact: true }).click();

  // 1. Verify scale and root selectors
  const rootSelect = page.getByRole('combobox', { name: 'Root note' });
  await rootSelect.waitFor();
  await rootSelect.selectOption('7'); // G
  const scaleSelect = page.getByRole('combobox', { name: 'Scale' });
  await scaleSelect.waitFor();
  await scaleSelect.selectOption('Minor');
  console.log('1. Root note set to G and Scale set to Minor');

  // 2. Toggle scale highlighting and scale snap
  await page.getByRole('button', { name: 'Highlight' }).click();
  await page.getByRole('button', { name: 'Snap' }).click();
  console.log('2. Toggled Highlight and Snap');

  // 3. Zoom controls
  await page.getByRole('button', { name: 'Zoom In' }).click();
  await page.getByRole('button', { name: 'Zoom Out' }).click();
  console.log('3. Zoom controls tested');

  // 4. Velocity Lane toggle
  await page.getByRole('button', { name: 'Vel Lane' }).click();
  await page.getByRole('button', { name: 'Vel Lane' }).click();
  console.log('4. Velocity Lane toggled');

  assert.equal(errors.length, 0, `Errors: ${errors.join('; ')}`);
  await context.close();
  await browser.close();
  console.log('PIANOROLL_E2E_PASSED');
}

runTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
