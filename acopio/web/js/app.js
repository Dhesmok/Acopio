// =====================================================================
//  app.js · armazón: mapa, lista, fichas y formularios
// =====================================================================
import * as Store from './store.js';
import { sb } from './store.js';
import * as Mapa from './mapa.js';
import { planoEn, desde, indexar } from './historia.js';
import { DIAS_RECOGIDA_SUGERIDOS, DOMINIO_USUARIOS, PROVEEDOR_POR_DEFECTO } from './config.js';

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 'plataforma' ya no se ofrece: Plataforma 5 dejó de ser un estado y es
// un sitio más, con su plano. Sigue en la lista para que los lotes
// viejos que lo tengan escrito se sepan nombrar.
//
// 'alimentado' es el final en planta: el lote se consumió y sale del
// plano. Por dónde entró —Batch, Tolva Naranja, Reempaque…— se elige al
// marcarlo y se guarda aparte.
const ESTADOS = {
  por_muestrear: 'Por muestrear', muestreado: 'Muestreado', remuestreo: 'Remuestreo',
  facturado: 'Facturado', devolucion: 'Devolución', alimentado: 'Alimentado',
  despachado: 'Despachado', plataforma: 'Plataforma 5'
};
// los que se pueden elegir a mano en la ficha de un lote
const ESTADOS_ELEGIBLES = ['por_muestrear', 'muestreado', 'remuestreo',
                           'facturado', 'devolucion', 'alimentado', 'despachado'];
// para ordenar la barra de colores del tablero de plataformas
const ORDEN_ESTADO = Object.fromEntries(ESTADOS_ELEGIBLES.map((k, i) => [k, i]));
const MATERIALES = { granel: 'Granel', bigbag: 'Bigbag' };
// el material define con qué figura se dibuja
const FORMA_DE = { granel: 'elipse', bigbag: 'rectangulo' };
// El granel es redondo. Al volver a él desde un bigbag o desde un polígono
// se iguala el radio, pero conservando la SUPERFICIE que ya tenía: quien
// agrandó un lote a mano no puede verlo encoger por cambiar el material.
const aCirculo = (o) => { const r = Math.round(Math.sqrt(o.rx * o.ry)) || 40; return { rx: r, ry: r }; };
const TIPOS_PILA = {
  alimentacion: 'Alimentación a planta', devolucion: 'Devolución',
  espera: 'En espera', otro: 'Otro'
};

const S = { perfil: null, pestana: 'mapa', filtro: 'todos', busqueda: '', edicion: false,
            lotes: [], pilas: [], proveedores: [], figuras: [], gente: [], config: {},
            pendientes: 0, idsPendientes: new Set(), rechazados: 0, sync: null,
            actualizacion: false,
            // buscar sobre el plano, y la figura que se acaba de encontrar
            buscarMapa: false, busquedaMapa: '', resaltado: null,
            // el lote que la volqueta está descargando: no se dibuja aún
            naciendo: null,
            // filtro del mapa: resalta lo que coincide y atenúa el resto
            mapaFiltro: { campo: 'ninguno', valor: null },
            recorrido: null,
            // mirar el patio de otro día: solo se mira, no se toca nada
            historia: null,
            // Encargos del admin. `avisadas` recuerda cuáles ya hicieron
            // vibrar el celular, para no repetir el aviso en cada vuelta.
            // Se guarda en el celular: si viviera solo en memoria, cada vez
            // que se abre la app volvería a sonar por las tareas de ayer.
            tareas: [],
            avisadas: new Set(JSON.parse(localStorage.getItem('acopio-avisadas') || '[]')),
            // los avisos se pueden apagar; queda guardado en el celular
            mudo: localStorage.getItem('acopio-mudo') === '1',
            // el patio es de CINCO plataformas. Se recuerda en cuál
            // estaba cada persona: el de Topsoil entra a Topsoil.
            plataformas: [], puntos: [],
            plataforma: localStorage.getItem('acopio-plataforma') || null };

// --------------------------------------------------------- plataformas
// El patio son cinco sitios —Topsoil, Plataforma 2, Plataforma 3, Ye,
// Plataforma 5— y cada uno tiene su propio plano. Casi toda la app
// trabaja sobre UNA a la vez: la que se esté mirando.
const plataformaActual = () =>
  S.plataformas.find((p) => p.id === S.plataforma) || S.plataformas[0] || null;

// El nombre de la plataforma se repinta AQUÍ, y no en cada sitio que
// cambia de plataforma: el chip de la cabecera se quedaba con el nombre
// anterior porque los dos caminos que llevan al mapa —la pestaña y el
// selector— no pasan por `pintar`. Repintarlo donde cambia el dato es el
// único sitio donde no se puede olvidar.
const irAPlataforma = (id) => {
  S.plataforma = id;
  recordar('acopio-plataforma', id);
  pintarChipPlataforma();
};

// Un lote alimentado se consumió en planta: sigue en la base con todo su
// historial, pero deja de estorbar en el plano. Para el contratista
// desaparece también de la lista; el admin lo sigue viendo, que para eso
// es la trazabilidad.
const alimentado = (l) => l.estado === 'alimentado';
// Lo que de verdad está en el patio, que es lo que el plano dibuja. Un
// lote despachado o alimentado ya se fue: contarlo hacía que la tarjeta
// de la plataforma dijera más lotes de los que se ven en su plano.
const enElPatio = (l) => !alimentado(l)
  && l.estado !== 'despachado' && l.estado !== 'plataforma';
const nombrePlataforma = (id) => S.plataformas.find((p) => p.id === id)?.nombre || '—';
const nombrePunto = (id) => S.puntos.find((p) => p.id === id)?.nombre || '—';
const seVeEnLaLista = (l) => !alimentado(l) || esAdmin();

// Lo que se dibuja: solo lo de la plataforma que se está mirando.
//
// Si NO hay plataformas cargadas —la app publicada antes de correr la
// migración, o la primera sincronización todavía en marcha— no se filtra
// nada. Sin esto el patio saldría vacío y parecería que se perdió todo,
// que es la peor cara posible para un despiste de despliegue.
const enEstaPlataforma = (x) => !S.plataforma || x.plataforma_id === S.plataforma;
const misLotes = () => S.lotes.filter((l) => enEstaPlataforma(l) && !alimentado(l));
const misPilas = () => S.pilas.filter(enEstaPlataforma);
const misFiguras = () => S.figuras.filter(enEstaPlataforma);

const esAdmin = () => S.perfil?.rol === 'admin';
const soloLectura = () => S.perfil?.rol === 'empresa';
// El informe es para quien responde por el patio ante alguien de fuera:
// el administrador y la empresa. El contratista trabaja lote a lote y no
// tiene por qué sacar el listado entero.
const puedeExportar = () => esAdmin() || soloLectura();

