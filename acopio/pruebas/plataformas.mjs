// =====================================================================
//  El patio son CINCO sitios, no uno.
//
//  Lo que se prueba aquí es lo que no se ve al mirar la pantalla: que un
//  lote no se teletransporte de patio sin dejar rastro, que mover una
//  pila se lleve a sus lotes, y que dos pilas puedan llamarse igual en
//  plataformas distintas —que es justo lo que se pidió.
// =====================================================================
import { readFile } from 'node:fs/promises';
import { instalar } from './ayudas/idb.mjs';
import { ok, titulo, cerrar } from './ayudas/decir.mjs';

const tiendas = instalar();
const { servidor } = await import('./ayudas/supabase.mjs');
const { cargarStore } = await import('./ayudas/cargar.mjs');
const Store = await cargarStore();

await Store.iniciar();

const TOPSOIL = 'PL-TOPSOIL', YE = 'PL-YE', P5 = 'PL-5';
servidor.tablas.proveedores.set('p1',
  { id: 'p1', abreviatura: 'PG', nombre: 'Prueba', activo: true });
for (const [id, nombre, orden] of [[TOPSOIL, 'Topsoil', 1], [YE, 'Ye', 4], [P5, 'Plataforma 5', 5]])
  servidor.tablas.plataformas.set(id, { id, nombre, orden, activa: true,
    ancho: 1000, alto: 700, actualizado_en: new Date().toISOString() });

const nuevoLote = (codigo, plataforma_id) => Store.crearLote({
  codigo, proveedor_id: 'p1', placa: 'WGY308', material: 'granel',
  forma: 'elipse', x: 100, y: 100, plataforma_id, usuario_id: 'yo' });

// ---------------------------------------------------------------------
titulo('Un lote nace en la plataforma donde se registra.');

const enTopsoil = await nuevoLote('PG1001', TOPSOIL);
const enYe = await nuevoLote('PG1002', YE);
ok(enTopsoil.plataforma_id === TOPSOIL, 'el primero queda en Topsoil');
ok(enYe.plataforma_id === YE, 'y el segundo en Ye, no donde estuviera el anterior');

await Store.sincronizar();
ok(servidor.tablas.lotes.get(enYe.id)?.plataforma_id === YE,
   'y la plataforma sube con el lote');

// ---------------------------------------------------------------------
titulo('Cambiar de plataforma es un EVENTO, no una escritura a escondidas.');

// Es lo que da la trazabilidad: el historial del lote tiene que poder
// contar cuándo se movió y quién lo movió. Si fuera una columna que se
// escribe y ya, un lote aparecería en otro patio sin explicación.
const antes = servidor.tablas.eventos.size;
await Store.trasladarLote(enTopsoil.id, P5, 'yo');

const suyos = (await Store.historial(enTopsoil.id)).filter((e) => e.tipo === 'traslado');
ok(suyos.length === 1, 'queda un apunte de traslado en su historial');
ok(suyos[0].plataforma_id === P5, 'que dice a qué plataforma se fue');
ok(suyos[0].usuario_id === 'yo', 'y quién lo movió');
ok((await Store.lote(enTopsoil.id)).plataforma_id === P5,
   'en pantalla ya está en Plataforma 5, sin esperar al servidor');

// Moverlo a donde ya está no apunta nada: si no, tocar el botón dos
// veces llenaría el historial de líneas que no dicen nada.
await Store.trasladarLote(enTopsoil.id, P5, 'yo');
ok((await Store.historial(enTopsoil.id)).filter((e) => e.tipo === 'traslado').length === 1,
   'y moverlo a donde ya está no apunta nada');

// ---------------------------------------------------------------------
titulo('El traslado NO toca el estado ni la pila.');

// Un lote facturado que se pasa a Ye sigue facturado. Antes, "llevar a
// plataforma 5" era un CAMBIO DE ESTADO y por eso se perdía el de verdad.
await Store.registrarEvento({ lote_id: enYe.id, tipo: 'cambio_estado',
  estado_nuevo: 'facturado', usuario_id: 'yo' });
