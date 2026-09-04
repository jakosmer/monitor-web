const fs = require('fs');
const { chromium } = require('playwright');

const URL = 'https://agendamiento.dian.gov.co/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const CARGANDO = '#mpcWPdivCargando';
const T = 120000;

const PASOS = [
  { tipo: 'control', nombre: 'btnSolicitarCita', espera: 'TipoPersona' },
  { tipo: 'opcion',  nombre: 'TipoPersona',  opcion: 'Persona Natural', espera: 'TipoAtencion' },
  { tipo: 'opcion',  nombre: 'TipoAtencion', opcion: 'Videoatención',   espera: 'Categorias' },
  { tipo: 'opcion',  nombre: 'Categorias',   opcion: 'Devoluciones.',   espera: null },
];

const BASE = ['PasoUno','txtTitulo','txtPasoUno','txtTipoPersona','TipoPersona',
              'txtTipoAtencion','TipoAtencion','txtCategoria','Categorias',
              'btnAnterior','btnSiguienteBlock','btnSiguiente'];
const IGNORAR = ['_Header', '_Footer', '_NavPaginaDIAN'];

const salida = (k, v) => process.env.GITHUB_OUTPUT
  && fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);

const controles = page => page.evaluate(ign =>
  [...document.querySelectorAll('[nombre]')].filter(el => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== 'none'
           && !ign.includes(el.getAttribute('pantalla') || '');
  }).map(el => ({
    n: el.getAttribute('nombre'),
    p: el.getAttribute('pantalla'),
    t: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
  })), IGNORAR);

async function diagnostico(page, etiqueta) {
  console.log(`\n### DIAGNOSTICO: ${etiqueta} ###`);
  console.log('overlay visible:', await page.locator(CARGANDO).isVisible().catch(() => '?'));
  const c = await controles(page).catch(() => []);
  console.log(`controles visibles (${c.length}):`);
  c.forEach(x => console.log(`   ${x.n} (${x.p}) :: ${x.t}`));
  await page.screenshot({ path: 'estado.png', fullPage: true }).catch(() => {});
}

async function esperarOverlay(page, ms = T) {
  await page.waitForTimeout(1000);
  await page.locator(CARGANDO).waitFor({ state: 'hidden', timeout: ms }).catch(() => {});
}

// clickea una opcion dentro de un control, en el propio DOM (evita rarezas de locators)
async function clickOpcion(page, control, opcion) {
  const hijos = await page.evaluate(({ control, opcion }) => {
    const cont = document.querySelector(`[nombre="${control}"]`);
    if (!cont) return { error: 'contenedor no existe' };
    const cands = [...cont.querySelectorAll('div, span, li, button')]
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map(el => ({
        clase: el.className.toString(),
        texto: (el.innerText || '').replace(/\s+/g, ' ').trim(),
      }));
    return { cands };
  }, { control, opcion });

  if (hijos.error) throw new Error(`${control}: ${hijos.error}`);

  // estrategias en orden de preferencia
  const objetivo = opcion.trim();
  const intentos = [
    page.locator(`[nombre="${control}"] .boton`).filter({ hasText: objetivo }),
    page.locator(`[nombre="${control}"] [class*="btn"]`).filter({ hasText: objetivo }),
    page.locator(`[nombre="${control}"] div`).filter({ hasText: objetivo }),
  ];

  for (const loc of intentos) {
    const n = await loc.count().catch(() => 0);
    if (n === 0) continue;
    const el = loc.last();          // el mas interno que coincide
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click({ timeout: 60000 });
    return;
  }

  console.log(`   candidatos en ${control}:`);
  hijos.cands.slice(0, 20).forEach(c =>
    console.log(`     [${c.clase.slice(0, 40)}] ${c.texto.slice(0, 40)}`));
  throw new Error(`no encontre la opcion "${opcion}" en ${control}`);
}

async function ejecutar(page, paso) {
  const t0 = Date.now();

  if (paso.tipo === 'opcion') {
    await page.locator(`[nombre="${paso.nombre}"]`).first()
              .waitFor({ state: 'visible', timeout: T });
    await page.waitForTimeout(2000);
    await clickOpcion(page, paso.nombre, paso.opcion);
  } else {
    const l = page.locator(`[nombre="${paso.nombre}"]`).filter({ visible: true }).first();
    await l.waitFor({ state: 'visible', timeout: T });
    await l.click({ timeout: 60000 });
  }

  await esperarOverlay(page, T);

  if (paso.espera) {
    const ok = await page.locator(`[nombre="${paso.espera}"]`).filter({ visible: true }).first()
                         .waitFor({ state: 'visible', timeout: T })
                         .then(() => true).catch(() => false);
    if (!ok) {
      await diagnostico(page, `no aparecio ${paso.espera}`);
      throw new Error(`no aparecio ${paso.espera}`);
    }
  }

  await page.waitForTimeout(1500);
  const etiqueta = paso.opcion ? `${paso.nombre}>"${paso.opcion}"` : paso.nombre;
  return `${etiqueta} [${((Date.now() - t0) / 1000).toFixed(0)}s]`;
}

(async () => {
  const browser = await chromium.launch({
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const ctx = await browser.newContext({
    userAgent: UA, viewport: { width: 1366, height: 900 },
    locale: 'es-CO', timezoneId: 'America/Bogota',
  });
  await ctx.addInitScript(() =>
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
  const page = await ctx.newPage();

  page.on('pageerror', e => console.log('  [JS ERROR]', String(e).slice(0, 150)));

  let estado = 'roto', detalle = '';
  const inicio = Date.now();

  try {
    const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    if (!resp || resp.status() >= 400) throw new Error(`HTTP ${resp?.status()}`);

    await page.locator('[nombre="btnSolicitarCita"]').waitFor({ state: 'visible', timeout: T });
    await esperarOverlay(page, T);
    await page.waitForTimeout(5000);
    console.log('pantalla inicial lista');

    for (const [i, paso] of PASOS.entries()) {
      console.log(`paso ${i + 1} ok: ${await ejecutar(page, paso)}`);
    }

    const salioModal = await page.locator('[nombre="ModalError"]')
      .filter({ visible: true }).first()
      .waitFor({ state: 'visible', timeout: 90000 }).then(() => true).catch(() => false);

    const finales = await controles(page);

    if (salioModal) {
      estado = 'sin_citas';
      detalle = (finales.find(c => c.n === 'txtInfoAdicional')?.t || 'modal sin texto').slice(0, 150);
    } else {
      const nuevos = finales.filter(c => !BASE.includes(c.n));
      if (nuevos.length) {
        estado = 'con_citas';
        detalle = nuevos.map(c => `${c.n}:${c.t}`).join(' | ').slice(0, 180);
      } else {
        estado = 'roto';
        detalle = 'ni modal ni controles nuevos tras elegir categoria';
      }
    }

    console.log('\n--- CONTROLES FINALES ---');
    finales.forEach(x => console.log(`   ${x.n} (${x.p}) :: ${x.t}`));

  } catch (e) {
    const msg = e.message.split('\n')[0];
    estado = /no encontre la opcion/i.test(msg) ? 'roto'
           : /Timeout|no aparecio/i.test(msg) ? 'lento' : 'roto';
    detalle = msg.slice(0, 150);
    await diagnostico(page, 'excepcion').catch(() => {});
  }

  console.log(`\nESTADO: ${estado} | ${detalle} | total ${((Date.now() - inicio) / 1000).toFixed(0)}s`);
  await page.screenshot({ path: 'estado.png', fullPage: true }).catch(() => {});
  salida('estado', estado);
  salida('detalle', detalle);
  await browser.close();
})();
