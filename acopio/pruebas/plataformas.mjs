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
// La función entera, hasta la siguiente: con una ventana fija de
// caracteres, cualquier sección nueva del panel dejaba el guardado fuera.
const fondo = app.slice(app.indexOf('function panelFondo()'),
                        app.indexOf('function fichaFigura('));
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
titulo('La tarjeta de la plataforma cuenta lo mismo que dibuja su plano.');

// Contaba los despachados, que ya se los llevó el camión y el plano no
// dibuja: la tarjeta decía más lotes de los que se ven al entrar.
ok(/const enElPatio = \(l\) => !alimentado\(l\)\s*\n\s*&& l\.estado !== 'despachado'/.test(app),
   'hay una sola definición de "está en el patio", y deja fuera lo despachado');
const res = app.slice(app.indexOf('const resumen = (id) =>'),
                      app.indexOf('function pintarPlataformas()'));
ok(/l\.plataforma_id === id && enElPatio\(l\)/.test(res),
   'la cuenta de la tarjeta la usa');

// ---------------------------------------------------------------------
titulo('Las cuentas de la tarjeta salen bien, no solo están escritas.');

// `resumen` se saca de app.js TAL CUAL y se ejecuta con lotes de
// mentira. Comprobar que el texto está en su sitio no dice si la cuenta
// es correcta, y esta pantalla es justo eso: cuentas.
const trozo = (desde, hasta) => {
  const a = app.indexOf(desde), b = app.indexOf(hasta, a);
  if (a < 0 || b < 0) throw new Error(`no se encontró el trozo ${desde}`);
  return app.slice(a, b);
};
const armar = new Function('S', `
  ${trozo('const hoyISO = (mas = 0)', '// La recogida es un compromiso')}
  ${trozo('const enDevolucion = (l) =>', 'function textoRecogida(')}
  ${trozo('const alimentado = (l) =>', 'const nombrePlataforma =')}
  ${trozo('const diasEntreFechas =', 'function filasDelInforme(')}
  ${trozo('const DIAS_NUEVO = 7;', 'function pintarPlataformas()')}
  return { resumen, DIAS_QUIETO };
`);

