// =====================================================================
//  Bajar solo lo que cambió, no truncar el historial en silencio, y que
//  la pasada completa sí note lo que se borró en el servidor.
// =====================================================================
import { instalar } from './ayudas/idb.mjs';
import { ok, titulo, cerrar, congelarReloj } from './ayudas/decir.mjs';

const tiendas = instalar();
const { servidor } = await import('./ayudas/supabase.mjs');
const { cargarStore } = await import('./ayudas/cargar.mjs');
const Store = await cargarStore();

// Filas ENTERAS bajadas: la lista de ids que se pide para cuadrar no
// cuenta, porque es justamente lo barato.
const bajadoDe = (tabla) => servidor.bajado
  .filter((b) => b.tabla === tabla && b.campos === '*').reduce((n, b) => n + b.filas, 0);
const consultoA = (tabla) => servidor.bajado.some((b) => b.tabla === tabla);

// La pasada que pasa lista es cada hora. Cada llamada adelanta el reloj
// un poco MÁS que la anterior: se dispara comparando contra la hora de la
// última, así que congelar siempre en el mismo instante solo forzaría la
// primera.
let adelanto = 2;
const saltar = () => {
  const d = congelarReloj(new Date(Date.now() + adelanto * 3600_000).toISOString());
  adelanto += 2;
  return Store.sincronizar().finally(d);
};

await Store.iniciar();

// ---------------------------------------------------------------------
titulo('Solo se baja lo que cambió, no todo cada vez.');

for (let i = 0; i < 40; i++) {
  const id = `L${i}`;
  servidor.tablas.lotes.set(id, { id, codigo: `PG${i}`, estado: 'por_muestrear',
    pila_id: null, x: 0, y: 0, rx: 46, ry: 34, rot: 0, forma: 'elipse',
    actualizado_en: '2026-07-01T10:00:00.000Z' });
  servidor.tablas.eventos.set(`E${i}`, { id: `E${i}`, lote_id: id, tipo: 'recepcion',
    ocurrido_en: '2026-07-01T10:00:00.000Z', registrado_en: '2026-07-01T10:00:00.000Z' });
}

await Store.sincronizar();                       // primera: completa
ok(bajadoDe('lotes') === 40, `la primera vuelta baja los 40 lotes (bajó ${bajadoDe('lotes')})`);

servidor.bajado.length = 0;
await Store.sincronizar();                       // segunda: nada cambió
ok(bajadoDe('lotes') === 0, `la segunda no baja ningún lote (bajó ${bajadoDe('lotes')})`);
ok(bajadoDe('eventos') === 0, `ni ningún evento (bajó ${bajadoDe('eventos')})`);

// alguien mueve UN lote desde otro celular
Object.assign(servidor.tablas.lotes.get('L7'),
  { actualizado_en: new Date().toISOString(), x: 999 });
servidor.bajado.length = 0;
await Store.sincronizar();
ok(bajadoDe('lotes') === 1, `al cambiar uno, baja solo ese (bajó ${bajadoDe('lotes')})`);
ok((await Store.lote('L7')).x === 999, 'y el cambio llegó a la pantalla');
ok((await Store.lotes()).length === 40, 'los otros 39 siguen ahí, no se borraron');

// ---------------------------------------------------------------------
titulo('La vuelta de siempre son cuatro preguntas, y ninguna cara.');

// Esto se usa en una mina: señal mala, datos que se pagan y un día sin
// dónde cargar el celular. Cada consulta enciende la radio aunque vuelva
// vacía. Antes, CADA VUELTA se bajaban enteros los proveedores, las
// figuras del plano, la configuración y los perfiles: cosas que cambian
// una vez al mes.
servidor.bajado.length = 0;
await Store.sincronizar();
ok(consultoA('lotes') && consultoA('pilas') && consultoA('eventos') && consultoA('tareas'),
   'se pregunta por lotes, pilas, eventos y tareas, que es lo que cambia a diario');
for (const t of ['proveedores', 'mapa_figuras', 'mapa_config', 'perfiles'])
  ok(!consultoA(t), `y NO se vuelve a bajar ${t}, que cambia una vez al mes`);
ok(servidor.bajado.length === 4,
   `cuatro consultas en total, ni una más (fueron ${servidor.bajado.length})`);

// Las tareas van en la vuelta RÁPIDA y no con los catálogos: una tarea
// urgente que tardara una hora en llegarle al contratista no serviría.
ok(servidor.bajado.find((b) => b.tabla === 'tareas')?.filas === 0,
   'y la de tareas no trae nada mientras no haya ninguna nueva');

