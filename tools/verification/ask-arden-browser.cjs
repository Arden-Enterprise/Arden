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
    let finishSource, receivedSource;
    const waitingSource = new Promise(resolve => { finishSource = resolve; });
    const sourceRequested = new Promise(resolve => { receivedSource = resolve; });
    let answerCount = 0;
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
        if (++answerCount === 1) {
          receivedAnswer();
          await waitingAnswer;
          return route.fulfill({ json: { status: 'INSUFFICIENT_EVIDENCE', answer: 'Synthetic delayed answer', citations: [] } });
        }
        return route.fulfill({ json: { status: 'ANSWERED', answer: 'Synthetic current answer', citations: [{
          documentId: '00000000-0000-4000-8000-000000000003', versionId: '00000000-0000-4000-8000-000000000004',
          title: 'Synthetic policy', version: 'v1', scope: 'Company-wide', excerpt: 'Synthetic evidence',
        }] } });
      }
      if (/\/knowledge\/published\/[0-9a-f-]+$/.test(path)) {
        receivedSource();
        await waitingSource;
        return route.fulfill({ json: { id: '00000000-0000-4000-8000-000000000004' } });
      }
      return route.fulfill({ json: { items: [], nextCursor: null } });
    });
    await page.goto(origin.href);
    await page.getByRole('button', { name: 'Ask Arden', exact: true }).click();
    const prompt = page.getByRole('textbox', { name: 'Ask Arden', exact: true });
    await prompt.focus();
    const accessibility = await prompt.evaluate(element => {
      const composer = element.closest('.ask-composer');
      const style = getComputedStyle(composer);
      const luminance = color => {
        const rgb = color.match(/[\d.]+/g).slice(0,3).map(Number).map(v => {
          v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const text = luminance(getComputedStyle(element, '::placeholder').color);
      const background = luminance(style.backgroundColor);
      return { contrast: (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05),
        outline: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });
    assert.ok(accessibility.contrast >= 4.5, 'Prompt placeholder meets normal-text contrast');
    assert.ok(accessibility.outline !== 'none' && accessibility.width >= 2, 'Keyboard focus is visible');
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
    await page.getByRole('textbox', { name: 'Ask Arden', exact: true }).fill('Synthetic source question');
    await page.getByRole('button', { name: 'Send prompt' }).click();
    await page.getByText('Synthetic current answer', { exact: true }).waitFor();
    assert.equal(await page.getByText('Synthetic current answer', { exact: true }).evaluate(element => getComputedStyle(element).whiteSpace), 'pre-wrap');
    await page.getByRole('button', { name: 'Open source 1: Synthetic policy, v1', exact: true }).click();
    await sourceRequested;
    await page.getByRole('button', { name: 'Ask Arden', exact: true }).click();
    const sourceResponse = page.waitForResponse(r => /\/knowledge\/published\/[0-9a-f-]+$/.test(new URL(r.url()).pathname));
    finishSource();
    await sourceResponse;
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    assert.ok(await page.getByRole('button', { name: 'Refresh', exact: true }).isEnabled(), 'Leaving an in-flight citation must release Library busy state');
    await page.getByRole('button', { name: 'Ask Arden', exact: true }).click();
    assert.equal(await page.getByText('Synthetic current answer', { exact: true }).count(), 1,
      'Reading a citation must preserve the conversation when returning to Ask Arden');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '.private/qa/feature-ask-mobile.png' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No mobile horizontal overflow');
    assert.deepEqual(errors, []);
    console.log('Synthetic browser QA passed: navigation, reset/source isolation, citation cleanup, contrast/focus/line breaks, mobile layout and no page errors. No live credentials or model calls.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
