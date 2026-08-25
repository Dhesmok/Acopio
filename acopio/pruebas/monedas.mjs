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
const saldo = (id) => Number(sql(`select monedas from v_saldos where usuario_id = '${id}'`) || 0);

ok(saldo(A) === 16, `Ana: 3+3 por dos lotes y 10 por una tarea = 16 (dio ${saldo(A)})`);
ok(saldo(B) === 3, `Beto: muestreó, apiló y trasladó UN lote = 3 (dio ${saldo(B)})`);

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
const rechaza = base.rechaza;
ok(rechaza(`insert into tareas (id,titulo,creado_por,asignado_a)
            values (gen_random_uuid(),'x','${A}','${A}')`),
   'la base rechaza que alguien se asigne una tarea a sí mismo');
ok(rechaza(`insert into tareas (id,titulo,monedas,creado_por)
            values (gen_random_uuid(),'x',50,'${A}')`),
   'y rechaza una tarea de 50 monedas');

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
// Pero saber en qué plataforma estás sigue haciendo falta: en un plano
// vacío es lo único que distingue "está vacía" de "estás en otra".
ok(/chip-plat-mapa/.test(app) && /<span>\$\{esc\(p\.nombre\)\}<\/span>/.test(app),
   'el nombre baja al mapa, que es el único sitio donde importa');
ok(/aria-label', p \? `Plataforma: \$\{p\.nombre\}/.test(app),
   'y el icono lo dice en voz alta para quien no ve la pantalla');

cerrar();