// ---------------------------------------------------------------------
titulo('Al actualizar la app, un catálogo NUEVO se baja en el acto.');

// Esto llegó a producción. Los catálogos van en la vuelta lenta, de hora
// en hora, y un celular que ya tenía la app abierta lleva su marca de
// "hace poco pasé lista": al actualizar se quedaba HASTA UNA HORA sin
// bajar las plataformas, que era una tabla que no existía antes.
//
// Y sin plataformas la app no puede filtrar por plataforma: el plano
// enseñaba los lotes de las cinco encima del mismo patio, la pantalla de
// Plataformas salía vacía y "otro día" no dibujaba ni un lote. Parecía
// que se había perdido todo, y lo que faltaba era una consulta.
tiendas.get('meta').set('forma_catalogos', { id: 'forma_catalogos', valor: 1 });
servidor.bajado.length = 0;
await Store.sincronizar();
ok(consultoA('plataformas'), 'la versión nueva pide las plataformas sin esperar a la hora');
ok(consultoA('puntos_alimentacion'), 'y los puntos de alimentación con ellas');

// Pero UNA sola vez: en cuanto se bajan queda apuntado, o cada vuelta
// volvería a bajar los catálogos enteros, que es lo que se quitó.
servidor.bajado.length = 0;
await Store.sincronizar();
ok(!consultoA('plataformas'), 'y la vuelta siguiente ya no las vuelve a pedir');
ok(servidor.bajado.length === 4,
   `se vuelve a las cuatro consultas de siempre (fueron ${servidor.bajado.length})`);

// ---------------------------------------------------------------------
titulo('El historial viejo ya no desaparece en silencio.');

// un lote cuyo evento de recepción quedó fuera del tope de la descarga
servidor.tablas.lotes.set('LX', { id: 'LX', codigo: 'PG-VIEJO', estado: 'por_muestrear',
  pila_id: null, x: 0, y: 0, rx: 46, ry: 34, rot: 0, forma: 'elipse',
  actualizado_en: '2026-07-01T10:00:00.000Z' });
servidor.tablas.eventos.set('EX', { id: 'EX', lote_id: 'LX', tipo: 'recepcion',
  ocurrido_en: '2020-01-01T10:00:00.000Z', registrado_en: '2020-01-01T10:00:00.000Z' });
await tiendas.get('eventos').delete('EX');       // no está en el celular

const h = await Store.historial('LX');
ok(h.length === 1 && h[0].tipo === 'recepcion',
   'al abrir la ficha se va a buscar la parte que faltaba');
ok(Store.historialCompleto(h), 'y queda marcado como completo');
ok(!!(await tiendas.get('eventos').get('EX')), 'lo traído se guarda en el celular');

// ---------------------------------------------------------------------
titulo('La pasada que pasa lista sí nota lo que se borró.');
servidor.tablas.lotes.delete('L3');
await Store.sincronizar();
ok(!!(await Store.lote('L3')), 'una vuelta incremental no lo nota (es lo esperado)');

servidor.bajado.length = 0;
await saltar();
ok(!(await Store.lote('L3')), 'la pasada que reconcilia sí lo quita');
ok((await Store.lotes()).length === 40, 'quedan 40 lotes (39 + el viejo)');

// Y lo hace pidiendo IDS, no las filas enteras: para saber qué sobra no
// hace falta bajarse otra vez todo el patio.
ok(consultoA('proveedores') && consultoA('perfiles'),
   'esta sí trae los catálogos, que es cuando toca');
ok(servidor.bajado.some((b) => b.tabla === 'lotes' && b.campos === 'id'),
   'y para saber qué sobra pide solo los ids, no las filas enteras');

// La lista de ids sirve para las dos cosas: lo que sobra se borra y lo
// que falta se va a buscar. LX está en el servidor con una fecha vieja,
// anterior a nuestra marca, así que por lo incremental no vendría nunca.
ok(!!(await Store.lote('LX')),
   'y lo que falta se trae por id: una fila con fecha vieja ya no se queda fuera para siempre');

// Abrir la app no fuerza una reconciliación: en el patio se abre y se
// cierra treinta veces al día, y eran treinta veces los catálogos
// enteros. La última queda apuntada en el celular.
servidor.bajado.length = 0;
await Store.sincronizar();
ok(!consultoA('proveedores'), 'una vuelta normal después no la repite');
ok(!!(await tiendas.get('meta').get('ultimo_completo')),
   'y la hora de la última queda GUARDADA, que es lo que la hace sobrevivir a cerrar la app');