// Iconos de trazo: se leen a cualquier tamaño y toman el color del botón,
// a diferencia de un emoji, que cada teléfono dibuja distinto.
const ico = (d) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICO = {
  mas:       ico('<path d="M12 5v14M5 12h14"/>'),
  menos:     ico('<path d="M5 12h14"/>'),
  encuadrar: ico('<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>'),
  filtro:    ico('<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>'),
  editar:    ico('<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>'),
  fondo:     ico('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>'),
  cerrar:    ico('<path d="M18 6L6 18M6 6l12 12"/>'),
  lupa:      ico('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  reloj:     ico('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'),
  diana:     ico('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  campana:   ico('<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
  visto:     ico('<path d="M20 6L9 17l-5-5"/>')
};

// Recordar una preferencia en el celular NUNCA puede tumbar lo que se
// estaba haciendo. `localStorage` lanza cuando el navegador va en modo
// privado, cuando el sitio tiene el almacenamiento bloqueado o cuando
// está lleno; y como esto se llama en medio de acciones —cambiar de
// plataforma, apagar los sonidos—, ese error se llevaba por delante el
// resto de la acción. Es una comodidad: si no se puede guardar, se
// pierde la preferencia al cerrar y ya.
const recordar = (clave, valor) => {
  try { localStorage.setItem(clave, valor); } catch { /* sin sitio o sin permiso */ }
};

const hoyISO = (mas = 0) => {
  const d = new Date(); d.setDate(d.getDate() + mas);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Días de CALENDARIO, no bloques de 24 horas. Un lote recibido anoche a
// las 10 lleva un día en el patio, no cero: contar por milisegundos lo
// dejaba en "hoy" hasta la noche siguiente.
const fechaLocal = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dias = (t) => Math.round((Date.parse(hoyISO()) - Date.parse(fechaLocal(t))) / 86_400_000);
// La recogida es un compromiso de la DEVOLUCIÓN: el proveedor tiene
// hasta tal día para venir por su material. Si el lote pasó a otro
// estado, la fecha que quedó guardada en la fila ya no compromete a
// nadie, así que ni se muestra ni cuenta como vencida. Antes seguía
// saliendo en la ficha, en la lista y como borde de alarma en el plano
// mucho después de que el asunto se hubiera resuelto.
// La placa de una volqueta son letras y números y nada más.
//
// El carácter malo NO LLEGA A ENTRAR: se cancela en `beforeinput`, antes
// de que el navegador lo escriba. Dar al espacio, sencillamente, no hace
// nada.
//
// La primera versión lo hacía al revés —dejaba escribir y luego reescribía
// el campo limpio— y en un teclado de celular eso se portaba como la
// tecla de borrar. En Android el espacio es la tecla que CIERRA la
// palabra que el teclado va componiendo; si mientras tanto alguien le
// cambia el contenido al campo por debajo, el teclado se queda con una
// idea distinta de lo que hay escrito y en la siguiente pulsación
// "corrige" comiéndose letras. Por eso ahora no se toca el valor en el
// camino normal.
//
// Las mayúsculas las pone el CSS, no el código, por lo mismo: cambiar el
// valor en cada tecla era justo lo que descuadraba al teclado. Al
// guardar ya se pasa a mayúsculas de todos modos.
function soloLetrasYNumeros(campo) {
  if (!campo) return;
  const malos = /[^a-zA-Z0-9]/g;

  campo.addEventListener('beforeinput', (ev) => {
    // Solo interesan los que meten texto. Borrar, mover el cursor o
    // deshacer no traen `data`, y hay que dejarlos pasar tal cual.
    const entra = typeof ev.data === 'string' ? ev.data
      : ev.dataTransfer?.getData('text') ?? null;
    if (entra === null || entra === '') return;
    if (!malos.test(entra)) return;
    malos.lastIndex = 0;                       // el flag /g guarda posición

    ev.preventDefault();
    // Lo que sí sirve de lo que venía —al pegar "AB C-99" entra "ABC99"—
    // se mete a mano. Si no queda nada, no pasa nada, que es lo que se
    // quiere cuando alguien da al espacio.
    const bueno = entra.replace(malos, '');
    if (!bueno) return;
    const i = campo.selectionStart ?? campo.value.length;
    const f = campo.selectionEnd ?? i;
    campo.setRangeText(bueno, i, f, 'end');
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Red de seguridad. Un teclado que compone palabras puede cerrar la
  // suya con un espacio dentro sin que `beforeinput` se pueda cancelar;
  // eso se limpia al terminar de componer, que ya es momento seguro para
  // tocar el valor.
  campo.addEventListener('compositionend', () => {
    const limpio = campo.value.replace(malos, '');
    if (limpio !== campo.value) campo.value = limpio;
  });
}

// -------------------------------------------------------------- sonidos
// Dos avisos que se oyen sin mirar la pantalla: la volqueta al registrar
// un lote, y el timbre al llegar una tarea. En un patio con ruido y con
// el celular en el bolsillo, un sonido llega donde un color no.
//
// Se cargan de una vez y se guardan: el navegador no vuelve a pedirlos, y
// el service worker los tiene en la caché, así que suenan sin señal.
//
// Nunca revientan nada. Un navegador puede negarse a sonar —lo hacen si
// la persona todavía no ha tocado la pantalla— y eso no puede tumbar el
// registro de un lote: se traga el fallo y sigue.
const SONIDOS = { volqueta: './sonidos/volqueta.mp3', tarea: './sonidos/tarea.mp3' };
const guardados = {};
function sonar(cual, volumen = 1) {
  if (S.mudo) return;
  try {
    const a = guardados[cual] || (guardados[cual] = new Audio(SONIDOS[cual]));
    a.volume = volumen;
    a.currentTime = 0;
    a.play?.().catch(() => {});
  } catch { /* sin sonido se sigue trabajando igual */ }
}

// Los ruidos de la escena de muestreo se SINTETIZAN, no son archivos.
//
// Son cuatro golpes muy cortos —la pala, el tiro, el terronazo y el
// casco— y grabarlos serían cuatro MP3 más que bajar, guardar en la
// caché y mantener. Hechos con osciladores no pesan nada, no hacen
// ninguna petición y suenan igual sin señal, que es como trabaja esta
// app la mitad del tiempo.
//
// El contexto de audio se crea la PRIMERA vez que hace falta, y para
// entonces ya hubo un toque en la pantalla —el botón de "Muestreado"—,
// que es lo que exigen los navegadores para dejar sonar nada.
let contextoAudio = null;
function audio() {
  if (!contextoAudio) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    contextoAudio = new AC();
  }
  if (contextoAudio.state === 'suspended') contextoAudio.resume?.();
  return contextoAudio;
}

// Un tono que cae o sube, con su volumen apagándose. Sirve para el
// golpe seco y para el rebote del casco.
function tono({ tipo = 'sine', de, a, dur, vol }) {
  const ctx = audio(); if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator(), gan = ctx.createGain();
  osc.type = tipo;
  osc.frequency.setValueAtTime(de, t);
  osc.frequency.exponentialRampToValueAtTime(a, t + dur);
  gan.gain.setValueAtTime(vol, t);
  gan.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gan); gan.connect(ctx.destination);
  osc.start(); osc.stop(t + dur);
}

// Ruido blanco filtrado: la pala entrando en la arena y el terrón
// cruzando el aire. Un tono no sirve aquí, la tierra no tiene nota.
function soplo({ de, a, tipo = 'bandpass', dur, vol }) {
  const ctx = audio(); if (!ctx) return;
  const t = ctx.currentTime;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const filtro = ctx.createBiquadFilter();
  filtro.type = tipo;
  filtro.frequency.setValueAtTime(de, t);
  filtro.frequency.exponentialRampToValueAtTime(a, t + dur * .7);
  const gan = ctx.createGain();
  gan.gain.setValueAtTime(vol, t);
  gan.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filtro); filtro.connect(gan); gan.connect(ctx.destination);
  src.start();
}

const RUIDOS = {
  palada:  () => soplo({ de: 900, a: 200, tipo: 'lowpass', dur: .15, vol: .18 }),
  tiro:    () => soplo({ de: 300, a: 1500, dur: .14, vol: .16 }),
  golpe:   () => tono({ tipo: 'triangle', de: 240, a: 32, dur: .18, vol: .30 }),
  casco:   () => tono({ tipo: 'sine', de: 120, a: 560, dur: .25, vol: .20 })
};

// Suena `cual` dentro de `ms` milisegundos. Devuelve el temporizador
// para poder cancelarlo si la escena se salta de un toque.
const ruidoEn = (cual, ms) => setTimeout(() => {
  if (S.mudo) return;
  try { RUIDOS[cual](); } catch { /* sin audio se ve igual, solo mudo */ }
}, ms);

// ------------------------------------------------------------ volquetas
// Un lote puede haberlo traído MÁS DE UNA volqueta: cuando todas
// descargan sobre el mismo montón es un solo lote, con una muestra y un
// estado. (Si cada una hace su propio montón son lotes distintos, y para
// eso está el código ABG40.1 / ABG40.2, que el plano pinta como ABG40¹.)
//
// Se guardan en el mismo campo, separadas por un espacio. Y se escriben
// EN UNA CAJA CADA UNA, no todas seguidas: si se dejaran escribir
// espacios, "VLJ 116" de un dedazo y "VLJ 116" de dos volquetas se
// escribirían igual y no habría manera de distinguirlos. Con una caja
// por volqueta cada una sigue siendo solo letras y números.
const placasDe = (l) =>
  String((l && typeof l === 'object' ? l.placa : l) || '').trim().split(/\s+/).filter(Boolean);
const placasTexto = (l, sep = ' · ') => placasDe(l).join(sep);

// El número no se reutiliza aunque se quiten filas: si se contaran las
// que hay, quitar una del medio y añadir otra repetiría un identificador.
let nPlaca = 0;
const filaPlaca = (id, valor = '') => `<div class="fila-placa">
  <input id="${id}-${nPlaca++}" class="placa" data-mono autocomplete="off" inputmode="text"
    autocapitalize="characters" spellcheck="false" value="${esc(valor)}">
  <button type="button" class="ctrl quitar-placa" aria-label="Quitar esta volqueta">×</button>
</div>`;

function cajaPlacas(id, valor = '') {
  const lista = placasDe(valor);
  if (!lista.length) lista.push('');
  const primera = `${id}-${nPlaca}`;          // el número que le va a tocar
  return `<div class="campo">
    <label for="${primera}">Placa de la volqueta</label>
    <div id="${id}-lista">${lista.map((p) => filaPlaca(id, p)).join('')}</div>
    <button type="button" class="pastilla" id="${id}-mas">+ Otra volqueta</button>
  </div>`;
}

function montarPlacas(id) {
  const lista = $(`#${id}-lista`);
  if (!lista) return;
  lista.querySelectorAll('input.placa').forEach(soloLetrasYNumeros);
  $(`#${id}-mas`).onclick = () => {
    lista.insertAdjacentHTML('beforeend', filaPlaca(id));
    const nueva = lista.lastElementChild.querySelector('input');
    soloLetrasYNumeros(nueva);
    nueva.focus();
  };
  lista.addEventListener('click', (ev) => {
    const b = ev.target.closest('.quitar-placa');
    if (b) b.closest('.fila-placa').remove();
  });
}

// Lo que se guarda: en mayúsculas, sin vacías y sin repetir.
const leerPlacas = (id) => [...document.querySelectorAll(`#${id}-lista input.placa`)]
  .map((c) => c.value.trim().toUpperCase())
  .filter((p, i, v) => p && v.indexOf(p) === i)
  .join(' ');

// Cómo se escribe un código en pantalla. La volqueta va pequeña y
// arriba, como un exponente: ABG40.2 se lee "ABG40" con un 2 al lado.
// Lo hace `Mapa.partesCodigo`, que es quien conoce el formato; aquí solo
// se le pone el HTML. El dato guardado no se toca: en el buscador, en la
// corrección de datos y en el informe sigue saliendo entero.
function codigoHTML(codigo) {
  const { base, volqueta } = Mapa.partesCodigo(codigo);
  return esc(base) + (volqueta ? `<sup class="volqueta">${esc(volqueta)}</sup>` : '');
}

const enDevolucion = (l) => l.estado === 'devolucion';
const vencido = (l) => enDevolucion(l) && !!l.fecha_recogida && l.fecha_recogida < hoyISO();
function textoRecogida(l) {
  if (!enDevolucion(l) || !l.fecha_recogida) return null;
  const d = Math.round((new Date(hoyISO()) - new Date(l.fecha_recogida)) / 86_400_000);
  if (d > 0) return `sin recoger · ${d} d de retraso`;
  if (d === 0) return 'se recoge hoy';
  if (d === -1) return 'se recoge mañana';
  return `se recoge el ${l.fecha_recogida.slice(8, 10)}/${l.fecha_recogida.slice(5, 7)}`;
}

// -------------------------------------------------------------- arranque
// El service worker ya dejó la versión nueva lista en la caché, pero esta
// pantalla sigue corriendo la vieja: solo un recargue la cambia. No se
// recarga sola a propósito —alguien puede estar registrando un lote—, se
// ofrece en la franja de arriba.
document.addEventListener('acopio:version-nueva', () => {
  S.actualizacion = true;
  pintarSync();
});

// Red de seguridad final: cualquier fallo que se escape de `accion` y de
// `gesto`. Sin esto terminaba en la consola del navegador, que nadie mira
// desde un celular en el patio.
addEventListener('unhandledrejection', (e) => { e.preventDefault(); fallaDeFondo(e.reason); });

async function arrancar() {
  await Store.iniciar();
  const { data } = await sb.auth.getSession();
  if (!data.session) return pantallaIngreso();
  abrirSesion(data.session.user);
}

async function abrirSesion(usuario) {
  // El perfil manda: define qué puede hacer y qué acepta el servidor.
  // Se pide al servidor; sin señal se usa el último conocido, guardado en
  // el celular. Suponer "contratista" a ciegas hacía que un usuario sin
  // habilitar —o de solo lectura— viera botones que el servidor iba a
  // rechazar en silencio.
  const cache = (await Store.perfiles()).find((p) => p.id === usuario.id);
  S.perfil = cache || { id: usuario.id, nombre: (usuario.email || '').split('@')[0], rol: 'contratista' };
  const { data, error } = await sb.from('perfiles').select('*').eq('id', usuario.id).maybeSingle();
  if (data) S.perfil = data;
  // contestó, y no hay perfil que leer: el administrador no lo ha activado
  else if (!error && navigator.onLine) S.sync = { ok: false, motivo: 'perfil_inactivo' };
  pantallaPrincipal();
  await recargar();
  Mapa.encuadrar();
  sincronizar();
  // Cada minuto, y solo con la app a la vista. Iba cada veinte segundos y
  // seguía preguntando con el teléfono en el bolsillo: en la mina eso es
  // batería y datos gastados para no enterarse de nada. Al volver a la
  // pantalla se pregunta enseguida, así que nunca se ve nada viejo.
  setInterval(() => { if (!document.hidden) sincronizar(); }, 60_000);
  addEventListener('online', sincronizar);
  addEventListener('offline', pintarSync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sincronizar(); });
}

// Aplica la paleta y calcula, para cada color, si el texto encima debe ir
// claro u oscuro. Así el admin puede elegir cualquier tono sin que un
// botón o una etiqueta queden ilegibles.
function aplicarPaleta() {
  const c = { ...Mapa.COLORES_BASE, ...(S.config?.colores || {}) };
  const raiz = document.documentElement.style;
  for (const [k, v] of Object.entries(c)) {
    raiz.setProperty(`--${k}`, v);
    raiz.setProperty(`--txt-${k}`, contraste(v));
  }
}

function contraste(hex) {
  const h = String(hex).replace('#', '');
  if (h.length < 6) return '#ffffff';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  // El corte va en 150, no en 165: con 165 el ámbar de «por muestrear»
  // se quedaba por un pelo del lado oscuro y le tocaba letra blanca,
  // que sobre ese tono casi no se lee al sol. Con 150 lleva letra negra
  // y ningún otro color de la paleta cambia (el siguiente más claro
  // anda por 190). El mismo número está en mapa.js, claro().
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#14171a' : '#ffffff';
}

async function recargar() {
  const [lotes, pilas, prov, figuras, config, cola, gente, malos, tareas,
         plats, puntos] = await Promise.all([
    Store.lotes(), Store.pilas(), Store.proveedores(),
    Store.figuras(), Store.config(), Store.pendientes(),
    Store.perfiles(), Store.fallidos(), Store.tareas(),
    Store.plataformas(), Store.puntos()
  ]);
  S.gente = gente; S.rechazados = malos.length; S.tareas = tareas;
  S.plataformas = plats.filter((p) => p.activa !== false)
    .sort((x, y) => (x.orden || 0) - (y.orden || 0));
  S.puntos = puntos.filter((p) => p.activo !== false)
    .sort((x, y) => (x.orden || 0) - (y.orden || 0));
  // La guardada puede haber desaparecido, o ser la primera vez: se cae a
  // la primera de la lista en vez de dejar la pantalla en blanco.
  if (!S.plataformas.some((p) => p.id === S.plataforma))
    S.plataforma = S.plataformas[0]?.id || null;
  pintarTareas();
  S.lotes = lotes; S.pilas = pilas.sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
  S.proveedores = prov.sort((a, b) => a.abreviatura.localeCompare(b.abreviatura));
  S.figuras = figuras; S.config = config;
  aplicarPaleta();
  S.pendientes = cola.length;
  S.idsPendientes = new Set(cola.map((o) => o.fila?.lote_id || o.fila?.id));
  pintar();
}

async function sincronizar() {
  S.sync = await Store.sincronizar();
  await recargar();
  await mostrarAvisos();
}

// Cosas que la app resolvió sola pero que hay que saber: una pila que
// hubo que renombrar porque otro celular ya había usado ese número. Se
// muestran una vez y se limpian; si hay una hoja abierta se esperan, para
// no tapar lo que la persona está haciendo.
async function mostrarAvisos() {
  const v = await Store.avisos();
  if (!v.length || document.querySelector('.hoja')) return;
  await Store.olvidarAvisos();
  abrirHoja(`<h2>Aviso</h2>
    ${v.map((a) => `<p class="sub">${esc(a.texto)}</p>`).join('')}
    <button class="btn btn-lleno btn-ancho" id="ok" style="width:100%;margin-top:16px">Entendido</button>`);
  $('#ok').onclick = cerrarHoja;
}

// Un botón que escribe tiene que verse ocupado mientras trabaja y, si
// falla, DECIRLO. Sin esto un toque no producía nada visible —ni giro, ni
// aviso, ni cierre—, la persona volvía a tocar, y al destrabarse salían
// diez lotes iguales de golpe.
function accion(fn, { ocupado = 'Guardando…', alFallar } = {}) {
  return async function (ev) {
    if (this.disabled) return;
    const etiqueta = this.textContent;
    this.disabled = true;
    this.textContent = ocupado;
    try {
      await fn.call(this, ev);
    } catch (e) {
      (alFallar || decirError)(e);
    } finally {
      // si la hoja ya se cerró el nodo está suelto y esto no molesta
      this.disabled = false;
      this.textContent = etiqueta;
    }
  };
}

const textoFallo = (e) =>
  `No se pudo guardar: ${e?.message || e}. El cambio quedó en el celular; se reintenta solo.`;

// Para lo que la persona pidió explícitamente con un botón: se muestra
// siempre, aunque tape la hoja abierta, porque está esperando respuesta.
const decirError = (e) => { console.error(e); avisar(textoFallo(e)); };

// Para lo que pasa de fondo —un gesto del mapa, la red de seguridad—:
// ni tapa lo que la persona está haciendo, ni repite el mismo aviso cada
// veinte segundos si algo quedó fallando en bucle.
let ultimoFallo = 0;
function fallaDeFondo(e) {
  console.error(e);
  if (document.querySelector('.hoja') || Date.now() - ultimoFallo < 15_000) return;
  ultimoFallo = Date.now();
  avisar(textoFallo(e));
}

// Arrastrar un lote, soltarlo sobre una pila o ajustar una forma no pasa
// por ningún botón, así que `accion` no los cubre y mapa.js no espera a
// que terminen: si fallaban, el error se perdía y en pantalla no pasaba
// nada. Que es exactamente como empezó todo esto.
const gesto = (fn) => (...args) => Promise.resolve()
  .then(() => fn(...args))
  .catch(fallaDeFondo);

// Pregunta antes de un cambio que no se puede deshacer, y espera la
// respuesta. Devuelve una promesa para poder usarla desde el gesto que
// la provocó y decidir ahí mismo si se guarda o se devuelve todo a como
// estaba. Tocar fuera de la hoja equivale a cancelar: ante la duda, no
// se cambia nada.
function confirmar({ titulo, detalle, aceptar = 'Aceptar', peligro = false }) {
  return new Promise((resolver) => {
    abrirHoja(`
      <h2 class="pregunta">${esc(titulo)}</h2>
      <div class="sub">${esc(detalle)}</div>
      <div class="acciones" style="margin-top:20px">
        <button id="c-no">Cancelar</button>
        <button id="c-si" class="${peligro ? 'btn-peligro' : 'btn-lleno'}">${esc(aceptar)}</button>
      </div>`);
    const responder = (v) => { cerrarHoja(); resolver(v); };
    $('#c-no').onclick = () => responder(false);
    $('#c-si').onclick = () => responder(true);
    // La equis de la hoja cierra y ya; aquí además tiene que contestar,
    // o quien esté esperando la respuesta se queda esperando para siempre.
    $('#x-hoja').onclick = () => responder(false);
    $('.velo').onclick = (e) => { if (e.target === $('.velo')) responder(false); };
  });
}

// --------------------------------------------------------------- ingreso
function pantallaIngreso() {
  $('#app').innerHTML = `
    <div class="ingreso">
      <div class="marca">Mina · acopio</div>
      <h1>Mapa de lotes</h1>
      <div class="campo">
        <label for="correo">Usuario</label>
        <input id="correo" type="text" autocomplete="username"
               autocapitalize="off" autocorrect="off" spellcheck="false">
      </div>
      <div class="campo">
        <label for="clave">Contraseña</label>
        <input id="clave" type="password" autocomplete="current-password">
      </div>
      <button class="btn btn-lleno" id="entrar" style="width:100%">Entrar</button>
      <p id="error-ingreso" class="aviso" hidden></p>
    </div>`;
  $('#clave').onkeydown = (e) => { if (e.key === 'Enter') $('#entrar').click(); };
  $('#entrar').onclick = async () => {
    const b = $('#entrar');
    b.disabled = true; b.textContent = 'Entrando…';
    const v = $('#correo').value.trim().toLowerCase();
    const { data, error } = await sb.auth.signInWithPassword({
      email: v.includes('@') ? v : `${v}@${DOMINIO_USUARIOS}`,
      password: $('#clave').value
    });
    if (error) {
      const p = $('#error-ingreso');
      p.hidden = false;
      p.textContent = !navigator.onLine
        ? 'Se necesita señal para entrar la primera vez. Después la app funciona sin internet.'
        : /invalid login/i.test(error.message)
          ? 'Usuario o contraseña incorrectos.'
          : 'No se pudo entrar. Avisa al encargado del sistema.';
      b.disabled = false; b.textContent = 'Entrar';
      return;
    }
    abrirSesion(data.user);
  };
}

// ------------------------------------------------------------- principal
function pantallaPrincipal() {
  $('#app').innerHTML = `
    <div class="cabecera-fija">
      <header>
        <h1>Acopio</h1>
        <span class="crece"></span>
        <button class="chip-plat" id="chip-plat" aria-label="Cambiar de plataforma"></button>
        <button class="icono campana" id="campana" aria-label="Tareas" hidden
          >${ICO.campana}<span class="cuenta" id="campana-n"></span></button>
        <button class="chip-sync" id="chip"><span class="punto"></span><span id="chip-txt">—</span></button>
        <button class="icono" id="menu" aria-label="Cuenta">⋮</button>
      </header>
      <nav class="pestanas">
        <button data-t="mapa" aria-selected="true">Mapa</button>
        <button data-t="plataformas" aria-selected="false">Plataformas</button>
        <button data-t="lotes" aria-selected="false">Lotes</button>
      </nav>
    </div>
    <main id="main"></main>
    <!-- Los avisos FLOTAN sobre el contenido en vez de empujarlo. Antes
         vivían dentro de la cabecera y del mapa, así que cada uno que
         aparecía daba un salto a toda la pantalla y reescalaba el plano. -->
    <div id="flotantes">
      <div id="barra-recorrido"></div>
      <div id="barra-forma"></div>
      <div id="barra-historia"></div>
      <div id="boton-nuevo"></div>
      <div id="franja" hidden class="franja"><div></div></div>
    </div>
    <div id="modal"></div>`;

  $('#chip').onclick = sincronizar;
  $('#menu').onclick = menuCuenta;
  $('#campana').onclick = panelTareas;
  $('#chip-plat').onclick = panelPlataformas;
  document.querySelectorAll('nav.pestanas button').forEach((b) => {
    b.onclick = () => {
      S.pestana = b.dataset.t;
      document.querySelectorAll('nav.pestanas button')
        .forEach((x) => x.setAttribute('aria-selected', String(x.dataset.t === S.pestana)));
      pintar();
      if (S.pestana === 'mapa') Mapa.encuadrar();
    };
  });
}

function pintar() {
  pintarSync();
  pintarTareas();
  pintarChipPlataforma();
  // El mapa va a sangre completa: sin márgenes ni tope de ancho. La
  // lista sí se centra, porque un renglón de texto muy largo se lee mal.
  const m = $('#main');
  if (m) m.className = S.pestana === 'mapa' ? 'a-sangre' : '';
  // las barras del mapa flotan sobre TODA la pantalla, así que hay que
  // recogerlas al salir de la pestaña o se quedarían sobre la lista
  if (S.pestana === 'plataformas') { limpiarBarrasMapa(); return pintarPlataformas(); }
  if (S.pestana !== 'mapa') { limpiarBarrasMapa(); return pintarLista(); }
  // Solo se monta la primera vez: repintar no puede perder el zoom ni el encuadre
  if (!document.querySelector('#lienzo-caja')) montarMapa();
  else refrescarMapa();
}

// El perfil nace inactivo y sin acceso a nada. Mientras lo esté, el
// servidor no devuelve ni un registro NI acepta ninguno, y todo eso pasa
// sin error visible: hay que decirlo, o la app parece rota sin motivo.
const sinPermiso = () => S.sync?.motivo === 'perfil_inactivo';

function pintarSync() {
  const chip = $('#chip'); if (!chip) return;
  let estado = 'ok', texto = 'Al día';
  if (sinPermiso()) { estado = 'error'; texto = 'Sin acceso'; }
  else if (S.pendientes > 0) { estado = 'pendiente'; texto = `${S.pendientes} sin subir`; }
  else if (!navigator.onLine) { estado = 'offline'; texto = 'Sin señal'; }
  chip.dataset.estado = estado;
  $('#chip-txt').textContent = texto;
  const f = $('#franja');
  f.hidden = S.pendientes === 0 && S.rechazados === 0 && !sinPermiso() && !S.actualizacion;
  f.dataset.tono = (S.rechazados || sinPermiso()) ? 'error' : 'aviso';
  if (sinPermiso()) {
    f.firstElementChild.textContent =
      'Usuario sin habilitar en el servidor · lo que se registre se guarda en el celular pero no sube. Avisar al administrador.';
    f.onclick = () => avisar(
      'El administrador debe activar el perfil en la base de datos (perfiles → activo). '
      + 'Hasta entonces todo se guarda en el celular y sube en cuanto quede habilitado.');
  } else if (S.actualizacion) {
    // recargar no pierde nada: lo pendiente vive en el celular, no en la pantalla
    f.firstElementChild.textContent = 'Hay una versión nueva de la app · toca para actualizar';
    f.onclick = () => location.reload();
  } else if (S.rechazados) {
    f.firstElementChild.textContent =
      `${S.rechazados} cambio${S.rechazados === 1 ? '' : 's'} que el servidor no aceptó · toca para ver`;
    f.onclick = panelRechazados;
  } else if (S.pendientes) {
    f.firstElementChild.textContent =
      `${S.pendientes} cambio${S.pendientes === 1 ? '' : 's'} guardado${S.pendientes === 1 ? '' : 's'} en el celular · suben solos al volver la señal`;
    f.onclick = sincronizar;
  }
}

// ------------------------------------------------------------------ mapa
const limpiarBarrasMapa = () => {
  for (const id of ['#barra-forma', '#barra-recorrido', '#barra-historia', '#boton-nuevo']) {
    const n = $(id); if (n) n.innerHTML = '';
  }
};

function montarMapa() {
  // Rearmar la barra no puede costar el encuadre en el que se estaba
  const vistaPrevia = document.querySelector('#lienzo') ? Mapa.obtenerVista() : null;

  limpiarBarrasMapa();
  // Mirando otro día no se registran lotes: el botón ni aparece.
  const nb = $('#boton-nuevo');
  if (nb && !soloLectura() && !S.historia) nb.innerHTML =
    `<button class="btn-mapa btn-mapa-primario" id="nuevo">${ICO.mas}<span>Nuevo lote</span></button>`;
  const rec = $('#barra-recorrido');
  if (rec && S.recorrido) rec.innerHTML = `<div class="barra-modo">
    <span>Recorrido del lote en pantalla</span>
    <button class="pastilla" id="quitar-recorrido">Quitar</button></div>`;

  $('#main').innerHTML = `
    <div class="pantalla-mapa">
      <div class="mapa-caja">
        <div id="lienzo-caja"></div>
        <div class="mapa-controles">
          <div class="ctrl-izq">
            <div class="grupo-herramientas">
              <button class="btn-mapa" id="r-buscar" aria-label="Buscar un lote"
                ${S.buscarMapa ? 'aria-pressed="true"' : ''}>${ICO.lupa}<span>Buscar</span></button>
              <button class="btn-mapa" id="r-filtrar" aria-label="Filtrar">
                ${ICO.filtro}<span>Filtrar</span></button>
              ${soloLectura() ? '' : `<button class="btn-mapa" id="r-editar" aria-label="Mover y editar figuras">
                ${ICO.editar}<span>${S.edicion ? 'Salir de editar' : 'Mover y editar'}</span></button>`}
              <button class="btn-mapa" id="r-historia" aria-label="Ver el patio de otro día"
                ${S.historia ? 'aria-pressed="true"' : ''}>${ICO.reloj}<span>Otro día</span></button>
              ${esAdmin() ? `<button class="btn-mapa" id="r-fondo" aria-label="Fondo del mapa">
                ${ICO.fondo}<span>Fondo del mapa</span></button>` : ''}
            </div>
            <div id="caja-buscar"></div>
            <div id="chip-filtro-caja"></div>
          </div>
          <div class="ctrl-grupo">
            <button class="ctrl" id="zoom-mas" aria-label="Acercar">${ICO.mas}</button>
            <button class="ctrl" id="zoom-menos" aria-label="Alejar">${ICO.menos}</button>
            <button class="ctrl" id="encuadrar" aria-label="Ver todo el patio">${ICO.encuadrar}</button>
          </div>
        </div>
      </div>
    </div>`;

  Mapa.montar($('#lienzo-caja'), {
    puedeEditarFondo: esAdmin,
    alTocar: gesto((tipo, id) => {
      // La ficha cuenta cómo está el lote HOY. Abrirla desde el patio de
      // otro día mezclaría las dos cosas, así que en ese modo no se abre.
      if (S.historia) return;
      if (tipo === 'lote') return fichaLote(id);
      if (tipo === 'pila') return fichaPila(id);
      if (esAdmin()) return fichaFigura(id);
    }),
    alSeleccionar: (tipo, obj) => barraForma(tipo, obj),
    alTocarVacio: () => { if (S.edicion) barraEdicion(); },
    alGuardarGeom: gesto(async (tipo, obj, origen, antes) => {
      // `origen` solo viene cuando la figura se ARRASTRÓ. Ajustar el
      // tamaño, el giro o un vértice no pregunta: para eso hubo que
      // agarrar una manija concreta. Todo arrastre sí pregunta, por corto
      // que sea: la posición en el plano es la ubicación real en el
      // patio, y cambiarla sin querer deja el material mal ubicado.
      if (origen) {
        const ok = await confirmar({
          titulo: tipo === 'figura' ? '¿Dejar la figura aquí?' : `¿Dejar ${obj.codigo} aquí?`,
          detalle: `${nombreDeFigura(tipo, obj)} cambia de ubicación en el patio.`,
          aceptar: 'Dejar aquí'
        });
        if (!ok) return Mapa.deshacerGeom(tipo, obj.id, antes);
      }
      const tabla = tipo === 'lote' ? 'lotes' : tipo === 'pila' ? 'pilas' : 'mapa_figuras';
      await Store.guardarFigura(tabla, { ...obj });
      if (tipo === 'lote' && origen) await anotarRecorrido(obj, origen);
      await recargar();
      sincronizar();
    }),
    alSoltarSobre: gesto(manejarSoltar)
  });
  refrescarMapa();
  Mapa.fijarVista(vistaPrevia);

  $('#zoom-mas').onclick = () => Mapa.acercar(0.8);
  $('#zoom-menos').onclick = () => Mapa.acercar(1.25);
  $('#encuadrar').onclick = () => Mapa.encuadrar();
  if ($('#nuevo')) $('#nuevo').onclick = formLote;
  $('#r-buscar').onclick = () => {
    S.buscarMapa = !S.buscarMapa;
    if (!S.buscarMapa) S.busquedaMapa = '';
    montarMapa();
    $('#q-mapa')?.focus();
    volverAlMapa();
  };
  pintarBuscadorMapa();
  $('#r-filtrar').onclick = panelFiltro;
  $('#r-historia').onclick = accion(alternarHistoria, { ocupado: 'Leyendo…' });
  if ($('#r-fondo')) $('#r-fondo').onclick = panelFondo;
  if ($('#r-editar')) $('#r-editar').onclick = () => { S.edicion = !S.edicion; montarMapa(); };
  if (S.edicion) $('#r-editar')?.setAttribute('aria-pressed', 'true');
  actualizarChipFiltro();

  // Mirando otro día no se edita nada: ni mover, ni ajustar, ni soltar
  // un lote sobre una pila. El botón de editar se apaga para que no
  // parezca disponible.
  Mapa.editar(S.historia ? false : S.edicion);
  if (S.historia) {
    $('#r-editar')?.setAttribute('disabled', '');
    barraHistoria();                       // deja la barra puesta y pinta
  } else if (S.edicion) barraEdicion();
  const qr = $('#quitar-recorrido');
  if (qr) qr.onclick = () => { S.recorrido = null; montarMapa(); Mapa.encuadrar(); };
}

// Mandar algo a otra plataforma. Lo puede hacer cualquiera que trabaje
// en el patio, no solo el admin: quien mueve el material es quien está
// ahí. Queda apuntado en el historial de cada lote, con quién y cuándo.
function hojaTrasladar({ titulo, detalle, desde, alSoltar }) {
  const otras = S.plataformas.filter((p) => p.id !== desde);
  abrirHoja(`
    <p class="pista">${esc(detalle)}</p>
    <div class="acciones acciones-plat">
      ${otras.map((p) => `<button class="btn btn-ancho" data-id="${p.id}"
        >${esc(p.nombre)}</button>`).join('')}
    </div>
    <div class="acciones"><button id="tr-cancelar">Cancelar</button></div>`,
    `<h2>${esc(titulo)}</h2>`);
  $('#tr-cancelar').onclick = cerrarHoja;
  for (const b of document.querySelectorAll('.acciones-plat button'))
    b.onclick = accion(() => alSoltar(b.dataset.id), { ocupado: 'Moviendo…' });
}

// ------------------------------------------------- pantalla de plataformas
// El nombre de la plataforma va SIEMPRE a la vista, en la cabecera: sin
// eso, mirando un plano vacío no hay manera de saber si es que la
// plataforma está vacía o es que estás en otra.
function pintarChipPlataforma() {
  const c = $('#chip-plat');
  if (!c) return;
  const p = plataformaActual();
  c.hidden = S.plataformas.length < 2;
  c.textContent = p ? p.nombre : '—';
}

// Cuánto tiene que llevar un lote para contar como recién llegado, y
// cuánto sin que le pase nada para contar como atascado. Tres semanas
// quietos es material del que alguien se olvidó.
const DIAS_NUEVO = 7;
const DIAS_QUIETO = 21;

// Cómo está una plataforma. Se cuenta lo mismo que se dibuja: los
// despachados y los alimentados ya salieron del patio y no cuentan,
// igual que no se pintan en el plano.
//
// La TARJETA de cada plataforma enseña solo el total y el desglose por
// estado: se probó con más datos —pilas, sueltos, antigüedad, porcentaje
// del patio— y era demasiado para lo que se viene a hacer aquí, que es
// escoger plataforma. El resto se usa arriba, en el total del patio, y
// en el selector rápido.
const resumen = (id) => {
  const suyos = S.lotes.filter((l) => l.plataforma_id === id && enElPatio(l));
  const porEstado = {};
  for (const l of suyos) porEstado[l.estado] = (porEstado[l.estado] || 0) + 1;
  // Por la fecha de recepción, no por `creado_en`: lo que importa es
  // cuándo llegó el material al patio, no cuándo se tecleó.
  const edades = suyos.map((l) => diasEntreFechas(l.fecha_recepcion))
                      .filter((n) => Number.isFinite(n));
  return {
    total: suyos.length, porEstado,
    pilas: S.pilas.filter((p) => p.plataforma_id === id && p.estado === 'abierta').length,
    nuevos: edades.filter((d) => d <= DIAS_NUEVO).length,
    // Lleva tres semanas en el mismo estado: nadie lo ha tocado.
    quietos: suyos.filter((l) => l.estado_desde && dias(l.estado_desde) >= DIAS_QUIETO).length,
    sinRecoger: suyos.filter(vencido).length
  };
};

function pintarPlataformas() {
  const m = $('#main');
  if (!m) return;
  // Una pantalla en blanco no dice nada. Si las plataformas todavía no
  // han bajado —la primera vez, o sin señal— hay que decirlo, porque
  // desde fuera se lee como "se perdieron las cinco".
  if (!S.plataformas.length) {
    m.innerHTML = `<div class="vacio"><strong>Todavía no han llegado las plataformas</strong>
      ${navigator.onLine ? 'Se están bajando; en cuanto lleguen salen aquí.'
        : 'Hace falta señal para bajarlas la primera vez.'}</div>`;
    return;
  }
  // Arriba del todo, el patio entero: sin esto no hay con qué comparar
  // una plataforma. "18 de 42" dice mucho más que "18".
  const todos = S.plataformas.map((p) => resumen(p.id));
  const suma = (c) => todos.reduce((a, r) => a + r[c], 0);
  const patio = { total: suma('total'), pilas: suma('pilas'),
                  sinRecoger: suma('sinRecoger'), quietos: suma('quietos'),
                  nuevos: suma('nuevos') };

  m.innerHTML = `
    <div class="patio-total">
      <span class="cifra">${patio.total}</span>
      <span class="txt">lote${patio.total === 1 ? '' : 's'} en el patio,
        repartidos en ${S.plataformas.length} plataformas</span>
      <span class="mini-datos">
        <span><strong>${patio.pilas}</strong> pila${patio.pilas === 1 ? '' : 's'} abierta${patio.pilas === 1 ? '' : 's'}</span>
        <span><strong>${patio.nuevos}</strong> esta semana</span>
        ${patio.sinRecoger ? `<span class="alerta"><strong>${patio.sinRecoger}</strong> sin recoger</span>` : ''}
        ${patio.quietos ? `<span><strong>${patio.quietos}</strong> sin moverse</span>` : ''}
      </span>
    </div>
    <div class="tablero-plat">${S.plataformas.map((p, i) => {
    const r = todos[i];
    const trozos = Object.entries(r.porEstado)
      .sort((a, b) => (ORDEN_ESTADO[a[0]] ?? 9) - (ORDEN_ESTADO[b[0]] ?? 9));
    return `<button class="patio${p.id === S.plataforma ? ' viva' : ''}" data-id="${p.id}">
      <span class="fila1"><strong>${esc(p.nombre)}</strong>
        <span class="tot">${r.total}<span class="uds"> lote${r.total === 1 ? '' : 's'}</span></span>
        <span class="flecha">›</span></span>

      ${r.total ? `<span class="barra-est">${trozos.map(([k, n]) =>
        `<span style="background:var(--${k});flex:${n}" title="${esc(ESTADOS[k] || k)}"></span>`).join('')}</span>`
        : '<span class="barra-est vacia"></span>'}

      ${r.total ? `<span class="leyenda">${trozos.map(([k, n]) =>
        `<span><i style="background:var(--${k})"></i>${esc(ESTADOS[k] || k)}
           <b>${n}</b></span>`).join('')}</span>`
        : '<span class="pie"><span>Sin material en este momento</span></span>'}

    </button>`;
  }).join('')}</div>`;

  for (const b of m.querySelectorAll('.patio')) b.onclick = () => {
    irAPlataforma(b.dataset.id);
    S.recorrido = null; S.historia = null;
    irAlMapa();
    Mapa.encuadrar();
  };
}

// El selector rápido: las cinco en miniatura, para saltar sin salir del
// mapa. Es SOLO para escoger; los lotes no se arrastran de aquí.
function panelPlataformas() {
  abrirHoja(`<div class="mini-plats">${S.plataformas.map((p) => {
    const r = resumen(p.id);
    return `<button class="mini${p.id === S.plataforma ? ' viva' : ''}" data-id="${p.id}">
      <svg viewBox="0 0 ${p.ancho || 1000} ${p.alto || 700}" preserveAspectRatio="xMidYMid meet">
        <rect width="${p.ancho || 1000}" height="${p.alto || 700}"
          fill="${esc(p.color_fondo || '#e4e7e2')}"/>
        ${S.lotes.filter((l) => l.plataforma_id === p.id && enElPatio(l) && !l.pila_id)
          .slice(0, 60).map((l) => `<circle cx="${l.x}" cy="${l.y}" r="${Math.max(l.rx || 40, 26)}"
            fill="${paletaActual()[l.estado] || '#5f6863'}"/>`).join('')}
        ${S.pilas.filter((x) => x.plataforma_id === p.id && x.estado === 'abierta')
          .map((x) => `<ellipse cx="${x.x}" cy="${x.y}" rx="${x.rx}" ry="${x.ry}"
            fill="none" stroke="#14171a" stroke-width="8" stroke-dasharray="26 14"/>`).join('')}
      </svg>
      <span class="nom">${esc(p.nombre)}</span>
      <span class="cnt">${r.total}
        <span class="cnt-sub">${r.pilas ? `${r.pilas} pila${r.pilas === 1 ? '' : 's'}` : 'sin pilas'}${
          r.sinRecoger ? ` · <b class="alerta">${r.sinRecoger} sin recoger</b>` : ''}</span></span>
    </button>`;
  }).join('')}</div>`, '<h2>Plataformas</h2>');

  for (const b of document.querySelectorAll('.mini')) b.onclick = () => {
    irAPlataforma(b.dataset.id);
    S.recorrido = null; S.historia = null;
    cerrarHoja(); irAlMapa(); Mapa.encuadrar();
  };
}

// --------------------------------------------------------------- tareas
// Encargos del admin a los contratistas.
//
// Las ve TODO el mundo aunque el admin diga a quién van dirigidas: en el
// patio se cubren entre ellos y esconderle un encargo a quien está al
// lado no ayuda. Quien no es admin solo puede COMPLETARLAS; el servidor
// lo impone, no la pantalla.
//
// El aviso es DENTRO de la app: la campana se pone roja y el celular
// vibra al aparecer una tarea nueva. No hay notificación con la app
// cerrada —eso necesita un servicio aparte y gasta batería—, pero como
// la app se abre varias veces al día para registrar lotes, se ve igual.
const PRIORIDADES = { urgente: 'Urgente', alta: 'Alta', media: 'Media', baja: 'Baja' };
const ORDEN_PRIORIDAD = { urgente: 0, alta: 1, media: 2, baja: 3 };

const pendientes = () => S.tareas.filter((t) => !t.completado_en)
  .sort((a, b) => (ORDEN_PRIORIDAD[a.prioridad] ?? 9) - (ORDEN_PRIORIDAD[b.prioridad] ?? 9)
                  || String(a.creado_en).localeCompare(String(b.creado_en)));
const completadas = () => S.tareas.filter((t) => t.completado_en)
  .sort((a, b) => String(b.completado_en).localeCompare(String(a.completado_en)));

// La campana: cuántas hay y si toca avisar. Vibra UNA vez por tarea, la
// primera que se ve; si no, cada vuelta de sincronización volvería a
// hacer vibrar el celular por lo mismo.
function pintarTareas() {
  const b = $('#campana');
  if (!b) return;
  const abiertas = pendientes();
  b.hidden = !abiertas.length && !esAdmin();
  b.dataset.hay = abiertas.length ? 'si' : 'no';
  b.dataset.urgente = abiertas.some((t) => t.prioridad === 'urgente') ? 'si' : 'no';
  $('#campana-n').textContent = abiertas.length || '';

  // Se avisa UNA vez por tarea, la primera que se ve. Sin esto, cada
  // vuelta de sincronización volvería a sonar por lo mismo.
  const nuevas = abiertas.filter((t) => !S.avisadas.has(t.id));
  // Solo se recuerdan las que siguen pendientes: una tarea cerrada ya no
  // puede volver a avisar, y así la lista no crece para siempre.
  S.avisadas = new Set(abiertas.map((t) => t.id));
  recordar('acopio-avisadas', JSON.stringify([...S.avisadas]));
  if (nuevas.length && !esAdmin()) {
    sonar('tarea');
    // dos toques cortos para lo normal, tres largos para lo urgente
    if (navigator.vibrate) navigator.vibrate(nuevas.some((t) => t.prioridad === 'urgente')
      ? [200, 100, 200, 100, 200] : [120, 80, 120]);
  }
}

const quienEs = (id) => S.gente.find((p) => p.id === id)?.nombre || 'alguien';

function panelTareas() {
  const abiertas = pendientes(), hechas = completadas();
  abrirHoja(`
    ${esAdmin() ? `<button class="btn btn-lleno btn-ancho" id="t-nueva" style="width:100%"
      >${ICO.mas}<span>Nueva tarea</span></button>` : ''}

    <h3>Pendientes</h3>
    ${abiertas.length ? `<ul class="tareas">${abiertas.map(filaTarea).join('')}</ul>`
      : '<p class="pista">No hay tareas pendientes.</p>'}

    ${esAdmin() ? `
      <h3>Completadas</h3>
      ${hechas.length ? `<ul class="tareas hechas">${hechas.slice(0, 50).map((t) => `
        <li data-id="${t.id}">
          <span class="etiqueta-prio" data-p="${t.prioridad}">${esc(PRIORIDADES[t.prioridad] || '')}</span>
          <span class="tarea-txt"><strong>${esc(t.titulo)}</strong>
            <span class="dias">${esc(quienEs(t.completado_por))} ·
              ${new Date(t.completado_en).toLocaleString('es-CO')}</span></span>
        </li>`).join('')}</ul>`
        : '<p class="pista">Todavía no se ha completado ninguna.</p>'}` : ''}`,
    '<h2>Tareas</h2>');

  const nueva = $('#t-nueva');
  if (nueva) nueva.onclick = accion(hojaNuevaTarea, { ocupado: 'Abriendo…' });
  for (const li of document.querySelectorAll('.tareas li'))
    li.onclick = () => fichaTarea(li.dataset.id);
}

const filaTarea = (t) => `<li data-id="${t.id}">
  <span class="etiqueta-prio" data-p="${t.prioridad}">${esc(PRIORIDADES[t.prioridad] || '')}</span>
  <span class="tarea-txt"><strong>${esc(t.titulo)}</strong>
    ${t.asignado_a ? `<span class="dias">Para ${esc(quienEs(t.asignado_a))}</span>` : ''}</span>
</li>`;

// Los lotes y las pilas que señala una tarea, ya resueltos. Un id que ya
// no exista simplemente no sale: la tarea no se rompe por eso.
const senalados = (t) => [
  ...(t.lotes_ids || []).map((id) => S.lotes.find((l) => l.id === id))
    .filter(Boolean).map((l) => ({ tipo: 'lote', o: l })),
  ...(t.pilas_ids || []).map((id) => S.pilas.find((p) => p.id === id))
    .filter(Boolean).map((p) => ({ tipo: 'pila', o: p }))
];

// Quién puede darle a "completada". Si la tarea tiene dueño, solo su
// dueño; el admin siempre. El servidor lo comprueba otra vez, esto es
// para no enseñar un botón que iba a no hacer nada.
const puedeCompletar = (t) =>
  !soloLectura() && (esAdmin() || !t.asignado_a || t.asignado_a === S.perfil?.id);

function fichaTarea(id) {
  const t = S.tareas.find((x) => x.id === id);
  if (!t) return;
  const cosas = senalados(t);
  abrirHoja(`
    <div class="fila-chips">
      <span class="etiqueta-prio" data-p="${t.prioridad}">${esc(PRIORIDADES[t.prioridad] || '')}</span>
      ${t.asignado_a ? `<span class="dias">Para ${esc(quienEs(t.asignado_a))}</span>` : ''}
    </div>
    ${t.detalle ? `<p class="detalle-tarea">${esc(t.detalle)}</p>`
                : '<p class="pista">Sin más detalle.</p>'}
    <p class="pista">La puso ${esc(quienEs(t.creado_por))} ·
      ${new Date(t.creado_en).toLocaleString('es-CO')}</p>

    ${cosas.length ? `<div class="senalados">${cosas.map((c, i) => `
      <button class="btn btn-ubicar" data-ir="${i}">${ICO.diana}<span>${
        c.tipo === 'lote' ? esc(c.o.codigo) : `Pila ${esc(c.o.codigo)}`}</span></button>`).join('')}</div>` : ''}

    ${t.completado_en ? `
      <p class="aviso">Completada por ${esc(quienEs(t.completado_por))} el
        ${new Date(t.completado_en).toLocaleString('es-CO')}.</p>
      ${t.nota_cierre ? `<p class="detalle-tarea">${esc(t.nota_cierre)}</p>` : ''}`
    : puedeCompletar(t) ? `
      <div class="campo">
        <label for="t-nota">Nota al completar (opcional)</label>
        <textarea id="t-nota" rows="2" placeholder="Qué se hizo"></textarea>
      </div>
      <button class="btn btn-guardar btn-ancho" id="t-listo" style="width:100%"
        >${ICO.visto}<span>Completada</span></button>`
    : soloLectura() ? '' : `
      <p class="pista">Esta tarea es de ${esc(quienEs(t.asignado_a))}: solo
        ${esc(quienEs(t.asignado_a))} puede darla por completada.</p>`}

    ${esAdmin() ? `<button class="btn btn-peligro btn-ancho" id="t-borrar" style="width:100%;margin-top:14px"
      >Borrar la tarea</button>` : ''}`,
    `<h2>${esc(t.titulo)}</h2>`);

  // Saltar al plano es exactamente lo que ya hace la ficha de un lote:
  // se reutiliza, y así la tarea también avisa si el lote ya salió del
  // patio en vez de llevar a un sitio donde no hay nada dibujado.
  for (const b of document.querySelectorAll('[data-ir]')) {
    const c = cosas[Number(b.dataset.ir)];
    b.onclick = () => { cerrarHoja(); if (c.tipo === 'lote') ubicarEnMapa(c.o); else fichaPila(c.o.id); };
  }

  const listo = $('#t-listo');
  if (listo) listo.onclick = accion(async () => {
    await Store.completarTarea(t.id, { usuario_id: S.perfil.id, nota: $('#t-nota')?.value });
    cerrarHoja(); await recargar(); pintarTareas(); sincronizar();
  }, { ocupado: 'Guardando…' });

  const borrar = $('#t-borrar');
  if (borrar) borrar.onclick = accion(async () => {
    const ok = await confirmar({
      titulo: '¿Borrar la tarea?',
      detalle: 'Desaparece para todos y no queda rastro de ella.',
      aceptar: 'Borrarla', peligro: true
    });
    if (!ok) return fichaTarea(id);
    await Store.borrarTarea(t.id);
    cerrarHoja(); await recargar(); pintarTareas(); sincronizar();
  });
}

async function hojaNuevaTarea() {
  // La lista de gente se refresca AQUÍ. Viaja con los catálogos, que van
  // una vez por hora, y con eso un compañero recién habilitado no
  // aparecía en el desplegable hasta la hora siguiente.
  S.gente = await Store.refrescarPerfiles();
  // Solo quien puede trabajar en el patio: el de rol "empresa" solo mira,
  // y a quien todavía no esté habilitado no le abre ni la app, así que
  // mandarle una tarea no serviría de nada.
  const gente = S.gente
    .filter((p) => p.activo !== false && (p.rol === 'contratista' || p.rol === 'admin'))
    .sort((x, y) => String(x.nombre).localeCompare(String(y.nombre), 'es'));
  const dormidos = S.gente.filter((p) => p.activo === false).length;
  abrirHoja(`
    <div class="campo">
      <label for="t-titulo">Qué hay que hacer</label>
      <input id="t-titulo" autocomplete="off" placeholder="Remuestrear el PG1042">
    </div>
    <div class="campo">
      <label for="t-detalle">Detalle (opcional)</label>
      <textarea id="t-detalle" rows="3" placeholder="Lo que haga falta explicar"></textarea>
    </div>
    <div class="campo">
      <label>Prioridad</label>
      <div class="acciones" id="t-prio">
        ${Object.entries(PRIORIDADES).map(([k, v]) => `<button type="button" data-p="${k}"
          class="etiqueta-prio${k === 'media' ? ' elegida' : ''}" data-p2="${k}">${v}</button>`).join('')}
      </div>
    </div>
    <div class="campo">
      <label for="t-quien">Para quién (opcional)</label>
      <select id="t-quien">
        <option value="">Cualquiera</option>
        ${gente.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}
      </select>
      ${dormidos ? `<p class="pista">Hay ${dormidos} persona${dormidos === 1 ? '' : 's'}
        sin habilitar todavía, y no ${dormidos === 1 ? 'sale' : 'salen'} aquí:
        sin habilitar no ${dormidos === 1 ? 'puede' : 'pueden'} ni abrir la app.</p>` : ''}
    </div>
    <div class="campo">
      <label for="t-buscar">Sobre qué lotes o pilas (opcional)</label>
      <input id="t-buscar" type="search" autocomplete="off"
             placeholder="Escribe el código: PG1042, SJ10…">
      <div id="t-elegidos" class="elegidos"></div>
      <div id="t-opciones" class="opciones"></div>
    </div>
    <p id="t-error" class="aviso" hidden></p>
    <div class="acciones">
      <button id="t-cancelar">Cancelar</button>
      <button id="t-crear" class="btn-lleno">Enviar la tarea</button>
    </div>`, '<h2>Nueva tarea</h2>');

  let prioridad = 'media';
  for (const b of document.querySelectorAll('#t-prio button'))
    b.onclick = () => {
      prioridad = b.dataset.p;
      for (const o of document.querySelectorAll('#t-prio button')) o.classList.remove('elegida');
      b.classList.add('elegida');
    };

  // ---- el buscador de lotes y pilas
  //
  // Antes era un desplegable con los novecientos lotes en el orden que
  // los devolviera la base: encontrar uno era imposible. Ahora se
  // escribe el código y se van marcando los que hagan falta, porque un
  // encargo puede ser sobre varios ("acomodar estos cuatro").
  //
  // Solo se enseñan quince a la vez: la lista entera en el DOM de un
  // celular va lenta, y si hace falta bajar de quince es que hay que
  // escribir una letra más.
  const catalogo = [
    ...S.lotes.filter((l) => l.estado !== 'despachado' && !alimentado(l))
      .map((l) => ({ k: `l:${l.id}`, txt: l.codigo,
                     sub: `${ESTADOS[l.estado] || ''} · ${nombrePlataforma(l.plataforma_id)}` })),
    ...S.pilas.filter((p) => p.estado === 'abierta')
      .map((p) => ({ k: `p:${p.id}`, txt: `Pila ${p.codigo}`,
                     sub: `pila · ${nombrePlataforma(p.plataforma_id)}` }))
  ].sort((x, y) => x.txt.localeCompare(y.txt, 'es', { numeric: true }));
  const elegidos = new Set();

  const pintarElegidos = () => {
    $('#t-elegidos').innerHTML = [...elegidos].map((k) => {
      const c = catalogo.find((o) => o.k === k);
      return `<button type="button" class="pastilla quita" data-k="${k}"
        >${esc(c ? c.txt : k)} <span aria-hidden="true">×</span></button>`;
    }).join('');
    for (const b of document.querySelectorAll('#t-elegidos .quita'))
      b.onclick = () => { elegidos.delete(b.dataset.k); pintarElegidos(); pintarOpciones(); };
  };

  const pintarOpciones = () => {
    const q = ($('#t-buscar')?.value || '').trim().toUpperCase();
    const hay = catalogo.filter((o) => !elegidos.has(o.k)
      && (!q || o.txt.toUpperCase().includes(q)));
    $('#t-opciones').innerHTML = !q && !hay.length ? ''
      : hay.length ? hay.slice(0, 15).map((o) => `<button type="button" data-k="${o.k}"
          ><strong>${esc(o.txt)}</strong><span class="dias">${esc(o.sub)}</span></button>`).join('')
          + (hay.length > 15 ? `<p class="pista">y ${hay.length - 15} más: escribe una letra más</p>` : '')
        : '<p class="pista">Ningún lote ni pila con ese código.</p>';
    for (const b of document.querySelectorAll('#t-opciones button'))
      b.onclick = () => {
        elegidos.add(b.dataset.k);
        $('#t-buscar').value = '';
        pintarElegidos(); pintarOpciones();
      };
  };
  $('#t-buscar').oninput = pintarOpciones;
  pintarElegidos(); pintarOpciones();

  $('#t-cancelar').onclick = () => panelTareas();
  $('#t-crear').onclick = accion(async () => {
    const titulo = $('#t-titulo').value.trim();
    if (!titulo) {
      const e = $('#t-error'); e.hidden = false; e.textContent = 'Escribe qué hay que hacer.';
      return;
    }
    await Store.crearTarea({
      titulo, detalle: $('#t-detalle').value, prioridad,
      asignado_a: $('#t-quien').value || null,
      lotes_ids: [...elegidos].filter((k) => k.startsWith('l:')).map((k) => k.slice(2)),
      pilas_ids: [...elegidos].filter((k) => k.startsWith('p:')).map((k) => k.slice(2)),
      usuario_id: S.perfil.id
    });
    cerrarHoja(); await recargar(); pintarTareas(); sincronizar();
  }, { ocupado: 'Enviando…' });
}

// ------------------------------------------------------- otro día
// Mirar el patio como estaba. SOLO MIRAR: no se guarda nada, no se
// sincroniza nada y no se puede arrastrar ni editar. Es la misma
// pregunta que se hace alguien delante del plano —"¿esto dónde estaba el
// martes?"— y hasta ahora había que ir lote por lote leyendo historiales.
//
// Se rehace a partir de los eventos, que no se borran nunca. Lo hace
// `historia.js`, que no toca la pantalla: aquí solo se le pide el patio
// de un instante y se le pasa al plano.
async function alternarHistoria() {
  if (S.historia) return salirDeHistoria();
  // Primero se baja la historia que falte. Sin esto se rehacía el patio
  // con la ventana corta que deja la sincronización —unos días— y de casi
  // ningún lote había un solo evento: salían todos "por muestrear" y sin
  // pila. Se trae de a tramos y se queda guardada, así que la segunda vez
  // no baja nada.
  const traido = await Store.ahondarHistoria();
  const eventos = await Store.eventos();
  const primero = desde(eventos);
  if (!primero) return avisar('Todavía no hay movimientos guardados para poder mirar atrás.');
  // La lista suelta no se guarda: con el índice basta, y son decenas de
  // miles de filas que no hace falta tener dos veces en memoria.
  S.historia = {
    primero, indice: indexar(eventos),
    entera: !!traido.entera, sinSenal: !!traido.sinSenal,
    dia: null, dias: 0, aproximados: 0
  };
  S.edicion = false;
  montarMapa();
}

function salirDeHistoria() {
  if (pintadoPedido) { cancelAnimationFrame(pintadoPedido); pintadoPedido = 0; }
  S.historia = null;
  montarMapa();
  refrescarMapa();
}

// El deslizador va en DÍAS, no en minutos. En minutos, un patio con
// medio año de historia son doscientos sesenta mil pasos repartidos en
// tres centímetros de pantalla: cada píxel saltaba medio día y era
// imposible parar en el martes. En días, medio año son ciento ochenta
// pasos y el dedo cae donde apunta.
const A_MEDIANOCHE = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const DIA = 86_400_000;
const diasEntre = (a, b) => Math.round((A_MEDIANOCHE(b) - A_MEDIANOCHE(a)) / DIA);

// "mié 15 jul". Se compone a mano porque `toLocaleDateString` suelta
// "Mié, 15 De Jul": la preposición en mayúscula y comas de más.
const momento = (d) => d
  .toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: 'short' })
  .replace(/,/g, '').replace(/\./g, '');

