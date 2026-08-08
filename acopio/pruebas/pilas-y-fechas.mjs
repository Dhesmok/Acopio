// =====================================================================
//  Dos celulares eligiendo el mismo número de pila, y la fecha del lote
//  cuando se registra de noche (que en UTC ya es el día siguiente).
// =====================================================================
import { instalar } from './ayudas/idb.mjs';
import { ok, titulo, cerrar, congelarReloj } from './ayudas/decir.mjs';

const tiendas = instalar();
const { servidor } = await import('./ayudas/supabase.mjs');
const { cargarStore } = await import('./ayudas/cargar.mjs');
const Store = await cargarStore();

await Store.iniciar();

// ---------------------------------------------------------------------
titulo('Dos celulares eligen el mismo número de pila.');
// otro celular ya subió las pilas 1, 2 y 3: el siguiente libre es el 4
for (const n of ['1', '2', '3'])
  servidor.tablas.pilas.set('otra' + n,
    { id: 'otra' + n, codigo: n, tipo: 'otro', estado: 'abierta',
      plataforma_id: 'PL-TOPSOIL' });

const lote = await Store.crearLote({ codigo: 'ABG50', proveedor_id: 'p1', placa: 'AAA111',
  material: 'granel', forma: 'elipse', x: 0, y: 0,
  plataforma_id: 'PL-TOPSOIL', usuario_id: 'yo' });
await Store.sincronizar();

const pila = await Store.crearPila({ codigo: '3', tipo: 'otro', nota: null,
  x: 0, y: 0, rx: 100, ry: 70, plataforma_id: 'PL-TOPSOIL', usuario_id: 'yo' });
await Store.registrarEvento({ lote_id: lote.id, tipo: 'ingreso_pila',
  pila_id: pila.id, usuario_id: 'yo' });

await Store.sincronizar();   // choque de nombre → se renombra
await Store.sincronizar();   // sube con el nombre nuevo, y detrás su evento

const mia = servidor.tablas.pilas.get(pila.id);
ok(!!mia, 'la pila subió, no se perdió por el nombre repetido');
ok(mia?.codigo === '4', `quedó con el siguiente número libre (quedó "${mia?.codigo}")`);
ok(servidor.tablas.pilas.size === 4, 'las cuatro pilas conviven en el servidor');
ok(servidor.tablas.eventos.size === 1, 'el evento de ingreso a la pila también subió');
ok((await Store.pila(pila.id))?.codigo === '4', 'en pantalla la pila también se llama 4');
ok([...tiendas.get('fallidos').values()].length === 0, 'nada quedó rechazado');
const avisos = await Store.avisos();
ok(avisos.length === 1 && /pila 3 ya existía/.test(avisos[0].texto),
   `se avisa del renombre: "${avisos[0]?.texto}"`);

// ---------------------------------------------------------------------
titulo('Una pila archivada suelta su nombre: el número se vuelve a usar.');

// El nombre era único PARA SIEMPRE, así que cada pila que se archivaba
// —y se archivan solas al quedarse con un lote— dejaba su número
// apartado. Con tres pilas en el patio la siguiente ya se llamaba "4", y
// en un año iría por la "40". Una pila archivada no se dibuja en el
// plano, así que su nombre no le estorba a nadie.
for (const p of servidor.tablas.pilas.values()) p.estado = 'consumida';
for (const p of await Store.pilas()) await Store.renombrarPila(p.id, { estado: 'consumida' });

const reusada = await Store.crearPila({ codigo: '1', tipo: 'otro', nota: null,
  x: 0, y: 0, rx: 100, ry: 70, plataforma_id: 'PL-TOPSOIL', usuario_id: 'yo' });
await Store.sincronizar();
const enServidor = servidor.tablas.pilas.get(reusada.id);
ok(!!enServidor, 'la pila nueva subió aunque ya hubo una "1" archivada');
ok(enServidor?.codigo === '1', `y se quedó con el nombre "1" (quedó "${enServidor?.codigo}")`);

// Pero entre las ABIERTAS el nombre sigue sin poder repetirse: dos pilas
// llamadas igual a la vez en el plano no se pueden distinguir.
const choca = await Store.crearPila({ codigo: '1', tipo: 'otro', nota: null,
  x: 0, y: 0, rx: 100, ry: 70, plataforma_id: 'PL-TOPSOIL', usuario_id: 'yo' });
await Store.sincronizar();
await Store.sincronizar();
ok(servidor.tablas.pilas.get(choca.id)?.codigo === '2',
   `otra "1" abierta a la vez sí se renombra (quedó "${servidor.tablas.pilas.get(choca.id)?.codigo}")`);

// ---------------------------------------------------------------------
titulo('Un lote recibido de noche NO se fecha al día siguiente.');
// lunes 27 de julio, 8:30 p. m. en Bogotá: en UTC ya es el martes 28
const descongelar = congelarReloj('2026-07-28T01:30:00Z');
const nocturno = await Store.crearLote({ codigo: 'ABG77', proveedor_id: 'p1', placa: 'BBB222',
  material: 'granel', forma: 'elipse', x: 0, y: 0,
  plataforma_id: 'PL-TOPSOIL', usuario_id: 'yo' });
descongelar();

ok(nocturno.fecha_recepcion === '2026-07-27',
   `fecha_recepcion = ${nocturno.fecha_recepcion}, no la de UTC (antes daba 2026-07-28)`);
ok(nocturno.creado_en.startsWith('2026-07-28T01:30'),
   `creado_en sigue en UTC, que es lo correcto para un instante: ${nocturno.creado_en}`);


// ---------------------------------------------------------------------
titulo('Un lote a granel nace redondo, no ovalado.');

const redondo = await Store.crearLote({ codigo: 'ABG80', proveedor_id: 'p1', placa: 'CCC333',
  material: 'granel', forma: 'elipse', x: 300, y: 300, usuario_id: 'yo' });
ok(redondo.rx === redondo.ry, `el granel sale circular (${redondo.rx} \u00d7 ${redondo.ry})`);
// La misma superficie que el \u00f3valo de 46 \u00d7 34 que hab\u00eda antes: el patio no
// cambia de densidad por cambiar la forma.
const antes = Math.PI * 46 * 34, ahora = Math.PI * redondo.rx * redondo.ry;
ok(Math.abs(ahora - antes) / antes < 0.05,
   `y ocupa lo mismo que el \u00f3valo de antes (${ahora.toFixed(0)} contra ${antes.toFixed(0)})`);

const bigbag = await Store.crearLote({ codigo: 'ABG81', proveedor_id: 'p1', placa: 'DDD444',
  material: 'bigbag', forma: 'rectangulo', x: 400, y: 300, usuario_id: 'yo' });
ok(bigbag.rx === 46 && bigbag.ry === 34,
   `el bigbag se queda como estaba (${bigbag.rx} \u00d7 ${bigbag.ry})`);

cerrar();
