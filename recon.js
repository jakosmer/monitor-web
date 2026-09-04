const { chromium } = require('playwright');

const URL = 'https://agendamiento.dian.gov.co/';
const PASOS = (process.env.PASOS || '').split(',').map(s => s.trim()).filter(Boolean);

async function volcar(page, etiqueta) {
  console.log(`\n========== ${etiqueta} ==========`);

  const info = await page.evaluate(() => {
    const ctrls = [...document.querySelectorAll('[nombre]')].map(el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        nombre: el.getAttribute('nombre'),
        pantalla: el.getAttribute('pantalla'),
        tag: el.tagName.toLowerCase(),
        visible: r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
        texto: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      };
    });
    return {
      bodyHtmlLen: document.body ? document.body.innerHTML.length : -1,
      hijosBody: document.body ? document.body.children.length : -1,
      pantallas: [...new Set(ctrls.map(c => c.pantalla).filter(Boolean))],
      visibles: ctrls.filter(c => c.visible),
      ocultos: ctrls.filter(c => !c.visible).length,
      texto: (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 2500),
    };
  }).catch(e => ({ error: String(e) }));

  if (info.error) { console.log('ERROR evaluando:', info.error); return; }

  console.log(`bodyHTML: ${info.bodyHtmlLen} chars | hijos: ${info.hijosBody}`);
  console.log('PANTALLAS:', info.pantallas.join(', ') || '(ninguna)');
  console.log(`CONTROLES VISIBLES: ${info.visibles.length} | ocultos: ${info.ocultos}`);
  for (const c of info.visibles.slice(0, 80)) {
    console.log(`  <${c.tag}> nombre="${c.nombre}" pantalla="${c.pantalla}" :: ${c.texto}`);
  }
  console.log('--- TEXTO ---');
  console.log(info.texto || '(vacío)');

  await page.screenshot({ path: `${etiqueta}.png`, fullPage: true }).catch(() => {});
}

async function clickControl(page, nombre) {
  const loc = page.locator(`[nombre="${nombre}"]`).filter({ visible: true }).first();
  await loc.waitFor({ state: 'visible', timeout: 25000 });
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.click();
}

(async () => {
  const browser = await chromium.launch({
    headless: false,                      // navegador real sobre Xvfb
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox',
           '--disable-dev-shm-usage', '--window-size=1366,900'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['es-CO', 'es'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
  });
  const page = await ctx.newPage();

  page.on('pageerror', e => console.log('  [JS ERROR]', String(e).slice(0, 250)));
  page.on('requestfailed', r =>
    console.log('  [red falló]', r.url().slice(0, 100), r.failure()?.errorText));

  const posts = [];
  page.on('response', async r => {
    const u = r.url();
    if (!/\.aspx|\/api\/|Servicio|Obtener/i.test(u)) return;
    let cuerpo = '';
    try { cuerpo = (await r.text()).slice(0, 400); } catch { cuerpo = '(sin cuerpo)'; }
    posts.push(`${r.status()} ${r.request().method()} ${u.slice(0, 110)}\n      ${cuerpo}`);
  });

  const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  console.log('HTTP status:', resp?.status());

  try {
    await page.locator('[nombre]').first().waitFor({ state: 'attached', timeout: 75000 });
    console.log('>>> CONTROLES MONTADOS <<<');
    await page.waitForTimeout(5000);
  } catch {
    console.log('>>> SIN CONTROLES TRAS 75s <<<');
  }

  console.log('\n=== LLAMADAS AL BACKEND ===');
  posts.slice(0, 30).forEach(l => console.log('  ' + l));

  await volcar(page, 'paso-0-inicio');

  for (const [i, nombre] of PASOS.entries()) {
    const num = i + 1;
    try {
      await clickControl(page, nombre);
      await page.waitForTimeout(4000);
      await volcar(page, `paso-${num}-ok-${nombre}`);
    } catch (e) {
      console.log(`\n!!! FALLÓ "${nombre}": ${e.message.split('\n')[0]}`);
      await volcar(page, `paso-${num}-FALLO-${nombre}`);
      break;
    }
  }

  await browser.close();
})();