// El patio de un día pasado se enseña COMO QUEDÓ AL CERRAR ESE DÍA, que
// es la respuesta a "¿cómo estaba el martes?". El de hoy, ahora mismo.
function instanteDelDia(h, i) {
  if (i >= h.dias) return new Date().toISOString();
  const f = A_MEDIANOCHE(new Date(h.primero));
  f.setDate(f.getDate() + i);
  f.setHours(23, 59, 59, 999);
  return f.toISOString();
}

function barraHistoria() {
  const caja = $('#barra-historia');
  if (!caja || !S.historia) return;
  const h = S.historia;
  h.dias = Math.max(0, diasEntre(new Date(h.primero), new Date()));
  if (h.dia == null) h.dia = h.dias;                      // se entra por hoy

  const alcance = new Date(h.primero).toLocaleDateString('es-CO');
  caja.innerHTML = `<div class="barra-modo barra-historia">
    <div class="fila-historia">
      <strong id="h-etiqueta"></strong>
      <button class="pastilla" id="h-salir">Volver a hoy</button>
    </div>
    <div class="fila-historia">
      <button class="ctrl ctrl-historia" id="h-atras" aria-label="Un día atrás">‹</button>
      <input type="range" id="h-cuando" min="0" max="${h.dias}" value="${h.dia}" step="1"
        aria-label="Qué día mirar">
      <button class="ctrl ctrl-historia" id="h-alante" aria-label="Un día adelante">›</button>
    </div>
    <span class="pista" id="h-detalle"></span>
    <span class="pista">Solo se mira. Se llega hasta el ${esc(alcance)}${
      h.entera ? ', que es el principio de todo.'
               : h.sinSenal ? '; sin señal no se pudo traer más.'
                            : '. Al volver a abrirlo se trae otro tramo.'}</span>
  </div>`;

  const campo = $('#h-cuando');
  // El deslizador NO se vuelve a dibujar al moverlo. Antes cada tirón
  // rehacía esta barra entera, y con ella el propio <input> que el dedo
  // estaba arrastrando: el navegador perdía el elemento a medio gesto y
  // el arrastre se cortaba solo. Solo cambian los dos textos.
  campo.oninput = () => { h.dia = Number(campo.value); rotularHistoria(); pedirPintado(); };
  const mover = (paso) => () => {
    campo.value = String(Math.min(Math.max(h.dia + paso, 0), h.dias));
    campo.dispatchEvent(new Event('input'));
  };
  $('#h-atras').onclick = mover(-1);
  $('#h-alante').onclick = mover(1);
  $('#h-salir').onclick = salirDeHistoria;

  rotularHistoria();
  pintarHistoria();
}