// ---------------------------------------------------------------------
titulo('La historia guardada ya no se borra sola cada diez minutos.');

// Este era el fallo que dejaba inservible lo de mirar otro día. La
// pasada completa vaciaba la tienda de eventos y la volvía a llenar con
// los TOPE_EVENTOS más recientes, así que del patio no quedaba más
// historia que unos días, se mirase cuando se mirase.
const VIEJO = '2019-06-01T10:00:00.000Z';
servidor.tablas.eventos.set('ANTIGUO', { id: 'ANTIGUO', lote_id: 'L1', tipo: 'cambio_estado',
  estado_nuevo: 'muestreado', ocurrido_en: VIEJO, registrado_en: VIEJO });

// se rellena por encima del tope de la descarga, para que ese evento
// quede FUERA de la ventana que la sincronización alcanza a ver
for (let i = 0; i < 3200; i++) {
  const id = `R${i}`;
  const cuando = new Date(Date.parse('2026-07-02T00:00:00.000Z') + i * 1000).toISOString();
  servidor.tablas.eventos.set(id, { id, lote_id: 'L1', tipo: 'observacion',
    nota: `n${i}`, ocurrido_en: cuando, registrado_en: cuando });
}

await saltar();
ok(!(await tiendas.get('eventos').get('ANTIGUO')),
   'la descarga normal no llega tan atrás: ese evento no está todavía');

const hondo = await Store.ahondarHistoria();
ok(!!(await tiendas.get('eventos').get('ANTIGUO')),
   'pedir más historia sí lo trae, bajando de página en página');
ok(hondo.entera === true, 'y avisa de que ya se llegó al principio de todo');

await saltar();
ok(!!(await tiendas.get('eventos').get('ANTIGUO')),
   'y la pasada completa YA NO se lo lleva por delante: esto es lo que estaba roto');

const otraVez = await Store.ahondarHistoria();
ok(otraVez.traidos === 0, 'una vez entera, volver a pedirla no baja nada');

// ---------------------------------------------------------------------
titulo('Un evento no se borra nunca, y por eso no se pregunta por ellos.');

// Los eventos son el libro de cuentas del patio: la base de datos misma
// impide borrarlos y la app no tiene por dónde. Preguntar cada tanto si
// siguen ahí sería gastar señal y batería para confirmar lo que ya se
// sabe, así que se dejan en paz, se borren o no en el servidor.
servidor.tablas.eventos.delete('R3100');
servidor.tablas.eventos.delete('ANTIGUO');
servidor.bajado.length = 0;
await saltar();
ok(!!(await tiendas.get('eventos').get('R3100')) &&
   !!(await tiendas.get('eventos').get('ANTIGUO')),
   'siguen en el celular: la app ya no va a comprobarlo');
ok(servidor.bajado.filter((b) => b.tabla === 'eventos').length === 1,
   'a eventos se le pregunta UNA vez, y solo por los nuevos');

// ---------------------------------------------------------------------
titulo('Si desactivan el perfil, no se borra lo que hay en el celular.');
// Las políticas devuelven cero filas SIN error: sin cerrojo, la app
// tomaría ese vacío por la verdad y dejaría la pantalla en blanco.
//
// Se comprueba con el reloj adelantado porque los dos cerrojos van por
// tiempo: el barato pregunta por el perfil propio cada media hora, y el
// otro va con la pasada que reconcilia. Preguntar en cada vuelta era una
// consulta cada veinte segundos para algo que no cambia casi nunca.
const habia = (await Store.lotes()).length;
servidor.tablas.perfiles.clear();
const r = await saltar();
ok(r.motivo === 'perfil_inactivo', `la app lo detecta y lo dice (${JSON.stringify(r)})`);
ok((await Store.lotes()).length === habia, `los ${habia} lotes siguen en pantalla`);


// ---------------------------------------------------------------------
titulo('Del lote ya alimentado se tira el recorrido, y SOLO el recorrido.');