await Store.trasladarLote(enYe.id, TOPSOIL, 'yo');
const movido = await Store.lote(enYe.id);
ok(movido.estado === 'facturado', 'sigue facturado después de mudarse');
ok(movido.plataforma_id === TOPSOIL, 'y está en la plataforma nueva');

// ---------------------------------------------------------------------
titulo('Mover una pila se lleva a sus lotes.');

const pila = await Store.crearPila({ codigo: '1', tipo: 'otro', nota: null,
  x: 300, y: 300, rx: 120, ry: 90, plataforma_id: TOPSOIL, usuario_id: 'yo' });
const dentro = [];
for (const c of ['PG1010', 'PG1011']) {
  const l = await nuevoLote(c, TOPSOIL);
  await Store.registrarEvento({ lote_id: l.id, tipo: 'ingreso_pila',
    pila_id: pila.id, usuario_id: 'yo' });
  dentro.push(l);
}

await Store.trasladarPila(pila.id, YE, 'yo');
ok((await Store.pila(pila.id)).plataforma_id === YE, 'la pila se fue a Ye');
for (const l of dentro) {
  const ahora = await Store.lote(l.id);
  ok(ahora.plataforma_id === YE, `${l.codigo} se fue con ella`);
  ok(ahora.pila_id === pila.id, `y ${l.codigo} sigue DENTRO de la pila, no suelto`);
  ok((await Store.historial(l.id)).some((e) => e.tipo === 'traslado'),
     `y en el historial de ${l.codigo} queda apuntado`);
}

// ---------------------------------------------------------------------
titulo('Dos plataformas pueden tener cada una su "pila 1".');

// Se pidió expresamente: "seguramente habrá una pila 1 en plataforma 5 y
// pila 1 en el topsoil". Son planos distintos y nadie las confunde.
const otraUno = await Store.crearPila({ codigo: '1', tipo: 'otro', nota: null,
  x: 300, y: 300, rx: 120, ry: 90, plataforma_id: P5, usuario_id: 'yo' });
await Store.sincronizar();
await Store.sincronizar();
ok(servidor.tablas.pilas.get(otraUno.id)?.codigo === '1',
   `la "pila 1" de Plataforma 5 conserva su nombre (quedó "${servidor.tablas.pilas.get(otraUno.id)?.codigo}")`);
ok([...tiendas.get('fallidos').values()].length === 0, 'y nada quedó rechazado');

// Pero DOS abiertas con el mismo nombre en la MISMA plataforma sí chocan.
const choca = await Store.crearPila({ codigo: '1', tipo: 'otro', nota: null,
  x: 500, y: 500, rx: 120, ry: 90, plataforma_id: P5, usuario_id: 'yo' });
await Store.sincronizar();
await Store.sincronizar();
ok(servidor.tablas.pilas.get(choca.id)?.codigo !== '1',
   `otra "1" en la misma plataforma sí se renombra (quedó "${servidor.tablas.pilas.get(choca.id)?.codigo}")`);

// ---------------------------------------------------------------------
titulo('Alimentar apunta POR DÓNDE y CUÁNDO.');

servidor.tablas.puntos_alimentacion.set('PT-BATCH',
  { id: 'PT-BATCH', nombre: 'Batch', orden: 1, activo: true });
const comido = await nuevoLote('PG1020', TOPSOIL);
await Store.registrarEvento({ lote_id: comido.id, tipo: 'cambio_estado',
  estado_nuevo: 'alimentado', punto_id: 'PT-BATCH', usuario_id: 'yo' });

const yaNo = await Store.lote(comido.id);
ok(yaNo.estado === 'alimentado', 'queda como alimentado');
ok(yaNo.punto_id === 'PT-BATCH', 'con el punto por el que entró');
ok(!!yaNo.alimentado_en, 'y la hora en que se alimentó');
ok((await Store.lotes()).some((x) => x.id === comido.id),
   'pero NO se borra: sigue en la base con todo su historial');