// Los dos textos que cambian al mover el deslizador.
function rotularHistoria() {
  const h = S.historia;
  if (!h) return;
  const hoy = h.dia >= h.dias;
  const fecha = A_MEDIANOCHE(new Date(h.primero));
  fecha.setDate(fecha.getDate() + h.dia);
  const et = $('#h-etiqueta');
  if (et) et.textContent = hoy ? 'Ahora mismo' : momento(fecha);
  const de = $('#h-detalle');
  if (!de) return;
  const faltan = h.aproximados
    ? ` · ${h.aproximados} sin historia completa` : '';
  de.textContent = hoy ? 'El patio tal como está ahora'
                       : `Como quedó al final del día${faltan}`;
}

// Pintar el plano entero cuesta; el dedo manda muchos más tirones que
// cuadros puede dibujar la pantalla. Se guarda el último y se pinta una
// vez por cuadro, así el deslizador nunca se queda atrás del dedo.
let pintadoPedido = 0;
function pedirPintado() {
  if (pintadoPedido) return;
  pintadoPedido = requestAnimationFrame(() => { pintadoPedido = 0; pintarHistoria(); });
}

function pintarHistoria() {
  const h = S.historia;
  if (!h || !document.querySelector('#lienzo')) return;
  const t = instanteDelDia(h, h.dia);
  // Mirar atrás se hace SOBRE LA PLATAFORMA que se está viendo: rehacer
  // las cinco a la vez no diría nada, y el plano es el de esta.
  // Se rehacen TODOS y se filtra DESPUÉS: un lote que entonces estaba en
  // Topsoil y hoy está en Ye tiene que salir en el Topsoil de entonces.
  // Filtrar antes lo escondería justo del día en que sí estaba ahí.
  const rehecho = planoEn(t, { lotes: S.lotes, pilas: S.pilas, indice: h.indice });
  // Se filtra con la misma regla que el plano de hoy —`enEstaPlataforma`—
  // y no comparando a pelo: si todavía no han llegado las plataformas,
  // esa regla deja pasar todo. Comparando a pelo no pasaba NI UN lote y
  // "otro día" salía en blanco, como si no hubiera historia.
  const lotes = rehecho.lotes.filter(enEstaPlataforma);
  const suyas = new Set(lotes.map((l) => l.pila_id).filter(Boolean));
  const pilas = rehecho.pilas.filter((p) => suyas.has(p.id));
  const aproximados = lotes.filter((l) => l._aprox).length;
  if (aproximados !== h.aproximados) { h.aproximados = aproximados; rotularHistoria(); }
  Mapa.pintar({ config: { ...S.config, ...(plataformaActual() || {}) },
                figuras: misFiguras(), pilas, lotes });
}

// El filtro activo se ve sobre el mapa y se quita de un toque, sin
// tener que volver a entrar al panel para desactivarlo.
function actualizarChipFiltro() {
  // el botón de la barra muestra el mismo estado, con su etiqueta
  const rf = $('#r-filtrar');
  if (rf) {
    const activo = S.mapaFiltro.campo !== 'ninguno';
    rf.querySelector('span').textContent = activo ? textoFiltro() : 'Filtrar';
    if (activo) rf.setAttribute('aria-pressed', 'true');
    else rf.removeAttribute('aria-pressed');
  }
  const caja = $('#chip-filtro-caja');
  if (!caja) return;
  caja.innerHTML = S.mapaFiltro.campo === 'ninguno' ? '' : `
    <button class="chip-filtro" id="quitar-filtro-rapido">
      ${ICO.filtro}<span>${esc(textoFiltro())}</span>${ICO.cerrar}
    </button>`;
  const b = $('#quitar-filtro-rapido');
  if (b) b.onclick = () => {
    S.mapaFiltro = { campo: 'ninguno', valor: null };
    actualizarChipFiltro();
    refrescarMapa();
  };
}

// Lleva al mapa, activa el modo edición y selecciona la figura pedida
function abrirEdicion(tipo, obj) {
  S.edicion = true;
  irAlMapa();
  Mapa.seleccionar(tipo, obj.id);
  barraForma(tipo, obj);
}

// Lleva el plano hasta un lote y lo deja latiendo unos segundos. Llegar
// no basta: al llegar hay que saber cuál de las figuras era.
function ubicarEnMapa(l) {
  if (l.estado === 'despachado' || l.estado === 'plataforma' || alimentado(l)) {
    return avisar(`${l.codigo}: ${ESTADOS[l.estado]}. Ya salió del patio, no se dibuja en el plano.`);
  }
  // Puede estar en OTRA plataforma: se cambia de plano antes de buscarlo,
  // o se acabaría mirando un patio donde ese lote no está.
  if (l.plataforma_id && l.plataforma_id !== S.plataforma) irAPlataforma(l.plataforma_id);
  const figura = figurasEnElPlano([l])[0];
  if (!figura) return avisar(`${l.codigo} no se está dibujando en el plano.`);

  // limpiar filtro y búsqueda: se pidió ver ESTE lote, y dejarlo
  // atenuado por un filtro puesto antes sería justo lo contrario
  S.mapaFiltro = { campo: 'ninguno', valor: null };
  S.busquedaMapa = ''; S.buscarMapa = false;
  S.resaltado = figura.id;
  irAlMapa();
  Mapa.enfocar([figura]);
  if (figura !== l) {
    avisar(`${l.codigo} está en la pila ${figura.codigo}. Se resalta la pila.`);
  }
  clearTimeout(ubicarEnMapa.temporizador);
  ubicarEnMapa.temporizador = setTimeout(() => { S.resaltado = null; refrescarMapa(); }, 4000);
}

function irAlMapa() {
  S.pestana = 'mapa';
  document.querySelectorAll('nav.pestanas button')
    .forEach((x) => x.setAttribute('aria-selected', String(x.dataset.t === 'mapa')));
  // El plano va de borde a borde, y esa clase es la que lo consigue.
  // Sin ponerla aquí, llegar al mapa desde Plataformas o desde "ver en el
  // mapa" lo dejaba metido dentro de los márgenes de la lista —encogido y
  // con barra de desplazamiento— hasta que la siguiente sincronización
  // pasaba por `pintar` y lo enderezaba. De ahí el "carga y se ajusta
  // solo a los pocos segundos".
  const m = $('#main');
  if (m) m.className = 'a-sangre';
  montarMapa();
}

function textoFiltro() {
  const f = S.mapaFiltro;
  if (f.campo === 'ninguno') return 'Filtrar';
  if (f.campo === 'proveedor')
    return S.proveedores.find((p) => p.id === f.valor)?.abreviatura || 'Filtro';
  if (f.campo === 'estado') return ESTADOS[f.valor];
  if (f.campo === 'material') return MATERIALES[f.valor];
  return f.valor;
}

// Lo que coincide se ve normal; lo demás se atenúa, no se esconde.
// La búsqueda y el filtro se acumulan: buscar dentro de un filtro puesto
// es lo que uno espera, no que el segundo borre al primero.
//
// El criterio va aparte de la lista sobre la que se aplica, porque se
// usa dos veces: sobre esta plataforma, para resaltar en el plano, y
// sobre las demás, para poder decir en cuál está lo que se busca.
const cumpleBusqueda = (l) => {
  const q = S.busquedaMapa.trim().toUpperCase();
  const f = S.mapaFiltro;
  // Solo por código. La pregunta que responde este buscador es "¿dónde
  // está el PG1042?"; buscar por volqueta ya lo hace el botón de
  // filtros de al lado, y teniéndolo ahí, aceptar placas aquí solo
  // servía para que un código tecleado a medias trajera lotes que no
  // se estaban buscando.
  if (q && !l.codigo.toUpperCase().includes(q)) return false;
  return f.campo === 'ninguno' ? true
    : f.campo === 'proveedor' ? l.proveedor_id === f.valor
    : f.campo === 'estado' ? l.estado === f.valor
    : f.campo === 'placa' ? placasDe(l).includes(f.valor)
    : f.campo === 'material' ? (l.material || 'granel') === f.valor
    : true;
};

const lotesQueCoinciden = () => {
  if (!S.busquedaMapa.trim() && S.mapaFiltro.campo === 'ninguno') return null;
  // Solo lo que está dibujado: resaltar un lote de otra plataforma no
  // serviría de nada, porque en este plano no se ve. Dónde está se dice
  // aparte, debajo del buscador.
  return misLotes().filter(cumpleBusqueda);
};

// Lo mismo, pero en las OTRAS plataformas, agrupado por plataforma.
//
// Buscar solo en el plano abierto contestaba "aquí no hay ninguno", que
// es verdad y no sirve: el lote existe, está a dos plataformas, y para
// dar con él había que ir abriéndolas una por una. Ahora se busca en el
// patio entero y se dice en cuál está, con un toque para ir.
//
// Solo con texto escrito. Con un filtro a secas —"devolución"— habría
// coincidencias en casi todas y el renglón estaría siempre puesto,
// diciendo lo que ya se sabe.
const coincidenEnOtras = () => {
  if (!S.busquedaMapa.trim()) return [];
  const porPlataforma = new Map();
  for (const l of S.lotes) {
    if (alimentado(l) || enEstaPlataforma(l) || !cumpleBusqueda(l)) continue;
    porPlataforma.set(l.plataforma_id, (porPlataforma.get(l.plataforma_id) || 0) + 1);
  }
  // En el orden de la pantalla de Plataformas, no en el que vinieran los
  // lotes: dos búsquedas seguidas tienen que dar la misma fila.
  return S.plataformas
    .filter((p) => porPlataforma.has(p.id))
    .map((p) => ({ id: p.id, nombre: p.nombre, cuantos: porPlataforma.get(p.id) }));
};

function calcularDestacados() {
  const encontrados = lotesQueCoinciden();
  if (!encontrados) return null;
  const ids = new Set(encontrados.map((l) => l.id));
  for (const p of S.pilas)
    if (S.lotes.some((l) => l.pila_id === p.id && ids.has(l.id))) ids.add(p.id);
  for (const g of S.figuras) ids.add(g.id);
  return ids;
}

// Un lote metido en una pila no se dibuja: lo que se ve es la pila. Y uno
// despachado o alimentado ya no está en el patio. Para encuadrar hay
// que traducir de lote a la figura que de verdad está en el plano.
function figurasEnElPlano(lotes) {
  const vistas = new Map();
  for (const l of lotes || []) {
    if (l.estado === 'despachado' || alimentado(l)) continue;
    const f = l.pila_id ? S.pilas.find((p) => p.id === l.pila_id && p.estado === 'abierta') : l;
    if (f) vistas.set(f.id, f);
  }
  return [...vistas.values()];
}

function panelFiltro() {
  const placas = [...new Set(misLotes().flatMap(placasDe))].sort();
  abrirHoja(`
    <h2>Filtrar el mapa</h2>
    <div class="sub">Lo que coincide se resalta; el resto queda atenuado.</div>

    <h3>Por proveedor</h3>
    <div class="filtros filtros-hoja">
      ${S.proveedores.map((p) => `<button data-campo="proveedor" data-valor="${p.id}"
        aria-pressed="${S.mapaFiltro.campo === 'proveedor' && S.mapaFiltro.valor === p.id}"
        >${esc(p.abreviatura)}</button>`).join('')}
    </div>

    <h3>Por estado</h3>
    <div class="filtros filtros-hoja">
      ${ESTADOS_ELEGIBLES.map((k) => `<button data-campo="estado" data-valor="${k}"
        aria-pressed="${S.mapaFiltro.campo === 'estado' && S.mapaFiltro.valor === k}"
        >${ESTADOS[k]}</button>`).join('')}
    </div>

    <h3>Por material</h3>
    <div class="filtros filtros-hoja">
      ${Object.entries(MATERIALES).map(([k, v]) => `<button data-campo="material" data-valor="${k}"
        aria-pressed="${S.mapaFiltro.campo === 'material' && S.mapaFiltro.valor === k}"
        >${v}</button>`).join('')}
    </div>

    <h3>Por volqueta</h3>
    <div class="filtros filtros-hoja">
      ${placas.length ? placas.map((pl) => `<button data-campo="placa" data-valor="${esc(pl)}"
        aria-pressed="${S.mapaFiltro.campo === 'placa' && S.mapaFiltro.valor === pl}"
        >${esc(pl)}</button>`).join('') : '<span class="pista">Todavía no hay placas registradas.</span>'}
    </div>

    <div class="acciones" style="margin-top:18px">
      <button id="cerrar">Cerrar</button>
      <button id="quitar-filtro" class="btn-lleno">Ver todo</button>
    </div>`);

  $('#cerrar').onclick = cerrarHoja;
  $('#quitar-filtro').onclick = () => {
    S.mapaFiltro = { campo: 'ninguno', valor: null };
    cerrarHoja(); volverAlMapa();
  };
  document.querySelectorAll('.filtros-hoja button').forEach((b) => {
    b.onclick = () => {
      S.mapaFiltro = { campo: b.dataset.campo, valor: b.dataset.valor };
      cerrarHoja(); volverAlMapa();
    };
  });
}

// Repinta el filtro del mapa sin perder el encuadre actual
function volverAlMapa() {
  actualizarChipFiltro();
  actualizarConteoBusqueda();
  refrescarMapa();
}

// --------------------------------------------------- buscar en el plano
// La pregunta que se hace alguien parado en el patio no es "¿cuáles hay
// por muestrear?" sino "¿DÓNDE está el PG1042?". El buscador de la lista
// no la responde: dice que existe, no dónde. Este escribe sobre el plano
// y el plano va hasta el lote.
function pintarBuscadorMapa() {
  const caja = $('#caja-buscar');
  if (!caja) return;
  if (!S.buscarMapa) { caja.innerHTML = ''; return; }
  caja.innerHTML = `
    <div class="buscar-mapa">
      ${ICO.lupa}
      <input id="q-mapa" data-mono inputmode="search" autocomplete="off"
             autocapitalize="characters" spellcheck="false"
             placeholder="Código del lote" value="${esc(S.busquedaMapa)}">
      <span class="conteo" id="q-conteo"></span>
      <button class="cerrar-buscar" id="q-cerrar" aria-label="Cerrar la búsqueda">${ICO.cerrar}</button>
    </div>
    <div class="otras-plat" id="q-otras"></div>`;

  const campo = $('#q-mapa');
  campo.oninput = () => {
    S.busquedaMapa = campo.value;
    actualizarConteoBusqueda();
    refrescarMapa();
    enfocarBusqueda();
  };
  // Enter no envía nada: solo quita el teclado, que en un celular tapa
  // media pantalla justo cuando se quiere mirar el plano.
  campo.onkeydown = (e) => { if (e.key === 'Enter') campo.blur(); };
  $('#q-cerrar').onclick = () => {
    S.buscarMapa = false; S.busquedaMapa = '';
    montarMapa(); volverAlMapa();
  };
  actualizarConteoBusqueda();
}

function actualizarConteoBusqueda() {
  const n = $('#q-conteo');
  if (!n) return;
  const aqui = S.busquedaMapa.trim() ? (lotesQueCoinciden() || []).length : 0;
  if (!S.busquedaMapa.trim()) { n.textContent = ''; n.dataset.vacio = 'no'; }
  else {
    n.textContent = aqui === 0 ? 'aquí no' : String(aqui);
    n.dataset.vacio = aqui === 0 ? 'si' : 'no';
  }
  pintarOtrasPlataformas(aqui);
}

// El renglón de "y en las demás está aquí". Cada plataforma con
// coincidencias es un botón que lleva hasta ella SIN perder lo escrito:
// se llega al otro plano con la búsqueda puesta y el lote ya encuadrado.
function pintarOtrasPlataformas(aqui) {
  const caja = $('#q-otras');
  if (!caja) return;
  const otras = coincidenEnOtras();
  if (!otras.length) { caja.innerHTML = ''; return; }
  caja.innerHTML = `<span class="rot">${aqui ? 'También en' : 'Está en'}</span>
    ${otras.map((o) => `<button data-plat="${o.id}">${esc(o.nombre)}
      <b>${o.cuantos}</b></button>`).join('')}`;
  for (const b of caja.querySelectorAll('button')) b.onclick = () => {
    irAPlataforma(b.dataset.plat);
    S.recorrido = null; S.historia = null;
    irAlMapa();               // remonta el plano; la búsqueda sigue puesta
    Mapa.encuadrar();
    enfocarBusqueda();        // y va hasta lo que se estaba buscando
  };
}

// El plano se mueve mientras se escribe. Con muchas coincidencias no
// encuadra: saltar de un extremo a otro del patio en cada letra marea y
// no ayuda; ahí basta con que lo demás quede atenuado.
function enfocarBusqueda() {
  if (!S.busquedaMapa.trim()) return;
  const figuras = figurasEnElPlano(lotesQueCoinciden());
  if (figuras.length && figuras.length <= 8) Mapa.enfocar(figuras);
}

function refrescarMapa() {
  if (S.pestana !== 'mapa' || !document.querySelector('#lienzo-caja')) return;
  // La sincronización sigue corriendo cada 20 segundos mientras se mira
  // otro día. Si repintara el patio de hoy encima, el plano daría un
  // salto al presente sin que nadie lo pidiera.
  if (S.historia) return pintarHistoria();
  Mapa.pintar({
    config: { ...S.config, ...(plataformaActual() || {}) },
    figuras: misFiguras(), pilas: misPilas(), lotes: misLotes(),
    destacados: calcularDestacados(), recorrido: S.recorrido, resaltado: S.resaltado,
    naciendo: S.naciendo
  });
}

// --------------------------------------------------- la volqueta descarga
// Un lote se registra una vez, y ese momento es el único que vale la pena
// celebrar: cambiar de estado pasa veinte veces al día y una escena ahí
// estorbaría. La escena va en una capa APARTE, encima del plano: el mapa
// se redibuja entero en cada sincronización y una animación metida dentro
// del SVG se cortaría a media descarga.
//
// Se puede saltar tocando la pantalla, y con `prefers-reduced-motion` no
// se reproduce: quien no quiera espectáculo no lo tiene.
const DURACION_VOLQUETA = 1700;   // ms; el lote real aparece a los 1080

