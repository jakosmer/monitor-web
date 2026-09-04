const fs = require('fs');
const { chromium } = require('playwright');

const URL = 'https://agendamiento.dian.gov.co/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const CARGANDO = '#mpcWPdivCargando';
const T = 120000;

const PASOS = [
  { nombre: 'btnSolicitarCita', opcion: null,              espera: 'TipoPersona' },
  { nombre: 'TipoPersona',      opcion: 'Persona Natural', espera: 'TipoAtencion' },
  { nombre: 'TipoAtencion',     opcion: 'Videoatención',   espera: 'Categorias' },
  { nombre: 'Categorias',       opcion: 'Devoluciones.',   espera: null },
];

const BASE = ['PasoUno', 'txtTitulo', 'txtPasoUno', 'txtTipoPersona', 'TipoPersona',
              'txtTipoAtencion', 'TipoAtencion', 'txtCategoria', 'Categorias',
              'btnAnterior', 'btnSiguienteBlock', 'btnSiguiente'];
const IGNORAR = ['_Header', '_Footer', '_NavPaginaDIAN'];

const salida = (k, v) => process.env.GITHUB_OUTPUT
  && fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);

const controles = (page) => page.evaluate((ign) =>
  [...document.querySelectorAll('[nombre]')].filter((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== 'none'
           && !ign.includes(el.getAttribute('pantalla') || '');
  }).map((el) => ({
    n: el.getAttribute('nombre'),
    p: el.getAttribute('pantalla'),
    t: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
  })), IGNORAR);

async function diagnostico(page, etiqueta) {
  console.log(`\n### DIAGNOSTICO: ${etiqueta} ###`);
  const c = await controles(page).catch(() => []);
  console.log(`controles visibles (${c.length}):`);
  c.forEach((x) => console.log(`   ${x.n} (${x.p}) :: ${x.t}`));
  await page.screenshot({ path: 'estado.png', fullPage: true }).catch(() => {});
}

async function esperarOverlay(page, ms) {
  await page.waitForTimeout(1000);
  await page.locator(CARGANDO).waitFor({ state: 'hidden', timeout: ms }).catch(() => {});
}

async function esperarControl(page, nombre, ms) {
  return page.waitForFunction((n) =>
    [...document.querySelectorAll(`[nombre="${n}"]`)].some((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== 'none';
    }), nombre, { timeout: ms }).then(() => true).catch(() => false);
}

async function clickEnDom(page, control, opcion) {
  return page.evaluate((args) => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
    };

    const conts = [...document.querySelectorAll(`[nombre="${args.control}"]`)].filter(visible);
    if (conts.length === 0) {
      return { ok: false, error: `sin contenedor visible ${args.control}` };
    }

    for (const cont of conts) {
      if (!args.opcion) {
        cont.click();
        return { ok: true, via: 'contenedor' };
      }
      const objetivo = args.opcion.trim().toLowerCase();
      const cands = [...cont.querySelectorAll('div, span, li, button')]
        .filter(visible)
        .filter((el) => (el.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase() === objetivo);

      if (cands.length > 0) {
        let el = cands[0];
        for (const c of cands) {
          if (c.contains(el)) el = c;
        }
        el.click();
        return { ok: true, via: (el.className || el.tagName).toString().slice(0, 40) };
      }
    }
    return { ok: false, error: `opcion "${args.opcion}" no hallada en ${args.control}` };
  }, { control, opcion });
}

async function ejecutar(page, paso) {
  const t0 = Date.now();

  const hay = await esperarControl(page, paso.nombre, T);
  if (!hay) {
    await diagnostico(page, `no existe ${paso.nombre}`);
    throw new Error(`no aparecio ${paso.nombre}`);
  }
  await page.waitForTimeout(2000);

  const r = await clickEnDom(page, paso.nombre, paso.opcion);
  if (!r.ok) {
    await diagnostico(page, r.error);
    throw new Error(r.error);
  }

  await esperarOverlay(page, T);

  if (paso.espera) {
    const listo = await esperarControl(page, paso.espera, T);
    if (!listo) {
      await diagnostico(page, `no aparecio ${paso.espera}`);
      throw new Error(`no aparecio ${paso.espera}`);
    }
  }

  await page.waitForTimeout(1500);
  const etiqueta = paso.opcion ? `${paso.nombre}>"${paso.opcion}"` : paso.nombre;
  return `${etiqueta} via ${r.via} [${((Date.now() - t0) / 1000).toFixed(0)}s]`;
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
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await ctx.newPage();

  page.on('pageerror', (e) => console.log('  [JS ERROR]', String(e).slice(0, 150)));

  let estado = 'roto';
  let detalle = '';
  const inicio = Date.now();

  try {
    const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    if (!resp || resp.status() >= 400) {
      throw new Error(`HTTP ${resp ? resp.status() : 'sin respuesta'}`);
    }

    const arranco = await esperarControl(page, 'btnSolicitarCita', T);
    if (!arranco) throw new Error('la app no monto la pantalla inicial');
    await esperarOverlay(page, T);
    await page.waitForTimeout(5000);
    console.log('pantalla inicial lista');

    for (let i = 0; i < PASOS.length; i++) {
      const info = await ejecutar(page, PASOS[i]);
      console.log(`paso ${i + 1} ok: ${info}`);
    }

    const salioModal = await esperarControl(page, 'ModalError', 90000);
    const finales = await controles(page);

    if (salioModal) {
      const txt = finales.find((c) => c.n === 'txtInfoAdicional');
      estado = 'sin_citas';
      detalle = (txt ? txt.t : 'modal sin texto').slice(0, 150);
    } else {
      const nuevos = finales.filter((c) => !BASE.includes(c.n));
      if (nuevos.length > 0) {
        estado = 'con_citas';
        detalle = nuevos.map((c) => `${c.n}:${c.t}`).join(' | ').slice(0, 180);
      } else {
        estado = 'roto';
        detalle = 'ni modal ni controles nuevos tras elegir categoria';
      }
    }

    console.log('\n--- CONTROLES FINALES ---');
    finales.forEach((x) => console.log(`   ${x.n} (${x.p}) :: ${x.t}`));
  } catch (e) {
    const msg = e.message.split('\n')[0];
    if (/no hallada|sin contenedor/i.test(msg)) {
      estado = 'roto';
    } else if (/Timeout|no aparecio|no monto/i.test(msg)) {
      estado = 'lento';
    } else {
      estado = 'roto';
    }
    detalle = msg.slice(0, 150);
    await diagnostico(page, 'excepcion').catch(() => {});
  }

  const total = ((Date.now() - inicio) / 1000).toFixed(0);
  console.log(`\nESTADO: ${estado} | ${detalle} | total ${total}s`);
  await page.screenshot({ path: 'estado.png', fullPage: true }).catch(() => {});
  salida('estado', estado);
  salida('detalle', detalle);
  await browser.close();
})();
