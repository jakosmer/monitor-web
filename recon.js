const { chromium, devices } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'es-CO' });
  const page = await ctx.newPage();

  await page.goto('https://agendamiento.dian.gov.co/', {
    waitUntil: 'networkidle', timeout: 60000
  });
  await page.waitForTimeout(6000);           // que termine de pintar

  console.log('=== TEXTO EN PANTALLA ===');
  console.log(await page.locator('body').innerText());

  console.log('=== ELEMENTOS CLICKEABLES ===');
  for (const el of await page.locator('button, a, select, [role="button"]').all()) {
    const t = (await el.innerText().catch(() => '')).trim()
           || await el.getAttribute('aria-label')
           || await el.getAttribute('title') || '';
    if (t) console.log('-', t.replace(/\s+/g, ' ').slice(0, 80));
  }

  await page.screenshot({ path: 'paso0.png', fullPage: true });
  await browser.close();
})();