function animarLlegada(lote) {
  // El sonido va lo primero: se oye aunque la escena no se dibuje —por
  // "reducir movimiento" o por estar en otra pestaña—, que es cuando más
  // sirve, porque no hay nada que mirar.
  sonar('volqueta');
  const caja = document.querySelector('.mapa-caja');
  const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Si no hay escena, el lote tiene que aparecer YA. Dejar `naciendo`
  // puesto lo escondería para siempre.
  if (!caja || sinMovimiento || S.pestana !== 'mapa') {
    S.naciendo = null; refrescarMapa();
    return Promise.resolve();
  }

  const v = Mapa.obtenerVista();
  const r = Math.max(lote.rx || 40, lote.ry || 40);
  const s = r / 40;                       // la volqueta crece con el lote
  const col = paletaActual()[lote.estado] || '#d99a06';

  // Entra y sale por fuera del encuadre, sea cual sea el zoom y esté el
  // lote donde esté: con una distancia fija, un lote pegado al borde
  // haría que la volqueta apareciera de la nada en mitad del patio. Se
  // mide desde el lote hasta cada borde, más el largo de la volqueta, y
  // en unidades del grupo —que va escalado—, no de pantalla.
  const largo = 200;
  const entra = (lote.x - v.x) / s + largo;
  const sale = (v.x + v.w - lote.x) / s + largo;

  const capa = document.createElement('div');
  capa.className = 'capa-volqueta';
  capa.style.setProperty('--entra', `${Math.round(entra)}px`);
  capa.style.setProperty('--sale', `${Math.round(sale)}px`);
  capa.innerHTML = `
    <svg viewBox="${v.x} ${v.y} ${v.w} ${v.h}" preserveAspectRatio="xMidYMid meet">
      <g transform="translate(${lote.x} ${lote.y}) scale(${s})">
        ${polvo()}
        ${terrones(col)}
        ${monton(col)}
        <g transform="translate(54 0)"><g class="vq-camion">${volqueta()}</g></g>
      </g>
    </svg>`;
  caja.appendChild(capa);

  return new Promise((listo) => {
    let acabado = false;
    const terminar = () => {
      if (acabado) return;
      acabado = true;
      clearTimeout(t1); clearTimeout(t2);
      capa.remove();
      if (S.naciendo) { S.naciendo = null; refrescarMapa(); }
      listo();
    };
    // el lote de verdad entra justo cuando el material termina de caer,
    // debajo del montón dibujado aquí: no hay salto, se relevan
    const t1 = setTimeout(() => { S.naciendo = null; refrescarMapa(); }, 1080);
    const t2 = setTimeout(terminar, DURACION_VOLQUETA);
    capa.onpointerdown = terminar;        // un toque la salta
  });
}

// Volqueta de perfil, en el lenguaje de los pictogramas de obra: filo
// negro, sin degradados. El origen (0,0) es el punto donde cae el
// material, o sea la esquina trasera del volco a ras de suelo.
//
// Lleva pistón, compuerta trasera y ruedas que ruedan. No es adorno: el
// pistón explica por qué sube el volco —sin él la caja bascula sola,
// como si la empujara el aire— y la compuerta explica por dónde sale el
// material.
const volqueta = () => `
  <g transform="translate(68 -34)"><g class="vq-piston">
    <line x1="0" y1="0" x2="-22" y2="-28" stroke="#14171a" stroke-width="6" stroke-linecap="round"/>
    <line x1="0" y1="0" x2="-22" y2="-28" stroke="#e9e5dc" stroke-width="3" stroke-linecap="round"/>
  </g></g>

  <g transform="translate(0 -34)"><g class="vq-volco">
    <path d="M2 0 L102 0 L94 -40 L4 -40 Z" fill="var(--amarillo)" stroke="#14171a"
          stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M22 -6 L20 -34 M42 -6 L40 -34 M62 -6 L60 -34 M82 -6 L80 -34"
          stroke="#14171a" stroke-width="2.5" opacity=".85"/>
    <path d="M12 -8 L90 -8" stroke="#14171a" stroke-width="3" stroke-dasharray="6 4"/>
    <path d="M12 -8 L90 -8" stroke="#ffffff" stroke-width="1.5" stroke-dasharray="6 4"/>
    <g class="vq-puerta">
      <path d="M2 0 L4 -40" stroke="#14171a" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M2 0 L4 -36" stroke="var(--amarillo)" stroke-width="2.5"/>
      <circle cx="4" cy="-40" r="3" fill="#14171a"/>
    </g>
  </g></g>

  <g transform="translate(108 -68)">
    <circle class="vq-humo" r="7" fill="#14171a" opacity=".4"/>
  </g>

  <path d="M-4 -34 L114 -34 L114 -22 L-4 -22 Z" fill="#14171a"/>
  <path d="M-2 -24 L-8 -12 L-2 -12 Z" fill="#14171a"/>

  <path d="M100 -34 L100 -68 L118 -76 L138 -76 L138 -22 L100 -22 Z"
        fill="var(--amarillo)" stroke="#14171a" stroke-width="3.5" stroke-linejoin="round"/>
  <path d="M108 -64 L116 -68 L130 -68 L130 -50 L108 -50 Z"
        fill="#e9e5dc" stroke="#14171a" stroke-width="2.5"/>
  <path d="M122 -65 L114 -53" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
  <path d="M104 -70 L122 -78" stroke="#14171a" stroke-width="3" stroke-linecap="round"/>
  <path d="M132 -34 L142 -34 L142 -22 L132 -22 Z" fill="#14171a"/>
  <path d="M138 -46 L138 -36" stroke="var(--amarillo)" stroke-width="3"/>
  <path d="M108 -58 L102 -58 L102 -48" fill="none" stroke="#14171a"
        stroke-width="2.5" stroke-linejoin="round"/>

  ${[24, 58, 122].map((x) => `<g transform="translate(${x} -15)"><g class="vq-rueda">
    <circle r="14.5" fill="#14171a"/>
    <circle r="7" fill="#e9e5dc" stroke="#14171a" stroke-width="2"/>
    <line x1="-5" y1="0" x2="5" y2="0" stroke="#14171a" stroke-width="2"/>
    <line x1="0" y1="-5" x2="0" y2="5" stroke="#14171a" stroke-width="2"/>
  </g></g>`).join('')}`;

// Los terrones que salen por detrás. Cada uno con su retardo, su sitio,
// su giro y su forma: cinco piedras iguales cayendo a la vez parecen una
// sola pieza bajando.
const terrones = (col) => [
  { dx:   6, dy:  -4, ret:   0, rot:   45, d: 'M-7 -5 L5 -8 L9 3 L-1 8 L-8 2 Z' },
  { dx: -24, dy:   8, ret:  50, rot:  110, d: 'M-9 -3 L3 -9 L10 2 L2 9 L-7 6 Z' },
  { dx:  20, dy:  14, ret:  90, rot:  -75, d: 'M-6 -6 L8 -4 L6 7 L-4 8 L-8 -1 Z' },
  { dx: -10, dy: -18, ret: 140, rot:  160, d: 'M-8 -2 L2 -8 L9 1 L4 9 L-6 5 Z' },
  { dx: -32, dy:  -2, ret: 180, rot: -120, d: 'M-6 -7 L6 -5 L8 5 L-2 7 L-9 1 Z' },
  { dx:  12, dy: -22, ret: 210, rot:   85, d: 'M-5 -5 L7 -3 L5 8 L-5 6 Z' }
].map((t) => `
  <g class="vq-terron" style="--dx:${t.dx}px; --dy:${t.dy}px; --rot:${t.rot}deg;
     animation-delay:${620 + t.ret}ms">
    <path d="${t.d}" fill="${esc(col)}" stroke="#14171a" stroke-width="2.2" stroke-linejoin="round"/>
  </g>`).join('');

// La polvareda de cuando el material pega contra el suelo.
const polvo = () => `
  <g transform="translate(-10 0)">
    <circle class="vq-polvo" style="--pdx:-35px; --pdy:-18px" cy="-5" r="14"
            fill="#e4e7e2" stroke="#14171a" stroke-width="2"/>
    <circle class="vq-polvo" style="--pdx:25px; --pdy:-22px; animation-delay:720ms" cy="-5" r="10"
            fill="#e4e7e2" stroke="#14171a" stroke-width="2"/>
  </g>`;

// El montón que queda. Es un CÍRCULO del radio del lote y tiene que
// seguir siéndolo: el plano se mira desde arriba, el lote es un círculo,
// y a los 1080 ms este se releva con él. Con forma de loma de perfil se
// vería el cambio de silueta. El relieve va por dentro, con una cresta
// que no toca el contorno.
const monton = (col) => `
  <g class="vq-monton">
    <circle r="40" fill="${esc(col)}" stroke="#14171a" stroke-width="2.5"/>
    <path d="M-26 8 C-16 -12, 2 -20, 14 -14 C24 -9, 30 0, 32 8" fill="none"
          stroke="#14171a" stroke-width="1.8" opacity=".35"/>
    <path d="M-14 20 C-6 10, 8 12, 18 20" fill="none"
          stroke="#14171a" stroke-width="1.6" opacity=".22"/>
  </g>`;

// ------------------------------------------------ los obreros muestrean
// Muestrear un lote es el paso que mueve el patio: hasta que no está
// muestreado no se puede facturar ni devolver nada. Se celebra con la
// cuadrilla trabajando: uno pala, el terrón le cae en el casco al de al
// lado, y el capataz mira desde su caja con el café.
//
// VA SIN FONDO —ni cielo, ni cerros, ni suelo— y es una decisión, no un
// recorte. El plano ya tiene el suyo, que puede ser la foto aérea del
// acopio: pintarle encima un paisaje de perfil taparía justo lo que se
// está mirando y se vería pegado con cinta. Quedan los muñecos, sus
// montones y sus sombras de contacto, que es lo que cuenta el chiste.
//
// El original traía además un topo asomándose por un agujero. Sin suelo
// no hay agujero del que asomarse, así que no está.
//
// Las coordenadas son las del dibujo original, con el suelo en y=250:
// tocarlas descuadraría el aparejo —la pala va soldada a las manos por
// jerarquía de pivotes— así que la escena entera se recoloca desde
// fuera, con un solo `translate`.
const SUELO_OBREROS = 250;
const CENTRO_OBREROS = 290;
const DURACION_OBREROS = 1600;   // ms; dos vueltas del gag de 800

// Un brazo o una pierna: el filo negro por debajo y el color encima, que
// es como se dibuja un miembro en este lenguaje.
const miembro = (d, gordo, fino) => `
  <path d="${d}" fill="none" stroke="#14171a" stroke-width="${gordo}" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${d}" fill="none" stroke="var(--traje)" stroke-width="${fino}" stroke-linecap="round" stroke-linejoin="round"/>`;

const obreroVictima = () => `
  <g transform="translate(120 ${SUELO_OBREROS})"><g class="ob-cuerpo-victima ob-art">
    <g class="ob-atras">
      ${miembro('M-10 -46 L-13 -22 L-13 -7', 13, 8)}
      <path d="M-23 -11 L-8 -11 L-8 0 L-25 0 Z" fill="#14171a" stroke="#14171a" stroke-width="2" stroke-linejoin="round"/>
    </g>
    <g class="ob-atras">
      ${miembro('M-7 -85 L-19 -72 L-15 -58', 9, 5.5)}
      <circle cx="-15" cy="-56" r="4.6" fill="var(--piel)" stroke="#14171a" stroke-width="2"/>
    </g>
    ${miembro('M8 -46 L12 -22 L12 -7', 13, 8)}
    <path d="M7 -11 L22 -11 L25 0 L7 0 Z" fill="#14171a" stroke="#14171a" stroke-width="2" stroke-linejoin="round"/>

    <path d="M-14 -44 L-15 -88 L15 -88 L13 -44 Z" fill="var(--traje)" stroke="#14171a" stroke-width="3" stroke-linejoin="round"/>
    <path d="M-12 -78 L12 -78 M-11.5 -62 L11 -62" stroke="#ffffff" stroke-width="5"/>
    <path d="M-12 -78 L12 -78 M-11.5 -62 L11 -62" stroke="#14171a" stroke-width="1" stroke-dasharray="2 2" opacity=".55"/>

    <g transform="translate(10 -85)"><g class="ob-brazo-balde ob-art">
      ${miembro('M0 0 L11 13 L12 25', 9, 5.5)}
      <g transform="translate(12 25)">
        <g class="ob-balde ob-art">
          <path d="M-11 9 Q0 -6 11 9" fill="none" stroke="#14171a" stroke-width="2.5" stroke-linecap="round"/>
          <path d="M-13 9 L13 9 L10 34 L-10 34 Z" fill="#10b981" stroke="#14171a" stroke-width="2.8" stroke-linejoin="round"/>
          <path d="M-12 16 L12 16" stroke="#14171a" stroke-width="1.6" opacity=".55"/>
          <path d="M-8 12 C-4 26, 4 26, 8 12" fill="var(--tierra)" opacity=".9"/>
        </g>
        <circle cy="1" r="5" fill="var(--piel)" stroke="#14171a" stroke-width="2"/>
      </g>
    </g></g>

    <g class="ob-polvo-golpe ob-art" transform="translate(0 -96)">
      <circle cx="-16" cy="2" r="12" fill="#cbd5e1" opacity=".55"/>
      <circle cx="16" cy="-3" r="10" fill="#cbd5e1" opacity=".55"/>
      <circle cy="-14" r="14" fill="#e2e8f0" opacity=".6"/>
    </g>

    <circle cx="1" cy="-101" r="11.5" fill="var(--piel)" stroke="#14171a" stroke-width="2.5"/>
    <g class="ob-cara">
      <circle cx="-3.5" cy="-104" r="1.9" fill="#14171a"/>
      <circle cx="5.5" cy="-104" r="1.9" fill="#14171a"/>
      <path d="M-3 -96 Q1.5 -93 6 -96" fill="none" stroke="#14171a" stroke-width="2" stroke-linecap="round"/>
    </g>
    <g class="ob-cara-ida" opacity="0">
      <path d="M-6.5 -107 L-1 -101 M-1 -107 L-6.5 -101" stroke="#14171a" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M3 -107 L8.5 -101 M8.5 -107 L3 -101" stroke="#14171a" stroke-width="2.2" stroke-linecap="round"/>
      <ellipse cx="1.5" cy="-95" rx="3.4" ry="3" fill="#14171a"/>
    </g>

    <g class="ob-estrellas ob-art" transform="translate(1 -134)">
      ${[0, -16, 16].map((x) => `<polygon transform="translate(${x} 0)"
        points="0,-6 2,-2 6,-2 3,1 4,5 0,3 -4,5 -3,1 -6,-2 -2,-2"
        fill="#facc15" stroke="#14171a" stroke-width="1"/>`).join('')}
    </g>

    <g transform="translate(1 -108)"><g class="ob-casco ob-art">
      <path d="M-14 0 C-14 -15, 14 -15, 14 0 Z" fill="var(--casco)" stroke="#14171a" stroke-width="2.8" stroke-linejoin="round"/>
      <line x1="-17.5" y1="0.5" x2="17.5" y2="0.5" stroke="#14171a" stroke-width="3" stroke-linecap="round"/>
    </g></g>

    <g transform="translate(34 -128)"><g class="ob-cartel ob-art">
      <polygon points="0,0 8,-8 4,-12 16,-12 12,-20 25,-15 22,-28 35,-20 30,-8 40,0 28,4 32,15 18,10 12,20 8,8"
               fill="#ef4444" stroke="#14171a" stroke-width="2" stroke-linejoin="round"/>
      <text x="19" y="-3" text-anchor="middle" font-family="var(--sans)" font-size="11"
            font-weight="800" fill="#ffffff">¡PLOF!</text>
    </g></g>
  </g></g>`;

const obreroPalero = () => `
  <g transform="translate(380 ${SUELO_OBREROS})"><g class="ob-cuerpo-palero ob-art">
    <g class="ob-atras">
      ${miembro('M10 -48 L18 -24 L19 -8', 14, 9)}
      <path d="M12 -12 L30 -12 L33 0 L12 0 Z" fill="#14171a" stroke="#14171a" stroke-width="2" stroke-linejoin="round"/>
    </g>
    ${miembro('M-8 -48 L-20 -26 L-22 -8', 14, 9)}
    <path d="M-36 -12 L-16 -12 L-16 0 L-38 0 Z" fill="#14171a" stroke="#14171a" stroke-width="2" stroke-linejoin="round"/>

    <path d="M-14 -46 L-24 -92 L6 -96 L14 -46 Z" fill="var(--traje)" stroke="#14171a" stroke-width="3" stroke-linejoin="round"/>
    <path d="M-18.5 -80 L6.5 -82.5 M-15 -64 L10 -65.5" stroke="#ffffff" stroke-width="5"/>
    <path d="M-18.5 -80 L6.5 -82.5 M-15 -64 L10 -65.5" stroke="#14171a" stroke-width="1" stroke-dasharray="2 2" opacity=".55"/>

    <circle cx="-14" cy="-107" r="11.5" fill="var(--piel)" stroke="#14171a" stroke-width="2.5"/>
    <circle cx="-19" cy="-108" r="2" fill="#14171a"/>
    <path d="M-24 -99 Q-19 -95 -13 -98" fill="none" stroke="#14171a" stroke-width="2" stroke-linecap="round"/>
    <path class="ob-sudor ob-art" d="M-26 -114 C-29 -121, -22 -121, -26 -114 Z" fill="#38bdf8" stroke="#14171a" stroke-width="1.2"/>
    <path d="M-27 -114 C-27 -129, 1 -129, 1 -114 Z" fill="var(--casco)" stroke="#14171a" stroke-width="2.8" stroke-linejoin="round"/>
    <line x1="-31" y1="-113.5" x2="5" y2="-113.5" stroke="#14171a" stroke-width="3" stroke-linecap="round"/>

    <g transform="translate(-8 -90)"><g class="ob-pala ob-art">
      <g class="ob-atras">${miembro('M4 -2 L5 10 L-12 12', 9, 5.5)}</g>
      <line x1="2" y1="2" x2="-56" y2="46" stroke="var(--madera)" stroke-width="6" stroke-linecap="round"/>
      <line x1="2" y1="2" x2="-56" y2="46" stroke="#14171a" stroke-width="1.2" stroke-dasharray="5 4" opacity=".55"/>
      <line x1="-2" y1="-3" x2="6" y2="7" stroke="var(--madera)" stroke-width="7" stroke-linecap="round"/>
      <line x1="-2" y1="-3" x2="6" y2="7" stroke="#14171a" stroke-width="1.4" opacity=".45"/>
      <path d="M-59 33 L-45 53 L-66 68 L-80 49 Z" fill="var(--metal)" stroke="#14171a" stroke-width="2.8" stroke-linejoin="round"/>
      <path d="M-56 42 L-68 58" stroke="#14171a" stroke-width="1.5" opacity=".5"/>
      <g class="ob-carga">
        <ellipse cx="-62" cy="51" rx="11" ry="6" transform="rotate(53 -62 51)" fill="var(--tierra)" stroke="#14171a" stroke-width="2"/>
      </g>
      ${miembro('M-5 0 L-20 16 L-32 27', 9, 5.5)}
      <circle cx="-12" cy="12" r="5" fill="var(--piel)" stroke="#14171a" stroke-width="2"/>
      <circle cx="-32" cy="27" r="5" fill="var(--piel)" stroke="#14171a" stroke-width="2"/>
    </g></g>
  </g></g>`;

const obreroJefe = () => `
  <g transform="translate(505 ${SUELO_OBREROS})"><g class="ob-cuerpo-jefe ob-art">
    <rect x="-24" y="-38" width="48" height="38" fill="#a16207" stroke="#14171a" stroke-width="2.8" rx="3"/>
    <line x1="-24" y1="-20" x2="24" y2="-20" stroke="#14171a" stroke-width="1.8" opacity=".8"/>
    <line x1="0" y1="-38" x2="0" y2="0" stroke="#14171a" stroke-width="1.5" opacity=".45"/>

    <g transform="translate(-2 -37)"><g class="ob-pierna-b ob-art ob-atras">
      ${miembro('M0 0 L-20 3 L-22 26', 13, 8)}
      <path d="M-32 24 L-16 24 L-16 33 L-34 33 Z" fill="#14171a" stroke="#14171a" stroke-width="2" stroke-linejoin="round"/>
    </g></g>
    <g transform="translate(-4 -36)"><g class="ob-pierna-a ob-art">
      ${miembro('M0 0 L-24 5 L-26 27', 13, 8)}
      <path d="M-37 25 L-20 25 L-20 34 L-39 34 Z" fill="#14171a" stroke="#14171a" stroke-width="2" stroke-linejoin="round"/>
    </g></g>
    <g transform="translate(8 -70)"><g class="ob-art ob-atras">
      ${miembro('M0 0 L14 12 L13 28', 9, 5.5)}
      <circle cx="13" cy="31" r="4.2" fill="var(--piel)" stroke="#14171a" stroke-width="2"/>
    </g></g>

    <path d="M-11 -36 L-13 -72 L13 -72 L11 -36 Z" fill="var(--traje)" stroke="#14171a" stroke-width="2.8" stroke-linejoin="round"/>
    <path d="M-10 -64 L10 -64 M-9.5 -50 L9.5 -50" stroke="#ffffff" stroke-width="4.5"/>
    <path d="M-2 -70 Q3 -62 6 -55" fill="none" stroke="#14171a" stroke-width="1.6"/>
    <circle cx="6" cy="-53" r="3" fill="var(--casco)" stroke="#14171a" stroke-width="1.4"/>

    <circle cy="-84" r="11.5" fill="var(--piel)" stroke="#14171a" stroke-width="2.5"/>
    <circle cx="-4.5" cy="-88" r="1.9" fill="#14171a"/>
    <circle cx="4.5" cy="-88" r="1.9" fill="#14171a"/>
    <path d="M-8 -81.5 Q-4 -85 0 -81.5 Q4 -85 8 -81.5 Q4 -79 0 -80.5 Q-4 -79 -8 -81.5 Z" fill="#14171a"/>
    <path d="M-3.5 -77 Q0 -74.5 3.5 -77" fill="none" stroke="#14171a" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M-14 -91 C-14 -106, 14 -106, 14 -91 Z" fill="#ffffff" stroke="#14171a" stroke-width="2.8" stroke-linejoin="round"/>
    <line x1="-17.5" y1="-90.5" x2="17.5" y2="-90.5" stroke="#14171a" stroke-width="3" stroke-linecap="round"/>

    <g transform="translate(-9 -70)"><g class="ob-brazo-cafe ob-art">
      ${miembro('M0 0 L-12 11 L-8 22', 9, 5.5)}
      <g transform="translate(-8 22)">
        <path class="ob-humo-cafe ob-art" d="M2 -10 Q7 -17 2 -24" fill="none" stroke="#e2e8f0" stroke-width="2.2" stroke-linecap="round"/>
        <circle cx="-2" r="4.6" fill="var(--piel)" stroke="#14171a" stroke-width="2"/>
        <path d="M0 -5 C-4 -5, -4 1, 0 1" fill="none" stroke="#14171a" stroke-width="2.2"/>
        <rect x="0" y="-8" width="11" height="12" fill="#ffffff" stroke="#14171a" stroke-width="2.2" rx="2"/>
        <rect x="1.5" y="-6.5" width="8" height="3" fill="#78350f"/>
      </g>
    </g></g>
  </g></g>`;