// Y si se corrige a otro estado, esos dos datos se limpian: dejarlos
// puestos mentiría en el informe.
await Store.registrarEvento({ lote_id: comido.id, tipo: 'cambio_estado',
  estado_nuevo: 'muestreado', usuario_id: 'yo' });
const corregido = await Store.lote(comido.id);
ok(corregido.punto_id === null && corregido.alimentado_en === null,
   'al corregirlo a otro estado, el punto y la fecha se van');

// ---------------------------------------------------------------------
titulo('La app y el servidor derivan lo mismo.');

// `aplicarLocal` en store.js pinta la pantalla antes de que el servidor
// conteste, y el disparador del servidor hace lo mismo un momento
// después. Si se separan, la pantalla y la base dicen cosas distintas.
const sql = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
ok(/elsif new\.tipo = 'traslado' then\s*\n(\s*--[^\n]*\n)*\s*update lotes set plataforma_id = new\.plataforma_id/
   .test(sql), 'el servidor mueve el lote con el evento de traslado');
ok(/punto_id = case when new\.estado_nuevo = 'alimentado'/.test(sql),
   'y guarda el punto solo cuando el estado es alimentado');
ok(/new\.plataforma_id\s*:= old\.plataforma_id;/.test(sql),
   'y el disparador protector impide cambiar de plataforma sin evento');

// ---------------------------------------------------------------------
titulo('El tamaño del plano es de CADA plataforma, no de todas.');

// Era un solo número en `mapa_config` para el patio entero. Al partirlo
// en cinco se movió a `plataformas`, pero la pantalla que lo edita seguía
// escribiendo en `mapa_config`: cambiar el tamaño no habría hecho nada, y
// peor, habría escrito en columnas que ya no existen.
const app = await readFile(new URL('../web/js/app.js', import.meta.url), 'utf8');
const fondo = app.slice(app.indexOf('function panelFondo()'),
                        app.indexOf('function panelFondo()') + 6000);
ok(/guardarPlataforma\(\{ \.\.\.plat, \.\.\.cfg \}\)/.test(fondo),
   'el tamaño y el fondo se guardan en la plataforma que se está mirando');
ok(!/guardarConfig\([^)]*ancho/.test(fondo),
   'y no en la configuración común, que ya no tiene tamaño');
ok(/guardarConfig\(\{ \.\.\.S\.config, colores \}\)/.test(fondo),
   'los colores sí siguen siendo de la empresa: valen para las cinco');

// Una figura del fondo nace en la plataforma que se está mirando. Sin
// esto el servidor la rechaza —la columna es obligatoria— y el admin ve
// "no se pudo guardar" sin saber por qué.
ok(/plataforma_id: S\.plataforma/.test(fondo),
   'y una figura nueva del fondo nace en esta plataforma');

// ---------------------------------------------------------------------
titulo('El informe dice en qué plataforma está y por dónde se alimentó.');

// Se pidió textualmente: "al momento de explotar el excel debería
// especificar alimentado y por dónde".
for (const [clave, titulo_] of [['plataforma', 'Plataforma'],
                                ['punto', 'Alimentado por'],
                                ['cuandoAlim', 'Fecha alimentado']])
  ok(new RegExp(`clave: '${clave}',\\s*titulo: '${titulo_}'`).test(app),
     `el archivo lleva la columna "${titulo_}"`);
ok(/punto: l\.punto_id \? nombrePunto\(l\.punto_id\) : ''/.test(app),
   'y sale el nombre del punto, no su identificador');

// ---------------------------------------------------------------------
titulo('La migración no nombra un estado que quizá acaba de crear.');

// Postgres no deja USAR un valor de enumeración en la misma corrida en
// que se añade. La migración añade 'plataforma' arriba por si viene de
// una base vieja, así que compararlo por nombre más abajo reventaría la
// migración entera justo en esas bases.
const mig = await readFile(new URL('../sql/migracion.sql', import.meta.url), 'utf8');
ok(/where estado::text = 'plataforma'/.test(mig),
   "el estado viejo se busca como texto (estado::text), no como valor de la enumeración");
ok(!/where estado = 'plataforma'/.test(mig), 'y en ningún sitio se nombra a secas');

cerrar();
