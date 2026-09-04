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

// click directo en el DOM: busca el contenedor VISIBLE (puede haber duplicados ocultos)
async function clickEnDom(page, { control, opcion }) {
  return page.evaluate(({ control, opcion }) => {
    const visible = el => {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
    };

    const conts = [...document.querySelectorAll(`[nombre="${control}"]`)].filter(visible);
    if (!conts.length) return { ok: false, error: `sin contenedor visible ${control}` };

    for (const cont of conts) {
      if (!opcion) {                    // click en el control mismo
        cont.click();
        return { ok: true, via: 'contenedor' };
      }
      const objetivo = opcion.trim().toLowerCase();
      const cands = [...cont.querySelectorAll('.boton, [class*="btn"], div, span, li')]
        .filter(visible)
        .filter(el => (el.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase() === objetivo);

      if (cands.length) {
        // el mas externo de los que coinciden exactamente: suele llevar el handler
        const el = cands.reduce((a, b) => (a.contains(b) ? a : b));
        el.click();
        return { ok: true, via: el.className || el.tagName };
      }
    }
    return { ok: false, error: `opcion "${opcion}" no hallada en ${control}` };
  }, { control, opcion });
}

async function ejecutar(page, paso) {
  const t0 = Date.now();

  await page.locator(`[nombre="${paso.nombre}"]`).first()
            .waitFor({ state: 'attached', timeout: T });
  await page.waitForTimeout(2000);

  const r = await clickEnDom(page, { control: paso.nombre, opcion: paso.opcion || null });
  if (!r.ok) {
    await diagnostico(page, r.error);
    throw new Error(r.error);
  }

  await esperarOverlay(page,