// La escena entera. El orden importa: primero las sombras, luego los
// montones de atrás, los muñecos, y al final el lóbulo de arena de
// delante —para que la hoja se hunda DENTRO del montón en vez de quedar
// flotando encima— y los terrones que vuelan por encima de todo.
const escenaObreros = () => `
  <g opacity=".28">
    <ellipse cx="122" cy="251" rx="34" ry="5"/>
    <ellipse cx="378" cy="251" rx="40" ry="5"/>
    <ellipse cx="505" cy="251" rx="34" ry="5"/>
  </g>

  <g transform="translate(92 ${SUELO_OBREROS})"><g class="ob-pila ob-art">
    <path d="M-46 0 C-36 -28, -10 -42, 14 -42 C34 -42, 48 -20, 54 0 Z"
          fill="var(--tierra)" stroke="#14171a" stroke-width="3" stroke-linejoin="round"/>
    <path d="M-26 -10 L-16 -23 L-6 -15" fill="none" stroke="var(--tierra-sombra)" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M4 -25 L17 -31 L27 -18" fill="none" stroke="var(--tierra-sombra)" stroke-width="2.5" stroke-linecap="round"/>
  </g></g>

  <g transform="translate(300 ${SUELO_OBREROS})">
    <path d="M-80 0 C-70 -34, -30 -52, 10 -52 C45 -52, 55 -30, 60 0 Z"
          fill="var(--tierra)" stroke="#14171a" stroke-width="3" stroke-linejoin="round"/>
    <path d="M-48 -16 C-34 -34, -8 -42, 14 -40" fill="none" stroke="var(--tierra-sombra)" stroke-width="3" stroke-linecap="round"/>
  </g>

  ${obreroVictima()}
  ${obreroJefe()}
  ${obreroPalero()}

  <g transform="translate(300 ${SUELO_OBREROS})">
    <path d="M-20 0 C-16 -26, 4 -38, 20 -36 C32 -35, 38 -16, 42 0 Z"
          fill="var(--tierra)" stroke="#14171a" stroke-width="3" stroke-linejoin="round"
          style="filter: brightness(1.12)"/>
    <path d="M-6 -14 L4 -25 L14 -16" fill="none" stroke="var(--tierra-sombra)" stroke-width="2.5" stroke-linecap="round"/>
  </g>

  <g transform="translate(316 212)"><g class="ob-polvo-cava ob-art">
    <circle cx="-10" r="9" fill="#e2e8f0" opacity=".5"/>
    <circle cx="8" cy="-4" r="7" fill="#e2e8f0" opacity=".5"/>
    <circle cy="-11" r="10" fill="#f1f5f9" opacity=".45"/>
  </g></g>

  <g transform="translate(304 116)">
    <g class="ob-terron-1 ob-art">
      <path d="M-10 -8 L8 -12 L12 6 L-2 12 L-12 2 Z" fill="var(--tierra)" stroke="#14171a" stroke-width="2.5" stroke-linejoin="round"/>
      <circle cx="-2" cy="-1" r="2.4" fill="var(--tierra-sombra)"/>
    </g>
    <g class="ob-terron-2 ob-art">
      <path d="M-6 -5 L6 -6 L8 4 L-1 7 L-7 1 Z" fill="var(--tierra)" stroke="#14171a" stroke-width="2" stroke-linejoin="round"/>
    </g>
  </g>`;

// Monta la escena sobre el lote y la quita al terminar.
//
// Mismas reglas que la volqueta: capa aparte encima del plano —el mapa
// se redibuja en cada sincronización y la cortaría a la mitad—, se salta
// tocando, y con "reducir movimiento" no se monta.
//
// La escena se dibuja con el suelo en y=250 y midiendo unos 500 de
// ancho. Se lleva encima del lote con un solo `translate` y se encoge a
// la mitad: a tamaño natural taparía medio patio. Como la volqueta,
// crece con el lote, así que en un lote grande la cuadrilla también es
// grande.
function animarMuestreo(lote) {
  const caja = document.querySelector('.mapa-caja');
  const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!caja || sinMovimiento || S.pestana !== 'mapa' || S.historia) return Promise.resolve();

  const v = Mapa.obtenerVista();
  const r = Math.max(lote.rx || 40, lote.ry || 40);
  // A tamaño natural la escena mide 500 de ancho y taparía medio patio;
  // a la mitad, la cara del que recibe el terronazo no se distingue en
  // un celular. 0,8 es donde el chiste se lee y el plano sigue viéndose.
  const s = (r / 40) * 0.8;

  const capa = document.createElement('div');
  capa.className = 'capa-obreros';
  capa.innerHTML = `
    <svg viewBox="${v.x} ${v.y} ${v.w} ${v.h}" preserveAspectRatio="xMidYMid meet">
      <g transform="translate(${lote.x} ${lote.y}) scale(${s})
                    translate(${-CENTRO_OBREROS} ${-SUELO_OBREROS})">
        ${escenaObreros()}
      </g>
    </svg>`;
  caja.appendChild(capa);

  // Los ruidos van con los fotogramas, no al bulto. Dentro de cada
  // vuelta de 800 ms: clava la pala al 15 %, la suelta al 57 %, el
  // terrón le llega al casco al 78 % y el casco rebota justo después.
  const relojes = [];
  for (const vuelta of [0, 800]) {
    relojes.push(ruidoEn('palada', vuelta + 120));
    relojes.push(ruidoEn('tiro', vuelta + 456));
    relojes.push(ruidoEn('golpe', vuelta + 624));
    relojes.push(ruidoEn('casco', vuelta + 664));
  }

  return new Promise((listo) => {
    let acabado = false;
    const terminar = () => {
      if (acabado) return;
      acabado = true;
      for (const t of relojes) clearTimeout(t);
      clearTimeout(fin);
      capa.remove();
      listo();
    };
    const fin = setTimeout(terminar, DURACION_OBREROS);
    capa.style.pointerEvents = 'auto';
    capa.onpointerdown = terminar;          // un toque la salta
  });
}

function barraEdicion() {
  $('#barra-forma').innerHTML = `
    <div class="barra-modo">
      <span>Modo edición · arrastra para mover; toca una figura para ver sus manijas de tamaño y giro</span>
      <button class="pastilla" id="salir-edicion">Salir</button>
    </div>`;
  $('#salir-edicion').onclick = () => { S.edicion = false; montarMapa(); };
}

function barraForma(tipo, obj) {
  const nombre = tipo === 'lote' ? obj.codigo
    : tipo === 'pila' ? `Pila ${obj.codigo}` : (obj.etiqueta || 'Figura');
  const ayuda = obj.forma === 'poligono'
    ? 'arrástrala para moverla; los vértices se mueven uno a uno, un “+” agrega y tocar un vértice lo quita'
    : 'arrástrala para moverla, el punto de la esquina es el tamaño y el de arriba el giro';
  $('#barra-forma').innerHTML = `
    <div class="barra-modo">
      <span>Ajustando <strong>${esc(nombre)}</strong> · ${ayuda}</span>
      <button class="pastilla" id="forma-listo">Listo</button>
    </div>`;
  $('#forma-listo').onclick = () => {
    Mapa.limpiarSeleccion();
    if (S.edicion) barraEdicion(); else $('#barra-forma').innerHTML = '';
  };
}

// Abre la frase, así que va en mayúscula: escrito en medio obligaba a
// contraer "de el" en "del" según el tipo, y salía "de el lote PG1042".
// El título usa el código, que no tiene género, para no tener que
// concordar "dejarlo" con "dejarla" según sea lote o pila.
const nombreDeFigura = (tipo, o) =>
  tipo === 'lote' ? `El lote ${o.codigo}`
  : tipo === 'pila' ? `La pila ${o.codigo}`
  : 'La figura del fondo';

// Soltar un lote sobre otro arma una pila; sobre una pila, lo mete.
// Las dos cosas escriben un evento que NO se puede borrar, así que las
// dos preguntan. Si se cancela, el lote vuelve a donde estaba.
async function manejarSoltar(lote, blanco, antes) {
  if (soloLectura()) return refrescarMapa();
  const volver = () => Mapa.deshacerGeom('lote', lote.id, antes);

  if (blanco.tipo === 'pila') {
    const ok = await confirmar({
      titulo: `¿Meter ${lote.codigo} en la pila ${blanco.obj.codigo}?`,
      detalle: 'Queda registrado en el historial del lote y en el de la pila.',
      aceptar: 'Meterlo'
    });
    if (!ok) return volver();
    await Store.guardarFigura('lotes', { ...lote });
    await Store.registrarEvento({
      lote_id: lote.id, tipo: 'ingreso_pila', pila_id: blanco.obj.id, usuario_id: S.perfil.id
    });
    await recargar(); sincronizar();
    return;
  }

  const okPila = await confirmar({
    titulo: `¿Armar una pila con ${lote.codigo} y ${blanco.obj.codigo}?`,
    detalle: 'Se crea una pila nueva con los dos lotes dentro y queda en el historial de ambos.',
    aceptar: 'Armar la pila'
  });
  if (!okPila) return volver();

  const otro = blanco.obj;
  const cx = (lote.x + otro.x) / 2, cy = (lote.y + otro.y) / 2;
  const codigo = siguienteCodigoPila();
  const pila = await Store.crearPila({
    codigo, tipo: 'otro', nota: null, x: cx, y: cy,
    rx: Math.max(lote.rx, otro.rx) + 46, ry: Math.max(lote.ry, otro.ry) + 34,
    plataforma_id: S.plataforma, usuario_id: S.perfil.id
  });
  for (const l of [otro, lote]) {
    await Store.registrarEvento({
      lote_id: l.id, tipo: 'ingreso_pila', pila_id: pila.id, usuario_id: S.perfil.id
    });
  }
  await recargar(); sincronizar();
  fichaPila(pila.id);
}

// Un acomodo de medio metro no es un traslado: solo cuenta si la figura
// dejó de traslaparse con donde estaba.
async function anotarRecorrido(lote, origen) {
  if (!Mapa.movimientoReal(lote, origen)) return;
  const previos = (await Store.historial(lote.id)).filter((e) => e.tipo === 'movimiento');
  if (!previos.length) {
    await Store.registrarEvento({
      lote_id: lote.id, tipo: 'movimiento', x: origen.x, y: origen.y, usuario_id: S.perfil.id
    });
  }
  await Store.registrarEvento({
    lote_id: lote.id, tipo: 'movimiento', x: lote.x, y: lote.y, usuario_id: S.perfil.id
  });
}

// El número libre más bajo, contando SOLO las pilas abiertas. Una pila
// archivada ya no se ve en el plano y suelta su número: si no, con tres
// pilas en el patio la siguiente ya se llamaba "4", y en un año, "40".
function siguienteCodigoPila() {
  const usados = S.pilas
    .filter((p) => p.estado === 'abierta' && p.plataforma_id === S.plataforma)
    .map((p) => parseInt(p.codigo, 10)).filter((n) => !isNaN(n));
  let n = 1;
  while (usados.includes(n)) n++;
  return String(n);
}

