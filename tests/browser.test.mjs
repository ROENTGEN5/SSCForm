import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

test('build rejects missing configuration and secret keys', () => {
  for (const config of [{ SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '' }, { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_secret_forbidden' }]) {
    const result = spawnSync(process.execPath, ['scripts/build.mjs'], { env: { ...process.env, ...config }, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
  }
});

test('production connects without exposing admin data and fails closed on database errors', async () => {
  const server = spawn(process.execPath, ['scripts/build.mjs', '--serve'], { env: { ...process.env, PORT: '3001', SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Production preview timed out')), 30000);
      server.stdout.on('data', data => { if (String(data).includes('Open http')) { clearTimeout(timeout); resolve(); } });
      server.on('exit', code => { clearTimeout(timeout); reject(new Error('Preview exited: ' + code)); });
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const requests = [];
    await page.route('https://test.supabase.co/**', route => {
      requests.push(route.request().url());
      const url = route.request().url();
      const data = url.includes('form_settings') ? { id: 1, form_title: 'Live SSC Form', form_description: 'Test configuration' }
        : url.includes('certificate_settings') ? { id: 1, title: 'Certificate', template_type: 'default' } : [];
      return route.fulfill({ json: data });
    });
    await page.goto('http://127.0.0.1:3001');
    await page.waitForFunction(() => !document.getElementById('btn-submit-form').disabled);
    assert.equal(await page.locator('#public-form-title').textContent(), 'Live SSC Form');
    assert.equal(await page.locator('#link-footer-config').isVisible(), false);
    assert.equal(requests.some(url => url.includes('survey_responses')), false);
    await page.locator('#link-footer-admin').click();
    assert.equal(await page.locator('#admin-dashboard-box').isVisible(), false);
    assert.equal(await page.locator('#admin-auth-box').isVisible(), true);
    await page.unrouteAll();
    await page.route('https://test.supabase.co/**', route => route.fulfill({ status: 400, json: { message: 'Database unavailable' } }));
    await page.reload();
    await page.waitForFunction(() => document.getElementById('participant-alert-box').textContent.includes('Unable to load'));
    assert.equal(await page.locator('#btn-submit-form').isDisabled(), true);
    assert.equal(await page.locator('#participant-dynamic-questions .gf-question-card').count(), 0);
  } finally { await browser?.close(); server.kill(); }
});

test('mobile form, logo, validation, duplicate prevention, admin builder and PDF download', async () => {
  const server = spawn(process.execPath, ['scripts/build.mjs', '--demo', '--serve'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Preview server timed out')), 30000);
      server.stdout.on('data', data => { if (String(data).includes('Open http')) { clearTimeout(timeout); resolve(); } });
      server.on('exit', code => { clearTimeout(timeout); reject(new Error('Preview exited: ' + code)); });
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:3000');
    await page.locator('#deployment-notice').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.ssc-brand img').evaluate(img => img.complete && img.naturalWidth > 0), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#btn-submit-form').click();
    assert.equal(await page.locator('#card-p-name').evaluate(el => el.classList.contains('has-error')), true);
    await page.locator('#input-p-name').fill('Juan Dela Cruz');
    await page.locator('#input-p-email').fill('juan@example.com');
    await page.locator('.gf-rating-scale').nth(0).locator('button').nth(4).click();
    await page.locator('.gf-options-list').first().locator('.gf-option-row').first().click();
    await page.locator('.gf-rating-scale').nth(1).locator('button').nth(4).click();
    await page.locator('#btn-submit-form').click();
    await page.locator('#view-certificate.active').waitFor();
    assert.equal(await page.locator('#cert-recipient-name').textContent(), 'Juan Dela Cruz');
    const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
    await page.locator('#btn-download-pdf').click();
    const download = await downloadPromise;
    assert.equal(await download.failure(), null);
    const pdf = await readFile(await download.path());
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: 'test-results/mobile-certificate.png', fullPage: true });
    await page.locator('#btn-submit-another').click();
    await page.locator('#input-p-name').fill('Another Name');
    await page.locator('#input-p-email').fill('juan@example.com');
    await page.locator('.gf-rating-scale').nth(0).locator('button').nth(4).click();
    await page.locator('.gf-options-list').first().locator('.gf-option-row').first().click();
    await page.locator('.gf-rating-scale').nth(1).locator('button').nth(4).click();
    await page.locator('#btn-submit-form').click();
    await page.waitForFunction(() => document.getElementById('participant-alert-box').textContent.includes('already responded'));
    assert.equal(await page.locator('#btn-retrieve-cert').count(), 0);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: 'test-results/mobile-form.png', fullPage: true });
    await page.locator('#link-footer-admin').click();
    await page.locator('#admin-dashboard-box').waitFor({ state: 'visible' });
    await page.locator('#builder-form-title').fill('SSC Event Evaluation');
    await page.locator('#btn-builder-save-all').click();
    await page.waitForFunction(() => document.getElementById('nav-form-title').textContent === 'SSC Event Evaluation');
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); server.kill(); }
});
