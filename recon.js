const { chromium, devices } = require('playwright');

const URL = 'https://agendamiento.dian.gov.co/';
const PASOS = (process.env.PASOS || '').split(',').map(s => s.trim()).filter(Boolean);

async function volcar(page, etiqueta) {
  console.log(`\n========== ${etiqueta} ==========`);
  console.log('--- TEXTO EN PANTALLA ---');
  console.log((await page.locator('body').innerText()).replace(/\n{3,}/g, '\n\n'));

  console.log('--- ELEMENTOS INTERACTIVOS ---');
  const sel = 'button, a, select, input, [role="button"], [role="option"], li';
  for (const el of await page.locator(sel).all()) {
    if (!(await el.isVisible().catch(() => false))) continue;
    const tag = await el.evaluate(n => n.tagName.toLowerCase());
    const txt = ((await el.innerText().catch(() => '')) || '').trim()
      || await el.getAttribute('placeholder')
      || await el.getAttribute('aria-label')
      || await el.getAttribute('value') || '';
    if (txt) console.log(`  [${tag}] ${txt.replace(/\s+/g, ' ').slice(0, 70)}`);
  }
  await page.screenshot({ path: `${etiqueta}.png`, fullPage: true }).catch(() => {});
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'es-CO' });
  const page = await ctx.newPage();

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(6000);
  await volcar(page, 'paso-0-inicio');

  for (const [i, texto] of PASOS.entries()) {
    const n = i + 1;
    try {
      const el = page.getByText(texto, { exact: false }).first();
      await el.waitFor({ state: 'visible', timeout: 20000 });
      await el.click();
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(3000);
      await volcar(page, `paso-${n}-ok`);
    } catch (e) {
      console.log(`\n!!! NO PUDE CLICKEAR "${texto}": ${e.message.split('\n')[0]}`);
      await volcar(page, `paso-${n}-FALLO`);
      break;
    }
  }
  await browser.close();
})();