// ------------------------------------------------------------------ lista
function pintarLista() {
  const prov = Object.fromEntries(S.proveedores.map((p) => [p.id, p.abreviatura]));
  const pilas = Object.fromEntries(S.pilas.map((p) => [p.id, p.codigo]));
  const q = S.busqueda.trim().toUpperCase();
  // La lista es de TODAS las plataformas a propósito: es donde se viene a
  // buscar un lote que no se sabe dónde está. Cada tarjeta dice en cuál.
  //
  // Los alimentados ya no están en el patio: para el contratista
  // desaparecen, y el admin los sigue viendo porque de eso se trata la
  // trazabilidad.
  const alcance = S.lotes.filter(seVeEnLaLista);
  const conteo = (e) => alcance.filter((l) => l.estado === e).length;
  const nVenc = alcance.filter(vencido).length;

  const visibles = alcance.filter((l) => {
    if (S.filtro === 'vencidas') { if (!vencido(l)) return false; }
    else if (S.filtro !== 'todos' && l.estado !== S.filtro) return false;
    return !q || l.codigo.includes(q) || (pilas[l.pila_id] || '').includes(q);
  }).sort((a, b) => (b.ultimo_evento_en || '').localeCompare(a.ultimo_evento_en || ''));

  $('#main').innerHTML = `
    <input class="buscador" id="q" placeholder="Buscar lote o pila…" value="${esc(S.busqueda)}">
    <div class="filtros">
      <button data-f="todos" aria-pressed="${S.filtro === 'todos'}">Todos · ${alcance.length}</button>
      ${nVenc ? `<button data-f="vencidas" aria-pressed="${S.filtro === 'vencidas'}">Sin recoger · ${nVenc}</button>` : ''}
      ${Object.entries(ESTADOS).filter(([k]) => conteo(k)).map(([k, v]) =>
        `<button data-f="${k}" aria-pressed="${S.filtro === k}">${v} · ${conteo(k)}</button>`).join('')}
    </div>
    <div class="lista">
      ${visibles.length ? visibles.map((l) => tarjeta(l, prov, pilas)).join('')
        : `<div class="vacio"><strong>No hay lotes que coincidan</strong>
             ${alcance.length ? 'Cambia el filtro o la búsqueda.' : 'Agrega el primero desde el mapa.'}</div>`}
    </div>`;

  const q_ = $('#q');
  q_.oninput = () => {
    S.busqueda = q_.value; pintarLista();
    const n = $('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length);
  };
  document.querySelectorAll('.filtros button').forEach((b) => {
    b.onclick = () => { S.filtro = b.dataset.f; pintarLista(); };
  });
  document.querySelectorAll('.lote').forEach((c) => { c.onclick = () => fichaLote(c.dataset.id); });
}

// La tarjeta tiene DOS columnas, y cada una responde a una pregunta
// distinta: la izquierda es "cuál es este lote" —código, proveedor,
// volqueta, cuánto lleva— y la derecha "dónde y cómo está" —estado,
// plataforma, pila—.
//
// La plataforma estaba a la izquierda, en un renglón para ella sola, y
// era el cuarto de la columna: cuatro renglones apretados a un lado y el
// estado solo al otro. Contesta a "dónde está", así que su sitio es
// debajo del estado, y de paso la izquierda se queda en dos renglones.
function tarjeta(l, prov, pilas) {
  const v = vencido(l), r = textoRecogida(l), d = dias(l.estado_desde);
  return `<button class="lote" data-id="${l.id}" data-estado="${l.estado}" data-vencida="${v ? 'si' : 'no'}">
    <span class="barra"></span>
    <span class="cuerpo">
      <span class="codigo">${codigoHTML(l.codigo)}</span>
      <span class="meta">
        <span>${esc(prov[l.proveedor_id] || '—')}</span>
        ${l.placa ? `<span>${esc(placasTexto(l))}</span>` : ''}
        <span class="dias" data-alerta="${v ? 'si' : 'no'}">${r || (d === 0 ? 'hoy' : `hace ${d} d`)}</span>
        ${alimentado(l) ? `<span class="dias">alimentado${
          l.punto_id ? ` por ${esc(nombrePunto(l.punto_id))}` : ''}</span>` : ''}
      </span>
    </span>
    <span class="lado">
      <span class="etiqueta" data-e="${l.estado}">${ESTADOS[l.estado]}</span>
      ${S.plataformas.length > 1
        ? `<span class="plat-tag">${esc(nombrePlataforma(l.plataforma_id))}</span>` : ''}
      ${l.pila_id ? `<span class="pila-tag">Pila ${esc(pilas[l.pila_id] || '?')}</span>` : ''}
      ${l._rechazado ? '<span class="sin-subir" data-error="si">rechazado</span>'
        : S.idsPendientes.has(l.id) ? '<span class="sin-subir">sin subir</span>' : ''}
    </span>
  </button>`;
}

// ----------------------------------------------------------------- hojas
function avisar(texto) {
  abrirHoja(`<h2>Aviso</h2><p class="sub">${esc(texto)}</p>
    <button class="btn btn-lleno btn-ancho" id="ok" style="width:100%;margin-top:16px">Entendido</button>`);
  $('#ok').onclick = cerrarHoja;
}

// `fijo` es el encabezado que NO se desplaza: de quién es la ficha y en
// qué estado está. En una ficha larga se llegaba al historial sin nada en
// pantalla que dijera de qué lote se estaba hablando, y el estado y la
// fecha de recogida —justo lo que uno va a mirar— habían quedado cinco
// pantallas arriba. Quien no lo necesite lo deja vacío y la hoja se
// comporta igual que siempre.
function abrirHoja(html, fijo = '') {
  // En la pantalla de ingreso todavía no existe el contenedor, y un aviso
  // no puede tumbar la app por no tener dónde ponerse.
  let m = $('#modal');
  if (!m) { m = document.createElement('div'); m.id = 'modal'; document.body.appendChild(m); }
  // La equis va aquí y no en cada hoja: el botón de cerrar vivía al final
  // del todo, así que en una ficha con historial largo había que bajar
  // hasta abajo para salir. Quien abra una hoja la tiene sin hacer nada.
  // Si hay encabezado fijo, viaja dentro de él; si no, se pega sola.
  const equis = `<button class="cerrar-hoja" id="x-hoja" aria-label="Cerrar">${ICO.cerrar}</button>`;
  m.innerHTML = `<div class="velo"><div class="hoja">
    ${fijo ? `<div class="hoja-fija">${equis}${fijo}</div>` : equis}
    ${html}</div></div>`;
  $('#x-hoja').onclick = cerrarHoja;
  $('.velo').onclick = (e) => { if (e.target === $('.velo')) cerrarHoja(); };
}
const cerrarHoja = () => { const m = $('#modal'); if (m) m.innerHTML = ''; };

async function panelRechazados() {
  // Primero la causa, después lo que solo la está esperando. Al revés, la
  // lista arranca con diez errores prestados y esconde el único que
  // alguien puede arreglar.
  const malos = (await Store.fallidos())
    .sort((a, b) => (a.creado_en || '').localeCompare(b.creado_en || ''));
  const NOMBRE = { lotes: 'lote', pilas: 'pila', eventos: 'movimiento',
                   mapa_figuras: 'figura del fondo', mapa_config: 'fondo del mapa' };
  abrirHoja(`
    <h2>Cambios no aceptados</h2>
    <div class="sub">El servidor rechazó estos cambios. Quedan guardados aquí para no perderlos.</div>
    <ul class="linea-tiempo">
      ${malos.map((m) => `<li>
        <div class="cuando">${new Date(m.creado_en).toLocaleString('es-CO')} · ${NOMBRE[m.tabla] || m.tabla}</div>
        <div class="que">${esc(m.error)}</div>
        ${m.detalle && m.detalle !== m.error ? `<div class="nota">${esc(m.detalle)}</div>` : ''}</li>`).join('')}
    </ul>
    <p class="pista">Siguen en pantalla marcados como “sin subir”. Corregida la causa —suele ser
       la primera de la lista— Reintentar los vuelve a mandar en el mismo orden en que se
       registraron, primero el lote y detrás lo que dependa de él.</p>
    <div class="acciones">
      <button id="reintentar" class="btn-lleno btn-ancho">Reintentar</button>
      <button id="cerrar">Cerrar</button>
      <button id="olvidar" class="btn-peligro">Descartar</button>
    </div>`);
  $('#cerrar').onclick = cerrarHoja;
  $('#reintentar').onclick = accion(async () => {
    await Store.reintentarFallidos(); cerrarHoja(); await sincronizar();
  }, { ocupado: 'Reintentando…' });
  $('#olvidar').onclick = accion(async () => {
    if (!confirm(`Se descartan ${malos.length} cambio${malos.length === 1 ? '' : 's'} que el servidor no aceptó. No se pueden recuperar. ¿Continuar?`)) return;
    await Store.olvidarFallidos(); cerrarHoja(); await recargar();
  }, { ocupado: 'Descartando…' });
}

function menuCuenta() {
  abrirHoja(`
    <h2>${esc(S.perfil.nombre)}</h2>
    <div class="sub">${S.perfil.rol === 'admin' ? 'Administrador'
      : S.perfil.rol === 'empresa' ? 'Solo lectura' : 'Contratista'}</div>
    ${puedeExportar() ? `
    <h3>Informe</h3>
    <button class="btn btn-ancho" id="informe" style="width:100%">Listado de lotes para Excel</button>
    <p class="pista">Todos los lotes del patio, con su estado, proveedor, volqueta,
       material, pila y observaciones, en un archivo que abre en Excel.</p>` : ''}
    <h3>Avisos</h3>
    <button class="btn btn-ancho" id="mudo" style="width:100%"
      >${S.mudo ? 'Activar los sonidos' : 'Silenciar los sonidos'}</button>
    <p class="pista">La volqueta al registrar un lote y el timbre al llegar una tarea.
       ${S.mudo ? 'Ahora están apagados.' : 'La vibración no se toca.'}</p>

    <h3>Sesión</h3>
    <div class="acciones">
      <button id="cerrar">Volver</button>
      <button id="salir" class="btn-peligro">Cerrar sesión</button>
    </div>`);
  $('#cerrar').onclick = cerrarHoja;
  $('#mudo').onclick = () => {
    S.mudo = !S.mudo;
    recordar('acopio-mudo', S.mudo ? '1' : '0');
    if (!S.mudo) sonar('tarea', .6);     // para oír que ya suena
    menuCuenta();
  };
  // Traer las observaciones del servidor tarda un momento; el botón lo
  // dice en vez de quedarse mudo.
  if (puedeExportar()) $('#informe').onclick = accion(panelInforme, { ocupado: 'Contando lotes…' });
  // Cerrar sesión borra TODO lo del celular, incluida la cola: es lo
  // correcto, porque lo que sigue pendiente es de esta persona y el
  // siguiente que entre no puede subirlo con su nombre. Pero antes de
  // borrar hay que intentar subirlo, que casi siempre es lo que falta.
  $('#salir').onclick = accion(async () => {
    if (S.pendientes > 0 || S.rechazados > 0) {
      await sincronizar();
      if (S.pendientes > 0 || S.rechazados > 0) return confirmarSalida();
    }
    await Store.salir();
    location.reload();
  }, { ocupado: 'Subiendo lo pendiente…' });
}

// ------------------------------------------------------- informe a Excel
// Las columnas del archivo. Están aquí y no dentro de la función que lo
// arma para que se lea de un vistazo qué lleva el informe: es lo primero
// que alguien va a querer cambiar.
const COLUMNAS_INFORME = [
  { clave: 'codigo',     titulo: 'Código',            ancho: 14 },
  { clave: 'proveedor',  titulo: 'Proveedor',         ancho: 28 },
  { clave: 'estado',     titulo: 'Estado',            ancho: 15 },
  { clave: 'plataforma', titulo: 'Plataforma',        ancho: 16 },
  { clave: 'punto',      titulo: 'Alimentado por',    ancho: 16 },
  { clave: 'cuandoAlim', titulo: 'Fecha alimentado',  ancho: 18 },
  { clave: 'diasEstado', titulo: 'Días en el estado', ancho: 16 },
  { clave: 'ingreso',    titulo: 'Fecha de ingreso',  ancho: 16 },
  { clave: 'diasPatio',  titulo: 'Días en el patio',  ancho: 16 },
  { clave: 'volqueta',   titulo: 'Volqueta',          ancho: 12 },
  { clave: 'material',   titulo: 'Material',          ancho: 11 },
  { clave: 'enPila',     titulo: '¿En pila?',         ancho: 11 },
  { clave: 'pila',       titulo: 'Pila',              ancho: 14 },
  { clave: 'recogida',   titulo: 'Fecha de recogida', ancho: 17 },
  { clave: 'nota',       titulo: 'Observaciones',     ancho: 60 }
];

// Días entre dos fechas sueltas ("2026-07-28"). No se usa `dias()`: ese
// espera una marca de tiempo y al pasarle una fecha a secas la corre un
// día en nuestro huso, porque la lee como medianoche UTC.
const diasEntreFechas = (desde) =>
  desde ? Math.round((Date.parse(hoyISO()) - Date.parse(desde)) / 86_400_000) : '';

function filasDelInforme(notas) {
  const prov = Object.fromEntries(S.proveedores.map((p) => [p.id, p.nombre]));
  const pilas = Object.fromEntries(S.pilas.map((p) => [p.id, p.codigo]));
  return S.lotes
    .slice()
    .sort((a, b) => (a.codigo || '').localeCompare(b.codigo || '', 'es', { numeric: true }))
    .map((l) => ({
      codigo: l.codigo,
      proveedor: prov[l.proveedor_id] || '',
      estado: ESTADOS[l.estado] || l.estado,
      diasEstado: l.estado_desde ? dias(l.estado_desde) : '',
      ingreso: l.fecha_recepcion || '',
      diasPatio: diasEntreFechas(l.fecha_recepcion),
      plataforma: nombrePlataforma(l.plataforma_id),
      punto: l.punto_id ? nombrePunto(l.punto_id) : '',
      cuandoAlim: l.alimentado_en ? fechaLocal(l.alimentado_en) : '',
      volqueta: placasTexto(l, ' / '),
      material: MATERIALES[l.material || 'granel'],
      enPila: l.pila_id ? 'Sí' : 'No',
      pila: l.pila_id ? (pilas[l.pila_id] || '') : '',
      // la recogida solo compromete mientras el lote sea devolución
      recogida: enDevolucion(l) ? (l.fecha_recogida || '') : '',
      nota: notas.get(l.id) || ''
    }));
}

async function panelInforme() {
  const { notas, completo } = await Store.observaciones();
  const filas = filasDelInforme(notas);
  const porEstado = Object.entries(ESTADOS)
    .map(([k, v]) => [v, S.lotes.filter((l) => l.estado === k).length])
    .filter(([, n]) => n);

  abrirHoja(`
    <div class="sub">Todos los lotes del patio, tal como están en este momento.</div>
    <h3>Lo que va en el archivo</h3>
    <div class="resumen">
      <div><strong>${filas.length}</strong><span>lote${filas.length === 1 ? '' : 's'}</span></div>
      ${porEstado.map(([v, n]) => `<div><strong>${n}</strong><span>${esc(v)}</span></div>`).join('')}
    </div>
    <p class="pista">Una fila por lote y una columna por dato:
       ${COLUMNAS_INFORME.map((c) => c.titulo.toLowerCase()).join(', ')}.</p>
    ${completo ? '' : `<p class="aviso">Sin señal para traer las observaciones del servidor.
       Las del archivo son solo las que ya estaban en este celular; el resto de columnas
       sí van completas.</p>`}
    <button class="btn btn-lleno btn-ancho" id="bajar" style="width:100%;margin-top:6px">
      Descargar para Excel</button>
    <button class="btn btn-ancho" id="cerrar" style="width:100%;margin-top:10px">Volver</button>`,
    '<h2 class="pregunta">Listado de lotes</h2>');

  // "Volver" vuelve al menú, no cierra: se entró desde ahí.
  $('#cerrar').onclick = menuCuenta;
  $('#bajar').onclick = accion(async () => {
    // La carga se hace aquí y no al abrir la hoja: en un patio con 900
    // lotes armar el archivo tarda lo suyo, y no hay por qué pagarlo
    // quien solo entró a mirar el resumen.
    const Excel = await import('./excel.js');
    Excel.descargar(Excel.construir(COLUMNAS_INFORME, filas, 'Lotes'),
      `acopio-lotes-${hoyISO()}.xlsx`);
    cerrarHoja();
  }, { ocupado: 'Armando el archivo…' });
}

// Un `confirm()` del navegador se acepta sin leerlo. Si de verdad se va a
// perder el trabajo del día, que cueste un toque deliberado.
function confirmarSalida() {
  const n = S.pendientes + S.rechazados;
  abrirHoja(`
    <h2>Todavía hay ${n} cambio${n === 1 ? '' : 's'} sin subir</h2>
    <div class="sub">No se pudieron subir al servidor y solo existen en este celular.
      Si cierras sesión ahora se pierden y no hay forma de recuperarlos.</div>
    <p class="pista">La causa habitual es falta de señal. Si el servidor los está rechazando,
      el detalle está en la franja roja.</p>
    <div class="acciones" style="margin-top:16px">
      <button id="quedarse" class="btn-lleno btn-ancho">Quedarme y esperar señal</button>
      <button id="salir-igual" class="btn-peligro">Salir y perderlos</button>
    </div>`);
  $('#quedarse').onclick = cerrarHoja;
  $('#salir-igual').onclick = accion(async () => {
    await Store.salir();
    location.reload();
  }, { ocupado: 'Cerrando…' });
}

async function fichaLote(id) {
  const l = await Store.lote(id);
  if (!l) return;
  const prov = S.proveedores.find((p) => p.id === l.proveedor_id);
  const pila = S.pilas.find((p) => p.id === l.pila_id);
  const eventos = await Store.historial(id);
  const r = textoRecogida(l);
  const lectura = soloLectura();

  // De quién es la ficha, en qué estado está y para cuándo se recoge: eso
  // se queda arriba, y todo lo demás pasa por debajo.
  const encabezado = `
    <h2>${codigoHTML(l.codigo)}</h2>
    <div class="sub">${esc(prov?.nombre || '—')} · ${MATERIALES[l.material || 'granel']}
      · ${placasDe(l).length > 1 ? 'volquetas' : 'volqueta'} ${esc(placasTexto(l) || '—')} · recibido ${esc(l.fecha_recepcion)}</div>
    <div class="fila-chips">
      <span class="etiqueta" data-e="${l.estado}">${ESTADOS[l.estado]}</span>
      <span class="dias">${dias(l.estado_desde) === 0 ? 'desde hoy' : `hace ${dias(l.estado_desde)} días`}</span>
      ${pila ? `<span class="pila-tag">Pila ${esc(pila.codigo)}</span>` : ''}
    </div>
    ${r ? `<div class="dias" data-alerta="${vencido(l) ? 'si' : 'no'}" style="margin:6px 0 0">
             Recogida ${esc(l.fecha_recogida)} · ${esc(r)}</div>` : ''}`;

  abrirHoja(`
    <button class="btn btn-ancho btn-ubicar" id="ver-en-mapa" style="width:100%;margin-top:10px">
      ${ICO.diana}<span>Ver en el mapa</span></button>

    ${lectura ? '' : `
    <h3>Cambiar estado</h3>
    <div class="acciones">
      ${ESTADOS_ELEGIBLES.filter((k) => k !== l.estado)
        .map((k) => `<button data-estado="${k}">${ESTADOS[k]}</button>`).join('')}
    </div>

    ${esAdmin() && enDevolucion(l) ? `
    <h3>${l.fecha_recogida ? 'Cambiar fecha de recogida' : 'Fecha de recogida'}</h3>
    <div class="acciones">
      <input type="date" id="f-recogida" value="${l.fecha_recogida || hoyISO(DIAS_RECOGIDA_SUGERIDOS)}">
      <button id="programar">${l.fecha_recogida ? 'Actualizar' : 'Programar'}</button>
    </div>
    <p class="pista">El compromiso de recogida lo fija y lo cambia solo el administrador,
       aunque cualquiera pueda declarar la devolución.</p>` : ''}

    ${lectura || S.plataformas.length < 2 ? '' : `
    <h3>Plataforma</h3>
    <button class="btn btn-ancho" id="mover-plat" style="width:100%"
      >Está en ${esc(nombrePlataforma(l.plataforma_id))} · mover a otra</button>
    ${pila ? '<p class="pista">Va dentro de una pila: para moverlo con toda la pila, hazlo desde la ficha de la pila.</p>' : ''}`}

    ${pila ? `<h3>Pila</h3>
      <button class="btn btn-ancho" id="sacar" style="width:100%">Sacar de la pila ${esc(pila.codigo)}</button>`
      : `<h3>Tipo de material</h3>
      <div class="acciones">
        ${Object.entries(MATERIALES).map(([k, v]) =>
          `<button data-material="${k}" ${(l.material || 'granel') === k ? 'class="btn-lleno"' : ''}>${v}</button>`).join('')}
      </div>

      <h3>Forma en el mapa</h3>
      <div class="acciones">
        <button id="editar-forma">Ajustar forma</button>
        <button id="poligono">${l.forma === 'poligono' ? 'Volver a la forma simple' : 'Dibujar a mano'}</button>
      </div>
      <p class="pista">"Dibujar a mano" convierte el lote en un polígono: arrastras cada vértice, agregas puntos con los “+” y los quitas tocándolos.</p>

      <h3>Recorrido</h3>
      <button class="btn btn-ancho" id="ver-recorrido" style="width:100%">Ver recorrido</button>
      <p class="pista">Cada traslado real queda registrado solo. Acomodarlo unos metros sobre el mismo sitio no cuenta.</p>`}

    ${esAdmin() ? `
    <h3>Corregir datos</h3>
    <div class="campo">
      <label for="a-cod">Código</label>
      <input id="a-cod" data-mono value="${esc(l.codigo)}">
    </div>
    ${cajaPlacas('a-placa', l.placa)}
    <div class="campo">
      <label for="a-prov">Proveedor</label>
      <select id="a-prov">
        ${S.proveedores.map((p) => `<option value="${p.id}" ${p.id === l.proveedor_id ? 'selected' : ''}
          >${esc(p.abreviatura)} · ${esc(p.nombre)}</option>`).join('')}
      </select>
    </div>
    <button class="btn btn-guardar btn-ancho" id="a-guardar" style="width:100%">Guardar corrección</button>` : ''}

    <h3>Observación</h3>
    <div class="campo"><textarea id="nota" rows="2" placeholder="Qué se observó en el lote"></textarea></div>
    <button class="btn btn-guardar btn-ancho" id="guardar-nota" style="width:100%">Guardar observación</button>`}

    <h3>Historial</h3>
    ${Store.historialCompleto(eventos) ? '' : `<p class="aviso">Falta señal para traer la parte
       más antigua de este historial. Lo que se ve abajo está completo de ahí en adelante.</p>`}
    <ul class="linea-tiempo">
      ${eventos.map((e) => `<li>
        <div class="cuando">${new Date(e.ocurrido_en).toLocaleString('es-CO')} · ${esc(quien(e.usuario_id))}</div>
        <div class="que">${textoEvento(e)}</div>
        ${e.nota ? `<div class="nota">${esc(e.nota)}</div>` : ''}</li>`).join('')}
    </ul>
    <button class="btn btn-ancho" id="cerrar" style="width:100%;margin-top:10px">Cerrar</button>`,
    encabezado);

  $('#cerrar').onclick = cerrarHoja;
  $('#ver-en-mapa').onclick = () => { cerrarHoja(); ubicarEnMapa(l); };
  if (lectura) return;

  const mp = $('#mover-plat');
  if (mp) mp.onclick = () => hojaTrasladar({
    titulo: `Mover ${l.codigo}`,
    detalle: `Está en ${nombrePlataforma(l.plataforma_id)}. Su estado y su pila no cambian: `
      + 'solo cambia de patio, y queda apuntado en su historial.',
    desde: l.plataforma_id,
    alSoltar: async (id) => {
      await Store.trasladarLote(l.id, id, S.perfil.id);
      cerrarHoja(); await recargar(); pintar(); sincronizar();
    }
  });

  document.querySelectorAll('.hoja .acciones button[data-estado]').forEach((b) => {
    b.onclick = accion(async () => {
      if (b.dataset.estado === 'devolucion') return pedirRecogida(l);
      // Alimentar no es solo un estado: hay que decir POR DÓNDE entró,
      // que es lo que se consulta después en el informe.
      if (b.dataset.estado === 'alimentado') return pedirPunto(l);
      // Un cambio de estado es un evento, y los eventos no se borran: la
      // única forma de corregirlo es otro evento encima. Se pregunta.
      const ok = await confirmar({
        titulo: `¿Pasar ${l.codigo} a ${ESTADOS[b.dataset.estado]}?`,
        detalle: `Estado actual: ${ESTADOS[l.estado]}. El cambio queda en el historial y no se puede borrar.`,
        aceptar: 'Cambiar el estado'
      });
      if (!ok) return fichaLote(id);
      await Store.registrarEvento({
        lote_id: id, tipo: 'cambio_estado', estado_nuevo: b.dataset.estado, usuario_id: S.perfil.id
      });
      cerrarHoja(); await recargar(); sincronizar();
      // Muestrear es el paso que destraba el lote: hasta que no está
      // muestreado no se puede facturar ni devolver nada. Es el único
      // cambio de estado que se celebra, y por lo mismo que la volqueta
      // —si cada uno de los veinte cambios del día trajera escena,
      // estorbarían todas. Va DESPUÉS de guardar: la escena no puede
      // retrasar el apunte, solo ocupa la espera que ya había.
      if (b.dataset.estado === 'muestreado') {
        const fresco = (await Store.lote(id)) || l;
        if (enEstaPlataforma(fresco)) await animarMuestreo(fresco);
      }
    }, { ocupado: 'Cambiando…' });
  });

  const prog = $('#programar');
  if (prog) prog.onclick = accion(async () => {
    const f = $('#f-recogida').value; if (!f) return;
    await Store.registrarEvento({
      lote_id: id, tipo: 'programar_recogida', fecha_recogida: f, usuario_id: S.perfil.id
    });
    cerrarHoja(); await recargar(); sincronizar();
  });

  const sacar = $('#sacar');
  if (sacar) sacar.onclick = accion(async () => {
    const ok = await confirmar({
      titulo: `¿Sacar ${l.codigo} de la pila ${pila.codigo}?`,
      detalle: 'Vuelve al patio, junto a la pila. Si la pila queda con un solo lote se disuelve sola.',
      aceptar: 'Sacarlo'
    });
    if (!ok) return fichaLote(id);
    await sacarDePila(l, pila);
    cerrarHoja(); await recargar(); sincronizar();
  }, { ocupado: 'Sacando…' });

  document.querySelectorAll('.hoja button[data-material]').forEach((b) => {
    b.onclick = accion(async () => {
      const material = b.dataset.material;
      const cambios = { material };
      // si estaba dibujado a mano se respeta; si no, toma la figura del material
      if (l.forma !== 'poligono') {
        cambios.forma = FORMA_DE[material];
        if (cambios.forma === 'elipse') Object.assign(cambios, aCirculo(l));
      }
      await Store.actualizarLote(l.id, cambios);
      cerrarHoja(); await recargar(); sincronizar();
    });
  });

  const pol = $('#poligono');
  if (pol) pol.onclick = accion(async () => {
    const vuelta = FORMA_DE[l.material || 'granel'];
    const cambios = l.forma === 'poligono'
      ? { forma: vuelta, ...(vuelta === 'elipse' ? aCirculo(l) : {}) }
      : { forma: 'poligono', puntos: l.puntos?.length >= 3 ? l.puntos : Mapa.puntosPorDefecto(l.rx, l.ry) };
    await Store.actualizarLote(l.id, cambios);
    cerrarHoja(); await recargar(); sincronizar();
    abrirEdicion('lote', { ...l, ...cambios });
  });

  montarPlacas('a-placa');
  const ef = $('#editar-forma');
  if (ef) ef.onclick = () => { cerrarHoja(); abrirEdicion('lote', l); };

  const ver = $('#ver-recorrido');
  if (ver) ver.onclick = async () => {
    const puntos = (await Store.historial(l.id))
      .filter((e) => e.tipo === 'movimiento' && e.x != null)
      .sort((a, b) => a.ocurrido_en.localeCompare(b.ocurrido_en))
      .map((e) => ({ x: Number(e.x), y: Number(e.y) }));
    puntos.push({ x: l.x, y: l.y });
    if (puntos.length < 2) {
      avisar('Este lote no se ha trasladado todavía, así que no hay recorrido que mostrar.');
      return;
    }
    S.recorrido = puntos;
    cerrarHoja();
    irAlMapa();
  };

  const ag = $('#a-guardar');
  if (ag) ag.onclick = accion(async () => {
    const codigo = $('#a-cod').value.trim().toUpperCase();
    if (!codigo) return;
    await Store.actualizarLote(l.id, {
      codigo, placa: leerPlacas('a-placa'), proveedor_id: $('#a-prov').value
    });
    await Store.registrarEvento({
      lote_id: l.id, tipo: 'renombrado',
      nota: `Datos corregidos por ${S.perfil.nombre}`, usuario_id: S.perfil.id
    });
    cerrarHoja(); await recargar(); sincronizar();
  });

  $('#guardar-nota').onclick = accion(async () => {
    const n = $('#nota').value.trim(); if (!n) return;
    await Store.registrarEvento({ lote_id: id, tipo: 'observacion', nota: n, usuario_id: S.perfil.id });
    cerrarHoja(); await recargar(); sincronizar();
  });
}

// Al salir de la pila el lote vuelve al mapa, junto a ella.
// No repinta ni sincroniza: quien la llame decide cuándo, UNA vez. Antes
// lo hacía aquí dentro, así que vaciar una pila de cinco lotes disparaba
// cinco relecturas de toda la base y cinco sincronizaciones seguidas.
async function sacarDePila(l, pila, { revisar = true } = {}) {
  const a = Math.random() * Math.PI * 2;
  const x = (pila?.x ?? l.x) + Math.cos(a) * ((pila?.rx ?? 80) + 70);
  const y = (pila?.y ?? l.y) + Math.sin(a) * ((pila?.ry ?? 60) + 60);
  await Store.guardarFigura('lotes', { ...l, x, y });
  await Store.registrarEvento({ lote_id: l.id, tipo: 'salida_pila', usuario_id: S.perfil.id });
  if (revisar && pila) await revisarPila(pila);
}

// Una pila de un solo lote no es una pila, y una vacía solo estorba:
// en ambos casos se disuelve sola y se archiva.
async function revisarPila(pila) {
  const dentro = (await Store.lotes()).filter((x) => x.pila_id === pila.id);
  if (dentro.length > 1) return;
  for (const q of dentro) await sacarDePila(q, pila, { revisar: false });
  await Store.renombrarPila(pila.id, { estado: 'consumida' });
}

// Por dónde entró el material a la planta. La lista la maneja el
// administrador desde la base, así que si mañana hay una tolva más, sale
// aquí sola.
function pedirPunto(l) {
  if (!S.puntos.length) {
    return avisar('No hay puntos de alimentación configurados todavía. '
      + 'Se añaden en la tabla `puntos_alimentacion`.');
  }
  abrirHoja(`
    <div class="sub">¿Por dónde se alimentó?</div>
    <div class="acciones acciones-plat" id="pt-lista">
      ${S.puntos.map((x) => `<button class="btn btn-ancho" data-id="${x.id}"
        >${esc(x.nombre)}</button>`).join('')}
    </div>
    <p class="pista">El lote deja de verse en el plano, pero no se borra: queda su
       historial completo y en el informe sale por dónde y cuándo se alimentó.</p>
    <div class="acciones"><button id="pt-cancelar">Cancelar</button></div>`,
    `<h2>${codigoHTML(l.codigo)} · alimentado</h2>`);
  $('#pt-cancelar').onclick = () => fichaLote(l.id);
  for (const b of document.querySelectorAll('#pt-lista button'))
    b.onclick = accion(async () => {
      await Store.registrarEvento({
        lote_id: l.id, tipo: 'cambio_estado', estado_nuevo: 'alimentado',
        punto_id: b.dataset.id, usuario_id: S.perfil.id
      });
      cerrarHoja(); await recargar(); pintar(); sincronizar();
    }, { ocupado: 'Guardando…' });
}

function pedirRecogida(l) {
  abrirHoja(`
    <h2>${codigoHTML(l.codigo)} · devolución</h2>
    <div class="sub">¿Hasta qué día tiene el proveedor para recoger el material?</div>
    <div class="campo" style="margin-top:14px">
      <label for="r-fecha">Fecha de recogida</label>
      <!-- Sin tope por abajo. Estaba cerrado a partir de hoy, y eso daba
           por hecho que el compromiso se apunta el mismo día en que se
           toma. En el patio no pasa: se declara la devolución de un lote
           cuyo plazo se acordó —o se venció— hace semanas, y el
           calendario no dejaba ni elegir el día. Una fecha pasada es un
           dato correcto: quiere decir que ya va con retraso, y la app lo
           enseña como tal. -->
      <input type="date" id="r-fecha" value="${hoyISO(DIAS_RECOGIDA_SUGERIDOS)}">
    </div>
    <div class="campo">
      <label for="r-nota">Motivo</label>
      <textarea id="r-nota" rows="2" placeholder="Opcional"></textarea>
    </div>
    <div class="acciones">
      <button id="r-cancelar">Cancelar</button>
      <button id="r-guardar" class="btn-lleno">Marcar devolución</button>
    </div>`);
  $('#r-cancelar').onclick = () => fichaLote(l.id);
  $('#r-guardar').onclick = accion(async () => {
    const f = $('#r-fecha').value; if (!f) return;
    await Store.registrarEvento({
      lote_id: l.id, tipo: 'cambio_estado', estado_nuevo: 'devolucion',
      fecha_recogida: f, nota: $('#r-nota').value.trim() || null, usuario_id: S.perfil.id
    });
    cerrarHoja(); await recargar(); sincronizar();
  });
}

const quien = (id) => S.gente.find((g) => g.id === id)?.nombre || 'alguien';

function textoEvento(e) {
  const p = S.pilas.find((x) => x.id === e.pila_id);
  switch (e.tipo) {
    case 'recepcion': return 'Recibido en acopio';
    case 'cambio_estado': return `Pasó a ${ESTADOS[e.estado_nuevo] || e.estado_nuevo}` +
      (e.fecha_recogida ? ` · recoge el ${e.fecha_recogida}` : '');
    case 'programar_recogida': return `Recogida fijada para el ${e.fecha_recogida}`;
    case 'ingreso_pila': return `Entró a la pila ${p?.codigo || '?'}`;
    case 'salida_pila': return 'Salió de la pila';
    case 'observacion': return 'Observación';
    case 'movimiento': return 'Se marcó su posición en el patio';
    case 'renombrado': return 'Se corrigieron los datos del lote';
    default: return e.tipo;
  }
}

async function fichaPila(id) {
  const p = S.pilas.find((x) => x.id === id); if (!p) return;
  const dentro = S.lotes.filter((l) => l.pila_id === id);
  const movs = await Store.historialPila(id);
  const prov = Object.fromEntries(S.proveedores.map((x) => [x.id, x.abreviatura]));
  const lectura = soloLectura();

  const encabezado = `
    <h2>Pila ${esc(p.codigo)}</h2>
    <div class="sub">${TIPOS_PILA[p.tipo] || p.tipo} · ${dentro.length} lote${dentro.length === 1 ? '' : 's'}</div>`;

  abrirHoja(`
    ${lectura ? '' : `
    <h3>Datos de la pila</h3>
    <div class="campo">
      <label for="p-cod">Nombre</label>
      <input id="p-cod" data-mono value="${esc(p.codigo)}">
    </div>
    <div class="campo">
      <label for="p-tipo">Destino</label>
      <select id="p-tipo">
        ${Object.entries(TIPOS_PILA).map(([k, v]) =>
          `<option value="${k}" ${k === p.tipo ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </div>
    <button class="btn btn-guardar btn-ancho" id="guardar-pila" style="width:100%">Guardar</button>`}

    ${lectura ? '' : `
    <h3>Forma en el mapa</h3>
    <div class="acciones">
      <button id="pila-ajustar">Ajustar forma</button>
      <button id="pila-poligono">${p.forma === 'poligono' ? 'Volver al óvalo' : 'Dibujar a mano'}</button>
    </div>
    <p class="pista">La pila crece con el material: ajústala para que en el mapa se parezca a como quedó realmente.</p>

    <h3>Destino</h3>
    <div class="acciones">
      ${S.plataformas.length > 1 ? `<button id="a-plataforma" class="btn-lleno btn-ancho"
        >Mover la pila a otra plataforma</button>` : ''}
      <button id="archivar-pila" class="btn-ancho btn-peligro">Quitar la pila del mapa</button>
    </div>
    <p class="pista">Moverla se lleva la pila entera con sus ${dentro.length} lote${
      dentro.length === 1 ? '' : 's'}: siguen dentro y con el estado que tengan, solo cambian de patio.
      Quitarla del mapa devuelve los lotes al patio y la archiva; su historial se conserva.</p>`}

    <h3>Lotes en esta pila</h3>
    <div class="lista">
      ${dentro.length ? dentro.map((l) => `
        <div class="fila-pila">
          <button class="lote" data-id="${l.id}" data-estado="${l.estado}" data-vencida="${vencido(l) ? 'si' : 'no'}">
            <span class="barra"></span>
            <span class="cuerpo"><span class="codigo">${codigoHTML(l.codigo)}</span>
              <span class="meta"><span>${esc(prov[l.proveedor_id] || '—')}</span>
              <span>${esc(placasTexto(l))}</span></span></span>
            <span class="lado"><span class="etiqueta" data-e="${l.estado}">${ESTADOS[l.estado]}</span></span>
          </button>
          ${lectura ? '' : `<button class="pastilla" data-sacar="${l.id}">Sacar</button>`}
        </div>`).join('')
        : '<div class="vacio"><strong>Pila vacía</strong>Arrastra lotes sobre ella en el mapa.</div>'}
    </div>
    <h3>Movimientos de la pila</h3>
    <ul class="linea-tiempo">
      ${movs.length ? movs.map((e) => `<li>
        <div class="cuando">${new Date(e.ocurrido_en).toLocaleString('es-CO')} · ${esc(quien(e.usuario_id))}</div>
        <div class="que">${e.tipo === 'ingreso_pila' ? 'Entró' : 'Salió'}
          ${esc(S.lotes.find((x) => x.id === e.lote_id)?.codigo || 'un lote')}</div></li>`).join('')
        : '<li><div class="nota">Sin movimientos registrados.</div></li>'}
    </ul>

    <button class="btn btn-ancho" id="cerrar" style="width:100%;margin-top:14px">Cerrar</button>`,
    encabezado);

  $('#cerrar').onclick = cerrarHoja;
  document.querySelectorAll('.hoja .lote').forEach((c) => { c.onclick = () => fichaLote(c.dataset.id); });
  document.querySelectorAll('.hoja [data-sacar]').forEach((b) => {
    b.onclick = accion(async (ev) => {
      ev.stopPropagation();
      const l = await Store.lote(b.dataset.sacar);
      const ok = await confirmar({
        titulo: `¿Sacar ${l.codigo} de la pila ${p.codigo}?`,
        detalle: 'Vuelve al patio, junto a la pila.',
        aceptar: 'Sacarlo'
      });
      if (!ok) return fichaPila(id);
      await sacarDePila(l, p);
      cerrarHoja(); await recargar(); sincronizar();
    }, { ocupado: '…' });
  });
  const pa = $('#pila-ajustar');
  if (pa) pa.onclick = () => { cerrarHoja(); abrirEdicion('pila', p); };

  const pp = $('#pila-poligono');
  if (pp) pp.onclick = accion(async () => {
    const cambios = p.forma === 'poligono'
      ? { forma: 'elipse' }
      : { forma: 'poligono', puntos: p.puntos?.length >= 3 ? p.puntos : Mapa.puntosPorDefecto(p.rx, p.ry) };
    await Store.renombrarPila(id, cambios);
    cerrarHoja(); await recargar(); sincronizar();
    abrirEdicion('pila', { ...p, ...cambios });
  });

  // Antes esto decía "Llevar a plataforma 5" y ponía a todos los lotes en
  // un ESTADO llamado así. Ahora Plataforma 5 es un sitio con su propio
  // plano, así que la pila se mueve de verdad: entera, con sus lotes
  // dentro y con el estado que cada uno tenga.
  const ap = $('#a-plataforma');
  if (ap) ap.onclick = () => hojaTrasladar({
    titulo: `Mover la pila ${p.codigo}`,
    detalle: `Está en ${nombrePlataforma(p.plataforma_id)} con ${dentro.length} lote${
      dentro.length === 1 ? '' : 's'} dentro. Se va entera: nadie sale de la pila `
      + 'y nadie cambia de estado.',
    desde: p.plataforma_id,
    alSoltar: async (destino) => {
      await Store.trasladarPila(id, destino, S.perfil.id);
      cerrarHoja(); await recargar(); pintar(); sincronizar();
    }
  });

  const arch = $('#archivar-pila');
  if (arch) arch.onclick = accion(async () => {
    const ok = await confirmar({
      titulo: `¿Quitar la pila ${p.codigo} del mapa?`,
      detalle: `Sus ${dentro.length} lote${dentro.length === 1 ? '' : 's'} vuelven al patio. La pila se archiva: su historial se conserva, pero deja de verse en el plano.`,
      aceptar: 'Quitarla', peligro: true
    });
    if (!ok) return fichaPila(id);
    for (const l of dentro) await sacarDePila(l, p, { revisar: false });
    await Store.renombrarPila(id, { estado: 'consumida' });
    cerrarHoja(); await recargar(); sincronizar();
  }, { ocupado: 'Quitando…' });

  const g = $('#guardar-pila');
  if (g) g.onclick = accion(async () => {
    await Store.renombrarPila(id, {
      codigo: $('#p-cod').value.trim().toUpperCase() || p.codigo,
      tipo: $('#p-tipo').value
    });
    cerrarHoja(); await recargar(); sincronizar();
  });
}

// ----------------------------------------------------------- formularios
// El proveedor elegido de entrada. Si la abreviatura configurada ya no
// existe en la tabla, no se rompe nada: cae al primero de la lista.
const proveedorPorDefecto = () =>
  S.proveedores.find((p) => p.abreviatura === PROVEEDOR_POR_DEFECTO) || S.proveedores[0];

function formLote() {
  const c = Mapa.centroVista();
  const porDefecto = proveedorPorDefecto();
  abrirHoja(`
    <h2>Nuevo lote</h2>
    <div class="campo">
      <label for="f-prov">Proveedor</label>
      <select id="f-prov">
        ${S.proveedores.map((p) => `<option value="${p.id}" ${p.id === porDefecto?.id ? 'selected' : ''}
          >${esc(p.abreviatura)} · ${esc(p.nombre)}</option>`).join('')}
      </select>
    </div>
    <div class="campo">
      <label for="f-num">Número de lote</label>
      <div class="con-sigla">
        <span id="f-sigla">${esc(porDefecto?.abreviatura || '')}</span>
        <input id="f-num" data-mono inputmode="numeric" autocomplete="off">
      </div>
    </div>
    ${cajaPlacas('f-placa')}
    <div class="campo">
      <label>Tipo de material</label>
      <div class="acciones">
        <button type="button" id="fm-granel" class="btn-lleno">Granel</button>
        <button type="button" id="fm-bigbag">Bigbag</button>
      </div>
    </div>
    <p id="f-error" class="aviso" hidden></p>
    <div class="acciones">
      <button id="f-cancelar">Cancelar</button>
      <button id="f-guardar" class="btn-lleno">Poner en el mapa</button>
    </div>`);
  let material = 'granel';
  const sigla = () => S.proveedores.find((p) => p.id === $('#f-prov').value)?.abreviatura || '';
  $('#f-prov').onchange = () => { $('#f-sigla').textContent = sigla(); };
  const elegirMaterial = (m) => {
    material = m;
    $('#fm-granel').classList.toggle('btn-lleno', m === 'granel');
    $('#fm-bigbag').classList.toggle('btn-lleno', m === 'bigbag');
  };
  montarPlacas('f-placa');
  $('#fm-granel').onclick = () => elegirMaterial('granel');
  $('#fm-bigbag').onclick = () => elegirMaterial('bigbag');

  $('#f-cancelar').onclick = cerrarHoja;
  const falla = (t) => { const e = $('#f-error'); if (e) { e.hidden = false; e.textContent = t; } };
  $('#f-guardar').onclick = accion(async () => {
    $('#f-error').hidden = true;
    const num = $('#f-num').value.trim().toUpperCase();
    const placa = leerPlacas('f-placa');
    const proveedor_id = $('#f-prov').value;
    const codigo = sigla() + num;
    if (!num) return falla('Escribe el número del lote.');
    if (!placa) return falla('La placa de la volqueta es obligatoria.');
    // sin proveedor el servidor rechaza el lote y todo lo que cuelgue de
    // él; es preferible pararlo aquí que dejarlo trabado en la cola
    if (!proveedor_id) return falla('No hay proveedores cargados todavía. Sincroniza antes de registrar el lote.');
    if (S.lotes.some((l) => l.codigo === codigo)) return falla(`El lote ${codigo} ya está registrado.`);
    const nuevo = await Store.crearLote({
      codigo, proveedor_id, placa,
      // el lote nace donde estás parado: para meter uno en Ye se abre el
      // plano de Ye y se le da a "Nuevo lote" allí
      plataforma_id: S.plataforma,
      material, forma: FORMA_DE[material],
      x: c.x + (Math.random() - 0.5) * 90, y: c.y + (Math.random() - 0.5) * 70,
      usuario_id: S.perfil.id
    });
    // el lote ya está guardado y subiendo; la escena no retrasa nada, solo
    // ocupa la espera que de todos modos había
    S.naciendo = nuevo.id;
    cerrarHoja(); await recargar(); sincronizar();
    await animarLlegada(nuevo);
  }, { ocupado: 'Poniendo…', alFallar: (e) => falla(`No se pudo guardar el lote: ${e?.message || e}`) });
}

// ------------------------------------------------------- fondo (admin)
const paletaActual = () => ({ ...Mapa.COLORES_BASE, ...(S.config?.colores || {}) });

function panelFondo() {
  // El tamaño, el color y la imagen son de ESTA plataforma. Los colores
  // de los estados, en cambio, son de la empresa y valen para las cinco.
  const plat = plataformaActual();
  if (!plat) return avisar('Todavía no hay plataformas cargadas. Sincroniza y vuelve a intentarlo.');
  const c = { ...S.config, ...plat };
  abrirHoja(`
    <h2>Fondo del mapa</h2>
    <div class="sub">Estás editando el plano de <strong>${esc(plat.nombre)}</strong>.
      Cada plataforma tiene el suyo; los colores de abajo sí son de todas.</div>

    <h3>Tamaño del patio</h3>
    <div class="campo">
      <label for="c-ancho">Ancho (de izquierda a derecha)</label>
      <input id="c-ancho" type="number" min="200" step="50" value="${Number(c.ancho)}">
    </div>
    <div class="campo">
      <label for="c-alto">Alto (de arriba a abajo)</label>
      <input id="c-alto" type="number" min="200" step="50" value="${Number(c.alto)}">
    </div>
    <p class="pista">Actualmente ${Number(c.ancho)} × ${Number(c.alto)}. Son unidades del plano, no metros:
       lo que importa es la proporción respecto al patio real.</p>

    <h3>Color</h3>
    <div class="campo"><input type="color" id="c-color" value="${c.color_fondo || '#e4e7e2'}"></div>

    <h3>Imagen de fondo</h3>
    <div class="campo">
      <input type="file" id="c-img" accept="image/*">
      <p class="pista">Una foto aérea o el plano del acopio. Se ajusta al tamaño del patio.</p>
    </div>
    ${c.imagen_url ? `
    <div class="campo">
      <label for="c-op">Transparencia</label>
      <input type="range" id="c-op" min="0.15" max="1" step="0.05" value="${c.imagen_opacidad ?? 1}">
    </div>
    <button class="btn btn-ancho" id="quitar-img" style="width:100%">Quitar imagen</button>` : ''}

    <h3>Colores</h3>
    <div class="rejilla-color">
      ${[['por_muestrear', 'Por muestrear'], ['muestreado', 'Muestreado'],
         ['remuestreo', 'Remuestreo'], ['facturado', 'Facturado'],
         ['devolucion', 'Devolución'], ['alimentado', 'Alimentado'],
         ['despachado', 'Despachado'],
         ['pila_alimentacion', 'Pila · alimentación'], ['pila_devolucion', 'Pila · devolución'],
         ['pila_espera', 'Pila · espera'], ['pila_otro', 'Pila · otro']]
        .map(([k, etq]) => `<label class="color-item">
          <input type="color" data-color="${k}" value="${paletaActual()[k]}">
          <span>${etq}</span></label>`).join('')}
    </div>
    <button class="btn btn-ancho" id="colores-base" style="width:100%">Volver a los colores originales</button>

    <h3>Figuras</h3>
    <div class="acciones">
      <button id="add-rect">+ Rectángulo</button>
      <button id="add-elipse">+ Óvalo</button>
    </div>
    <p class="pista">Para dibujar la caseta, la vía, los límites. Mantén presionada una figura en el mapa para estirarla o girarla.</p>

    <div class="acciones" style="margin-top:18px">
      <button id="cerrar">Cerrar</button>
      <button id="guardar-fondo" class="btn-guardar">Guardar</button>
    </div>
    <p id="fondo-error" class="aviso" hidden></p>`);

  $('#cerrar').onclick = cerrarHoja;

  const agregar = (forma) => accion(async () => {
    const c2 = Mapa.centroVista();
    await Store.guardarFigura('mapa_figuras', {
      id: Store.uuid(), forma, etiqueta: null, plataforma_id: S.plataforma,
      x: c2.x, y: c2.y, rx: forma === 'rectangulo' ? 110 : 80, ry: 70, rot: 0,
      color: '#c7cdc5', orden: misFiguras().length
    });
    cerrarHoja(); await recargar(); sincronizar();
  }, { ocupado: 'Agregando…' });
  $('#add-rect').onclick = agregar('rectangulo');
  $('#add-elipse').onclick = agregar('elipse');

  const quitar = $('#quitar-img');
  if (quitar) quitar.onclick = accion(async () => {
    await Store.guardarPlataforma({ ...plat, imagen_url: null });
    cerrarHoja(); await recargar(); sincronizar();
  }, { ocupado: 'Quitando…' });

  $('#colores-base').onclick = accion(async () => {
    await Store.guardarConfig({ ...S.config, colores: { ...Mapa.COLORES_BASE } });
    cerrarHoja(); await recargar(); sincronizar();
  }, { ocupado: 'Restaurando…' });

  $('#guardar-fondo').onclick = accion(async () => {
    const colores = { ...paletaActual() };
    document.querySelectorAll('[data-color]').forEach((i) => { colores[i.dataset.color] = i.value; });
    // Dos cosas distintas y a dos sitios distintos: la paleta a la
    // configuración de la empresa, y el plano a esta plataforma.
    const cfg = {
      ancho: Number($('#c-ancho').value) || 1000,
      alto: Number($('#c-alto').value) || 700,
      color_fondo: $('#c-color').value,
      imagen_opacidad: $('#c-op') ? Number($('#c-op').value) : (plat.imagen_opacidad ?? 1)
    };
    const archivo = $('#c-img').files[0];
    if (archivo) {
      try {
        cfg.imagen_url = await Store.subirImagenFondo(archivo);
        cfg.imagen_x = 0; cfg.imagen_y = 0;
        cfg.imagen_ancho = cfg.ancho; cfg.imagen_alto = cfg.alto;
      } catch (e) {
        const p = $('#fondo-error');
        p.hidden = false;
        p.textContent = 'La imagen necesita señal para subir. Guarda el resto ahora y súbela cuando tengas internet.';
        return;
      }
    }
    await Store.guardarConfig({ ...S.config, colores });
    await Store.guardarPlataforma({ ...plat, ...cfg });
    cerrarHoja(); await recargar(); refrescarMapa(); Mapa.encuadrar(); sincronizar();
  }, { alFallar: (e) => {
    const p = $('#fondo-error');
    if (p) { p.hidden = false; p.textContent = `No se pudo guardar: ${e?.message || e}`; } else decirError(e);
  } });
}

function fichaFigura(id) {
  const f = S.figuras.find((x) => x.id === id); if (!f) return;
  abrirHoja(`
    <h2>Figura del fondo</h2>
    <div class="campo">
      <label for="g-etq">Etiqueta</label>
      <input id="g-etq" value="${esc(f.etiqueta || '')}" placeholder="Caseta, vía, portería…">
    </div>
    <div class="campo">
      <label for="g-color">Color</label>
      <input type="color" id="g-color" value="${f.color}">
    </div>
    <h3>Forma</h3>
    <div class="acciones">
      <button id="g-ajustar">Ajustar forma</button>
      <button id="g-poligono">${f.forma === 'poligono' ? 'Volver a la forma simple' : 'Dibujar a mano'}</button>
      <button id="g-rect" ${f.forma === 'rectangulo' ? 'class="btn-lleno"' : ''}>Rectángulo</button>
      <button id="g-elipse" ${f.forma === 'elipse' ? 'class="btn-lleno"' : ''}>Óvalo</button>
    </div>
    <p class="pista">Igual que los lotes: arrastra para mover, ajusta el tamaño con el punto de la esquina y gira con el de arriba.</p>

    <div class="acciones" style="margin-top:16px">
      <button id="g-borrar" class="btn-peligro">Borrar</button>
      <button id="g-guardar" class="btn-guardar">Guardar</button>
    </div>
    <button class="btn btn-ancho" id="cerrar" style="width:100%;margin-top:8px">Cancelar</button>`);
  $('#cerrar').onclick = cerrarHoja;

  const ajustar = (extra) => accion(async () => {
    if (extra) await Store.guardarFigura('mapa_figuras', { ...f, ...extra });
    cerrarHoja(); await recargar(); sincronizar();
    abrirEdicion('figura', { ...f, ...(extra || {}) });
  });
  $('#g-ajustar').onclick = ajustar(null);
  $('#g-rect').onclick = ajustar({ forma: 'rectangulo' });
  $('#g-elipse').onclick = ajustar({ forma: 'elipse' });
  $('#g-poligono').onclick = ajustar(f.forma === 'poligono'
    ? { forma: 'rectangulo' }
    : { forma: 'poligono', puntos: f.puntos?.length >= 3 ? f.puntos : Mapa.puntosPorDefecto(f.rx, f.ry) });
  $('#g-guardar').onclick = accion(async () => {
    await Store.guardarFigura('mapa_figuras', {
      ...f, etiqueta: $('#g-etq').value.trim() || null, color: $('#g-color').value
    });
    cerrarHoja(); await recargar(); sincronizar();
  });
  $('#g-borrar').onclick = accion(async () => {
    await Store.borrarFiguraFondo(id);
    cerrarHoja(); await recargar(); sincronizar();
  }, { ocupado: 'Borrando…' });
}

arrancar();
