// =====================================================================
//  Las monedas no se guardan: se calculan desde los eventos.
//
//  Lo que se prueba aquí es que no haya forma de ganar más haciendo el
//  trabajo mal. La regla es una sola —cada hecho paga UNA vez por lote—
//  y de ella salen todas las demás: deshacer y rehacer no da nada, y da
//  igual mover una pila de diez lotes que moverlos de uno en uno.
//
//  Corre contra PostgreSQL de verdad si lo hay. Las vistas son SQL puro,
//  y comprobarlas leyendo el archivo no diría si las cuentas salen.
// =====================================================================
import { readFile } from 'node:fs/promises';
import { ok, titulo, cerrar } from './ayudas/decir.mjs';
import { baseNueva } from './ayudas/base.mjs';

const app = await readFile(new URL('../web/js/app.js', import.meta.url), 'utf8');
const store = await readFile(new URL('../web/js/store.js', import.meta.url), 'utf8');
const esquema = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
const migracion = await readFile(new URL('../sql/migracion.sql', import.meta.url), 'utf8');
const css = await readFile(new URL('../web/styles.css', import.meta.url), 'utf8');

// ---------------------------------------------------------------------
titulo('El saldo se calcula, no se guarda.');

// Es la decisión que sostiene todo lo demás. Un contador que la app suma
// se rompe solo —dos celulares sin señal sumarían por separado— y además
// se puede tocar.
ok(/create view v_monedas/.test(esquema), 'las monedas salen de una vista, no de una columna');
ok(!/alter table perfiles add column .*monedas|perfiles\.monedas/.test(esquema),
   'no hay ninguna columna de saldo que alguien pueda escribir');
ok(/security_invoker = true/.test(esquema.slice(esquema.indexOf('create view v_monedas'))),
   'y la vista respeta los permisos de quien pregunta');