// Cada acomodo por el patio deja un apunte de `movimiento`: son los
// eventos más numerosos de todos y no dicen nada del lote, solo dónde
// estuvo. Un lote alimentado ya se lo comió la planta y no se dibuja en
// ningún plano, así que su recorrido no le sirve a nadie y se quedaba
// ocupando el celular para siempre.
//
// La prueba de arriba dejó el perfil sin habilitar para comprobar el
// cerrojo; aquí se vuelve a habilitar, o no bajaría nada.
servidor.tablas.perfiles.set('yo', { id: 'yo', nombre: 'Yo', rol: 'admin' });
const conRecorrido = await Store.crearLote({ codigo: 'PG-COMIDO', proveedor_id: 'p1',
  placa: 'AAA111', material: 'granel', forma: 'elipse', x: 0, y: 0,
  plataforma_id: 'PL-TOPSOIL', usuario_id: 'yo' });
const enPie = await Store.crearLote({ codigo: 'PG-VIVO', proveedor_id: 'p1',
  placa: 'BBB222', material: 'granel', forma: 'elipse', x: 0, y: 0,
  plataforma_id: 'PL-TOPSOIL', usuario_id: 'yo' });

// A los dos se les mueve por el patio y se les cambia de estado.
for (const l of [conRecorrido, enPie]) {
  for (const [x, y] of [[10, 10], [80, 80], [200, 150]])
    await Store.registrarEvento({ lote_id: l.id, tipo: 'movimiento', x, y, usuario_id: 'yo' });
  await Store.registrarEvento({ lote_id: l.id, tipo: 'cambio_estado',
    estado_nuevo: 'muestreado', usuario_id: 'yo' });
}
// pero solo uno acaba en la planta
await Store.registrarEvento({ lote_id: conRecorrido.id, tipo: 'cambio_estado',
  estado_nuevo: 'alimentado', usuario_id: 'yo' });
await Store.sincronizar();
// En el servidor de verdad es un disparador el que pasa el estado del
// evento a la fila del lote; este servidor de mentira no los tiene, así
// que se hace a mano. Importa porque la poda mira el estado que BAJÓ,
// no el que se pintó en pantalla al registrar el evento.
Object.assign(servidor.tablas.lotes.get(conRecorrido.id),
  { estado: 'alimentado', actualizado_en: new Date(Date.now() + 1000).toISOString() });

const suyos = (id) => (tiendas.get('eventos') ? [...tiendas.get('eventos').values()] : [])
  .filter((e) => e.lote_id === id);
const deTipo = (id, t) => suyos(id).filter((e) => e.tipo === t).length;

ok(deTipo(conRecorrido.id, 'movimiento') === 3, 'antes de podar tenía sus tres movimientos');

// La poda va con la pasada lenta, la que pasa lista una vez por hora.
await saltar();

ok(deTipo(conRecorrido.id, 'movimiento') === 0,
   `del alimentado no queda ni un movimiento (quedaban ${deTipo(conRecorrido.id, 'movimiento')})`);
// Lo que cuenta su historia se queda: es lo que sale en la ficha y en el
// informe, y ocupa una fracción de lo otro.
ok(deTipo(conRecorrido.id, 'recepcion') === 1, 'pero su recepción sigue ahí');
ok(deTipo(conRecorrido.id, 'cambio_estado') === 2,
   `y sus cambios de estado, los dos (quedan ${deTipo(conRecorrido.id, 'cambio_estado')})`);
ok((await Store.lote(conRecorrido.id))?.estado === 'alimentado',
   'y el lote entero sigue en la base, que es de lo que vive la trazabilidad');

// Al que sigue en el patio no se le toca NADA.
ok(deTipo(enPie.id, 'movimiento') === 3,
   `al que sigue en el patio le quedan sus tres movimientos (${deTipo(enPie.id, 'movimiento')})`);

// Y en el servidor no se borra nada: ahí los eventos no se borran nunca
// —la base misma lo impide— y de eso viven el informe y la trazabilidad.
const enServidor = [...servidor.tablas.eventos.values()]
  .filter((e) => e.lote_id === conRecorrido.id && e.tipo === 'movimiento').length;
ok(enServidor === 3, `en el servidor siguen los tres (hay ${enServidor})`);

// ---------------------------------------------------------------------
titulo('salir() no borra la cola si no se fuerza.');

await Store.crearLote({ codigo: 'PG-SALIR-TEST', proveedor_id: 'p1',
  placa: 'XYZ999', material: 'granel', forma: 'elipse', x: 0, y: 0,
  plataforma_id: 'PL-TOPSOIL', usuario_id: 'yo' });

let falloNormal = false;
try {
  await Store.salir();
} catch (e) {
  falloNormal = true;
}
ok(falloNormal, 'salir() sin forzar falla cuando hay cambios en la cola');
ok((await Store.lote('PG-SALIR-TEST')) !== null, 'el lote pendiente no fue borrado');

cerrar();
