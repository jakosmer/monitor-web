const { chromium, devices } = require('playwright');

const URL = 'https://agendamiento.dian.gov.co/';
const PASOS = (process.env.PASOS || '').split(',').map(s => s.trim()).filter(Boolean);

async function volcar(page, etiqueta) {
  console.log(`\n========== ${etiqueta} ==========`);

  console.log('--- TEXTO EN PANTALLA ---');
  const texto = await page.locator('body').innerText().catch(() => '(vacío)');
  console.log(texto.replace(/\n{3,}/g, '\n\n').slice(0, 4000));

  console.log('--- ELEMENTOS INTERACTIVOS ---');
  const sel = 'button, a, select, input, [role="button"], [role="option"], li';
  const vistos = new Set();
  let n = 0;
  for (const el of await page.locator(sel).all()) {
    if (n >= 120) { console.log('  ...(cortado)'); break; }
    if (!(await el.isVisible().catch(() => false))) continue;
    const tag = await el.evaluate(x => x.tagName.toLowerCase()).catch(() => '?');
    const txt = ((await el.innerText().catch(() => '')) || '').trim()
      || await el.getAttribute('placeholder').catch(() => null)
      || await el.getAttribute('aria-label').catch(() => null)
      || await el.getAttribute('value').catch(() => null) || '';
    const limpio = txt.replace(/\s+/g, ' ').slice(0, 70);
    if (!limpio) continue;
    const clave = `${tag}|${limpio}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    console.log(`  [${tag}] ${limpio}`);
    n++;

    if (tag === 'select') {
      const ops = await el.locator('option').allInnerTexts().catch(() => []);
      ops.slice(0, 25).forEach(o => console.log(`      · ${o.trim()}`));
    }
  }

  await page.screenshot({ path: `${etiqueta}.png`, fullPage: true }).catch(() => {});
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'es-CO' });
  const page = await ctx.newPage();

  page.on('console', m => console.log('  [console]', m.text().slice(0, 120)));
  page.on('requestfailed', r =>
    console.log('  [red falló]', r.url().slice(0, 90), r.failure()?.errorText));

  let resp;
  try {
    resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    console.log('HTTP status:', resp?.status(), '| URL final:', page.url());
  } catch (e) {
    console.log('NO CARGÓ:', e.message.split('\n')[0]);
    await page.screenshot({ path: 'error-carga.png' }).catch(() => {});
    await browser.close();
    process.exit(1);
  }

  try {
    await page.waitForFunction(
      () => document.body && document.body.innerText.trim().length > 40,
      { timeout: 45000 }
    );
    console.log('La app renderizó contenido.');
  } catch {
    console.log('Sigue vacía tras 45s (spinner infinito o bloqueo).');
  }

  await page.waitForTimeout(4000);
  await volcar(page, 'paso-0-inicio');

  for (const [i, textoPaso] of PASOS.entries()) {
    const num = i + 1;
    try {
      const el = page.getByText(textoPaso, { exact: false }).first();
      await el.waitFor({ state: 'visible', timeout: 20000 });
      await el.click();
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(3000);
      await volcar(page, `paso-${num}-ok`);
    } catch (e) {
      console.log(`\n!!! NO PUDE CLICKEAR "${textoPaso}": ${e.message.split('\n')[0]}`);
      await volcar(page, `paso-${num}-FALLO`);
      break;
    }
  }

  await browser.close();
})();
