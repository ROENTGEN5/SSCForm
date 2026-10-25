import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';

async function assertCertificateFillsPage(bytes) {
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  const page = doc.getPages()[0];
  const streams = page.node.Contents();
  const content = Array.from({ length: streams.size() }, (_, i) =>
    Buffer.from(decodePDFRawStream(doc.context.lookup(streams.get(i))).decode()).toString()
  ).join('\n');
  const matrices = [...content.matchAll(/([\d.]+) 0 0 ([\d.]+) [\d.\-]+ [\d.\-]+ cm/g)];
  assert.ok(matrices.some(m => Number(m[1]) >= page.getWidth() * 0.98 && Number(m[2]) >= page.getHeight() * 0.98),
    'Certificate artwork should occupy at least 98% of the A4 landscape page in both dimensions');
  const images = doc.context.enumerateIndirectObjects().map(([, object]) => object)
    .filter(object => object.dict?.get(PDFName.of('Subtype'))?.toString() === '/Image');
  assert.ok(images.some(image => image.dict.get(PDFName.of('Width')).asNumber() >= 3500
    && image.dict.get(PDFName.of('Height')).asNumber() >= 2470),
  'Certificate artwork should be embedded at approximately 300 DPI for A4 printing');
}

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
    await assertCertificateFillsPage(pdf);
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
    await page.locator('[data-tab="tab-certificate"]').click();
    await page.locator('#btn-mode-custom').click();
    const template = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1160; canvas.height = 820;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff2ce'; ctx.fillRect(0, 0, 1160, 820);
      ctx.strokeStyle = '#7c2020'; ctx.lineWidth = 20; ctx.strokeRect(10, 10, 1140, 800);
      ctx.fillStyle = '#7c2020'; ctx.font = 'bold 54px Georgia'; ctx.textAlign = 'center';
      ctx.fillText('CERTIFICATE OF PARTICIPATION', 580, 180);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('#input-cert-template-file').setInputFiles({
      name: 'certificate.png', mimeType: 'image/png', buffer: Buffer.from(template, 'base64')
    });
    await page.waitForFunction(() => document.getElementById('cert-file-name-text').textContent === 'certificate.png');
    await page.locator('#btn-save-custom-template').click();
    await page.locator('#btn-toggle-preview').click();
    await page.locator('#input-p-name').fill('Maria Dela Cruz');
    await page.locator('#input-p-email').fill('maria@example.com');
    await page.locator('.gf-rating-scale').nth(0).locator('button').last().click();
    await page.locator('.gf-options-list').first().locator('.gf-option-row').first().click();
    await page.locator('.gf-rating-scale').nth(1).locator('button').last().click();
    await page.locator('#btn-submit-form').click();
    await page.locator('#view-certificate.active').waitFor();
    const imageDownloadPromise = page.waitForEvent('download', { timeout: 60000 });
    await page.locator('#btn-download-pdf').click();
    const imageDownload = await imageDownloadPromise;
    assert.equal(await imageDownload.failure(), null);
    await imageDownload.saveAs('test-results/custom-image-certificate.pdf');
    await assertCertificateFillsPage(await readFile(await imageDownload.path()));
    await page.locator('#link-footer-admin').click();
    await page.locator('[data-tab="tab-builder"]').click();
    assert.equal(await page.locator('#allow-duplicate-responses').isChecked(), false);
    await page.locator('#allow-duplicate-responses').check();
    await page.locator('#btn-save-response-settings').click();
    await page.waitForFunction(() => document.getElementById('response-settings-status').textContent.includes('repeat submissions are allowed'));
    await page.locator('#btn-toggle-preview').click();
    async function submitRepeat() {
      await page.locator('#input-p-name').fill('Maria Dela Cruz');
      await page.locator('#input-p-email').fill('maria@example.com');
      for (const scale of await page.locator('.gf-rating-scale').all()) await scale.locator('button').last().click();
      await page.locator('.gf-options-list').first().locator('.gf-option-row').first().click();
      await page.locator('#btn-submit-form').click();
    }
    await submitRepeat();
    await page.locator('#view-certificate.active').waitFor();
    await page.locator('#link-footer-admin').click();
    assert.equal(await page.locator('#allow-duplicate-responses').isChecked(), true);
    await page.locator('#allow-duplicate-responses').uncheck();
    await page.locator('#btn-save-response-settings').click();
    await page.waitForFunction(() => document.getElementById('response-settings-status').textContent.includes('each email can submit once'));
    await page.locator('#btn-toggle-preview').click();
    await submitRepeat();
    await page.waitForFunction(() => document.getElementById('participant-alert-box').textContent.includes('already responded'));
    assert.equal(await page.locator('#view-certificate.active').count(), 0);
    await page.locator('#link-footer-admin').click();
    await page.locator('[data-tab="tab-certificate"]').click();
    const invalidSvgDialog = page.waitForEvent('dialog');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#input-cert-template-file').setInputFiles({
      name: 'unsafe.svg', mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    });
    assert.match((await invalidSvgDialog).message(), /static SVG/);
    assert.equal(await page.locator('#cert-file-name-text').textContent(), 'certificate.png');
    const externalSvgDialog = page.waitForEvent('dialog');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#input-cert-template-file').setInputFiles({
      name: 'external.svg', mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 842 595"><image href="https://example.com/photo.png" width="842" height="595"/></svg>')
    });
    assert.match((await externalSvgDialog).message(), /Embed images/);
    await page.locator('#input-cert-template-file').setInputFiles({
      name: 'vector-certificate.svg', mimeType: 'image/svg+xml',
      buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 842 595">
        <style>.title { fill: #702020; font-family: Times; font-size: 32px; }</style>
        <rect width="842" height="595" fill="#fff9e6"/>
        <rect x="8" y="8" width="826" height="579" fill="none" stroke="#702020" stroke-width="12"/>
        <path d="M 24 24 L 818 24 L 818 571 L 24 571 Z" fill="none" stroke="#bd932c" stroke-width="3"/>
        <text x="421" y="145" text-anchor="middle" class="title">CERTIFICATE OF PARTICIPATION</text>
        <!--${'x'.repeat(10 * 1024 * 1024)}-->
      </svg>`)
    });
    await page.waitForFunction(() => document.getElementById('cert-file-name-text').textContent === 'vector-certificate.svg.pdf');
    await page.locator('#btn-save-custom-template').click();
    await page.locator('#btn-toggle-preview').click();
    await page.locator('#input-p-name').fill('SVG Test Participant');
    await page.locator('#input-p-email').fill('svg@example.com');
    for (const scale of await page.locator('.gf-rating-scale').all()) await scale.locator('button').last().click();
    await page.locator('.gf-options-list').first().locator('.gf-option-row').first().click();
    await page.locator('#btn-submit-form').click();
    await page.locator('#view-certificate.active').waitFor();
    const vectorDownloadPromise = page.waitForEvent('download', { timeout: 60000 });
    await page.locator('#btn-download-pdf').click();
    const vectorDownload = await vectorDownloadPromise;
    assert.equal(await vectorDownload.failure(), null);
    await vectorDownload.saveAs('test-results/svg-certificate.pdf');
    const vectorDoc = await PDFDocument.load(await readFile(await vectorDownload.path()));
    assert.equal(vectorDoc.getPageCount(), 1);
    const vectorPage = vectorDoc.getPages()[0];
    assert.ok(Math.abs(vectorPage.getWidth() - 841.89) < 1 && Math.abs(vectorPage.getHeight() - 595.28) < 1);
    assert.equal(vectorDoc.context.enumerateIndirectObjects().some(([, object]) =>
      object.dict?.get(PDFName.of('Subtype'))?.toString() === '/Image'), false,
    'A vector-only SVG template must remain vector artwork in the downloaded PDF');
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); server.kill(); }
});