// Un patio de mentira: hoy, hace 3 días, hace 40 y uno atascado.
const hoy = new Date();
const haceDias = (n) => {
  const d = new Date(hoy); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const cuando = (n) => `${haceDias(n)}T12:00:00.000Z`;
const S = { lotes: [
  // en el patio, recién llegados
  { id: 'a', plataforma_id: 'X', estado: 'por_muestrear', fecha_recepcion: haceDias(0),
    estado_desde: cuando(0), pila_id: null },
  { id: 'b', plataforma_id: 'X', estado: 'muestreado', fecha_recepcion: haceDias(3),
    estado_desde: cuando(3), pila_id: 'P1' },
  // viejo y atascado: 40 días sin que le pase nada
  { id: 'c', plataforma_id: 'X', estado: 'facturado', fecha_recepcion: haceDias(40),
    estado_desde: cuando(40), pila_id: 'P1' },
  // devolución con la fecha ya pasada
  { id: 'd', plataforma_id: 'X', estado: 'devolucion', fecha_recepcion: haceDias(20),
    estado_desde: cuando(20), pila_id: null, fecha_recogida: haceDias(5) },
  // estos DOS ya no están en el patio y no pueden contar para nada
  { id: 'e', plataforma_id: 'X', estado: 'despachado', fecha_recepcion: haceDias(2),
    estado_desde: cuando(2), pila_id: null },
  { id: 'f', plataforma_id: 'X', estado: 'alimentado', fecha_recepcion: haceDias(2),
    estado_desde: cuando(2), pila_id: null },
  // y este es de otra plataforma
  { id: 'g', plataforma_id: 'Y', estado: 'por_muestrear', fecha_recepcion: haceDias(1),
    estado_desde: cuando(1), pila_id: null }
], pilas: [
  { id: 'P1', plataforma_id: 'X', estado: 'abierta' },
  { id: 'P2', plataforma_id: 'X', estado: 'consumida' },   // archivada: no cuenta
  { id: 'P3', plataforma_id: 'Y', estado: 'abierta' }
] };

const { resumen: calcular, DIAS_QUIETO } = armar(S);
const x = calcular('X');

ok(x.total === 4, `cuenta los 4 que están en el patio (contó ${x.total})`);
ok(x.porEstado.despachado === undefined && x.porEstado.alimentado === undefined,
   'y lo despachado y lo alimentado no aparecen ni en el desglose');
ok(x.pilas === 1, `una sola pila abierta; la archivada no se dibuja ni se cuenta (contó ${x.pilas})`);
ok(x.nuevos === 2, `dos llegaron esta semana (contó ${x.nuevos})`);
// Solo el de 40 días. El de devolución lleva 20 y el corte está en 21:
// se deja justo por debajo a propósito, para que la prueba se entere si
// alguien cambia el umbral o el "mayor o igual" por un "mayor".
ok(x.quietos === 1,
   `atascado solo el de 40 días; el de 20 no llega al corte de ${DIAS_QUIETO} (dijo ${x.quietos})`);
ok(x.sinRecoger === 1, `uno se pasó de la fecha de recogida (dijo ${x.sinRecoger})`);

// La otra plataforma se cuenta sola: si se colaran los lotes de al lado,
// el tablero mentiría justo en lo que se mira para comparar.
const y = calcular('Y');
ok(y.total === 1 && y.pilas === 1, `la otra plataforma va por su cuenta (${y.total} lote, ${y.pilas} pila)`);

// Una plataforma vacía no puede dar NaN: al empezar, cuatro de las
// cinco están así.
const vacia = calcular('Z');
ok(vacia.total === 0 && vacia.nuevos === 0 && vacia.quietos === 0 && vacia.pilas === 0,
   'una plataforma vacía da ceros, no NaN');
ok(Object.keys(vacia.porEstado).length === 0, 'y su desglose por estado sale vacío');

// ---------------------------------------------------------------------
titulo('La lupa del plano busca en TODO el patio, no solo en lo que se ve.');

// Buscar solo en el plano abierto contestaba "aquí no hay ninguno", que
// es verdad y no sirve de nada: el lote existe, está a dos plataformas,
// y para dar con él había que ir abriéndolas una por una.
const buscador = new Function('S', `
  const placasDe = (l) => (l.placa || '').split(',').filter(Boolean);
  ${trozo('const alimentado = (l) =>', 'const nombrePlataforma =')}
  ${trozo('const enEstaPlataforma = (x) =>', 'const esAdmin =')}
  ${trozo('const cumpleBusqueda = (l) =>', 'function calcularDestacados()')}
  return { lotesQueCoinciden, coincidenEnOtras };
`);

const patio = {
  plataformas: [{ id: 'T', nombre: 'Topsoil' }, { id: 'Y', nombre: 'Ye' },
                { id: 'C', nombre: 'Plataforma 5' }],
  plataforma: 'T',
  mapaFiltro: { campo: 'ninguno', valor: null },
  busquedaMapa: 'PG1042',
  lotes: [
    { id: '1', codigo: 'PG1001', estado: 'por_muestrear', plataforma_id: 'T' },
    { id: '2', codigo: 'PG1042', estado: 'muestreado',    plataforma_id: 'Y' },
    { id: '3', codigo: 'PG1042(2)', estado: 'facturado',  plataforma_id: 'Y' },
    { id: '4', codigo: 'PG1042(3)', estado: 'devolucion', plataforma_id: 'C' },
    // alimentado: se consumió en planta, mandar a nadie a buscarlo sería
    // mandarlo a un patio donde ya no está
    { id: '5', codigo: 'PG1042(4)', estado: 'alimentado', plataforma_id: 'C' }
  ]
};
const { lotesQueCoinciden, coincidenEnOtras } = buscador(patio);

ok((lotesQueCoinciden() || []).length === 0,
   'en la plataforma abierta no hay ninguno, y eso no cambia');
const otras = coincidenEnOtras();
ok(otras.length === 2, `pero se encuentra en otras dos plataformas (encontró ${otras.length})`);
ok(otras[0].nombre === 'Ye' && otras[0].cuantos === 2,
   `en Ye hay 2 (dijo ${otras[0]?.nombre} ${otras[0]?.cuantos})`);
ok(otras[1].nombre === 'Plataforma 5' && otras[1].cuantos === 1,
   `y en Plataforma 5 uno, sin contar el alimentado (dijo ${otras[1]?.cuantos})`);
ok(otras.map((o) => o.id).join() === 'Y,C',
   'y salen en el orden de la pantalla de Plataformas, no en el que vengan los lotes');

// Estando ya en Ye, Ye deja de aparecer en el renglón: se enseña dónde
// MÁS está, no dónde se está.
patio.plataforma = 'Y';
ok(coincidenEnOtras().map((o) => o.id).join() === 'C',
   'al llegar a Ye, solo queda Plataforma 5 por visitar');
ok((lotesQueCoinciden() || []).length === 2, 'y allí sí se resaltan los dos');

// Con un filtro a secas —sin escribir nada— habría coincidencias en casi
// todas las plataformas y el renglón estaría siempre puesto, diciendo lo
// que ya se sabe.
patio.busquedaMapa = '';
patio.mapaFiltro = { campo: 'estado', valor: 'devolucion' };
ok(coincidenEnOtras().length === 0,
   'un filtro sin texto no llena la pantalla de plataformas');

// ---------------------------------------------------------------------
titulo('La fecha de recogida se puede poner en el pasado.');

// Estaba cerrada a partir de hoy, y eso daba por hecho que el compromiso
// se apunta el mismo día en que se toma. En el patio se declara la
// devolución de un lote cuyo plazo se acordó —o se venció— hace semanas.
const rec = app.slice(app.indexOf('function pedirRecogida(l)'),
                      app.indexOf('function pedirRecogida(l)') + 1400);
ok(/id="r-fecha"/.test(rec), 'se encontró el campo de la fecha de recogida');
ok(!/id="r-fecha"[^>]*\smin=/.test(rec),
   'y el calendario ya no tiene tope por abajo: se puede elegir un día pasado');

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

// ---------------------------------------------------------------------
titulo('La migración le pide permiso al disparador antes de rellenar.');

// Esto reventó de verdad al correrla:
//   ERROR 23502: column "plataforma_id" of relation "lotes"
//                contains null values
// `trg_proteger_derivados` devuelve estado, pila y plataforma a lo que ya
// tenían en CADA update de `lotes`, venga de donde venga. El relleno se
// aplicaba y el disparador lo deshacía en el acto, así que la columna
// seguía vacía y el `set not null` de después fallaba.
const relleno = mig.slice(mig.indexOf('do $$\ndeclare\n  topsoil'),
                          mig.indexOf('-- El plano de hoy pasa a ser el plano de Topsoil'));
ok(relleno.length > 100, 'se encontró el bloque que rellena la plataforma de lo que ya existe');
ok(relleno.indexOf("set_config('app.desde_evento', 'on', true)") >= 0
   && relleno.indexOf("set_config('app.desde_evento', 'on', true)")
      < relleno.indexOf('update lotes'),
   'la marca se enciende ANTES de tocar los lotes, o el disparador borra el relleno');
ok(/set_config\('app\.desde_evento', 'off', true\)/.test(relleno),
   'y se apaga al terminar: fuera de aquí el disparador tiene que seguir protegiendo');
ok(relleno.indexOf('update lotes set plataforma_id = plat5, estado')
   > relleno.indexOf("set_config('app.desde_evento', 'on', true)"),
   'el cambio de estado de los de Plataforma 5 va dentro del mismo bloque');


// ---------------------------------------------------------------------
titulo('Un lote recién llegado SOLO puede pasar a muestreado.');

// No es un permiso, es el orden del trabajo: hasta que no hay muestra no
// se sabe qué material es, así que facturarlo o devolverlo sería decidir
// sobre algo que nadie ha mirado. Por eso vale también para el admin.
const posiblesDe = (rol) => new Function('S', `
  const esAdmin = () => S.perfil?.rol === 'admin';
  ${trozo('const ESTADOS_ELEGIBLES = ', '// para ordenar la barra de colores')}
  return estadosPosibles;
`)({ perfil: { rol } });
const posibles = posiblesDe('admin');

const desdeNuevo = posibles({ estado: 'por_muestrear' });
ok(desdeNuevo.length === 1 && desdeNuevo[0] === 'muestreado',
   `desde "por muestrear" solo se ofrece muestreado (salían ${desdeNuevo.length})`);

const desdeMuestreado = posibles({ estado: 'muestreado' });
ok(desdeMuestreado.length >= 6, `ya muestreado se abren los demás (${desdeMuestreado.length})`);
ok(!desdeMuestreado.includes('muestreado'), 'menos el que ya tiene, que no es un cambio');
for (const e of ['facturado', 'devolucion', 'alimentado', 'despachado', 'remuestreo'])
  ok(desdeMuestreado.includes(e), `entre ellos ${e}`);
// Y se puede volver atrás: un estado puesto por error se corrige.
ok(posibles({ estado: 'facturado' }).includes('por_muestrear'),
   'y desde cualquier otro se puede devolver a "por muestrear" si fue un error');

// Alimentar es solo del admin: la base rechaza a los demás, así que la
// pantalla tampoco se lo ofrece.
const delContratista = posiblesDe('contratista')({ estado: 'muestreado' });
ok(!delContratista.includes('alimentado'), 'al contratista no se le ofrece alimentado');
ok(delContratista.includes('facturado'), 'pero el resto de estados sí');

// ---------------------------------------------------------------------
titulo('Cambiar el proveedor corrige el código.');

// El código empieza por la abreviatura del proveedor: PG1042 lo trajo
// PG. Cambiar el proveedor y dejar el código igual deja el lote
// diciendo una cosa y siendo otra.
const recod = new Function(`${trozo('const recodificar = (codigo, vieja, nueva)', 'const siglaDe =')}
  return recodificar;`)();

ok(recod('PG1042', 'PG', 'SJ') === 'SJ1042', 'PG1042 con proveedor SJ pasa a SJ1042');
ok(recod('pg1042', 'PG', 'SJ') === 'SJ1042', 'y da igual cómo esté escrito');
// El sufijo de volqueta se respeta TAL CUAL: quien lo tecleó eligió ese
// formato y no es asunto de esta corrección cambiarlo.
ok(recod('SJ115(2)', 'SJ', 'PG') === 'PG115(2)', 'el sufijo entre paréntesis se respeta');
ok(recod('ABG40.2', 'ABG', 'PG') === 'PG40.2', 'y el sufijo con punto, también');
ok(recod('ABG40-2', 'ABG', 'PG') === 'PG40-2', 'y el sufijo con guion, igual');
// Abreviaturas de largos distintos.
ok(recod('ABG50', 'ABG', 'PG') === 'PG50', 'de una sigla larga a una corta');
ok(recod('PG50', 'PG', 'ABG') === 'ABG50', 'y al revés');
// Si el código no empezaba por la sigla anterior —lo escribieron a mano—
// se cambian igual las letras del principio.
ok(recod('XX1042', 'PG', 'SJ') === 'SJ1042', 'un código que no seguía la regla se endereza');
ok(recod('1042', 'PG', 'SJ') === 'SJ1042', 'y a uno sin letras se le pone la sigla delante');

// ---------------------------------------------------------------------
titulo('El número de viaje tiene su propia casilla.');

// El teclado numérico de un celular NO tiene guion, ni punto, ni
// paréntesis: en un iPhone, escribir "1004-2" en el campo del número era
// sencillamente imposible. Con dos casillas los dos campos conservan el
// teclado de números grande —el que se usa con guantes— y el código lo
// arma la app.
const campos = trozo('<label for="f-num">', '${cajaPlacas(');
ok(/id="f-viaje"[^>]*inputmode="numeric"/s.test(campos),
   'el viaje tiene su propio campo, también con teclado de números');
ok(/id="f-num"[^>]*inputmode="numeric"/s.test(campos),
   'y el número del lote conserva el suyo: nadie tiene que teclear un símbolo');

// Se limpia a lo que `partesCodigo` sabe leer como viaje, o el lote
// quedaría con un código que luego no se muestra con el número arriba y
// la diferencia no se vería hasta después.
const armarCodigo = new Function('S', 'num', 'crudo', `
  const $ = (sel) => sel === '#f-num' ? { value: num } : { value: crudo };
  ${trozo('const limpiarViaje =', 'const rotular =')}
  const sigla = () => 'PG';
  return codigoDe();
`);
const arma = (num, viaje) => armarCodigo({}, num, viaje);

ok(arma('1004', '') === 'PG1004', 'sin viaje, el código es el de siempre');
ok(arma('1004', '2') === 'PG1004-2', 'con viaje 2 queda PG1004-2');
ok(arma('1004', '12') === 'PG1004-12', 'y el viaje puede tener dos cifras');
// Lo que se limpia, y por qué
ok(arma('1004', '02') === 'PG1004-2', 'un cero delante se cae: "-02" no se mostraría arriba');
ok(arma('1004', '0') === 'PG1004', 'y un cero solo es no haber puesto viaje');
ok(arma('1004', '123') === 'PG1004-12', 'más de dos cifras no es un viaje: se recorta');
ok(arma('1004', 'a-2') === 'PG1004-2', 'y si algún teclado cuela letras o el guion, se quitan');
// Que lo que arma el formulario sea justo lo que el plano dibuja con el
// número arriba se comprueba en la tanda del mapa, que es donde vive
// `partesCodigo`.

// ---------------------------------------------------------------------
titulo('La escena de muestreo encuadra ANTES de montarse.');

// La escena se dibuja sobre el encuadre que hay en ese momento: montarla
// y encuadrar después la dejaría centrada en el sitio de antes.
const orden = app.slice(app.indexOf("if (b.dataset.estado === 'muestreado')"),
                        app.indexOf("if (b.dataset.estado === 'muestreado')") + 400);
ok(orden.indexOf('encuadrarPara') < orden.indexOf('animarMuestreo'),
   'se encuadra primero y se monta después');
ok(/await encuadrarPara\(fresco\);/.test(orden), 'y se espera a que el plano llegue');
// Y se enmarca la caja de la ESCENA, no la del lote: `Mapa.enfocar`
// sobre un lote suelto deja un cuadro de 320 y la cuadrilla mide 400.
ok(/const CAJA_OBREROS = \{ dx: [-\d]+, dy: [-\d]+, rx: (\d+), ry: (\d+) \};/.test(app),
   'la caja que ocupa la escena está medida y escrita');
const caja = app.match(/const CAJA_OBREROS = \{ dx: [-\d]+, dy: [-\d]+, rx: (\d+), ry: (\d+) \};/);
ok(Number(caja[1]) * 2 >= 400,
   `la caja mide ${Number(caja[1]) * 2} de ancho, que es lo que ocupa la cuadrilla entera`);


// ---------------------------------------------------------------------
titulo('Un lote que se va SOLO a otra plataforma sale de su pila.');

// Esto se perdía de verdad. El lote se quedaba marcado como parte de una
// pila que está en OTRA plataforma, y así no se dibujaba en ninguno de
// los dos planos: del viejo porque ya no es suyo, y del nuevo porque el
// mapa no pinta como sueltos a los que tienen pila, y allí no hay
// ninguna pila que lo contenga. Seguía en la base y en la ficha de su
// pila, pero en el patio no estaba en ninguna parte.
const laPila = await Store.crearPila({ codigo: '9', tipo: 'otro', nota: null,
  x: 300, y: 300, rx: 120, ry: 90, plataforma_id: TOPSOIL, usuario_id: 'yo' });
const tres = [];
for (const c of ['PG2001', 'PG2002', 'PG2003']) {
  const x = await nuevoLote(c, TOPSOIL);
  await Store.registrarEvento({ lote_id: x.id, tipo: 'ingreso_pila',
    pila_id: laPila.id, usuario_id: 'yo' });
  tres.push(x);
}

const viajero = tres[0];
await Store.trasladarLote(viajero.id, YE, 'yo');
const ido = await Store.lote(viajero.id);

ok(ido.plataforma_id === YE, 'el lote se fue a Ye');
ok(ido.pila_id === null, 'y salió de la pila, que se quedó en Topsoil');

// El plano dibuja como sueltos a los que NO tienen pila. Si se quedara
// con la pila puesta, no aparecería aquí ni allá.
const sueltosEn = async (plat) => (await Store.lotes())
  .filter((l) => l.plataforma_id === plat && !l.pila_id).length;
ok((await sueltosEn(YE)) >= 1, 'y en Ye se dibuja, que es lo que antes no pasaba');

// Queda apuntado: el historial tiene que poder contar que salió del
// montón, no solo que cambió de patio.
const suHistorial = (await Store.historial(viajero.id)).map((e) => e.tipo);
ok(suHistorial.includes('salida_pila'), 'la salida de la pila queda en su historial');
ok(suHistorial.includes('traslado'), 'y el traslado también');

// Los que no se movieron siguen dentro y donde estaban.
for (const q of tres.slice(1)) {
  const s = await Store.lote(q.id);
  ok(s.pila_id === laPila.id && s.plataforma_id === TOPSOIL,
     `${q.codigo} se queda en su pila y en Topsoil`);
}

// Y mover la pila ENTERA sigue llevándose a los suyos DENTRO: son dos
// cosas distintas y solo una suelta los lotes.
await Store.trasladarPila(laPila.id, P5, 'yo');
for (const q of tres.slice(1)) {
  const s = await Store.lote(q.id);
  ok(s.plataforma_id === P5 && s.pila_id === laPila.id,
     `${q.codigo} viaja con la pila y sigue dentro`);
}

// ---------------------------------------------------------------------
titulo('Alimentar una pila entera apunta a cada lote, no a la pila.');

// Quién puede y desde qué plataforma lo decide la pantalla; aquí se
// prueba que cada lote quede con su apunte y que no se cuele ninguno
// sin muestrear.
const comida = await Store.crearPila({ codigo: '50', tipo: 'alimentacion', nota: null,
  x: 300, y: 300, rx: 80, ry: 60, plataforma_id: P5, usuario_id: 'yo' });
const tres5 = [];
for (const c of ['PG5001', 'PG5002', 'PG5003']) {
  const x = await nuevoLote(c, P5);
  await Store.registrarEvento({ lote_id: x.id, tipo: 'ingreso_pila',
    pila_id: comida.id, usuario_id: 'yo' });
  tres5.push(x);
}
for (const x of tres5.slice(0, 2))
  await Store.registrarEvento({ lote_id: x.id, tipo: 'cambio_estado',
    estado_nuevo: 'muestreado', usuario_id: 'yo' });

let r = await Store.alimentarPila(comida.id, 'BATCH', 'admin');
ok(r.alimentados === 2 && r.pendientes === 1, 'pasan los dos muestreados y queda uno');
for (const x of tres5.slice(0, 2)) {
  const s = await Store.lote(x.id);
  ok(s.estado === 'alimentado' && s.punto_id === 'BATCH' && s.alimentado_en,
     `${x.codigo} queda alimentado por Batch y con su fecha`);
}
ok((await Store.lote(tres5[2].id)).estado === 'por_muestrear',
   'el que no tiene muestra no se toca');
ok((await Store.pila(comida.id)).estado === 'abierta',
   'y la pila sigue abierta mientras le quede alguien');

await Store.registrarEvento({ lote_id: tres5[2].id, tipo: 'cambio_estado',
  estado_nuevo: 'muestreado', usuario_id: 'yo' });
r = await Store.alimentarPila(comida.id, 'BATCH', 'admin');
ok(r.alimentados === 1, 'la segunda vez solo pasa el que faltaba');
const veces = (await Store.historial(tres5[0].id))
  .filter((e) => e.estado_nuevo === 'alimentado').length;
ok(veces === 1, 'los ya alimentados no se apuntan dos veces');
ok((await Store.pila(comida.id)).estado === 'consumida', 'y la pila se archiva');

cerrar();
