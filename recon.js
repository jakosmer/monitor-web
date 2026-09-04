const { chromium } = require('playwright');

const URL = 'https://agendamiento.dian.gov.co/';
const PASOS = (process.env.PASOS || '').split(',').map(s => s.trim()).filter(Boolean);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function volcar(page, etiqueta) {
  console.log(`\n========== ${etiqueta} ==========`);

  const info = await page.evaluate(() => {
    const ctrls = [...document.querySelectorAll('[nombre]')].map(el => {
      const r = el.getBoundingClientRect();
      return {
        nombre: el.getAttribute('nombre'),
        pantalla: el.getAttribute('pantalla'),
        tipo: el.getAttribute('tipo'),
        tag: el.tagName.toLowerCase(),
        visible: r.width > 0 && r.height > 0 &&
                 getComputedStyle(el).display !== 'none' &&
                 getComputedStyle(el).visibility !== 'hidden',
        texto: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      };
    });
    const pantallas = [...new Set(ctrls.map(c => c.pantalla).filter(Boolean))];
    return {
      pantallas,
      visibles: ctrls.filter(c => c.visible),
      ocultos: ctrls.filter(c => !c.visible).length,
      texto: (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 2500),
    };
  }).catch(e => ({ error: String(e) }));

  if (info.error) { console.log('ERROR evaluando:', info.error); return; }

  console.log('PANTALLAS EN EL DOM:', info.pantallas.join(', ') || '(ninguna)');
  console.log(`CONTROLES VISIBLES: ${info.visibles.length} | ocultos: ${info.ocultos}`);
  for (const c of info.visibles.slice(0, 80)) {
    console.log(`  <${c.tag}> nombre="${c.nombre}" pantalla="${c.pantalla}" :: ${c.texto}`);
  }

  console.log('--- TEXTO EN PANTALLA ---');
  console.log(info.texto || '(vacío)');

  await page.screenshot({ path: `${etiqueta}.png`, fullPage: true }).catch(() => {});
}

// espera a que aparezca un control visible con ese nombre y lo clickea
async function clickControl(page, nombre) {
  const loc = page.locator(`[nombre="${nombre}"]`).filter({ visible: true }).first();
  await loc.waitFor({ state: 'visible', timeout: 25000 });
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.click();
}

(async () => {
  const browser = await chromium.launch({
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1366, height: 900 },
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
  });
  const page = await ctx.newPage();

  const red = [];
  page.on('response', r => {
    const u = r.url();
    if (/\.(png|jpg|jpeg|svg|gif|woff2?|ttf|ico|css)(\?|$)/i.test(u)) return;
    red.push(`${r.status()} ${r.request().method()} ${u.slice(0, 130)}`);
  });
  page.on('pageerror', e => console.log('  [JS ERROR]', String(e).slice(0, 200)));

  const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  console.log('HTTP status:', resp?.status());

  // esperar a que el framework monte los controles
  try {
    await page.locator('[nombre]').first().waitFor({ state: 'attached', timeout: 60000 });
    await page.waitForTimeout(5000);
    console.log('Controles montados.');
  } catch {
    console.log('No aparecieron controles en 60s.');
  }

  console.log('\n=== PETICIONES DE RED ===');
  red.slice(0, 50).forEach(l => console.log('  ' + l));

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
