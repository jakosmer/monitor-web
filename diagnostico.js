const URL = 'https://agendamiento.dian.gov.co/';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function probar(etiqueta, opciones) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const r = await fetch(URL, { ...opciones, signal: ctrl.signal, redirect: 'manual' });
    clearTimeout(timer);
    const cuerpo = await r.text().catch(() => '');
    console.log(`\n[${etiqueta}] ${r.status} ${r.statusText} en ${Date.now() - t0}ms`);
    console.log('  server:', r.headers.get('server'),
                '| cf-ray:', r.headers.get('cf-ray'),
                '| location:', r.headers.get('location'));
    console.log('  bytes:', cuerpo.length);
    console.log('  inicio:', cuerpo.slice(0, 300).replace(/\s+/g, ' '));
  } catch (e) {
    console.log(`\n[${etiqueta}] FALLÓ en ${Date.now() - t0}ms: ${e.name} ${e.message}`);
  }
}

(async () => {
  console.log('IP saliente del runner:');
  await fetch('https://api.github.com/meta').then(() => {}).catch(() => {});

  await probar('sin cabeceras', {});

  await probar('con UA de navegador', {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-CO,es;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
    },
  });

  await probar('HEAD', { method: 'HEAD', headers: { 'User-Agent': UA } });
})();