ok(/from v_saldos|from\('v_saldos'\)/.test(store), 'la app las PIDE al servidor');
ok(!/function .*calcularMonedas|reduce\(.*monedas/.test(store),
   'y no las cuenta por su cuenta con los eventos que tenga a mano');

// ---------------------------------------------------------------------
titulo('Lo que paga cada cosa está en UN solo sitio.');

const tarifa = esquema.slice(esquema.indexOf('tarifa (clase, monedas)'),
                             esquema.indexOf('tarifa (clase, monedas)') + 220);
for (const [clase, monedas] of [['registrar', 3], ['muestrear', 1], ['apilar', 1],
                                ['trasladar', 1], ['despachar', 2]])
  ok(new RegExp(`\\('${clase}', ${monedas}\\)`).test(tarifa),
     `${clase} paga ${monedas}`);
ok(!/'alimentar'|'mover_pila'/.test(tarifa),
   'alimentar no paga, como se pidió');
// El mismo cuadro en la migración, o la base de verdad pagaría otra cosa
// que el esquema de referencia.
for (const [clase, monedas] of [['registrar', 3], ['muestrear', 1], ['apilar', 1],
                                ['trasladar', 1], ['despachar', 2]])
  ok(new RegExp(`\\('${clase}', ${monedas}\\)`).test(migracion),
     `y la migración paga lo mismo por ${clase}`);

// ---------------------------------------------------------------------
titulo('El tope de las tareas y la regla de no auto-asignarse.');

ok(/monedas *int not null default 0 check \(monedas between 0 and 15\)/.test(esquema),
   'una tarea paga entre 0 y 15, y el tope lo impone la base');
ok(/constraint tarea_no_autoasignada check \(asignado_a is null or asignado_a <> creado_por\)/
   .test(esquema), 'y un admin no se manda tareas a sí mismo');
ok(/new\.monedas +:= old\.monedas;/.test(esquema),
   'quien no es admin tampoco puede subirse el premio al cerrarla');
ok(/completado_por is distinct from t\.creado_por/.test(esquema),
   'y nadie cobra por una tarea que creó él mismo, ni dejándola sin dueño');
// La pantalla no ofrece lo que la base va a rechazar.
ok(/p\.id !== S\.perfil\.id/.test(app),
   'la lista de "para quién" no incluye a quien está creando la tarea');
ok(/Math\.max\(0, Math\.min\(15,/.test(store),
   'y el tope se aplica también antes de encolar, para no subir algo que rebote');

// ---------------------------------------------------------------------
titulo('La pantalla no deja creer que dos números se contradicen.');

// "Tengo 219 arriba y 196 en la tabla, no sé qué anda mal." No andaba
// mal nada: uno es el saldo de siempre y el otro lo del mes. La pantalla
// no lo decía, así que se leían como si compitieran.
const pantalla = app.slice(app.indexOf('async function panelMonedas'),
                           app.indexOf('// --------------------------------------------------------------- tareas'));
ok(/desde que empezaste/.test(pantalla),
   'el número grande dice que es de SIEMPRE, no "en total" a secas');
ok(/class="desde">[^<]*en \$\{MESES\[m1 - 1\]\}/.test(pantalla),
   'y debajo, cuántas de esas son del mes en curso');
ok(/Clasificación de \$\{MESES\[m1 - 1\]\}/.test(pantalla),
   'la tabla lleva el nombre del mes, no un "este mes" que no se sabe cuál es');
ok(/tus monedas NO se borran/.test(pantalla),
   'y avisa de que lo que se reinicia es la tabla, no el saldo');

// ---------------------------------------------------------------------
titulo('La cabecera: iconos, y el nombre de la plataforma donde cabe.');

// Con cinco cosas arriba, "Plataforma 3" se comía media barra y salía
// cortado en "PLATAFO…", que no dice ni cuál es.
ok(/id="chip-plat"[^>]*>\$\{ICO\.capas\}/.test(app),
   'el botón de plataformas es un icono, no el nombre');
ok(/id="trofeo"[^>]*aria-label="Monedas y clasificación"/.test(app),
   'y hay un trofeo que lleva derecho a la clasificación');
// Hubo un rato una SEGUNDA pastilla con el nombre suelta sobre el mapa.
// Sobraba: nadie la pidió y quitaba sitio al plano, que es lo que se
// viene a mirar.
ok(!/chip-plat-mapa/.test(app) && !/chip-plat-mapa/.test(css),
   'no hay una segunda pastilla de plataformas encima del mapa');
ok(/aria-label', p \? `Plataforma: \$\{p\.nombre\}/.test(app)
   && /'title', p \? `Plataforma: \$\{p\.nombre\}/.test(app),
   'el propio icono lleva el nombre, para el dedo encima y para quien no ve la pantalla');
// Y donde se elige, se dice cuál está puesta: el borde amarillo solo
// significa algo si ya sabes qué significa.
ok(/aquí estás/.test(app) && /\.mini \.aqui/.test(css),
   'y la hoja de Plataformas marca con palabras en cuál estás');

// ---------------------------------------------------------------------
titulo('La tienda tiene su propia entrada, y se ve.');

// La barra amarilla a lo ancho se comía una franja de una pantalla que
// ya es larga, y al bajar por la clasificación desaparecía. El botón
// viaja ahora dentro del encabezado fijo, al lado de la equis.
ok(/id="ir-tienda"/.test(app) && /class="a-tienda"/.test(app)
   && !/btn-tienda/.test(app) && !/btn-tienda/.test(css),
   'a la tienda se entra desde el encabezado, al lado de la equis');
ok(/\.a-tienda \{[^}]*position: sticky/.test(css),
   'y ese botón se queda pegado arriba, como la equis: no se pierde al bajar');
ok(/abrirHoja\(html, fijo = '', esquina = ''\)/.test(app)
   && /\$\{equis\}\$\{esquina\}/.test(app),
   'va DESPUÉS de la equis en el código, que es lo que lo deja a su izquierda');
const tienda = app.slice(app.indexOf('async function panelTienda'),
                         app.indexOf('function fichaProducto'));
ok(/const enVenta = admin \? cat\.lista : cat\.lista\.filter\(\(p\) => p\.activo\)/.test(tienda),
   'lo retirado lo sigue viendo el admin, pero no quien viene a canjear');
ok(/Te faltan \$\{falta\}/.test(tienda),
   'lo que no alcanza SE VE igual, diciendo cuánto falta: es para lo que se ahorra');
ok(/Store\.canjear/.test(tienda) && !/encolar|Store\.registrarEvento/.test(tienda),
   'canjear va derecho al servidor, no a la cola: el saldo lo lleva él');
ok(/sinSenal|alDia/.test(tienda) && /Sin señal/.test(tienda),
   'y sin señal lo dice en vez de dejar tocar un botón que no va a funcionar');
const ficha = app.slice(app.indexOf('function fichaProducto'),
                        app.indexOf('// --------------------------------------------------------------- tareas'));
ok(/p-activo/.test(ficha) && !/borrarProducto|delete\(\)/.test(ficha),
   'un producto se RETIRA, no se borra: borrarlo se llevaría por delante recibos de otros');
ok(/existencias: cuantos === '' \? null/.test(ficha),
   'dejar en blanco "cuántos hay" es sin límite, que no es lo mismo que cero');
ok(/const enVenta[\s\S]{0,1200}gap: 18px 14px/.test(app + css)
   || /gap: 18px 14px/.test(css),
   'y la vitrina va holgada: apretada no daba ganas de canjear nada');

// ---------------------------------------------------------------------
titulo('Las muestras que esperan al laboratorio.');

// Es una lista de trabajo del admin, no un estado del lote: el lote
// sigue donde estaba y como estaba. Por eso va como evento aparte y no
// como columna ni como estado nuevo.
ok(/'traslado', 'entrega_laboratorio'/.test(esquema),
   'la entrega al laboratorio es un evento más, con su autor y su hora');
ok(/alter type tipo_evento add value if not exists 'entrega_laboratorio'/.test(migracion),
   'y la migración lo añade sin tocar nada de lo que ya hay');
const lab = store.slice(store.indexOf('export async function muestras'),
                        store.indexOf('// --------------------------------------------------------------- tienda'));
ok(/idb\.todos\('eventos'\)/.test(lab) && !/sb\.from/.test(lab),
   'la lista se saca de los eventos del CELULAR: en el patio la señal va y viene');
ok(/!m\.entregado_en \|\| m\.entregado_en < m\.muestreado_en/.test(lab),
   'espera cuando el muestreo es posterior a la entrega, así que un remuestreo la reabre solo');
ok(/e\.ocurrido_en > m\.muestreado_en/.test(lab) && /e\.ocurrido_en > m\.entregado_en/.test(lab),
   'y se queda con la ÚLTIMA de cada clase, no con la primera');
ok(/registrarEvento\(\{[\s\S]{0,120}tipo: 'entrega_laboratorio'/.test(store),
   'marcarla entregada pasa por la cola, como todo lo del patio');

const pantallaLab = app.slice(app.indexOf('async function pintarLaboratorio'),
                              app.indexOf('// ---------------------------------------------------------------- tienda'));
ok(/if \(!esAdmin\(\)\) \{ b\.hidden = true; return; \}/.test(pantallaLab),
   'el botón solo lo ve el admin, que es quien lleva las bolsas');
ok(/b\.hidden = !n;/.test(pantallaLab),
   'y se esconde cuando no hay ninguna esperando: verlo ya significa algo');
ok(/\.icono\.lab \{[^}]*background: var\(--traje\)/.test(css),
   'va en naranja, que en esa barra no lo lleva nada más');
ok(/\.muestras \.dias\.tarde/.test(css) && /DIAS_MUESTRA_VIEJA = 2/.test(app),
   'y la que lleva más de dos días esperando se marca en rojo');

// La cabecera es una fila con seis cosas: hay que comprobar que quepan.
ok(/@media \(max-width: 400px\)[^}]*\}[\s\S]{0,200}#chip-txt \{ display: none/.test(css),
   'en un teléfono estrecho el chip de sincronización pierde la palabra y deja el punto');
ok(/@media \(max-width: 344px\)[\s\S]{0,120}header h1 \{ display: none/.test(css),
   'y en el más estrecho de todos se va el nombre de la app, entero y no recortado');

// ---------------------------------------------------------------------
titulo('La monedita de píxeles gira, y no marea a quien no quiere.');

ok(/const monedaPixel = /.test(app) && /shape-rendering="crispEdges"/.test(app),
   'está dibujada píxel a píxel, y se le pide al navegador que no los suavice');
ok(/MONEDA_ANCHOS = \[14, 12, 8, 4, 2, 4, 8, 12\]/.test(app),
   'son ocho fotogramas: de frente hasta el canto, y de vuelta');
ok(/steps\(8\)/.test(css),
   'la tira salta de un fotograma a otro; interpolando se vería un borrón');
ok(/prefers-reduced-motion[^}]*\}\s*\{\s*\.moneda-px svg \{ animation: none/.test(
     css.replace(/\s+/g, ' ').replace(/@media \(/g, '{ ('))
   || /\.moneda-px svg \{ animation: none; \}/.test(css),
   'y con "menos movimiento" puesto en el celular, se para');
ok(/precio = \(n\) => `<span class="precio">\$\{monedaPixel\(\)\}/.test(app),
   'cada precio de la tienda la lleva al lado');
ok(/<span class="cifra">\$\{monedaPixel\(\)\}\$\{total\}/.test(app),
   'y el saldo de Monedas también, que es de donde salió la idea');
ok(/class="gano"/.test(app) && /\.linea-tiempo \.gano \{ color: var\(--verde\)/.test(css),
   'lo ganado va en verde, que es el color que la app ya usa para lo que se suma');

// =====================================================================
//  De aquí abajo, contra PostgreSQL de verdad.
//
//  La base se crea AQUÍ, entera, cada vez: se carga el esquema real y se
//  mete un patio de prueba donde cada uno intenta una trampa distinta.
//  Sin esto la prueba daría por hecho una base que alguien dejó
//  preparada, y el día que no estuviera pasaría sin comprobar nada.
// =====================================================================
const base = baseNueva();
if (!base) {
  console.log('\n  (no hay PostgreSQL a mano: las cuentas de abajo no se corrieron)');
cerrar();
}
base.cargar('./ayudas/patio-falso.sql');
process.on('exit', () => base.tirar());

titulo('El esquema real carga en una base limpia.');
ok(Number(base.sql('select count(*) from v_monedas')) > 0,
   'el esquema entero se carga sin un error y la vista devuelve filas');

titulo('Las cuentas salen, y los atajos no pagan.');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const sql = base.sql;
const rechaza = base.rechaza;
const saldo = (id) => Number(sql(`select monedas from v_saldos where usuario_id = '${id}'`) || 0);

// Ana registró TRES lotes, pero el tercero lo despachó al minuto: ese no
// paga nada. 3 + 3 por los dos buenos, 10 por la tarea.
ok(saldo(A) === 16, `Ana: 3+3 por dos lotes buenos y 10 por una tarea = 16 (dio ${saldo(A)})`);
ok(saldo(B) === 3, `Beto: muestreó, apiló y trasladó UN lote = 3 (dio ${saldo(B)})`);

// ---------------------------------------------------------------------
titulo('Inventarse un lote y despacharlo no da ni una moneda.');

// Es la pregunta que trajo todo esto: "¿qué pasa si alguien crea un lote
// y lo despacha?". Antes: cinco monedas por dos toques. Ahora: cero.
const PG3 = 'dddddddd-0000-4000-8000-000000000003';
ok(Number(sql(`select count(*) from v_monedas where lote_id = '${PG3}'`)) === 0,
   'el lote que entra y sale en el mismo minuto no paga NADA, ni a quien lo creó ni a quien lo despachó');

// Y el que sí es de verdad sigue pagando: el cerrojo no puede cobrarse
// el trabajo bueno por delante.
const PG2 = 'dddddddd-0000-4000-8000-000000000002';
ok(Number(sql(`select coalesce(sum(monedas),0) from v_monedas where lote_id = '${PG2}'`)) === 5,
   'el lote normal, despachado tres días después, sigue pagando sus 3 + 2');

// Y el admin lo tiene delante, no escondido en la base. Cada consulta
// abre su propia sesión, así que el "quién soy" va en la misma llamada.
// `set_config` también devuelve una fila, así que la respuesta es la
// última línea, no la primera.
const como = (id, q) => sql(
  `select set_config('request.jwt.claim.sub','${id}',false);\n${q}`)
  .trim().split('\n').pop();
const CARLA = '33333333-3333-4333-8333-333333333333';

ok(como(CARLA, `select codigo from v_lotes_dudosos where codigo = 'PG3'`) === 'PG3',
   'y le sale al admin en la lista de lotes que conviene mirar');
ok(como(CARLA, `select motivo from v_lotes_dudosos where codigo = 'PG3'`)
     === 'entró y salió del patio el mismo rato',
   'diciéndole por qué, no solo que sí');
// El otro motivo es distinto y hace falta que se distingan: PG2 es un
// lote de verdad, pero salió sin que nadie apuntara el muestreo. Eso no
// es trampa, es un hueco de trazabilidad, y se dice como tal.
ok(como(CARLA, `select motivo from v_lotes_dudosos where codigo = 'PG2'`)
     === 'salió sin que nadie apuntara el muestreo',
   'y el que salió sin muestreo sale con SU motivo, que no es el mismo');
ok(Number(como(B, `select count(*) from v_lotes_dudosos`)) === 0,
   'y el que no es admin no ve esa lista: no es asunto suyo');

// ---------------------------------------------------------------------
titulo('La tienda: no se canjea lo que no se tiene.');

const P1 = 'ffffffff-0000-4000-8000-000000000001';
sql(`insert into productos (id,nombre,precio,existencias)
     values ('${P1}','Termo',10,1)`);

// Ana tiene 16 y el termo vale 10: puede.
sql(`select set_config('request.jwt.claim.sub','${A}',false);
     select fn_canjear('${P1}')`);
ok(saldo(A) === 6, `canjear descuenta del saldo: 16 - 10 = 6 (dio ${saldo(A)})`);
ok(Number(sql(`select ganado from v_saldos where usuario_id = '${A}'`)) === 16,
   'pero lo GANADO no se toca: el saldo baja, el mérito no');
ok(Number(sql(`select existencias from productos where id = '${P1}'`)) === 0,
   'y el producto pierde una unidad');

// Ahora le faltan monedas, y además ya no quedan termos.
ok(rechaza(`select set_config('request.jwt.claim.sub','${A}',false);
            select fn_canjear('${P1}')`),
   'el segundo canje lo rechaza el SERVIDOR, no la pantalla');

// Beto tiene 3: no le alcanza para nada de 10.
const P2 = 'ffffffff-0000-4000-8000-000000000002';
sql(`insert into productos (id,nombre,precio) values ('${P2}','Gorra',10)`);
ok(rechaza(`select set_config('request.jwt.claim.sub','${B}',false);
            select fn_canjear('${P2}')`),
   'y a quien no le alcanza, tampoco');
ok(saldo(B) === 3, 'que se quede con sus 3 monedas intactas');

// La puerta de atrás: escribir el canje a mano. Aquí las pruebas corren
// como dueño de la base, que se salta RLS, así que lo que se comprueba
// es el PERMISO —que es lo que para a la app— y no el intento.
ok(sql(`select has_table_privilege('authenticated','canjes','insert')`) === 'f',
   'nadie mete un canje a mano: la única puerta es fn_canjear');
ok(sql(`select has_table_privilege('authenticated','canjes','delete')`) === 'f',
   'ni lo borra después para que no quede rastro');
ok(sql(`select has_function_privilege('authenticated','fn_canjear(uuid)','execute')`) === 't',
   'pero fn_canjear sí la puede llamar cualquiera con cuenta activa');

// El recibo no se reescribe. Si el admin sube el precio del termo, lo
// que Ana ya pidió sigue costando lo que costó.
sql(`update productos set precio = 99 where id = '${P1}'`);
ok(Number(sql(`select precio from canjes where nombre = 'Termo'`)) === 10,
   'subirle el precio a un producto no le sube el precio a lo ya canjeado');
ok(saldo(A) === 6, 'ni le cambia el saldo a quien ya lo canjeó');

// Anular devuelve las monedas; entregar no.
sql(`select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
     update canjes set estado = 'entregado' where nombre = 'Termo'`);
ok(saldo(A) === 6, 'marcar entregado no devuelve nada, que ya se lo llevó');
ok(sql(`select resuelto_por::text from canjes where nombre = 'Termo'`)
     === '33333333-3333-4333-8333-333333333333',
   'y queda apuntado quién lo entregó');
sql(`update canjes set estado = 'anulado' where nombre = 'Termo'`);
ok(saldo(A) === 16, 'anular un canje SÍ devuelve las monedas');

const veces = (id, motivo) => Number(sql(
  `select count(*) from v_monedas where usuario_id = '${id}' and motivo = '${motivo}'`));
ok(veces(B, 'muestrear') === 1, 'muestrear dos veces el mismo lote paga una sola');
ok(veces(B, 'apilar') === 1, 'sacarlo de la pila y volver a meterlo, también una sola');
ok(veces(B, 'trasladar') === 1, 'y mandarlo de ida y vuelta entre plataformas, una sola');

const suyaPropia = Number(sql(
  `select count(*) from v_monedas where motivo = 'tarea'
     and origen in (select id from tareas where creado_por = completado_por)`));
ok(suyaPropia === 0, 'una tarea creada y cerrada por la misma persona no paga nada');

// Y las reglas que tienen que RECHAZAR.
ok(rechaza(`insert into tareas (id,titulo,creado_por,asignado_a)
            values (gen_random_uuid(),'x','${A}','${A}')`),
   'la base rechaza que alguien se asigne una tarea a sí mismo');
ok(rechaza(`insert into tareas (id,titulo,monedas,creado_por)
            values (gen_random_uuid(),'x',50,'${A}')`),
   'y rechaza una tarea de 50 monedas');

// ---------------------------------------------------------------------
titulo('En la clasificación salen TODOS, también los que llevan cero.');

// Antes solo aparecía quien hubiera ganado algo, y eso deja fuera justo
// a quien más falta le hace verse: el que empieza el mes en blanco, y el
// de rol "empresa", que no trabaja el patio y solo gana por tareas
// sueltas. Una tabla de la que desapareces cuando no has hecho nada no
// invita a hacer nada.
const EMP = '44444444-4444-4444-8444-444444444444';
sql(`insert into auth.users (id,email) values ('${EMP}','emp@x.com')`);
sql(`update perfiles set nombre='Empresa SA', rol='empresa', activo=true where id='${EMP}'`);

const enTabla = (n) => Number(sql(
  `select count(*) from v_clasificacion where nombre = '${n}'
     and mes = to_char(now() at time zone 'America/Bogota','YYYY-MM')`));
ok(enTabla('Empresa SA') === 1, 'quien no ha ganado nada este mes igual sale en la tabla');
ok(Number(sql(`select monedas from v_clasificacion where nombre = 'Empresa SA'
                and mes = to_char(now() at time zone 'America/Bogota','YYYY-MM')`)) === 0,
   'y sale con cero, no con un hueco');
ok(enTabla('Ana') === 1, 'y los que sí ganaron siguen saliendo una sola vez');

// ---------------------------------------------------------------------
titulo('El de rol "empresa" cierra SUS tareas y cobra por ellas.');

// No toca el patio —no registra lotes ni cambia estados— pero se le
// encargan cosas de por libre, y cerrarlas no es editar el patio.
const T1 = 'eeeeeeee-0000-4000-8000-000000000001';
sql(`insert into tareas (id,titulo,monedas,creado_por,asignado_a)
     values ('${T1}','Revisar papeles',5,'33333333-3333-4333-8333-333333333333','${EMP}')`);
// actuando como ella, que es lo que hace la app con su sesión
sql(`select set_config('request.jwt.claim.sub','${EMP}',false);
     update tareas set completado_en = now() where id = '${T1}'`);

ok(sql(`select completado_por from tareas where id = '${T1}'`) === EMP,
   'el servidor la deja cerrarla y apunta que fue ella');
ok(Number(sql(`select monedas from v_saldos where rol = 'empresa'`)) === 5,
   'y cobra las 5 monedas de esa tarea');

// Pero solo las SUYAS: las sueltas son trabajo de cuadrilla.
const T2 = 'eeeeeeee-0000-4000-8000-000000000002';
sql(`insert into tareas (id,titulo,monedas,creado_por,asignado_a)
     values ('${T2}','De otro',9,'33333333-3333-4333-8333-333333333333','${A}')`);
sql(`select set_config('request.jwt.claim.sub','${EMP}',false);
     update tareas set completado_en = now() where id = '${T2}'`);
ok(sql(`select coalesce(completado_en::text,'') from tareas where id = '${T2}'`) === '',
   'una tarea de otro no la puede cerrar, y el servidor lo impide');
ok(Number(sql(`select monedas from v_saldos where rol = 'empresa'`)) === 5,
   'así que no cobra de más');

// Y la pantalla acompaña al servidor en vez de contradecirlo.
ok(/if \(soloLectura\(\)\) return t\.asignado_a === S\.perfil\?\.id;/.test(app),
   'la app le ofrece completar solo la tarea que lleva su nombre');
ok(/\['contratista', 'admin', 'empresa'\]\.includes\(p\.rol\)/.test(app),
   'y aparece en la lista de "para quién" al crear una tarea');

cerrar();
