const fs = require('fs');
const { chromium } = require('playwright');

const URL = 'https://agendamiento.dian.gov.co/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const CARGANDO = '#mpcWPdivCargando';
const T = 180000;   // timeout generoso: el backend de la DIAN es muy lento

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
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
    t: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
  })), IGNORAR);

async function esperarOverlay(page, ms = T) {
  await page.waitForTimeout(800);
  try {
    await page.locator(CARGANDO).waitFor({ state: 'hidden', timeout: ms });
  } catch {
    const e = new Error('overlay de carga no desaparece (backend lento)');
    e.lento = true;
    throw e;
  }
}

async function ejecutar(page, paso) {
  const t0 = Date.now();
  let loc;

  if (paso.tipo === 'opcion') {
    loc = page.locator(`[nombre="${paso.nombre}"] .boton`)
              .filter({ hasText: new RegExp(`^\\s*${esc(paso.opcion)}\\s*$`) }).first();
    if (!(await loc.count())) {
      loc = page.locator(`[nombre="${paso.nombre}"] .boton`)
                .filter({ hasText: paso.opcion }).first();
    }
  } else {
    loc = page.locator(`[nombre="${paso.nombre}"]`).filter({ visible: true }).first();
  }

  await loc.waitFor({ state: 'visible', timeout: T });
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.click({ timeout: 120000 });

  await esperarOverlay(page, T);
  if (paso.espera) {
    await page.locator(`[nombre="${paso.espera}"]`).filter({ visible: true }).first()
              .waitFor({ state: 'visible', timeout: T });
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

  let estado = 'roto', detalle = '';
  const inicio = Date.now();

  try {
    const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    if (!resp || resp.status() >= 400) throw new Error(`HTTP ${resp?.status()}`);

    await page.locator('[nombre]').first().waitFor({ state: 'attached', timeout: T });
    await esperarOverlay(page, T).catch(() => {});
    await page.waitForTimeout(2000);

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
    // un timeout no es que el flujo cambió: es que el sitio no respondió a tiempo
    estado = (e.lento || /Timeout/i.test(msg)) ? 'lento' : 'roto';
    detalle = msg.slice(0, 150);
  }

  console.log(`\nESTADO: ${estado} | ${detalle} | total ${((Date.now() - inicio) / 1000).toFixed(0)}s`);
  await page.screenshot({ path: 'estado.png', fullPage: true }).catch(() => {});
  salida('estado', estado);
  salida('detalle', detalle);
  await browser.close();
})();
