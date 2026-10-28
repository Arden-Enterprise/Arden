// Optional synthetic browser regression. Requires Playwright and its browser.
const fs = require('node:fs');
const origin = new URL(process.env.ARDEN_UI_QA_ORIGIN || 'http://127.0.0.1:5180');
if (origin.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(origin.hostname)) throw new Error('QA target must be HTTP loopback');
fs.mkdirSync('.private/qa', { recursive: true });
const { chromium } = require(process.env.ARDEN_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.ARDEN_QA_BROWSER_CHANNEL ? { channel: process.env.ARDEN_QA_BROWSER_CHANNEL } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let finishAnswer;
    const waitingAnswer = new Promise(resolve => { finishAnswer = resolve; });
    let receivedAnswer;
    const answerRequested = new Promise(resolve => { receivedAnswer = resolve; });
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/me') return route.fulfill({ json: {
        actor: { id: '00000000-0000-4000-8000-000000000001', email: 'synthetic@example.test' },
        account: { passwordSetupRequired: false }, memberships: [{
          organization: { id: '00000000-0000-4000-8000-000000000002', name: 'Synthetic QA workspace' },
          status: 'active', roleCodes: [], canUsePrivateWorkspace: true,
        }],
      } });
      if (path.endsWith('/ai/answers')) {
        receivedAnswer();
        await waitingAnswer;
        return route.fulfill({ json: { status: 'ANSWERED', answer: 'Synthetic delayed answer', citations: [] } });
      }
      return route.fulfill({ json: { items: [], nextCursor: null } });
    });
    await page.goto(origin.href);
    await page.getByRole('button', { name: 'Ask Arden', exact: true }).click();
    await page.getByRole('textbox', { name: 'Ask Arden', exact: true }).fill('Synthetic workflow question');
    await page.getByRole('button', { name: 'Send prompt' }).click();
    await answerRequested;
    await page.getByRole('button', { name: 'Synthetic workflow question', exact: true }).click();
    await page.getByRole('button', { name: 'New chat', exact: true }).waitFor();
    const response = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/ai/answers'));
    finishAnswer();
    await response;
    // Wait on the rendered state, not a fixed delay or a model-only approximation.
    await page.getByRole('button', { name: 'Send prompt' }).waitFor();
    await page.screenshot({ path: '.private/qa/feature-ask-reset-desktop.png' });
    assert.equal(await page.getByText('Synthetic delayed answer', { exact: true }).count(), 0,
      'A completed old request must not insert an answer into a reset conversation');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '.private/qa/feature-ask-mobile.png' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No mobile horizontal overflow');
    assert.deepEqual(errors, []);
    console.log('Synthetic browser QA passed: authenticated navigation, in-flight reset isolation, mobile layout, no page errors. No live credentials or model calls.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
