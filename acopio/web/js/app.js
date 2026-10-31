// =====================================================================
//  app.js · armazón: mapa, lista, fichas y formularios
// =====================================================================
import * as Store from './store.js';
import { sb } from './store.js';
import * as Mapa from './mapa.js';
import * as Dibujo from './dibujo.js';
import * as Gps from './gps.js';
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

// Un lote recién llegado SOLO puede pasar a muestreado.
//
// No es un permiso, es el orden del trabajo: hasta que no hay muestra no
// se sabe qué material es, así que facturarlo, devolverlo o alimentarlo
// sería decidir sobre algo que nadie ha mirado todavía. Por eso vale
// igual para el admin: no es que no tenga permiso, es que ese paso no
// existe. En cuanto está muestreado se abren todos los demás.
//
// Corregir un estado puesto por error sigue siendo posible: el que ya
// pasó de por_muestrear tiene la lista entera, y ahí está por_muestrear
// para devolverlo al principio si hizo falta.
// Alimentar es solo del admin: la base rechaza a cualquier otro
// (fn_solo_admin_alimenta), así que tampoco se le ofrece.
const estadosPosibles = (l) => l.estado === 'por_muestrear'
  ? ['muestreado']
  : ESTADOS_ELEGIBLES.filter((k) => k !== l.estado && (k !== 'alimentado' || esAdmin()));
// para ordenar la barra de colores del tablero de plataformas
const ORDEN_ESTADO = Object.fromEntries(ESTADOS_ELEGIBLES.map((k, i) => [k, i]));
const MATERIALES = { granel: 'Granel', bigbag: 'Bigbag' };
// Cuántos bigbags trae un lote. Se apilan de a Mapa.ALTO_BIGBAGS en el
// plano; el tope es solo para que un dedo de más no dibuje un patio entero.
const MAX_BIGBAGS = 999;
const leerBigbags = (sel) => {
  const n = Number(String($(sel)?.value || '').trim());
  return Number.isInteger(n) && n >= 1 && n <= MAX_BIGBAGS ? n : null;
};
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

// El filtro del mapa admite VARIOS valores por campo: dos proveedores,
// o "devolución" y "remuestreo" a la vez. Dentro de un campo basta con
// que coincida uno; entre campos tienen que cumplirse todos.
const filtroMapaVacio = () => ({ proveedor: [], estado: [], material: [], placa: [] });

// Lo que se elige en los desplegables de la pestaña Lotes. Vacío es "todos".
const filtroListaVacio = () => ({ proveedor: '', plataforma: '', material: '', pila: '',
                                  desde: '', hasta: '' });

const S = { perfil: null, pestana: 'mapa', filtro: 'todos', busqueda: '', edicion: false,
            lista: filtroListaVacio(), orden: 'actividad', masFiltros: false,
            lotes: [], pilas: [], proveedores: [], figuras: [], gente: [], config: {},
            pendientes: 0, idsPendientes: new Set(), rechazados: 0, sync: null,
            actualizacion: false,
            // buscar sobre el plano, y la figura que se acaba de encontrar
            buscarMapa: false, busquedaMapa: '', resaltado: null,
            // el lote que la volqueta está descargando: no se dibuja aún
            naciendo: null,
            // filtro del mapa: resalta lo que coincide y atenúa el resto
            mapaFiltro: filtroMapaVacio(),
            // La barra de herramientas del mapa se puede guardar fuera de
            // la pantalla. Se recuerda en el celular: quien la esconde para
            // ver el patio la quiere escondida también mañana.
            herramientas: localStorage.getItem('acopio-herramientas') !== '0',
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
            plataforma: localStorage.getItem('acopio-plataforma') || null,
            // El GPS. Prendido o apagado se recuerda en el celular: quien
            // lo usa lo quiere cada vez que abre la app, sin volver a
            // pedirlo. `yo` es la última lectura; `otros`, los que el
            // servidor dice que están en el patio ahora.
            gps: { activo: localStorage.getItem('acopio-gps') === '1', yo: null, otros: [], enVivo: false,
                   error: null, compartiendo: false, enviado: null, enviando: false, leidoEn: 0,
                   // lo que respondió el servidor si no aceptó la posición o no dejó leer
                   fallaSubir: null, fallaLeer: null },
            // el admin marcando los dos puntos que ubican el plano en el mundo
            calibrando: null };

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
// Plataforma 5 es la que da a la planta: solo desde ahí se alimenta una
// pila entera de un golpe. Se reconoce por el nombre, que es lo único que
// la tabla garantiza único.
const esPlataforma5 = (id) => /^plataforma\s*5$/i.test(nombrePlataforma(id).trim());
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
  // guardar la barra de herramientas a la izquierda, y sacarla de nuevo
  plegar:    ico('<path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/>'),
  ajustes:   ico('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
  editar:    ico('<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>'),
  fondo:     ico('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>'),
  cerrar:    ico('<path d="M18 6L6 18M6 6l12 12"/>'),
  lupa:      ico('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  reloj:     ico('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'),
  diana:     ico('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  campana:   ico('<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
  visto:     ico('<path d="M20 6L9 17l-5-5"/>'),
  // Capas apiladas: las cinco plataformas vistas de canto.
  capas:     ico('<path d="M12 3l9 5-9 5-9-5 9-5"/><path d="M3 13l9 5 9-5"/>'),
  // Copa con asas y pie, que es como se dibuja un trofeo en cualquier
  // sitio: se reconoce sin leer nada.
  trofeo:    ico('<path d="M7 4h10v5a5 5 0 0 1-10 0V4"/><path d="M7 6H4v2a3 3 0 0 0 3 3"/>'
                 + '<path d="M17 6h3v2a3 3 0 0 1-3 3"/><path d="M12 14v4M8 21h8M10 18h4"/>'),
  // Bolsa de compra con asa: la tienda.
  bolsa:     ico('<path d="M6 2h12l2 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8l2-6z"/>'
                 + '<path d="M4 8h16"/><path d="M9 12a3 3 0 0 0 6 0"/>'),
  // Matraz de laboratorio: el cuello estrecho y el cuerpo cónico. Es el
  // dibujo que se reconoce sin leer nada al lado.
  frasco:    ico('<path d="M9 3h6M10 3v6.5L4.6 18.4A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.6L14 9.5V3"/>'
                 + '<path d="M7.2 14h9.6"/>'),
  // La "i" en un círculo: abre la leyenda de colores del plano.
  info:      ico('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>'),
  // Triángulo de aviso, para los lotes que conviene mirar.
  alerta:    ico('<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'
                 + '<path d="M12 9v4M12 17h.01"/>'),
  // La flecha de navegación: es como cualquier teléfono dice "ubicación".
  gps:       ico('<path d="M3 11l19-9-9 19-2-8-8-2z"/>'),
  // Mapa plegado: la imagen satelital.
  mapa:      ico('<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>')
};

// ------------------------------------------------------- la monedita
// La moneda que gira, dibujada píxel a píxel.
//
// Es la única cosa de toda la app que se mueve porque sí, y se lo ha
// ganado: un número pelado no dice que sea una moneda, y un dibujo
// quieto tampoco. Girando, se entiende sin leer nada — es el gesto que
// cualquiera reconoce de un videojuego.
//
// Ocho fotogramas en una tira, y una ventana que va enseñando uno cada
// vez. `steps(8)` salta de uno a otro sin difuminar: si se interpolara,
// se vería un borrón en vez de píxeles. Los anchos van de 10 a 2 y
// vuelven: es la moneda de canto a mitad de vuelta.
//
// `shape-rendering="crispEdges"` es lo que impide que el navegador
// suavice los bordes. Sin eso no son píxeles, son manchas.
// La rejilla es de 16 y no de 12 a propósito. Con 12 la moneda de frente
// salía de 10 de ancho por 10 de alto pero con las esquinas apenas
// mordidas, y eso no se lee como un círculo: se lee como un ladrillo.
// Con 16 sobran píxeles para recortarle las cuatro esquinas de verdad.
//
// Los anchos: de frente 14, y de ahí a 2, que es la moneda de canto.
// Vuelve subiendo, y esa es la media vuelta que falta.
const MONEDA_ANCHOS = [14, 12, 8, 4, 2, 4, 8, 12];
const CUADRO = 16;
const ORO = '#f2c007', BRILLO = '#ffe066', SOMBRA = '#b8890a', FILO = '#0c0c0b';

const monedaPixel = () => {
  const cuadros = MONEDA_ANCHOS.map((w, i) => {
    const x = i * CUADRO + (CUADRO - w) / 2;
    const r = (a, b, c, d, f) => c <= 0 ? ''
      : `<rect x="${a}" y="${b}" width="${c}" height="${d}" fill="${f}"/>`;
    // De canto no cabe ni el brillo ni la sombra: solo el filo dorado.
    // El oro va centrado sobre el filo, que es lo que se hacía mal antes
    // y dejaba la moneda de canto con el negro solo por un lado.
    if (w <= 4) {
      return r(x, 1, w, 14, FILO) + r(x + w / 2 - 1, 3, 2, 10, ORO);
    }
    // Rectángulos cruzados y cada vez más anchos hacen un octógono, que
    // a este tamaño es lo más redondo que hay. De frente la moneda es
    // grande y le caben tres escalones; de perfil, con dos basta y sobra.
    const pasos = w >= 12 ? 3 : 2;
    let d = '';
    for (let k = 0; k < pasos; k++) {
      d += r(x + (pasos - 1 - k), 1 + k, w - 2 * (pasos - 1 - k), 14 - 2 * k, FILO);
      d += r(x + (pasos - k), 2 + k, w - 2 * (pasos - k), 12 - 2 * k, ORO);
    }
    return d
         + r(x + pasos, 5, 1, 6, BRILLO)          // el brillo, a la izquierda
         + r(x + w - pasos - 1, 5, 1, 6, SOMBRA); // la sombra, a la derecha
  }).join('');
  return `<span class="moneda-px" aria-hidden="true"><svg
    viewBox="0 0 ${CUADRO * MONEDA_ANCHOS.length} ${CUADRO}"
    shape-rendering="crispEdges">${cuadros}</svg></span>`;
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
// hasta tal día para venir por su material. Si el lote pas�� a otro
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
// arriba, como un exponente: ABG40.2 —o ABG40-2, o ABG40(2)— se lee
// "ABG40" con un 2 al lado.
// Lo hace `Mapa.partesCodigo`, que es quien conoce el formato; aquí solo
// se le pone el HTML. El dato guardado no se toca: en el buscador, en la
// corrección de datos y en el informe sigue saliendo entero.
function codigoHTML(codigo) {
  const { base, volqueta } = Mapa.partesCodigo(codigo);
  return esc(base) + (volqueta ? `<sup class="volqueta">${esc(volqueta)}</sup>` : '');
}

// El código de un lote empieza por la abreviatura de su proveedor:
// PG1042 lo trajo PG. Así que corregir el proveedor y dejar el código
// como estaba deja el lote diciendo una cosa y siendo otra.
//
// Se cambia SOLO el principio y se respeta todo lo demás tal cual, con
// su número y con el sufijo de volqueta sea como sea que esté escrito
// —SJ115(2), ABG40.2 o ABG40-2—: quien lo tecleó eligió ese formato y
// no es asunto de esta corrección cambiarlo.
const recodificar = (codigo, vieja, nueva) => {
  const t = String(codigo || '').trim().toUpperCase();
  const v = String(vieja || '').toUpperCase(), n = String(nueva || '').toUpperCase();
  if (v && t.startsWith(v)) return n + t.slice(v.length);
  // No empezaba por la sigla anterior —lo escribieron a mano, o el
  // proveedor cambió de abreviatura—: se sustituyen las letras del
  // principio, y si no había ninguna se le antepone la nueva.
  return t.replace(/^[A-Z]*/, n);
};
const siglaDe = (id) => S.proveedores.find((p) => p.id === id)?.abreviatura || '';

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
  // El GPS se apaga con la app en el bolsillo y vuelve al sacarla: con la
  // pantalla apagada nadie mira el plano, y el GPS es de lo que más
  // batería gasta en un teléfono.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pararGps();
    else {
      if (S.gps.activo) arrancarGps();
      leerOtros({ yaMismo: true });       // lo de hace un rato ya no es "ahora"
    }
  });
  if (S.gps.activo) arrancarGps();
  vigilarOtros();
  // La ventana de calibrar (calibrar.html) escribe en la misma base del
  // navegador. Avisa al guardar, y aquí se recarga en el acto en vez de
  // esperar a la vuelta de sincronización: el admin que acaba de calibrar
  // vuelve a esta pestaña esperando ver el GPS ya puesto.
  if ('BroadcastChannel' in window) {
    new BroadcastChannel('acopio').onmessage = (e) => { if (e.data?.tipo === 'calibrado') recargar(); };
  }
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
  pintarLaboratorio();
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
    // Se guarda el CONTENIDO, no el texto.
    //
    // Con `textContent` el botón perdía su icono para siempre: poner
    // texto borra el dibujo de dentro, y al terminar se devolvía un
    // texto vacío —un SVG no tiene texto— así que el trofeo, la campana
    // y "Nuevo lote" se quedaban en un rectángulo negro y pelado hasta
    // recargar. Guardando el contenido entero vuelve tal cual estaba.
    const antes = this.innerHTML;
    this.disabled = true;
    // `aria-busy` enciende la cinta de obra en marcha del botón (styles.css)
    // y avisa al lector de pantalla de que está trabajando.
    this.setAttribute('aria-busy', 'true');
    // `textContent` y no `innerHTML`: lo que llega en `ocupado` se pinta
    // como texto, nunca como marcado.
    this.textContent = ocupado;
    try {
      await fn.call(this, ev);
    } catch (e) {
      (alFallar || decirError)(e);
    } finally {
      // si la hoja ya se cerró el nodo está suelto y esto no molesta
      this.disabled = false;
      this.removeAttribute('aria-busy');
      this.innerHTML = antes;
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
    b.disabled = true; b.setAttribute('aria-busy', 'true'); b.textContent = 'Entrando…';
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
      b.disabled = false; b.removeAttribute('aria-busy'); b.textContent = 'Entrar';
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
        <button class="icono" id="colores" aria-label="Información: qué significa cada color"
          title="Información">${ICO.info}</button>
        <button class="icono trofeo" id="trofeo" aria-label="Monedas y clasificación"
          >${ICO.trofeo}</button>
        <button class="icono lab" id="lab" aria-label="Muestras para el laboratorio" hidden
          >${ICO.frasco}<span class="cuenta" id="lab-n"></span></button>
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
      <div id="barra-gps"></div>
      <!-- La pastilla del GPS va abajo a la izquierda, en el mismo renglón
           que "Nuevo lote": arriba, debajo de las herramientas, se sumaba
           a todo lo que ya había en esa esquina. -->
      <div class="fila-inferior">
        <div id="chip-gps-caja"></div>
        <div id="boton-nuevo"></div>
      </div>
      <div id="franja" hidden class="franja"><div></div></div>
    </div>
    <div id="modal"></div>`;

  $('#chip').onclick = sincronizar;
  $('#menu').onclick = menuCuenta;
  $('#campana').onclick = panelTareas;
  $('#lab').onclick = accion(() => panelLaboratorio(), { ocupado: '…' });
  $('#colores').onclick = hojaColores;
  $('#trofeo').onclick = accion(() => panelMonedas(), { ocupado: '…' });
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
  pintarLaboratorio();
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
  for (const id of ['#barra-forma', '#barra-recorrido', '#barra-historia', '#barra-gps', '#boton-nuevo',
                    '#chip-gps-caja']) {
    const n = $(id); if (n) n.innerHTML = '';
  }
};

function montarMapa() {
  // Rearmar la barra no puede costar el encuadre en el que se estaba
  const vistaPrevia = document.querySelector('#lienzo') ? Mapa.obtenerVista() : null;

  // Una calibración es de UNA plataforma: si se cambió de plano a mitad,
  // los puntos marcados serían de otro dibujo.
  if (S.calibrando && (S.calibrando.plat !== S.plataforma || S.historia)) soltarCalibracion();

  limpiarBarrasMapa();
  // Mirando otro día no se registran lotes: el botón ni aparece. Calibrando
  // tampoco: no es momento de registrar nada, y taparía la barra.
  const nb = $('#boton-nuevo');
  if (nb && !soloLectura() && !S.historia && !S.calibrando) nb.innerHTML =
    `<button class="btn-mapa btn-mapa-primario" id="nuevo" aria-label="Nuevo lote" title="Nuevo lote">${ICO.mas}</button>`;
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
            <button class="btn-mapa btn-plegar" id="r-plegar" aria-expanded="${S.herramientas}"
              aria-controls="herramientas"
              aria-label="${S.herramientas ? 'Ocultar las herramientas' : 'Mostrar las herramientas'}"
              ${herramientaPuesta() ? 'data-activo="si"' : ''}
              >${S.herramientas ? ICO.plegar : ICO.ajustes}<span>${S.herramientas ? 'Ocultar' : 'Herramientas'}</span></button>
            <div class="grupo-herramientas" id="herramientas" ${S.herramientas ? '' : 'hidden'}>
              <button class="btn-mapa" id="r-buscar" aria-label="Buscar un lote"
                ${S.buscarMapa ? 'aria-pressed="true"' : ''}>${ICO.lupa}<span>Buscar</span></button>
              <button class="btn-mapa" id="r-filtrar" aria-label="Filtrar">
                ${ICO.filtro}<span>Filtrar</span></button>
              <button class="btn-mapa" id="r-gps" aria-label="Mi ubicación en el plano"
                ${S.gps.activo ? 'aria-pressed="true"' : ''}>${ICO.gps}<span>Ubicación</span></button>
              ${soloLectura() ? '' : `<button class="btn-mapa" id="r-editar" aria-label="Mover y editar figuras">
                ${ICO.editar}<span>${S.edicion ? 'Salir de editar' : 'Mover y editar'}</span></button>`}
              ${esAdmin() ? `<button class="btn-mapa" id="r-historia" aria-label="Ver el patio de otro día"
                ${S.historia ? 'aria-pressed="true"' : ''}>${ICO.reloj}<span>Otro día</span></button>` : ''}
              ${esAdmin() ? `<button class="btn-mapa" id="r-fondo" aria-label="Fondo del mapa">
                ${ICO.fondo}<span>Fondo del mapa</span></button>` : ''}
            </div>
            <div id="caja-buscar"></div>
            <div id="chip-filtro-caja"></div>
          </div>
        </div>
      </div>
    </div>`;

  Mapa.montar($('#lienzo-caja'), {
    puedeEditarFondo: esAdmin,
    // Mantener presionado un lote lo levanta para moverlo sin entrar a
    // "Mover y editar". Quien solo mira (empresa) no mueve nada, y en el
    // patio de otro día tampoco: ese plano es historia, no se edita.
    puedeMover: () => !soloLectura() && !S.historia,
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
      // Un lote que estaba DENTRO de una pila de bigbags y se soltó fuera
      // de ella sale de la pila. (Si cayó dentro de su pila, o en otra, el
      // mapa llama a alSoltarSobre, no aquí.)
      if (origen && tipo === 'lote' && obj.pila_id) {
        const pila = S.pilas.find((p) => p.id === obj.pila_id);
        const ok = await confirmar({
          titulo: `¿Sacar ${obj.codigo} de la pila ${pila?.codigo || ''}?`,
          detalle: 'Queda suelto donde lo soltaste, y queda en el historial del lote y de la pila.',
          aceptar: 'Sacarlo y dejarlo aquí'
        });
        if (!ok) return Mapa.deshacerGeom(tipo, obj.id, antes);
        await Store.guardarFigura('lotes', { ...obj });
        await anotarRecorrido(obj, origen);
        await Store.registrarEvento({ lote_id: obj.id, tipo: 'salida_pila', usuario_id: S.perfil.id });
        if (pila) await revisarPila(pila);
        await recargar(); sincronizar();
        return;
      }
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
      // Mover una pila mueve lo que tiene adentro: en una de bigbags cada
      // lote se ve en su sitio y tiene que seguir dentro; en una de granel
      // no se ven, pero su posición guardada tampoco puede quedarse atrás.
      if (tipo === 'pila' && origen) {
        const dx = obj.x - origen.x, dy = obj.y - origen.y;
        for (const l of S.lotes.filter((q) => q.pila_id === obj.id)) {
          await Store.guardarFigura('lotes', { ...l, x: l.x + dx, y: l.y + dy });
        }
      }
      await recargar();
      sincronizar();
    }),
    alSoltarSobre: gesto(manejarSoltar)
  });
  refrescarMapa();
  Mapa.fijarVista(vistaPrevia);

  if ($('#nuevo')) $('#nuevo').onclick = formLote;
  $('#r-plegar').onclick = alternarHerramientas;
  $('#r-buscar').onclick = () => {
    S.buscarMapa = !S.buscarMapa;
    if (!S.buscarMapa) S.busquedaMapa = '';
    montarMapa();
    $('#q-mapa')?.focus();
    volverAlMapa();
  };
  pintarBuscadorMapa();
  $('#r-filtrar').onclick = panelFiltro;
  $('#r-gps').onclick = gesto(() => (S.gps.activo ? apagarGps() : prenderGps()));
  if ($('#r-historia')) $('#r-historia').onclick = accion(alternarHistoria, { ocupado: 'Leyendo…' });
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

  if (S.calibrando) dibujarCalibracion();
  // Volver al mapa desde la lista: lo de los demás puede tener un rato.
  leerOtros();
  pintarGps();
}

// Si alguna herramienta está haciendo algo —buscar, filtrar, el GPS,
// editar, mirar otro día— con la barra escondida no se vería. El botón
// que la saca lleva entonces una marca, para que no quede nada puesto
// sin que se sepa.
const herramientaPuesta = () =>
  S.buscarMapa || hayFiltroMapa() || S.gps.activo || S.edicion || !!S.historia;

// La marca solo se ve con la barra escondida (styles.css); aquí se dice
// si hay algo puesto, y se llama también al quitar el filtro desde su
// pastilla, que es lo único que cambia sin pasar por la barra.
function marcarPlegar() {
  const b = $('#r-plegar'); if (!b) return;
  if (herramientaPuesta()) b.dataset.activo = 'si'; else delete b.dataset.activo;
}

// Esconder la barra de herramientas no rearma el mapa: solo la desliza
// fuera de la pantalla. Rearmarlo costaría un parpadeo del plano por
// algo que es puramente de vista.
function alternarHerramientas() {
  S.herramientas = !S.herramientas;
  recordar('acopio-herramientas', S.herramientas ? '1' : '0');
  const g = $('#herramientas'), b = $('#r-plegar');
  if (!g || !b) return;
  b.setAttribute('aria-expanded', String(S.herramientas));
  b.setAttribute('aria-label', S.herramientas ? 'Ocultar las herramientas' : 'Mostrar las herramientas');
  b.innerHTML = `${S.herramientas ? ICO.plegar : ICO.ajustes}<span>${S.herramientas ? 'Ocultar' : 'Herramientas'}</span>`;
  marcarPlegar();
  // Se desliza hacia la izquierda y, al terminar, se quita del todo: así
  // la pastilla del filtro y la del GPS suben y no queda un hueco donde
  // estaban los botones. Sin animación, si el celular pide menos movimiento.
  const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;
  g.classList.remove('saliendo', 'entrando');
  if (S.herramientas) {
    g.hidden = false;
    if (!quieto) g.classList.add('entrando');
  } else if (quieto) g.hidden = true;
  else {
    g.classList.add('saliendo');
    g.addEventListener('animationend', () => {
      if (!S.herramientas) g.hidden = true;
      g.classList.remove('saliendo');
    }, { once: true });
  }
}

// La leyenda del plano. Quien llega nuevo ve óvalos de colores y no tiene
// cómo saber que el ámbar es "falta muestra" o que el negro es una
// devolución que nadie ha recogido. Los colores salen de la paleta
// guardada: si el admin repinta un estado, la leyenda lo sigue sola.
function hojaColores() {
  const c = paletaActual();
  const muestra = (col, pila) => `<svg width="48" height="30" viewBox="0 0 48 30" aria-hidden="true">
    <ellipse cx="24" cy="15" rx="22" ry="13" fill="${esc(col)}" ${pila
      ? `fill-opacity=".14" stroke="${esc(col)}" stroke-width="3"`
      : 'stroke="#14171a" stroke-width="2"'}/></svg>`;
  const fila = (dibujo, titulo, detalle = '') => `<div class="ley-fila">${dibujo}
    <div><b>${titulo}</b>${detalle ? `<small>${detalle}</small>` : ''}</div></div>`;
  const LOTES = [
    ['por_muestrear', 'Recién llegado. Falta tomarle la muestra.'],
    ['muestreado', 'Ya tiene muestra, espera resultado.'],
    ['remuestreo', 'Hay que volver a tomarle muestra.'],
    ['facturado', 'Aprobado y facturado.'],
    ['devolucion', 'Se le devuelve al proveedor.']
  ];
  abrirHoja(`
    <h3>Lotes · el relleno es su estado</h3>
    <div class="ley">
      ${LOTES.map(([k, d]) => fila(muestra(c[k]), ESTADOS[k], d)).join('')}
      ${fila(muestra('#14171a'), 'Negro: recogida vencida', 'Devolución cuya fecha de recogida ya pasó.')}
    </div>
    <p class="ley-nota">Alimentado y despachado no aparecen en el plano: ya salieron del patio.</p>
    <h3>Pilas · óvalo con borde de color</h3>
    <div class="ley">
      ${Object.entries(TIPOS_PILA).map(([k, v]) => fila(muestra(c[`pila_${k}`], true), v)).join('')}
    </div>
    <h3>Formas y marcas</h3>
    <div class="ley">
      ${fila(muestra('#fdfbf7'), 'Óvalo', 'Lote a granel.')}
      ${fila(`<svg width="48" height="30" viewBox="0 0 48 30" aria-hidden="true"><rect x="3" y="3" width="42" height="24"
        fill="#fdfbf7" stroke="#14171a" stroke-width="2"/></svg>`, 'Rectángulo', 'Lote en bigbag.')}
      ${fila(`<svg width="48" height="30" viewBox="0 0 48 30" aria-hidden="true"><text x="20" y="21" text-anchor="middle"
        font-family="ui-monospace, monospace" font-weight="800" font-size="12">ABG-4</text><text x="42" y="13"
        font-family="ui-monospace, monospace" font-weight="800" font-size="8">2</text></svg>`,
        'Número pequeño arriba', 'Viaje de volqueta: ABG-4 viaje 2.')}
      ${fila(`<svg width="48" height="30" viewBox="0 0 48 30" aria-hidden="true"><ellipse cx="24" cy="15" rx="22" ry="13"
        fill="${esc(c.facturado)}" opacity=".25" stroke="#14171a" stroke-width="2"/></svg>`,
        'Pálido', 'No coincide con el filtro o la búsqueda.')}
    </div>`,
    `<h2>Información</h2><p class="sub">Qué significa cada color del plano.</p>`);
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
// El botón de plataformas de la cabecera se quitó: la pestaña
// Plataformas ya lleva a cualquiera de ellas, y ese sitio quedó para la
// leyenda de colores, que es lo que un recién llegado necesita.
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

// -------------------------------------------------------------- monedas
// Lo que cada uno ha ganado trabajando, de dónde salió cada moneda, y
// quién va ganando este mes.
//
// El saldo NO se calcula aquí: lo cuenta el servidor desde el historial
// entero. El celular guarda solo una ventana de eventos, así que una
// cuenta hecha con lo local daría un número distinto en cada teléfono.
//
// La clasificación se reinicia cada mes a propósito: una tabla histórica
// se congela —gana siempre el que empezó primero— y el que entra nuevo
// ni lo intenta.
const MOTIVOS = {
  registrar: 'Registró el lote', muestrear: 'Lo muestreó', apilar: 'Lo metió en una pila',
  trasladar: 'Lo cambió de plataforma', despachar: 'Lo despachó', tarea: 'Completó una tarea'
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
               'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const nombreDe = (id) => S.gente.find((p) => p.id === id)?.nombre || 'alguien';

async function panelMonedas(verA = null) {
  const quien = verA || S.perfil.id;
  abrirHoja('<p class="pista">Contando monedas…</p>', '<h2>Monedas</h2>', ESQUINA_TIENDA);

  const r = await Store.resumenMonedas();
  const mios = r.saldos.find((x) => x.usuario_id === S.perfil.id);
  const tabla = [...r.clasificacion].sort((a, b) => b.monedas - a.monedas);
  const h = await Store.historialMonedas(quien);
  const dudosos = esAdmin() ? await Store.lotesDudosos() : { lista: [] };
  // Son TRES números y hay que separarlos, o se leen como si se
  // contradijeran: el saldo es lo que queda por gastar, el ganado es lo
  // que se lleva desde siempre —eso no baja al canjear— y la tabla es
  // del mes en curso.
  const total = mios?.monedas ?? 0;
  const ganado = mios?.ganado ?? total;
  const gastado = mios?.gastado ?? 0;
  const esteMes = tabla.find((x) => x.usuario_id === S.perfil.id)?.monedas ?? 0;
  const m1 = Number(r.mes.slice(5, 7));

  abrirHoja(`
    ${r.alDia ? '' : `<p class="aviso">Sin señal: esto es lo último que llegó${
      r.cuando ? `, del ${fechaLocal(r.cuando)}` : ''}. Las monedas las cuenta el servidor.</p>`}

    <div class="saldo">
      <span class="cifra">${monedaPixel()}${total}</span>
      <span class="txt">moneda${total === 1 ? '' : 's'} tuyas para gastar</span>
      <span class="desde">${esteMes} ${esteMes === 1 ? 'ganada' : 'ganadas'} en ${MESES[m1 - 1]}${
        gastado ? ` · ${ganado} ganadas en total, ${gastado} canjeadas` : ', desde que empezaste'}</span>
    </div>

    <h3>Clasificación de ${MESES[m1 - 1]}</h3>
    ${tabla.length ? `<ol class="ranking">${tabla.map((x, i) => `
      <li data-quien="${x.usuario_id}"${x.usuario_id === quien ? ' class="viva"' : ''}>
        <span class="puesto" data-podio="${i < 3 ? i + 1 : 'no'}">${i + 1}</span>
        <span class="quien">${esc(x.nombre || nombreDe(x.usuario_id))}${
          x.rol === 'admin' ? ' <span class="dias">admin</span>' : ''}</span>
        <span class="cuanto">${x.monedas}</span>
      </li>`).join('')}</ol>
      <p class="pista">Toca un nombre para ver de dónde salieron sus monedas.
         Esta tabla vuelve a cero el 1 de ${MESES[m1 % 12]}; tus monedas NO se borran.</p>`
      : '<p class="pista">Todavía nadie ha ganado monedas este mes.</p>'}

    <h3>${quien === S.perfil.id ? 'Tus monedas' : `Monedas de ${esc(nombreDe(quien))}`}</h3>
    ${h.sinSenal ? '<p class="aviso">Hace falta señal para ver el detalle.</p>'
      : h.lineas.length ? `<ul class="linea-tiempo">${h.lineas.map((l) => `<li>
          <div class="cuando">${new Date(l.ocurrido_en).toLocaleString('es-CO')}</div>
          <div class="que"><strong class="gano">+${l.monedas}</strong> · ${esc(MOTIVOS[l.motivo] || l.motivo)}</div>
        </li>`).join('')}</ul>`
      : '<p class="pista">Sin monedas todavía.</p>'}

    ${dudosos.lista.length ? `
      <h3 class="con-ico">${ICO.alerta} Lotes que conviene mirar</h3>
      <p class="pista">Su paso por el patio no cuadra. Salir aquí NO quiere decir
         que alguien hiciera trampa: puede ser un apunte que se quedó sin hacer.
         El que entró y salió el mismo rato, además, no paga monedas.</p>
      <ul class="dudosos">${dudosos.lista.map((d) => `<li>
        <div class="que"><strong>${esc(d.codigo)}</strong> · placa ${esc(d.placa || '—')}</div>
        <div class="cuando">${esc(d.motivo)}${
          d.horas == null ? '' : d.horas < 1 ? ' · menos de una hora en el patio'
            : ` · ${d.horas} h en el patio`} · lo registró ${
          esc(nombreDe(d.registro))}, lo sacó ${esc(nombreDe(d.salida))}</div>
      </li>`).join('')}</ul>` : ''}

    <button class="btn btn-ancho" id="cerrar" style="width:100%;margin-top:14px">Volver</button>`,
    '<h2>Monedas</h2>', ESQUINA_TIENDA);

  $('#cerrar').onclick = menuCuenta;
  $('#ir-tienda').onclick = accion(() => panelTienda(), { ocupado: '…' });
  for (const li of document.querySelectorAll('.ranking li'))
    li.onclick = accion(() => panelMonedas(li.dataset.quien), { ocupado: '…' });
}

// ----------------------------------------------------------- laboratorio
// Las muestras que están esperando a que alguien las lleve al laboratorio.
//
// Es una lista de trabajo del administrador, no un estado del lote: el
// lote sigue donde estaba y como estaba, se apila, se traslada y se
// despacha igual. Lo único que dice esta lista es "de estos lotes hay una
// bolsa que todavía no ha salido para el laboratorio".
//
// El botón vive en la cabecera y va en NARANJA, que no lo lleva nada más:
// el amarillo es del trofeo y el rojo de la campana. Se esconde solo
// cuando no hay ninguna esperando, así que verlo ya significa algo.
//
// La lista se calcula con los eventos del celular, así que funciona sin
// señal —ver `muestras` en store.js—. Marcar una entregada también: se
// guarda aquí y sube cuando vuelva la conexión, como todo lo del patio.
async function pintarLaboratorio() {
  const b = $('#lab');
  if (!b) return;
  // Solo el administrador: es él quien recoge las bolsas y las lleva.
  if (!esAdmin()) { b.hidden = true; return; }
  const n = (await Store.muestras()).pendientes.length;
  b.hidden = !n;
  $('#lab-n').textContent = n || '';
}

async function panelLaboratorio() {
  const { pendientes: espera, entregadas } = await Store.muestras();

  // El lote puede haberse borrado del celular —o no haber llegado— y eso
  // no puede tumbar la lista: esa línea simplemente no sale.
  const conLote = (m) => {
    const l = S.lotes.find((x) => x.id === m.lote_id);
    return l ? { ...m, lote: l } : null;
  };
  const hoy = espera.map(conLote).filter(Boolean);
  const hechas = entregadas.map(conLote).filter(Boolean);

  const dias = (cuando) =>
    Math.floor((Date.now() - new Date(cuando)) / 86400000);
  const cuanto = (cuando) => {
    const d = dias(cuando);
    return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`;
  };

  abrirHoja(`
    <p class="pista">Cada línea es una bolsa de muestra que todavía no ha
       salido. Marcarla entregada no le cambia nada al lote: solo la tacha
       de aquí.</p>

    <h3>Sin entregar${hoy.length ? ` · ${hoy.length}` : ''}</h3>
    ${hoy.length ? `<ul class="muestras">${hoy.map((m) => `
      <li data-id="${m.lote_id}">
        <div class="linea">
          <span class="cod">${esc(m.lote.codigo)}</span>
          <span class="pt" style="background:${paletaActual()[m.lote.estado] || '#5f6863'}"></span>
          <span class="dias${dias(m.muestreado_en) >= DIAS_MUESTRA_VIEJA ? ' tarde' : ''}"
            >${cuanto(m.muestreado_en)}</span>
        </div>
        <div class="quien">Muestreado por ${esc(nombreDe(m.muestreado_por))} ·
          ${new Date(m.muestreado_en).toLocaleString('es-CO')}</div>
        <button class="btn btn-lleno entregar-lab" data-id="${m.lote_id}">Entregada</button>
      </li>`).join('')}</ul>`
      : '<p class="pista">Ninguna esperando. Todo lo muestreado ya salió.</p>'}

    <h3>Entregadas</h3>
    ${hechas.length ? `<ul class="muestras hechas">${hechas.map((m) => `
      <li>
        <div class="linea">
          <span class="cod">${esc(m.lote.codigo)}</span>
          <span class="dias">${cuanto(m.entregado_en)}</span>
        </div>
        <div class="quien">La llevó ${esc(nombreDe(m.entregado_por))} ·
          ${new Date(m.entregado_en).toLocaleString('es-CO')}</div>
      </li>`).join('')}</ul>`
      : '<p class="pista">Todavía no se ha entregado ninguna.</p>'}`,
    '<h2>Al laboratorio</h2>');

  for (const b of document.querySelectorAll('.entregar-lab'))
    b.onclick = accion(async () => {
      await Store.entregarAlLaboratorio(b.dataset.id, S.perfil.id);
      await recargar();
      await panelLaboratorio();
      sincronizar();
    }, { ocupado: 'Marcando…' });
}

// A partir de cuántos días una muestra sin entregar se marca en rojo. Dos
// días es lo que tarda una bolsa en volverse un problema: el laboratorio
// trabaja sobre material que ya se movió.
const DIAS_MUESTRA_VIEJA = 2;

// ---------------------------------------------------------------- tienda
// En qué se gastan las monedas. Sin esto, el sistema entero es un número
// que sube y ya: la tabla motiva una semana y después da igual.
//
// El admin pone los productos con su precio y su foto; los demás
// canjean. Un canje NO pasa por la cola de siempre —es lo único de toda
// la app que no— porque el saldo lo tiene que comprobar el servidor:
// ver el comentario de `canjear` en store.js.
//
// Se enseña SIEMPRE el catálogo entero, también lo que no alcanza. Una
// tienda donde solo se ve lo que ya puedes pagar no le dice a nadie para
// qué está ahorrando, que es justo lo que hace que ahorre.
const CANJE = { pedido: 'Pedido', entregado: 'Entregado', anulado: 'Anulado' };

const precio = (n) => `<span class="precio">${monedaPixel()}${n}</span>`;

// El botón que acompaña a la equis en la cabecera de Monedas. Ahí arriba
// se ve desde cualquier punto de la hoja —el encabezado va pegado— y no
// le quita una franja entera a la pantalla, que es lo que hacía la barra
// amarilla que tenía antes.
const ESQUINA_TIENDA =
  `<button class="a-tienda" id="ir-tienda" aria-label="Ir a la tienda">${ICO.bolsa}<span>Tienda</span></button>`;

// Qué se enseña en la vitrina. Se recuerda mientras la hoja está
// abierta: al canjear se repinta entera, y volver a "Todo" cada vez
// desharía el filtro justo cuando más se está usando.
let filtroTienda = 'todo';

async function panelTienda() {
  abrirHoja('<p class="pista">Abriendo la tienda…</p>', '<h2>Tienda</h2>');

  const [cat, mis, r] = await Promise.all([
    Store.productos(), Store.canjes(), Store.resumenMonedas()
  ]);
  const saldo = r.saldos.find((x) => x.usuario_id === S.perfil.id)?.monedas ?? 0;
  const admin = esAdmin();
  // Al admin le interesan los pedidos de todos, porque es quien entrega.
  // A cada uno, los suyos.
  const pedidos = admin ? mis.lista : mis.lista.filter((c) => c.usuario_id === S.perfil.id);
  const porEntregar = mis.lista.filter((c) => c.estado === 'pedido').length;
  const mios = mis.lista.filter((c) => c.usuario_id === S.perfil.id && c.estado === 'pedido').length;
  // Lo retirado sigue existiendo para el admin —tiene que poder volver a
  // sacarlo— pero no se le enseña a quien viene a canjear.
  const enVenta = admin ? cat.lista : cat.lista.filter((p) => p.activo);

  const alcanza = (p) => p.precio <= saldo
    && !(p.existencias != null && p.existencias <= 0) && p.activo;
  const cuantos = enVenta.filter(alcanza).length;
  // El filtro solo tiene sentido con catálogo suficiente y con algo que
  // filtrar: con tres productos, dos pastillas encima son ruido.
  const hayFiltro = !admin && enVenta.length > 3 && cuantos > 0 && cuantos < enVenta.length;
  if (!hayFiltro) filtroTienda = 'todo';
  const vitrina = filtroTienda === 'alcanza' ? enVenta.filter(alcanza) : enVenta;

  abrirHoja(`
    ${cat.alDia ? '' : `<p class="aviso">Sin señal: esto es el catálogo que quedó guardado.
       Para canjear hace falta conexión, porque el saldo lo lleva el servidor.</p>`}

    <div class="tres-cifras">
      <div class="oro">
        <span>Para gastar</span>
        <b>${monedaPixel()}${saldo}</b>
      </div>
      <div>
        <span>Ya te alcanzan</span>
        <b>${cuantos}</b>
      </div>
      <div>
        <span>${admin ? 'Por entregar' : 'Por recoger'}</span>
        <b>${admin ? porEntregar : mios}</b>
      </div>
    </div>

    ${admin ? `<button class="btn btn-lleno btn-ancho" id="nuevo-prod"
       style="width:100%">Añadir un producto</button>` : ''}

    ${hayFiltro ? `<div class="filtro-tienda">
      <button class="pastilla" data-filtro="todo"
        aria-pressed="${filtroTienda === 'todo'}">Todo · ${enVenta.length}</button>
      <button class="pastilla" data-filtro="alcanza"
        aria-pressed="${filtroTienda === 'alcanza'}">Ya me alcanza · ${cuantos}</button>
    </div>` : ''}

    ${vitrina.length ? `<div class="vitrina">${vitrina.map((p) => {
      const agotado = p.existencias != null && p.existencias <= 0;
      const falta = p.precio - saldo;
      const puede = !agotado && p.activo && falta <= 0 && cat.alDia;
      return `<article class="prod${p.activo ? '' : ' retirado'}" data-id="${p.id}">
        <div class="foto">${p.imagen_url
          ? `<img src="${esc(p.imagen_url)}" alt="${esc(p.nombre)}" loading="lazy">`
          : `<span class="sin-foto">${ICO.bolsa}</span>`}
          ${agotado ? '<span class="cinta">Agotado</span>'
            : !p.activo ? '<span class="cinta">Retirado</span>' : ''}</div>
        <div class="cuerpo">
          <h4>${esc(p.nombre)}</h4>
          <p class="det">${[p.detalle ? esc(p.detalle) : '',
              p.existencias != null && !agotado ? `quedan ${p.existencias}` : '']
              .filter(Boolean).join(' · ') || '&nbsp;'}</p>
          <div class="pie">${precio(p.precio)}</div>
          ${admin
            ? `<button class="btn btn-ancho editar-prod" data-id="${p.id}">Editar</button>`
            : puede
              ? `<button class="btn btn-lleno btn-ancho canjear" data-id="${p.id}">Canjear</button>`
              : `<button class="btn btn-ancho" disabled>${
                  agotado ? 'Agotado' : !cat.alDia ? 'Sin señal' : `Te faltan ${falta}`}</button>`}
        </div>
      </article>`;
    }).join('')}</div>`
      : `<p class="pista">${enVenta.length ? 'Todavía no te alcanza para nada de la tienda. Sigue sumando.'
          : `La tienda está vacía todavía.${admin ? ' Añade el primer producto ahí arriba.'
              : ' El administrador aún no ha puesto nada.'}`}</p>`}

    <h3>${admin ? 'Pedidos de todos' : 'Lo que has canjeado'}</h3>
    ${mis.sinSenal ? '<p class="aviso">Hace falta señal para ver los pedidos.</p>'
      : pedidos.length ? `<ul class="canjes">${pedidos.map((c) => `<li data-id="${c.id}">
          <div class="que"><strong>${esc(c.nombre)}</strong> ${precio(c.precio)}
            <span class="marca ${c.estado}">${CANJE[c.estado] || c.estado}</span></div>
          <div class="cuando">${new Date(c.pedido_en).toLocaleString('es-CO')}${
            admin ? ` · ${esc(nombreDe(c.usuario_id))}` : ''}</div>
          ${admin && c.estado === 'pedido' ? `<div class="acciones">
            <button class="btn entregar" data-id="${c.id}">Entregado</button>
            <button class="btn anular" data-id="${c.id}">Anular y devolver</button>
          </div>` : ''}
        </li>`).join('')}</ul>`
      : `<p class="pista">${admin ? 'Nadie ha canjeado nada todavía.'
          : 'Todavía no has canjeado nada.'}</p>`}

    <button class="btn btn-ancho" id="volver" style="width:100%;margin-top:14px">Volver a monedas</button>`,
    '<h2>Tienda</h2>');

  // `avisar` REEMPLAZA la hoja abierta. Sin devolver la tienda después,
  // un "te faltan 4 monedas" dejaba la pantalla en blanco al aceptar.
  const fallo = (texto) => { avisar(texto); $('#ok').onclick = () => panelTienda(); };

  $('#volver').onclick = accion(() => panelMonedas(), { ocupado: '…' });
  const nuevo = $('#nuevo-prod');
  if (nuevo) nuevo.onclick = () => fichaProducto(null);

  for (const b of document.querySelectorAll('.filtro-tienda .pastilla'))
    b.onclick = accion(async () => { filtroTienda = b.dataset.filtro; await panelTienda(); },
                       { ocupado: '…' });

  for (const b of document.querySelectorAll('.editar-prod'))
    b.onclick = () => fichaProducto(cat.lista.find((p) => p.id === b.dataset.id));

  for (const b of document.querySelectorAll('.canjear')) b.onclick = accion(async () => {
    const p = cat.lista.find((x) => x.id === b.dataset.id);
    // Se pregunta antes: el saldo no vuelve solo, hace falta que el
    // admin anule el pedido, y eso es una conversación.
    //
    // `confirmar` reemplaza la hoja, así que al decir que no hay que
    // devolver la tienda a la pantalla o se queda en blanco.
    if (!await confirmar({ titulo: `¿Canjear ${p.nombre} por ${p.precio} monedas?`,
                           detalle: 'El administrador te lo entrega en el patio.',
                           aceptar: 'Canjear' })) { await panelTienda(); return; }
    const res = await Store.canjear(p.id);
    if (res.error) { fallo(res.error); return; }
    await panelTienda();
  }, { ocupado: 'Canjeando…' });

  for (const b of document.querySelectorAll('.entregar')) b.onclick = accion(async () => {
    const res = await Store.resolverCanje(b.dataset.id, 'entregado');
    if (res.error) { fallo(res.error); return; }
    await panelTienda();
  }, { ocupado: '…' });

  for (const b of document.querySelectorAll('.anular')) b.onclick = accion(async () => {
    if (!await confirmar({ titulo: '¿Anular el pedido?',
                           detalle: 'Las monedas vuelven a su dueño.',
                           aceptar: 'Anular', peligro: true })) { await panelTienda(); return; }
    const res = await Store.resolverCanje(b.dataset.id, 'anulado');
    if (res.error) { fallo(res.error); return; }
    await panelTienda();
  }, { ocupado: '…' });
}

// El formulario del admin. Un producto es poco: nombre, precio, foto y,
// si es algo de lo que hay una cantidad contada, cuántos quedan.
//
// "Retirar" en vez de borrar: un producto borrado se lleva por delante
// los canjes que lo señalan, y esos son el recibo de alguien. Retirado
// desaparece de la tienda y el recibo se queda.
function fichaProducto(p) {
  const esNuevo = !p;
  abrirHoja(`
    <div class="campo"><label for="p-nombre">Qué es</label>
      <input id="p-nombre" maxlength="60" value="${p ? esc(p.nombre) : ''}"
        placeholder="Termo, camiseta, día libre…"></div>

    <div class="campo"><label for="p-detalle">Detalle (opcional)</label>
      <input id="p-detalle" maxlength="120" value="${p?.detalle ? esc(p.detalle) : ''}"
        placeholder="Talla M · color azul"></div>

    <div class="fila-2">
      <div class="campo"><label for="p-precio">Cuántas monedas cuesta</label>
        <input id="p-precio" type="number" min="1" step="1" value="${p?.precio ?? 20}"></div>
      <div class="campo"><label for="p-exist">Cuántos hay</label>
        <input id="p-exist" type="number" min="0" step="1"
          value="${p?.existencias ?? ''}" placeholder="sin límite"></div>
    </div>

    <div class="campo"><label>Foto</label>
      <div class="foto-prod" id="p-vista">${p?.imagen_url
        ? `<img src="${esc(p.imagen_url)}" alt="">` : `<span class="sin-foto">${ICO.bolsa}</span>`}</div>
      <input type="file" id="p-foto" accept="image/*" style="margin-top:8px">
      <p class="pista">Una foto de verdad vende diez veces más que un nombre.</p></div>

    ${esNuevo ? '' : `<label class="fila-check">
      <input type="checkbox" id="p-activo"${p.activo ? ' checked' : ''}>
      <span>En la tienda. Al quitarlo deja de verse, pero los canjes que ya hay se conservan.</span>
    </label>`}

    <p class="aviso" id="p-error" hidden></p>

    <button class="btn btn-lleno btn-ancho" id="p-guardar"
      style="width:100%;margin-top:14px">Guardar</button>
    <button class="btn btn-ancho" id="p-volver" style="width:100%;margin-top:8px">Cancelar</button>`,
    `<h2>${esNuevo ? 'Producto nuevo' : esc(p.nombre)}</h2>`);

  // Aquí el aviso va DENTRO del formulario, no en una hoja aparte.
  // `avisar` tapa la hoja, y volver a ella repinta el formulario desde
  // cero: quien se dejó el nombre en blanco perdería también el precio
  // y la foto que ya había puesto.
  const fallo = (texto) => {
    const a = $('#p-error');
    a.textContent = texto; a.hidden = false;
    a.scrollIntoView({ block: 'nearest' });
  };

  let foto = p?.imagen_url || null;
  // `accion` guarda y restaura el CONTENIDO del botón, y un <input> no
  // tiene contenido: aquí se apaga el campo a mano mientras sube.
  $('#p-foto').onchange = async function () {
    const archivo = this.files?.[0];
    if (!archivo) return;
    this.disabled = true;
    $('#p-vista').innerHTML = '<span class="sin-foto">Subiendo…</span>';
    try {
      foto = await Store.subirImagenProducto(archivo);
      $('#p-vista').innerHTML = `<img src="${esc(foto)}" alt="">`;
    } catch (e) {
      $('#p-vista').innerHTML = `<span class="sin-foto">${ICO.bolsa}</span>`;
      decirError(e);
    } finally { this.disabled = false; }
  };

  $('#p-volver').onclick = accion(() => panelTienda(), { ocupado: '…' });

  $('#p-guardar').onclick = accion(async () => {
    const nombre = $('#p-nombre').value.trim();
    const monedas = Math.round(Number($('#p-precio').value));
    if (!nombre) { fallo('Ponle un nombre al producto.'); return; }
    if (!(monedas >= 1)) { fallo('El precio tiene que ser de una moneda para arriba.'); return; }
    const cuantos = $('#p-exist').value.trim();

    const res = await Store.guardarProducto({
      id: p?.id || Store.uuid(),
      nombre, detalle: $('#p-detalle').value.trim() || null,
      precio: monedas,
      // Vacío quiere decir "sin límite", que no es lo mismo que cero.
      existencias: cuantos === '' ? null : Math.max(0, Math.round(Number(cuantos))),
      imagen_url: foto,
      activo: esNuevo ? true : $('#p-activo').checked,
      creado_por: p?.creado_por || S.perfil.id
    });
    if (res.error) { fallo(res.error); return; }
    await panelTienda();
  }, { ocupado: 'Guardando…' });
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
// Quién puede darla por completada.
//
// El de rol "empresa" no toca el patio —no registra lotes ni cambia
// estados— pero SÍ puede cerrar una tarea que lleve su nombre: a veces
// se le encargan cosas de por libre, y cerrarla no es editar el patio,
// es decir "esto ya está". Lo que no puede es coger las tareas sueltas,
// que son trabajo de cuadrilla.
const puedeCompletar = (t) => {
  if (t.completado_en) return false;
  if (soloLectura()) return t.asignado_a === S.perfil?.id;
  return esAdmin() || !t.asignado_a || t.asignado_a === S.perfil?.id;
};

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
    : t.asignado_a ? `
      <p class="pista">Esta tarea es de ${esc(quienEs(t.asignado_a))}: solo
        ${esc(quienEs(t.asignado_a))} puede darla por completada.</p>`
    : soloLectura() ? `
      <p class="pista">Esta tarea no tiene dueño y la puede cerrar cualquiera
         de la cuadrilla.</p>` : ''}

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
  // Quien la crea NO sale en la lista: un admin no se manda tareas a sí
  // mismo. La base lo impone; aquí simplemente no se ofrece, para que
  // nadie se tope con un rechazo que no entiende.
  // Entran los tres roles. El de "empresa" no trabaja el patio, pero se
  // le encargan cosas de por libre y también gana monedas por ellas.
  const gente = S.gente
    .filter((p) => p.activo !== false && p.id !== S.perfil.id
                   && ['contratista', 'admin', 'empresa'].includes(p.rol))
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
      <label for="t-monedas">Monedas que paga</label>
      <div class="acciones" id="t-mon">
        ${[0, 1, 3, 5, 10, 15].map((n) => `<button type="button" data-m="${n}"
          class="etiqueta-prio${n === 0 ? ' elegida' : ''}">${n || 'Ninguna'}</button>`).join('')}
      </div>
      <p class="pista">Lo que gana quien la complete. El tope es 15.</p>
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

  let monedas = 0;
  for (const b of document.querySelectorAll('#t-mon button'))
    b.onclick = () => {
      monedas = Number(b.dataset.m);
      for (const o of document.querySelectorAll('#t-mon button')) o.classList.remove('elegida');
      b.classList.add('elegida');
    };

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
      monedas, usuario_id: S.perfil.id
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
    const activo = hayFiltroMapa();
    rf.querySelector('span').textContent = activo ? textoFiltro() : 'Filtrar';
    if (activo) rf.setAttribute('aria-pressed', 'true');
    else rf.removeAttribute('aria-pressed');
  }
  const caja = $('#chip-filtro-caja');
  if (!caja) return;
  caja.innerHTML = !hayFiltroMapa() ? '' : `
    <button class="chip-filtro" id="quitar-filtro-rapido">
      ${ICO.filtro}<span>${esc(textoFiltro())}</span>${ICO.cerrar}
    </button>`;
  const b = $('#quitar-filtro-rapido');
  if (b) b.onclick = () => {
    S.mapaFiltro = filtroMapaVacio();
    actualizarChipFiltro();
    marcarPlegar();
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
  S.mapaFiltro = filtroMapaVacio();
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

// El nombre de un valor del filtro tal como se lee en la pastilla
const nombreEnFiltro = (campo, v) =>
  campo === 'proveedor' ? S.proveedores.find((p) => p.id === v)?.abreviatura || '?'
  : campo === 'estado' ? ESTADOS[v] || v
  : campo === 'material' ? MATERIALES[v] || v
  : v;

// Con uno o dos valores se nombran; con más, el primero y cuántos más,
// porque la pastilla flota sobre el plano y no puede crecer sin tope.
function textoFiltro() {
  const nombres = Object.entries(S.mapaFiltro)
    .flatMap(([campo, vs]) => vs.map((v) => nombreEnFiltro(campo, v)));
  if (!nombres.length) return 'Filtrar';
  return nombres.length <= 2 ? nombres.join(' · ') : `${nombres[0]} +${nombres.length - 1}`;
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
  // Un campo sin nada elegido no filtra. Con algo, basta con uno de sus
  // valores: "ABG o PGA", no "ABG y PGA", que ningún lote cumpliría.
  return (!f.proveedor.length || f.proveedor.includes(l.proveedor_id))
    && (!f.estado.length || f.estado.includes(l.estado))
    && (!f.material.length || f.material.includes(l.material || 'granel'))
    && (!f.placa.length || placasDe(l).some((pl) => f.placa.includes(pl)));
};

const hayFiltroMapa = () => Object.values(S.mapaFiltro).some((vs) => vs.length);

const lotesQueCoinciden = () => {
  if (!S.busquedaMapa.trim() && !hayFiltroMapa()) return null;
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

// Cada toque prende o apaga un valor, y el plano de detrás se actualiza
// en el acto: antes cada toque cerraba la hoja, así que solo se podía
// elegir UNA cosa, y mirar dos proveedores a la vez no era posible.
function panelFiltro() {
  const placas = [...new Set(misLotes().flatMap(placasDe))].sort();
  const boton = (campo, valor, texto) => `<button data-campo="${campo}" data-valor="${esc(valor)}"
    aria-pressed="${S.mapaFiltro[campo].includes(valor)}">${esc(texto)}</button>`;
  abrirHoja(`
    <h2>Filtrar el mapa</h2>
    <div class="sub">Lo que coincide se resalta; el resto queda atenuado. Se pueden marcar varios:
      dentro de un grupo basta con uno, y entre grupos tienen que cumplirse todos.</div>

    <h3>Por proveedor</h3>
    <div class="filtros filtros-hoja">
      ${S.proveedores.map((p) => boton('proveedor', p.id, p.abreviatura)).join('')}
    </div>

    <h3>Por estado</h3>
    <div class="filtros filtros-hoja">
      ${ESTADOS_ELEGIBLES.map((k) => boton('estado', k, ESTADOS[k])).join('')}
    </div>

    <h3>Por material</h3>
    <div class="filtros filtros-hoja">
      ${Object.entries(MATERIALES).map(([k, v]) => boton('material', k, v)).join('')}
    </div>

    <h3>Por volqueta</h3>
    <div class="filtros filtros-hoja">
      ${placas.length ? placas.map((pl) => boton('placa', pl, pl)).join('')
        : '<span class="pista">Todavía no hay placas registradas.</span>'}
    </div>

    <div class="acciones pie-filtro">
      <button id="quitar-filtro">Ver todo</button>
      <button id="cerrar" class="btn-lleno"><span id="filtro-cuenta">Listo</span></button>
    </div>`);

  // cuántos lotes quedan resaltados, para no tener que cerrar a mirar
  const contar = () => {
    const n = lotesQueCoinciden();
    $('#filtro-cuenta').textContent = n ? `Listo · ${n.length} lote${n.length === 1 ? '' : 's'}` : 'Listo';
  };
  contar();
  $('#cerrar').onclick = cerrarHoja;
  $('#quitar-filtro').onclick = () => {
    S.mapaFiltro = filtroMapaVacio();
    cerrarHoja(); volverAlMapa();
  };
  document.querySelectorAll('.filtros-hoja button').forEach((b) => {
    b.onclick = () => {
      const lista = S.mapaFiltro[b.dataset.campo];
      const i = lista.indexOf(b.dataset.valor);
      if (i >= 0) lista.splice(i, 1); else lista.push(b.dataset.valor);
      b.setAttribute('aria-pressed', String(i < 0));
      contar(); volverAlMapa();
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
  // la plataforma pudo cambiar, y con ella dónde cae cada punto
  pintarGps();
}

// --------------------------------------------------- la volqueta descarga
// Un lote se registra una vez, y ese momento es el único que vale la pena
// celebrar: cambiar de estado pasa veinte veces al día y una escena ahí
// estorbaría. La escena va en una capa APARTE, encima del plano: el mapa
// se redibuja entero en cada sincronización y una animación metida dentro
// del SVG se cortaría a media descarga.
//
// La volqueta se ve DESDE ARRIBA, como el plano: antes era un dibujo de
// perfil encima de un mapa cenital y se notaba pegado. Entra en reversa,
// levanta el volco (visto desde arriba se acorta hacia atrás y asoma el
// pistón), abre la compuerta, el material cae y forma el montón, y se va.
// El montón que deja es EXACTAMENTE el dibujo del lote (Mapa.dibujoLote):
// cuando el lote de verdad entra por debajo, no hay salto.
//
// Se puede saltar tocando la pantalla, y con `prefers-reduced-motion` no
// se reproduce: quien no quiera espectáculo no lo tiene.
const DURACION_VOLQUETA = 2200;   // ms; el lote real aparece a los 1500
const LOTE_APARECE = 1500;

function animarLlegada(lote) {
  // El sonido va lo primero: se oye aunque la escena no se dibuje —por
  // "reducir movimiento" o por estar en otra pestaña—, que es cuando más
  // sirve, porque no hay nada que mirar.
  sonar('volqueta');
  const caja = document.querySelector('.mapa-caja');
  const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Si no hay escena, el lote tiene que aparecer YA. Dejar `naciendo`
  // puesto lo escondería para siempre.
  if (!caja || sinMovimiento || S.pestana !== 'mapa' || !Element.prototype.animate) {
    S.naciendo = null; refrescarMapa();
    return Promise.resolve();
  }

  const v = Mapa.obtenerVista();
  const rx = lote.rx || 40, ry = lote.ry || 40;
  const s = Math.max(rx, ry) / 46;          // la volqueta crece con el lote
  const col = paletaActual()[lote.estado] || '#d99a06';
  // La cola del volco queda sobre el borde derecho del montón: de ahí cae
  // el material. Entra y sale por fuera del encuadre, sea cual sea el
  // zoom: con una distancia fija, un lote pegado al borde haría que la
  // volqueta apareciera de la nada en mitad del patio.
  const cola = { x: lote.x + rx * .82, y: lote.y };
  const fuera = (v.x + v.w - cola.x) / s + 40;

  const piedras = Dibujo.terrones(col);
  const polvo = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2;
    return `<circle class="vq-polvo" cx="${(lote.x + Math.cos(a) * rx * .9).toFixed(1)}"
      cy="${(lote.y + Math.sin(a) * ry * .9).toFixed(1)}" r="${(8 + (i % 3) * 2) * s}"
      fill="#e9e5dc" stroke="#14171a" stroke-width="${1.8 * s}" opacity="0"/>`;
  }).join('');

  const capa = document.createElement('div');
  capa.className = 'capa-volqueta';
  capa.innerHTML = `
    <svg viewBox="${v.x} ${v.y} ${v.w} ${v.h}" preserveAspectRatio="xMidYMid meet">
      <defs>${Dibujo.DEFS}</defs>
      <g class="vq-monton" style="transform-origin:${cola.x}px ${cola.y}px" opacity="0">${Mapa.dibujoLote(lote)}</g>
      ${polvo}
      <g transform="translate(${cola.x} ${cola.y}) scale(${s})">
        ${piedras.map((t) => `<g transform="translate(0 ${t.y.toFixed(1)})"><path class="vq-terron" d="${t.d}"
          fill="${t.relleno}" stroke="#14171a" stroke-width="1.2" opacity="0"
          data-dx="${(-12 - t.kx * rx * 1.1 / s).toFixed(1)}" data-dy="${t.dy.toFixed(1)}"/></g>`).join('')}
        <g class="vq-mov"><g class="vq-vibra">${Dibujo.volquetaPlanta(col)}</g></g>
      </g>
    </svg>`;
  caja.appendChild(capa);

  const a = (sel, kf, o) => capa.querySelectorAll(sel).forEach((el) =>
    el.animate(kf, { fill: 'both', easing: 'cubic-bezier(.32,.72,0,1)', ...o }));
  const ent = 'cubic-bezier(.4,0,.2,1)';
  a('.vq-mov', [{ transform: `translateX(${fuera.toFixed(0)}px)` }, { transform: 'translateX(-6px)', offset: .85 }, { transform: 'none' }],
    { duration: 560, easing: 'cubic-bezier(.2,.7,.3,1)' });
  a('.vq-mov', [{ transform: 'none' }, { transform: `translateX(${(fuera + 160).toFixed(0)}px)` }],
    { duration: 520, delay: 1680, easing: 'cubic-bezier(.55,0,.9,.4)', fill: 'forwards', composite: 'replace' });
  a('.vq-vibra', [{ transform: 'none' }, { transform: 'translateY(.7px)' }, { transform: 'none' }],
    { duration: 110, iterations: 20, easing: 'linear', fill: 'none' });
  const volcar = [{ transform: 'none' }, { transform: 'scale(.7,1.06)', offset: .3 }, { transform: 'scale(.7,1.06)', offset: .78 }, { transform: 'none' }];
  a('.vq-volco', volcar, { duration: 1150, delay: 560, easing: ent });
  a('.vq-piston', [{ opacity: 0 }, { opacity: 1, offset: .2 }, { opacity: 1, offset: .8 }, { opacity: 0 }], { duration: 1150, delay: 560, easing: 'linear' });
  a('.vq-compuerta', [{ transform: 'none' }, { transform: 'translateX(-9px) scaleX(2.4)', offset: .3 },
    { transform: 'translateX(-9px) scaleX(2.4)', offset: .78 }, { transform: 'none' }], { duration: 1150, delay: 560, easing: ent });
  a('.vq-carga', [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-30px) scaleX(.5)' }],
    { duration: 650, delay: 760, easing: 'cubic-bezier(.5,0,.8,.6)' });
  capa.querySelectorAll('.vq-terron').forEach((t, i) => {
    const giro = (i % 2 ? 1 : -1) * 140, fin = `translate(${t.dataset.dx}px, ${t.dataset.dy}px) rotate(${giro}deg)`;
    t.animate([{ opacity: 1, transform: 'scale(1.5)' }, { opacity: 1, transform: fin, offset: .8 }, { opacity: 0, transform: fin }],
      { duration: 480, delay: 800 + i * 34, easing: 'cubic-bezier(.5,0,.9,.5)', fill: 'both' });
  });
  a('.vq-monton', [{ opacity: 0, transform: 'scale(.1,.3)' }, { opacity: 1, transform: 'scale(.35,.6)', offset: .15 }, { opacity: 1, transform: 'none' }],
    { duration: 760, delay: 860, easing: 'cubic-bezier(.2,.7,.3,1)' });
  a('.vq-polvo', [{ opacity: .95, transform: 'scale(.3)' }, { opacity: 0, transform: 'scale(1.5)' }],
    { duration: 650, delay: 1320, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' });
  a('.vq-humo', [{ opacity: .6, transform: 'scale(.6)' }, { opacity: 0, transform: 'translate(-14px,-10px) scale(1.8)' }],
    { duration: 420, delay: 1680, iterations: 2 });

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
    // el lote de verdad entra justo cuando el montón termina de formarse,
    // debajo del dibujado aquí: no hay salto, se relevan
    const t1 = setTimeout(() => { S.naciendo = null; refrescarMapa(); }, LOTE_APARECE);
    const t2 = setTimeout(terminar, DURACION_VOLQUETA);
    capa.onpointerdown = terminar;        // un toque la salta
  });
}

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
// Una vuelta del gag: clava la pala, tira, y el terrón le llega al casco
// al de al lado. Dura 800 ms, que es el original de 1,2 s a 1,5 veces la
// velocidad. Ocho vueltas son 6,4 s, que es lo que se pidió; el número
// va de aquí al CSS por `--vueltas`, así que no hay dos sitios que se
// puedan desincronizar y la escena nunca se corta a media palada.
const VUELTA_OBREROS = 800;
const VUELTAS_OBREROS = 8;
const DURACION_OBREROS = VUELTA_OBREROS * VUELTAS_OBREROS;

// Lo que ocupa la escena, medido desde donde se ancla —el centro es el
// lote y el suelo su línea de cintura—. Sirve para encuadrar el plano
// antes de montarla: si no cabe entera, la cuadrilla sale cortada.
// De izquierda a derecha va del montón acumulado al capataz; hacia
// arriba, hasta el cartel de "¡PLOF!".
const CAJA_OBREROS = { dx: 3, dy: -77, rx: 247, ry: 83 };

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

// Lleva el plano hasta el lote y espera a que llegue, ANTES de montar la
// escena.
//
// Hace falta porque la escena se dibuja sobre el encuadre que hay en ese
// momento: montarla y encuadrar después la dejaría centrada en el sitio
// de antes. Y no vale con `Mapa.enfocar` a secas sobre el lote, que
// enmarca un cuadro de 320 pensado para "¿dónde está este lote?": la
// cuadrilla mide 400 y saldría cortada por los lados. Se enmarca la caja
// de la escena, no la del lote.
//
// El plano se DESLIZA, no salta: si el lote estaba fuera de la pantalla,
// aparecer de golpe en otro sitio hace perder dónde se estaba.
function encuadrarPara(lote) {
  if (S.pestana !== 'mapa' || !document.querySelector('#lienzo')) return Promise.resolve();
  const s = (Math.max(lote.rx || 40, lote.ry || 40) / 40) * 0.8;
  const c = CAJA_OBREROS;
  Mapa.enfocar([{ x: lote.x + c.dx * s, y: lote.y + c.dy * s,
                  rx: c.rx * s, ry: c.ry * s }], { margen: 30 });
  // El deslizamiento dura 420 ms; se le da un respiro y se monta encima
  // del encuadre ya quieto.
  return new Promise((listo) => setTimeout(listo, 460));
}

// Monta la escena sobre el lote y la quita al terminar.
//
// Mismas reglas que la volqueta: capa aparte encima del plano —el mapa
// se redibuja en cada sincronización y la cortaría a la mitad— y con
// "reducir movimiento" no se monta.
//
// Pero esta NO se salta tocando, y la capa deja pasar el dedo al plano
// como si no estuviera. La volqueta dura 1,7 s y tapa el sitio donde
// acaba de aparecer el lote, así que ahí poder saltarla sirve. Esta dura
// seis segundos y la gente toca la pantalla todo el rato: lo único que
// conseguía el atajo era que se fuera sin que nadie lo hubiera pedido.
//
// La escena se dibuja con el suelo en y=250 y midiendo unos 500 de
// ancho. Se lleva encima del lote con un solo `translate`. Como la
// volqueta, crece con el lote: en un lote grande la cuadrilla también.
function animarMuestreo(lote) {
  const caja = document.querySelector('.mapa-caja');
  const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!caja || sinMovimiento || S.pestana !== 'mapa' || S.historia) return Promise.resolve();

  // Muestrear dos lotes seguidos no puede dejar dos cuadrillas encimadas.
  for (const vieja of caja.querySelectorAll('.capa-obreros')) vieja.remove();

  const v = Mapa.obtenerVista();
  const r = Math.max(lote.rx || 40, lote.ry || 40);
  // A tamaño natural la escena mide 500 de ancho y taparía medio patio;
  // a la mitad, la cara del que recibe el terronazo no se distingue en
  // un celular. 0,8 es donde el chiste se lee y el plano sigue viéndose.
  const s = (r / 40) * 0.8;

  const capa = document.createElement('div');
  capa.className = 'capa-obreros';
  // Las vueltas y el momento de irse salen de aquí, no del CSS: un solo
  // sitio del que dependen el dibujo, los ruidos y el reloj que la quita.
  capa.style.setProperty('--vueltas', VUELTAS_OBREROS);
  capa.style.setProperty('--sale-en', `${DURACION_OBREROS - 200}ms`);
  capa.innerHTML = `
    <svg viewBox="${v.x} ${v.y} ${v.w} ${v.h}" preserveAspectRatio="xMidYMid meet">
      <g transform="translate(${lote.x} ${lote.y}) scale(${s})
                    translate(${-CENTRO_OBREROS} ${-SUELO_OBREROS})">
        ${escenaObreros()}
      </g>
    </svg>`;
  caja.appendChild(capa);

  // Los ruidos van con los fotogramas, no al bulto. Dentro de cada
  // vuelta: clava la pala al 15 %, la suelta al 57 %, el terrón le llega
  // al casco al 78 % y el casco rebota al 83 %.
  const relojes = [];
  for (let i = 0; i < VUELTAS_OBREROS; i++) {
    const vuelta = i * VUELTA_OBREROS;
    for (const [ruido, pct] of [['palada', 15], ['tiro', 57], ['golpe', 78], ['casco', 83]])
      relojes.push(ruidoEn(ruido, vuelta + Math.round(VUELTA_OBREROS * pct / 100)));
  }

  // Si mientras tanto se cambia de pestaña, de plataforma o se entra a
  // mirar otro día, el plano se rearma entero y se lleva la capa por
  // delante. No hace falta vigilarlo: cuando salte este reloj, quitar un
  // nodo que ya no está en la página no hace nada.
  return new Promise((listo) => setTimeout(() => {
    for (const t of relojes) clearTimeout(t);
    capa.remove();
    listo();
  }, DURACION_OBREROS));
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
  const ayuda = tipo === 'lote' && Mapa.esGrupoBigbags(obj)
    ? `arrástralo para moverlo; la manija del costado reparte las columnas (de a ${Mapa.ALTO_BIGBAGS} bigbags) y la de arriba lo gira`
    : obj.forma === 'poligono'
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

  // Acomodarlo dentro de SU pila (solo pasa en las de bigbags, que son las
  // que muestran sus lotes): no cambia de pila, solo de sitio.
  if (blanco.tipo === 'pila' && lote.pila_id === blanco.obj.id) {
    const ok = await confirmar({
      titulo: `¿Dejar ${lote.codigo} aquí?`,
      detalle: `Se acomoda dentro de la pila ${blanco.obj.codigo}.`,
      aceptar: 'Dejar aquí'
    });
    if (!ok) return volver();
    await Store.guardarFigura('lotes', { ...lote });
    await anotarRecorrido(lote, antes);
    await recargar(); sincronizar();
    return;
  }

  if (blanco.tipo === 'pila') {
    const anterior = lote.pila_id ? S.pilas.find((p) => p.id === lote.pila_id) : null;
    const ok = await confirmar({
      titulo: `¿Meter ${lote.codigo} en la pila ${blanco.obj.codigo}?`,
      detalle: 'Queda registrado en el historial del lote y en el de la pila.',
      aceptar: 'Meterlo'
    });
    if (!ok) return volver();
    await Store.guardarFigura('lotes', { ...lote });
    // Meterlo a la pila LO MUEVE: la posición que se acaba de guardar es
    // la del punto donde se soltó el dedo, encima de la pila, y pisa la
    // que tenía en el patio. Sin apuntar ese traslado, mirar un día en
    // que el lote todavía andaba suelto lo dibujaba sobre la pila, junto
    // a todos los demás que entraron igual: montados unos sobre otros.
    // Va ANTES del ingreso porque eso fue lo que pasó: primero se movió.
    await anotarRecorrido(lote, antes);
    await Store.registrarEvento({
      lote_id: lote.id, tipo: 'ingreso_pila', pila_id: blanco.obj.id, usuario_id: S.perfil.id
    });
    // venía de otra pila de bigbags: esa puede quedarse con uno solo
    if (anterior) await revisarPila(anterior);
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
  const codigo = siguienteCodigoPila();
  let geo = { x: (lote.x + otro.x) / 2, y: (lote.y + otro.y) / 2,
              rx: Math.max(lote.rx, otro.rx) + 46, ry: Math.max(lote.ry, otro.ry) + 34 };
  // Dos lotes de bigbags no se montan uno encima del otro: en una pila de
  // bigbags se ve cada grupo con su código. El que se soltó se acomoda al
  // lado del otro, y la pila (rectangular) abarca a los dos.
  if (lote.material === 'bigbag' && otro.material === 'bigbag') {
    lote.x = otro.x + otro.rx + lote.rx + 10; lote.y = otro.y;
    await Store.guardarFigura('lotes', { ...lote });
    const x1 = otro.x - otro.rx, x2 = lote.x + lote.rx;
    const y1 = Math.min(otro.y - otro.ry, lote.y - lote.ry), y2 = Math.max(otro.y + otro.ry, lote.y + lote.ry);
    geo = { x: (x1 + x2) / 2, y: (y1 + y2) / 2, rx: (x2 - x1) / 2 + 22, ry: (y2 - y1) / 2 + 26, forma: 'rectangulo' };
  }
  const pila = await Store.crearPila({
    codigo, tipo: 'otro', nota: null, ...geo,
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
    // De dónde SALIÓ va fechado un milisegundo antes que la llegada, y no
    // "ahora" como todo lo demás. Es lo que pasó —estaba ahí antes de
    // llegar— y hace falta: la hora de un evento se mide en milisegundos
    // y las dos escrituras caben en uno, así que empataban. Al releerlas,
    // IndexedDB las devuelve en orden de clave —un uuid al azar—, y la
    // pareja venía al revés la mitad de las veces: mirar el pasado
    // dibujaba el lote en el sitio al que iba, no en el que dejaba.
    await Store.registrarEvento({
      lote_id: lote.id, tipo: 'movimiento', x: origen.x, y: origen.y, usuario_id: S.perfil.id,
      ocurrido_en: new Date(Date.now() - 1).toISOString()
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
// Cómo se ordena la lista. La de siempre es la del último movimiento:
// lo que acaba de pasar arriba. Las demás responden a preguntas del
// patio: "¿qué llegó ayer?", "¿qué lleva más tiempo esperando?".
const ORDENES = {
  actividad:     { nombre: 'Último movimiento',
                   cmp: (a, b) => (b.ultimo_evento_en || '').localeCompare(a.ultimo_evento_en || '') },
  recibido_desc: { nombre: 'Recibido: más reciente primero',
                   cmp: (a, b) => (b.fecha_recepcion || '').localeCompare(a.fecha_recepcion || '')
                     || (b.creado_en || '').localeCompare(a.creado_en || '') },
  recibido_asc:  { nombre: 'Recibido: más antiguo primero',
                   cmp: (a, b) => (a.fecha_recepcion || '').localeCompare(b.fecha_recepcion || '')
                     || (a.creado_en || '').localeCompare(b.creado_en || '') },
  quieto:        { nombre: 'Más días en su estado',
                   cmp: (a, b) => (a.estado_desde || '').localeCompare(b.estado_desde || '') },
  codigo:        { nombre: 'Código (A → Z)',
                   cmp: (a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }) }
};

// Cuántos filtros de "Más filtros" están puestos: el botón lo dice, para
// que un filtro escondido no deje la lista corta sin explicación.
const extrasPuestos = () =>
  ['plataforma', 'material', 'pila', 'desde', 'hasta'].filter((k) => S.lista[k]).length;

// Los filtros de la lista, salvo el de estado. Va aparte porque el
// desplegable de estado cuenta cuántos hay de cada uno DENTRO de lo que
// ya filtran los demás: "Devolución · 3" tiene que ser 3 de ese proveedor,
// no 3 del patio entero.
function cumpleLista(l, pilas) {
  const f = S.lista;
  const q = S.busqueda.trim().toUpperCase();
  if (f.proveedor && l.proveedor_id !== f.proveedor) return false;
  if (f.plataforma && l.plataforma_id !== f.plataforma) return false;
  if (f.material && (l.material || 'granel') !== f.material) return false;
  if (f.pila === 'suelto' ? !!l.pila_id
    : f.pila === 'alguna' ? !l.pila_id
    : f.pila ? l.pila_id !== f.pila : false) return false;
  // fecha_recepcion es "AAAA-MM-DD", así que se compara como texto
  if (f.desde && (l.fecha_recepcion || '') < f.desde) return false;
  if (f.hasta && (l.fecha_recepcion || '') > f.hasta) return false;
  return !q || l.codigo.includes(q) || (pilas[l.pila_id] || '').includes(q)
    || placasDe(l).some((pl) => pl.toUpperCase().includes(q));
}

// Antes los estados eran una fila de pastillas que se salía de la
// pantalla y había que arrastrar para ver las últimas; y no había forma
// de mirar un solo proveedor. Ahora son desplegables: caben todos, se
// combinan, y lo menos usado queda bajo "Más filtros".
function pintarLista() {
  const prov = Object.fromEntries(S.proveedores.map((p) => [p.id, p.abreviatura]));
  const pilas = Object.fromEntries(S.pilas.map((p) => [p.id, p.codigo]));
  const f = S.lista;
  // La lista es de TODAS las plataformas a propósito: es donde se viene a
  // buscar un lote que no se sabe dónde está. Cada tarjeta dice en cuál.
  //
  // Los alimentados ya no están en el patio: para el contratista
  // desaparecen, y el admin los sigue viendo porque de eso se trata la
  // trazabilidad.
  const alcance = S.lotes.filter(seVeEnLaLista);
  const base = alcance.filter((l) => cumpleLista(l, pilas));
  const conteo = (e) => base.filter((l) => l.estado === e).length;
  const nVenc = base.filter(vencido).length;

  const orden = ORDENES[S.orden] || ORDENES.actividad;
  const visibles = base.filter((l) => {
    if (S.filtro === 'vencidas') return vencido(l);
    return S.filtro === 'todos' || l.estado === S.filtro;
  }).sort(orden.cmp);

  const opcion = (valor, texto, elegido) =>
    `<option value="${esc(valor)}" ${valor === elegido ? 'selected' : ''}>${esc(texto)}</option>`;
  // Un estado sin lotes no se ofrece, salvo que sea el elegido: si
  // desapareciera del desplegable, no habría cómo ver qué está puesto.
  const estados = Object.entries(ESTADOS).filter(([k]) => conteo(k) || S.filtro === k);
  const provs = [...S.proveedores].sort((a, b) => a.abreviatura.localeCompare(b.abreviatura));
  // Las pilas se llaman 1, 2, 3 en CADA plataforma: el nombre solo no
  // dice cuál es, así que se le pega el sitio.
  const pilasAbiertas = S.pilas.filter((p) => p.estado === 'abierta')
    .sort((a, b) => nombrePlataforma(a.plataforma_id).localeCompare(nombrePlataforma(b.plataforma_id))
      || a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
  const nExtras = extrasPuestos();
  const algoPuesto = S.filtro !== 'todos' || f.proveedor || nExtras || S.busqueda.trim();

  $('#main').innerHTML = `
    <input class="buscador" id="q" placeholder="Buscar lote, pila o placa…" value="${esc(S.busqueda)}">
    <div class="filtros-lista">
      <label class="desplegable"><span>Estado</span>
        <select id="f-estado">
          ${opcion('todos', `Todos · ${base.length}`, S.filtro)}
          ${nVenc || S.filtro === 'vencidas' ? opcion('vencidas', `Sin recoger · ${nVenc}`, S.filtro) : ''}
          ${estados.map(([k, v]) => opcion(k, `${v} · ${conteo(k)}`, S.filtro)).join('')}
        </select></label>
      <label class="desplegable"><span>Proveedor</span>
        <select id="f-proveedor">
          ${opcion('', 'Todos', f.proveedor)}
          ${provs.map((p) => opcion(p.id, `${p.abreviatura} · ${p.nombre}`, f.proveedor)).join('')}
        </select></label>
      <label class="desplegable"><span>Ordenar</span>
        <select id="f-orden">
          ${Object.entries(ORDENES).map(([k, o]) => opcion(k, o.nombre, S.orden)).join('')}
        </select></label>
      <button class="mas-filtros" id="f-mas" aria-expanded="${S.masFiltros}"
        ${nExtras ? 'data-puestos="si"' : ''}>${ICO.filtro}<span>Más filtros${nExtras ? ` · ${nExtras}` : ''}</span></button>
    </div>
    <div class="filtros-lista" id="f-extra" ${S.masFiltros ? '' : 'hidden'}>
      ${S.plataformas.length > 1 ? `<label class="desplegable"><span>Plataforma</span>
        <select id="f-plataforma">
          ${opcion('', 'Todas', f.plataforma)}
          ${S.plataformas.map((p) => opcion(p.id, p.nombre, f.plataforma)).join('')}
        </select></label>` : ''}
      <label class="desplegable"><span>Material</span>
        <select id="f-material">
          ${opcion('', 'Todos', f.material)}
          ${Object.entries(MATERIALES).map(([k, v]) => opcion(k, v, f.material)).join('')}
        </select></label>
      <label class="desplegable"><span>Pila</span>
        <select id="f-pila">
          ${opcion('', 'Todas', f.pila)}
          ${opcion('suelto', 'Sueltos (sin pila)', f.pila)}
          ${opcion('alguna', 'En alguna pila', f.pila)}
          ${pilasAbiertas.map((p) => opcion(p.id, `Pila ${p.codigo}${
            S.plataformas.length > 1 ? ` · ${nombrePlataforma(p.plataforma_id)}` : ''}`, f.pila)).join('')}
        </select></label>
      <label class="desplegable"><span>Recibido desde</span>
        <input type="date" id="f-desde" value="${esc(f.desde)}" ${f.hasta ? `max="${esc(f.hasta)}"` : ''}></label>
      <label class="desplegable"><span>Recibido hasta</span>
        <input type="date" id="f-hasta" value="${esc(f.hasta)}" ${f.desde ? `min="${esc(f.desde)}"` : ''}></label>
    </div>
    <div class="resumen-lista">
      <span>${visibles.length === alcance.length ? `${alcance.length} lote${alcance.length === 1 ? '' : 's'}`
        : `${visibles.length} de ${alcance.length} lotes`}</span>
      ${algoPuesto ? '<button class="enlace" id="f-limpiar">Quitar filtros</button>' : ''}
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
  $('#f-estado').onchange = (e) => { S.filtro = e.target.value; pintarLista(); };
  $('#f-orden').onchange = (e) => { S.orden = e.target.value; pintarLista(); };
  for (const k of ['proveedor', 'plataforma', 'material', 'pila', 'desde', 'hasta']) {
    const c = $(`#f-${k}`);
    if (c) c.onchange = () => { S.lista[k] = c.value; pintarLista(); };
  }
  $('#f-mas').onclick = () => { S.masFiltros = !S.masFiltros; pintarLista(); };
  const lim = $('#f-limpiar');
  if (lim) lim.onclick = () => {
    S.filtro = 'todos'; S.busqueda = ''; S.lista = filtroListaVacio();
    pintarLista();
  };
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
function abrirHoja(html, fijo = '', esquina = '') {
  // En la pantalla de ingreso todavía no existe el contenedor, y un aviso
  // no puede tumbar la app por no tener dónde ponerse.
  let m = $('#modal');
  if (!m) { m = document.createElement('div'); m.id = 'modal'; document.body.appendChild(m); }
  // La equis va aquí y no en cada hoja: el botón de cerrar vivía al final
  // del todo, así que en una ficha con historial largo había que bajar
  // hasta abajo para salir. Quien abra una hoja la tiene sin hacer nada.
  // Si hay encabezado fijo, viaja dentro de él; si no, se pega sola.
  //
  // `esquina` es para el botón que acompaña a la equis, como el de la
  // tienda dentro de Monedas. Va DESPUÉS de ella en el código y a su
  // izquierda en la pantalla: los dos flotan a la derecha, y el primero
  // que se escribe es el que queda más a la derecha del todo.
  const equis = `<button class="cerrar-hoja" id="x-hoja" aria-label="Cerrar">${ICO.cerrar}</button>`;
  m.innerHTML = `<div class="velo"><div class="hoja">
    ${fijo ? `<div class="hoja-fija">${equis}${esquina}${fijo}</div>` : equis + esquina}
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
    <h3>Monedas</h3>
    <button class="btn btn-ancho" id="monedas" style="width:100%">Mis monedas y la clasificación</button>

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
  $('#monedas').onclick = accion(() => panelMonedas(), { ocupado: 'Contando…' });
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
    await soltarUbicacion();
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
  // SistemaCM lee esta columna al auditar el Stock contra el patio: dice si
  // el lote ya no está donde lo descargó la volqueta.
  { clave: 'movido',     titulo: 'Movido en el patio', ancho: 17 },
  { clave: 'recogida',   titulo: 'Fecha de recogida', ancho: 17 },
  { clave: 'nota',       titulo: 'Observaciones',     ancho: 60 }
];

// Días entre dos fechas sueltas ("2026-07-28"). No se usa `dias()`: ese
// espera una marca de tiempo y al pasarle una fecha a secas la corre un
// día en nuestro huso, porque la lee como medianoche UTC.
const diasEntreFechas = (desde) =>
  desde ? Math.round((Date.parse(hoyISO()) - Date.parse(desde)) / 86_400_000) : '';

function filasDelInforme(notas, movidos) {
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
      movido: movidos.ids.has(l.id) ? 'Sí' : movidos.completo ? 'No' : '',
      // la recogida solo compromete mientras el lote sea devolución
      recogida: enDevolucion(l) ? (l.fecha_recogida || '') : '',
      nota: notas.get(l.id) || ''
    }));
}

async function panelInforme() {
  const [{ notas, completo }, movidos] = await Promise.all([Store.observaciones(), Store.movidos()]);
  const filas = filasDelInforme(notas, movidos);
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
    ${completo && movidos.completo ? '' : `<p class="aviso">Sin señal para traer las observaciones
       y los movimientos del servidor. Esas dos columnas llevan solo lo que ya estaba en este
       celular; el resto sí va completo.</p>`}
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
    await soltarUbicacion();
    await Store.salir();
    location.reload();
  }, { ocupado: 'Cerrando…' });
}

async function fichaLote(id) {
  const l = await Store.lote(id);
  if (!l) return;
  const prov = S.proveedores.find((p) => p.id === l.proveedor_id);
  // Solo una pila abierta: un lote alimentado con su pila sigue apuntando a
  // ella, y ofrecer "sacarlo" de una pila archivada no tiene sentido.
  const pila = S.pilas.find((p) => p.id === l.pila_id && p.estado === 'abierta');
  const eventos = await Store.historial(id);
  const r = textoRecogida(l);
  const lectura = soloLectura();

  // De quién es la ficha, en qué estado está y para cuándo se recoge: eso
  // se queda arriba, y todo lo demás pasa por debajo.
  const encabezado = `
    <h2>${codigoHTML(l.codigo)}</h2>
    <div class="sub">${esc(prov?.nombre || '—')} · ${MATERIALES[l.material || 'granel']}${
      l.material === 'bigbag' && Number(l.bigbags) > 0 ? ` × ${Number(l.bigbags)}` : ''}
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
      ${estadosPosibles(l)
        .map((k) => `<button data-estado="${k}">${ESTADOS[k]}</button>`).join('')}
    </div>
    ${l.estado === 'por_muestrear' ? `<p class="pista">Hasta que no esté muestreado no se
       puede hacer nada más con él: sin muestra no se sabe qué material es.</p>` : ''}

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
      ${l.material === 'bigbag' ? `
      <h3>Bigbags</h3>
      <div class="campo">
        <label for="bb-cant">Cantidad</label>
        <input id="bb-cant" type="number" inputmode="numeric" min="1" max="${MAX_BIGBAGS}" value="${Number(l.bigbags) || 1}">
      </div>
      <button class="btn btn-guardar btn-ancho" id="bb-guardar" style="width:100%">Guardar cantidad</button>
      <p class="pista">Se apilan de a ${Mapa.ALTO_BIGBAGS} en el mapa. Para repartir las columnas de otra forma, toca «Ajustar forma» y arrastra la manija del costado: cambia la distribución, no el tamaño de cada bigbag.</p>` : ''}

      <h3>Forma en el mapa</h3>
      <div class="acciones">
        <button id="editar-forma">Ajustar forma</button>
        ${Mapa.esGrupoBigbags(l) ? '' : `<button id="poligono">${l.forma === 'poligono' ? 'Volver a la forma simple' : 'Dibujar a mano'}</button>`}
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
        <div class="que">${esc(textoEvento(e))}</div>
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
    detalle: `Está en ${nombrePlataforma(l.plataforma_id)}. Su estado no cambia`
      + (pila ? `, pero SALE de la pila ${pila.codigo}: se lleva ese lote y no el montón entero.`
              : ': solo cambia de patio, y queda apuntado en su historial.'),
    desde: l.plataforma_id,
    alSoltar: async (id) => {
      await Store.trasladarLote(l.id, id, S.perfil.id);
      // La pila de la que salió puede haberse quedado con uno solo, y una
      // pila de un lote no es una pila: se disuelve, igual que al sacarlo
      // a mano desde su ficha.
      if (pila) await revisarPila(pila);
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
        if (enEstaPlataforma(fresco)) {
          await encuadrarPara(fresco);
          await animarMuestreo(fresco);
        }
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
        // vuelve a bigbag con la cantidad que ya tenía: ocupa lo de su grupo
        if (material === 'bigbag' && Number(l.bigbags) > 0) {
          const d = Mapa.disposicionBigbags(l.bigbags, l.bigbags_fila);
          Object.assign(cambios, { rx: d.rx, ry: d.ry });
        }
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

  const bb = $('#bb-guardar');
  if (bb) bb.onclick = accion(async () => {
    const n = leerBigbags('#bb-cant');
    if (!n) return avisar(`Escribe cuántos bigbags son (de 1 a ${MAX_BIGBAGS}).`);
    // el reparto que ya tenía se respeta; el tamaño sale de la cantidad
    const d = Mapa.disposicionBigbags(n, l.bigbags_fila);
    await Store.actualizarLote(l.id, { bigbags: n, bigbags_fila: l.bigbags_fila ? d.porFila : null,
                                       forma: 'rectangulo', rx: d.rx, ry: d.ry });
    cerrarHoja(); await recargar(); sincronizar();
  }, { ocupado: 'Guardando…' });

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

  // Cambiar el proveedor corrige el código en el acto, a la vista, en vez
  // de hacerlo por debajo al guardar: así se ve qué va a quedar y se
  // puede retocar a mano antes de aceptar. Sigue siendo un campo de
  // texto normal; esto solo adelanta el trabajo.
  const ap = $('#a-prov'), ac = $('#a-cod');
  if (ap && ac) {
    let sigla = siglaDe(l.proveedor_id);
    ap.onchange = () => {
      const nueva = siglaDe(ap.value);
      ac.value = recodificar(ac.value, sigla, nueva);
      sigla = nueva;
    };
  }

  const ag = $('#a-guardar');
  if (ag) ag.onclick = accion(async () => {
    const codigo = $('#a-cod').value.trim().toUpperCase();
    if (!codigo) return;
    // El código es único en TODO el patio, no solo en esta plataforma.
    // Sin esta comprobación el servidor lo rechazaba después, en la cola,
    // y el aviso llegaba lejos del momento en que se pudo arreglar.
    const repetido = S.lotes.find((x) => x.codigo === codigo && x.id !== l.id);
    if (repetido) {
      return avisar(`Ya hay otro lote con el código ${codigo}, en ${
        nombrePlataforma(repetido.plataforma_id)}. Cámbialo antes de guardar.`);
    }
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

// Lo mismo para una pila entera. La regla —admin y Plataforma 5— se
// vuelve a mirar aquí y no solo al pintar el botón: la ficha pudo quedarse
// abierta mientras la pila se movía de plataforma.
function pedirPuntoPila(p, dentro) {
  if (!esAdmin() || !esPlataforma5(p.plataforma_id)) {
    return avisar('Una pila entera solo la puede alimentar el administrador, y solo en Plataforma 5.');
  }
  if (!S.puntos.length) {
    return avisar('No hay puntos de alimentación configurados todavía. '
      + 'Se añaden en la tabla `puntos_alimentacion`.');
  }
  const listos = dentro.filter((l) => l.estado !== 'alimentado' && l.estado !== 'por_muestrear');
  const sinMuestra = dentro.filter((l) => l.estado === 'por_muestrear');
  if (!listos.length) {
    return avisar(sinMuestra.length
      ? 'Todos los lotes de la pila están por muestrear: hay que muestrearlos antes de alimentarlos.'
      : 'No queda ningún lote por alimentar en esta pila.');
  }
  abrirHoja(`
    <div class="sub">¿Por dónde se alimentó?</div>
    <div class="acciones acciones-plat" id="pt-lista">
      ${S.puntos.map((x) => `<button class="btn btn-ancho" data-id="${x.id}"
        >${esc(x.nombre)}</button>`).join('')}
    </div>
    <p class="pista">Pasan a alimentado ${listos.length} lote${listos.length === 1 ? '' : 's'}.
      ${sinMuestra.length ? `Se quedan en la pila ${sinMuestra.length} por muestrear:
      ${sinMuestra.map((l) => esc(l.codigo)).join(', ')}.` : 'La pila se archiva al terminar.'}
      Nada se borra: cada lote conserva su historial.</p>
    <div class="acciones"><button id="pt-cancelar">Cancelar</button></div>`,
    `<h2>Pila ${esc(p.codigo)} · alimentada</h2>`);
  $('#pt-cancelar').onclick = () => fichaPila(p.id);
  for (const b of document.querySelectorAll('#pt-lista button'))
    b.onclick = accion(async () => {
      await Store.alimentarPila(p.id, b.dataset.id, S.perfil.id);
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
  // por código, para dar con uno a ojo en una pila de veinte
  const dentro = S.lotes.filter((l) => l.pila_id === id)
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
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

    ${!lectura && esAdmin() && esPlataforma5(p.plataforma_id) && dentro.length ? `
    <h3>Alimentar</h3>
    <button id="alimentar-pila" class="btn-lleno btn-ancho" style="width:100%"
      >Pasar toda la pila a Alimentado</button>
    <p class="pista">Cada lote queda alimentado por el mismo punto, con su apunte en el
      historial. Los que estén por muestrear no se tocan. Solo el administrador, y solo
      en Plataforma 5.</p>` : ''}

    <h3>Lotes en esta pila</h3>
    ${dentro.length > 1 ? `<input class="buscador" id="pila-q" placeholder="Buscar lote, proveedor o placa…">` : ''}
    ${!lectura && dentro.length > 1 ? `
    <!-- La casilla reemplaza al botón "Sacar" de cada fila: marcar uno y
         sacarlo es lo mismo, y los dos juntos dejaban la tarjeta tan
         angosta que el estado se montaba sobre el código. -->
    <div class="barra-seleccion">
      <label class="marca-todos"><input type="checkbox" id="pila-todos"><span>Seleccionar todos</span></label>
      <button class="pastilla pastilla-fuerte" id="sacar-varios" disabled>Sacar seleccionados</button>
    </div>` : ''}
    <div class="lista">
      ${dentro.length ? dentro.map((l) => `
        <div class="fila-pila" data-busca="${esc([l.codigo, prov[l.proveedor_id], ...placasDe(l)].join(' ').toUpperCase())}">
          ${!lectura && dentro.length > 1 ? `<label class="marca"><input type="checkbox" data-elegir="${l.id}"
            aria-label="Elegir ${esc(l.codigo)}"></label>` : ''}
          <button class="lote" data-id="${l.id}" data-estado="${l.estado}" data-vencida="${vencido(l) ? 'si' : 'no'}">
            <span class="barra"></span>
            <span class="cuerpo"><span class="codigo">${codigoHTML(l.codigo)}</span>
              <span class="meta"><span>${esc(prov[l.proveedor_id] || '—')}</span>
              <span>${esc(placasTexto(l))}</span></span></span>
            <span class="lado"><span class="etiqueta" data-e="${l.estado}">${ESTADOS[l.estado]}</span></span>
          </button>
          ${lectura || dentro.length > 1 ? '' : `<button class="pastilla" data-sacar="${l.id}">Sacar</button>`}
        </div>`).join('')
        : '<div class="vacio"><strong>Pila vacía</strong>Arrastra lotes sobre ella en el mapa.</div>'}
      <div class="vacio" id="pila-nada" hidden><strong>Ningún lote coincide</strong>Cambia la búsqueda.</div>
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

  // Buscar dentro de la pila. Se esconden las filas en vez de repintar la
  // hoja, que perdería el foco del campo y lo que ya estaba marcado.
  const filas = [...document.querySelectorAll('.hoja .fila-pila')];
  const marcas = () => filas.filter((f) => !f.hidden)
    .map((f) => f.querySelector('[data-elegir]')).filter(Boolean);
  const elegidos = () => marcas().filter((c) => c.checked).map((c) => c.dataset.elegir);
  const alElegir = () => {
    const b = $('#sacar-varios'); if (!b) return;
    const n = elegidos().length, visibles = marcas().length;
    b.disabled = n === 0;
    b.textContent = n ? `Sacar ${n} lote${n === 1 ? '' : 's'}` : 'Sacar seleccionados';
    const t = $('#pila-todos');
    t.checked = visibles > 0 && n === visibles;
    t.indeterminate = n > 0 && n < visibles;
  };
  const pq = $('#pila-q');
  if (pq) pq.oninput = () => {
    const q = pq.value.trim().toUpperCase();
    for (const f of filas) {
      f.hidden = !!q && !f.dataset.busca.includes(q);
      // Lo que se esconde se desmarca: sacar un lote que no se está
      // viendo, solo porque se marcó antes de buscar, sería una sorpresa.
      const c = f.querySelector('[data-elegir]');
      if (f.hidden && c) c.checked = false;
    }
    $('#pila-nada').hidden = filas.some((f) => !f.hidden);
    alElegir();
  };
  document.querySelectorAll('.hoja [data-elegir]').forEach((c) => { c.onchange = alElegir; });
  const todos = $('#pila-todos');
  if (todos) todos.onchange = () => {
    for (const c of marcas()) c.checked = todos.checked;
    alElegir();
  };

  // Sacar varios de una vez. Antes había que abrir, confirmar y volver a
  // la pila por cada lote. Una sola pregunta, y la pila se revisa al
  // final una sola vez: si se queda con uno o con ninguno, se disuelve.
  const sv = $('#sacar-varios');
  if (sv) sv.onclick = accion(async () => {
    const ids = elegidos(); if (!ids.length) return;
    const codigos = dentro.filter((l) => ids.includes(l.id)).map((l) => l.codigo);
    const quedan = dentro.length - ids.length;
    const ok = await confirmar({
      titulo: `¿Sacar ${ids.length} lote${ids.length === 1 ? '' : 's'} de la pila ${p.codigo}?`,
      detalle: `${codigos.join(', ')}. Vuelven al patio, junto a la pila.`
        + (quedan <= 1 ? ` La pila queda con ${quedan === 1 ? 'un solo lote' : 'ninguno'} y se disuelve:`
          + ' se archiva y su historial se conserva.' : ''),
      aceptar: ids.length === 1 ? 'Sacarlo' : 'Sacarlos'
    });
    if (!ok) return fichaPila(id);
    for (const lid of ids) {
      const l = await Store.lote(lid);
      if (l?.pila_id === id) await sacarDePila(l, p, { revisar: false });
    }
    await revisarPila(p);
    cerrarHoja(); await recargar(); sincronizar();
  }, { ocupado: 'Sacando…' });
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

  const al = $('#alimentar-pila');
  if (al) al.onclick = () => pedirPuntoPila(p, dentro);

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
    <p class="pista" id="f-quedara"></p>
    ${cajaPlacas('f-placa')}
    <div class="campo">
      <label>Tipo de material</label>
      <div class="acciones">
        <button type="button" id="fm-granel" class="btn-lleno">Granel</button>
        <button type="button" id="fm-bigbag">Bigbag</button>
      </div>
    </div>
    <div class="campo" id="f-bb" hidden>
      <label for="f-bigbags">Cantidad de bigbags</label>
      <input id="f-bigbags" type="number" inputmode="numeric" min="1" max="${MAX_BIGBAGS}" value="1">
    </div>
    <p class="pista" id="f-bb-pista" hidden>En el mapa se apilan de a ${Mapa.ALTO_BIGBAGS}. Cómo se reparten las columnas se ajusta después, desde «Ajustar forma».</p>
    <p id="f-error" class="aviso" hidden></p>
    <div class="acciones">
      <button id="f-cancelar">Cancelar</button>
      <button id="f-guardar" class="btn-lleno">Poner en el mapa</button>
    </div>`);
  let material = 'granel';
  const sigla = () => S.proveedores.find((p) => p.id === $('#f-prov').value)?.abreviatura || '';

  // El código completo no lo escribe nadie, así que se enseña: es lo que
  // va a quedar rotulado en la bolsa y lo que se busca después.
  const codigoDe = () => sigla() + $('#f-num').value.trim().toUpperCase();
  const rotular = () => {
    const c = codigoDe();
    $('#f-quedara').textContent = $('#f-num').value.trim() ? `Quedará como ${c}` : '';
  };
  $('#f-num').oninput = rotular;
  $('#f-prov').onchange = () => { $('#f-sigla').textContent = sigla(); rotular(); };
  const elegirMaterial = (m) => {
    material = m;
    $('#fm-granel').classList.toggle('btn-lleno', m === 'granel');
    $('#fm-bigbag').classList.toggle('btn-lleno', m === 'bigbag');
    $('#f-bb').hidden = $('#f-bb-pista').hidden = m !== 'bigbag';
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
    const codigo = codigoDe();
    if (!num) return falla('Escribe el número del lote.');
    if (!placa) return falla('La placa de la volqueta es obligatoria.');
    // sin proveedor el servidor rechaza el lote y todo lo que cuelgue de
    // él; es preferible pararlo aquí que dejarlo trabado en la cola
    if (!proveedor_id) return falla('No hay proveedores cargados todavía. Sincroniza antes de registrar el lote.');
    if (S.lotes.some((l) => l.codigo === codigo)) {
      return falla(`El lote ${codigo} ya está registrado.`);
    }
    const bigbags = material === 'bigbag' ? leerBigbags('#f-bigbags') : null;
    if (material === 'bigbag' && !bigbags) return falla(`Escribe cuántos bigbags son (de 1 a ${MAX_BIGBAGS}).`);
    const disp = bigbags ? Mapa.disposicionBigbags(bigbags) : null;
    const nuevo = await Store.crearLote({
      codigo, proveedor_id, placa,
      // el lote nace donde estás parado: para meter uno en Ye se abre el
      // plano de Ye y se le da a "Nuevo lote" allí
      plataforma_id: S.plataforma,
      material, forma: FORMA_DE[material],
      bigbags, tam: disp ? { rx: disp.rx, ry: disp.ry } : null,
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

// ------------------------------------------------------------------- GPS
// El punto azul es uno mismo; los negros con nombre, los compañeros. Todo
// se dibuja en una capa aparte del plano (ver mapa.js).
//
// Ver y compartir van por separado.
//
// A los demás se los ve SIEMPRE, sin tocar nada: quien mira el plano
// desde la oficina, o un contratista buscando a un compañero, no tiene
// por qué prender su propio GPS para eso.
//
// El botón «Ubicación» es solo lo propio: el punto azul, y compartirlo.
// Y compartir es SOLO dentro del patio: la posición se sube mientras cae
// en el plano de alguna plataforma calibrada. Fuera de ahí —en la
// oficina, en la casa, camino al trabajo— no sale nada del teléfono, y se
// borra la que hubiera.
// Lo propio sube en cuanto se mueve 3 m, como mucho cada 2 s: eso es lo
// que los demás ven en tiempo real. Quieto, cada 15 s, para seguir vivo.
const CADA_ENVIO_MS = 15_000;
const MOVIDO_M = 3;
const ENTRE_ENVIOS_MS = 2000;
// A los demás se los ve EN VIVO (ver escucharUbicaciones en store.js).
// Preguntar sigue haciendo falta, pero de respaldo: al abrir, para saber
// quién estaba ya; cada minuto, por si se perdió algún aviso; y cada 15 s
// mientras la conexión en vivo esté caída, que con la señal del patio pasa.
const CADA_LECTURA_AJENA_MS = 15_000;
const SIN_NADIE_CADA_MS = 60_000;
// Un punto del que no se sabe nada en este rato deja de dibujarse: es lo
// mismo que hace la vista del servidor con los de hace diez minutos.
const OLVIDAR_MS = 10 * 60_000;
const VIEJO_S = 90;                       // a partir de aquí el punto se pinta desvaído
// Una lectura peor que esto no se comparte: es la del teléfono adivinando
// con las antenas, y pintaría a la persona en la otra punta del patio.
const PRECISION_COMPARTIR_M = 60;
// Cuánto se puede salir alguien del dibujo y seguir viéndose: la vía de
// entrada, el parqueadero de las volquetas, justo al borde.
const MARGEN_PLANO_M = 30;

let relojGps = 0, relojOtros = 0, vivoAlgunaVez = false;

// Arranca al abrir la sesión y no para: leerOtros mismo se salta las
// vueltas con la app escondida o fuera del mapa.
function vigilarOtros() {
  clearInterval(relojOtros);
  Store.escucharUbicaciones({
    alEstado: (e) => {
      const antes = S.gps.enVivo;
      S.gps.enVivo = e === 'SUBSCRIBED';
      // Al RECONECTAR puede haberse perdido algo mientras estuvo caída. La
      // primera conexión no: el mapa acaba de preguntar al abrirse.
      if (S.gps.enVivo && !antes && vivoAlgunaVez) leerOtros({ yaMismo: true });
      if (S.gps.enVivo) vivoAlgunaVez = true;
    },
    alCambiar: alCambiarOtro
  });
  leerOtros();
  relojOtros = setInterval(() => {
    // Lo que lleva diez minutos sin noticias se olvida, y el resto se
    // vuelve a pintar: un punto se va desvaneciendo aunque no llegue nada.
    const antes = S.gps.otros.length;
    S.gps.otros = S.gps.otros.filter((o) => Date.now() - o.recibido < OLVIDAR_MS);
    if (S.gps.otros.length !== antes || S.gps.otros.length) pintarGps();
    leerOtros();
  }, CADA_LECTURA_AJENA_MS);
}

// Un aviso en vivo: alguien se movió, prendió su GPS o lo apagó.
function alCambiarOtro(tipo, nueva, vieja) {
  const id = nueva?.usuario_id || vieja?.usuario_id;
  if (!id || id === S.perfil?.id) return;
  const resto = S.gps.otros.filter((o) => o.usuario_id !== id);
  if (tipo === 'DELETE') S.gps.otros = resto;
  else {
    // El aviso trae la fila, no el nombre: el nombre sale de lo que ya se
    // sabía de esa persona, o de la lista de perfiles del celular.
    const antes = S.gps.otros.find((o) => o.usuario_id === id);
    const nombre = antes?.nombre || S.gente.find((p) => p.id === id)?.nombre || '?';
    S.gps.otros = [...resto, { usuario_id: id, nombre, lat: nueva.lat, lon: nueva.lon,
                               precision_m: nueva.precision_m, recibido: Date.now() }];
  }
  if (!document.hidden && S.pestana === 'mapa') pintarGps();
}

async function prenderGps() {
  // La primera vez se explica qué implica: prenderlo es dejarse ver.
  // Pedir el permiso del teléfono sin contarlo antes sería decir solo la
  // mitad.
  let avisado = null;
  try { avisado = localStorage.getItem('acopio-gps-avisado'); } catch { /* sin almacenamiento */ }
  if (avisado !== '1') {
    const ok = await confirmar({
      titulo: '¿Prender la ubicación?',
      detalle: 'Te verás como un punto azul en el plano. Mientras estés dentro del patio, '
        + 'tus compañeros también te verán, con tu nombre. Fuera del patio no se comparte nada. '
        + 'Se apaga con el mismo botón.',
      aceptar: 'Prender'
    });
    if (!ok) return;
    recordar('acopio-gps-avisado', '1');
  }
  S.gps.activo = true;
  recordar('acopio-gps', '1');
  arrancarGps();
  botonGps();
  pintarGps();
}

async function apagarGps() {
  S.gps.activo = false;
  recordar('acopio-gps', '0');
  pararGps();
  // A los demás se los sigue viendo: apagar es dejar de verse uno.
  S.gps.yo = null; S.gps.error = null; S.gps.fallaSubir = null;
  botonGps();
  pintarGps();
  await soltarUbicacion();
}

function arrancarGps() {
  if (document.hidden) return;
  S.gps.error = null;
  // Si este plano no tiene GPS, puede ser que el admin lo acabe de calibrar
  if (!Gps.transformacion(plataformaActual()?.geo)) buscarCalibracion();
  Gps.seguir(alLeerGps, alFallarGps);
  clearInterval(relojGps);
  relojGps = setInterval(() => {
    // Quieto, el teléfono puede pasar minutos sin dar lectura nueva: la
    // última sigue siendo la buena, y sin esto la persona se iría
    // desvaneciendo de la pantalla de los demás sin haberse movido. Pero
    // solo un rato: si el GPS lleva dos minutos callado —bajo techo, sin
    // satélites—, esa lectura ya no se puede vender como "ahora".
    if (S.gps.yo && Date.now() - S.gps.yo.cuando < 120_000) compartirSiToca(S.gps.yo);
  }, CADA_LECTURA_AJENA_MS);
}

function pararGps() {
  Gps.detener();
  clearInterval(relojGps);
  relojGps = 0;
}

// Que los demás dejen de verlo YA. Si no hay señal no pasa nada: la vista
// del servidor lo da por ido a los diez minutos.
async function soltarUbicacion() {
  if (!S.gps.compartiendo || !S.perfil) return;
  try {
    if (await Store.dejarDeCompartir(S.perfil.id)) { S.gps.compartiendo = false; S.gps.enviado = null; }
  } catch (e) { console.error(e); }
}

function alLeerGps(l) {
  const primera = !S.gps.yo;
  S.gps.yo = l;
  S.gps.error = null;
  if (S.calibrando) medirCalibracion(l);
  pintarGps();
  // Al prenderlo, el plano va hasta uno: es lo primero que se quiere ver.
  if (primera && !S.calibrando) centrarEnMi({ avisar: false });
  compartirSiToca(l);
}

function alFallarGps(e) {
  // El código 3 es "tardó": el teléfono sigue intentando solo y no hay
  // nada que hacer, así que solo se avisa si todavía no hay ni una lectura.
  if (e?.code === 3 && S.gps.yo) return;
  S.gps.error = Gps.motivoFallo(e);
  // Sin permiso no va a llegar nada: se apaga el GPS, que es lo que gasta
  // batería. Pero SOLO el GPS: ver a los demás no depende del propio. El
  // admin en la oficina, con el navegador sin permiso de ubicación, se
  // quedaba sin ver a nadie, como si nadie estuviera compartiendo.
  if (e?.code === 1 || e?.code === 0) Gps.detener();
  pintarGps();
}

// Las plataformas —y con ellas la calibración— bajan una vez por hora.
// Mientras el GPS esté prendido y el teléfono no sepa de un plano
// calibrado donde caiga, se pregunta solo por ellas, como mucho cada dos
// minutos: sin la calibración, el teléfono no comparte nada.
const BUSCAR_CALIBRACION_CADA_MS = 2 * 60_000;
let calibracionBuscada = 0;
async function buscarCalibracion() {
  if (Date.now() - calibracionBuscada < BUSCAR_CALIBRACION_CADA_MS) return;
  calibracionBuscada = Date.now();
  try {
    if (await Store.refrescarPlataformas()) await recargar();
  } catch (e) { console.error(e); }
}

async function compartirSiToca(l) {
  const g = S.gps;
  if (!g.activo || g.enviando || !S.perfil || sinPermiso()) return;
  const buena = l.precision <= PRECISION_COMPARTIR_M;
  const dentro = buena && Gps.dondeCae(S.plataformas, l.lat, l.lon, MARGEN_PLANO_M);
  // Fuera de todo plano conocido: o está fuera del patio, o este teléfono
  // todavía no sabe que su plano ya está calibrado.
  if (buena && !dentro) buscarCalibracion();
  if (!dentro) {
    // Salió del patio, o la señal se volvió mala: se retira la que había
    // en vez de dejar a los demás mirando un punto que ya no es verdad.
    if (g.compartiendo) { g.enviando = true; await soltarUbicacion(); g.enviando = false; }
    return;
  }
  const t = Date.now();
  const toca = !g.enviado || t - g.enviado.cuando > CADA_ENVIO_MS
    || (t - g.enviado.cuando > ENTRE_ENVIOS_MS && Gps.distanciaM(g.enviado, l) > MOVIDO_M);
  if (!toca) return;
  g.enviando = true;
  try {
    if (await Store.compartirUbicacion(S.perfil.id, l)) {
      g.compartiendo = true;
      g.enviado = { lat: l.lat, lon: l.lon, cuando: t };
      if (g.fallaSubir) { g.fallaSubir = null; chipGps(); }
    }
  } catch (e) {
    // Lo más probable: falta correr migracion.sql. La posición propia se
    // sigue viendo; solo no sale del teléfono. Se reintenta en 15 s. Y se
    // DICE: antes esto iba a la consola, y desde el patio parecía que
    // compartía cuando no.
    console.error(e);
    g.enviado = { lat: l.lat, lon: l.lon, cuando: t };
    g.fallaSubir = e?.message || String(e);
    chipGps();
  } finally { g.enviando = false; }
}

async function leerOtros({ yaMismo = false } = {}) {
  if (document.hidden || S.pestana !== 'mapa' || S.historia) return;
  const espera = S.gps.enVivo || (!S.gps.otros.length && !S.gps.activo)
    ? SIN_NADIE_CADA_MS : CADA_LECTURA_AJENA_MS;
  // el segundo de holgura es para que el reloj de 15 s no caiga justo antes
  if (!yaMismo && Date.now() - S.gps.leidoEn < espera - 1000) return;
  const inicio = S.gps.leidoEn = Date.now();
  try {
    const filas = await Store.ubicaciones();
    // Lo que llegó EN VIVO mientras se esperaba la respuesta es más nuevo
    // que la respuesta: se queda. La antigüedad la cuenta el servidor
    // (`segundos`), así que el reloj del celular no tiene que estar bien.
    const vivos = new Map(S.gps.otros.filter((o) => o.recibido >= inicio).map((o) => [o.usuario_id, o]));
    const ahora = Date.now();
    S.gps.otros = filas.filter((u) => u.usuario_id !== S.perfil?.id)
      .map((u) => vivos.get(u.usuario_id) || { ...u, recibido: ahora - (u.segundos || 0) * 1000 });
    for (const [id, o] of vivos) if (!S.gps.otros.some((x) => x.usuario_id === id)) S.gps.otros.push(o);
    S.gps.fallaLeer = null;
  } catch (e) {
    // Sin respuesta se queda lo que había: se irá desvaneciendo solo si de
    // verdad no llega nada más, en vez de vaciarse el plano de golpe.
    console.error(e);
    S.gps.fallaLeer = e?.message || String(e);
  }
  pintarGps();
}

// El primer nombre basta para reconocerse en un patio de diez personas,
// y ocupa la mitad sobre el plano.
const nombreCorto = (n) => String(n || '?').trim().split(/\s+/)[0];

// Pasa el estado del GPS a coordenadas de ESTE plano y se lo da al mapa.
function pintarGps() {
  chipGps();
  marcarPlegar();
  if (S.pestana !== 'mapa' || !document.querySelector('#lienzo')) return;
  const plat = plataformaActual();
  const t = Gps.transformacion(plat?.geo);
  const marcas = marcasCalibracion();
  if (!t || S.historia) return Mapa.pintarGps(marcas.length ? { marcas } : null);
  const enPlano = (lat, lon) => {
    const pt = t.aPlano(lat, lon);
    return Gps.dentroDelPlano(plat, t, pt, MARGEN_PLANO_M) ? pt : null;
  };
  const yo = S.gps.activo && S.gps.yo && enPlano(S.gps.yo.lat, S.gps.yo.lon);
  const otros = S.gps.otros.map((o) => {
    const pt = enPlano(o.lat, o.lon);
    return pt && { ...pt, nombre: nombreCorto(o.nombre), viejo: Date.now() - o.recibido > VIEJO_S * 1000 };
  }).filter(Boolean);
  Mapa.pintarGps({
    yo: yo && { ...yo, radio: S.gps.yo.precision * t.escala },
    otros, marcas
  });
}

function botonGps() {
  const b = $('#r-gps');
  if (!b) return;
  if (S.gps.activo) b.setAttribute('aria-pressed', 'true'); else b.removeAttribute('aria-pressed');
}

// Lo que pasa con el GPS, dicho en una pastilla sobre el plano. Tocarla
// hace lo que la pastilla promete: ir hasta uno, cambiar de plataforma,
// reintentar o calibrar.
function chipGps() {
  const caja = $('#chip-gps-caja');
  if (!caja) return;
  const g = S.gps;
  // Vive fuera del mapa, con los botones flotantes: en la lista no pinta nada.
  if (S.pestana !== 'mapa' || S.historia || S.calibrando) { caja.innerHTML = ''; return; }
  const plat = plataformaActual();
  const t = Gps.transformacion(plat?.geo);
  // Los demás: cuántos en este plano, y si no hay ninguno, en cuál hay.
  // Sin esto, mirar Topsoil mientras todos están en Ye era ver el plano
  // vacío y pensar que nadie estaba compartiendo.
  const enEste = (o) => t && Gps.dentroDelPlano(plat, t, t.aPlano(o.lat, o.lon), MARGEN_PLANO_M);
  const aquiOtros = S.gps.otros.filter(enEste).length;
  const porPlat = new Map();
  for (const o of S.gps.otros) {
    if (enEste(o)) continue;
    const d = Gps.dondeCae(S.plataformas, o.lat, o.lon, MARGEN_PLANO_M);
    if (d) porPlat.set(d.plat, (porPlat.get(d.plat) || 0) + 1);
  }
  const [otraPlat, enOtra] = [...porPlat.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  const irA = (p) => () => {          // el mismo camino que el selector de plataformas
    irAPlataforma(p.id);
    S.recorrido = null; S.historia = null;
    irAlMapa();
    Mapa.encuadrar();
    centrarEnMi({ avisar: false });
  };
  const gente = aquiOtros ? ` · ${aquiOtros} más aquí`
    : otraPlat ? ` · ${enOtra} en ${otraPlat.nombre}` : '';
  const compas = (n) => `${n} compañero${n === 1 ? '' : 's'}`;
  let texto, alTocar, malo = false;
  // Con lo propio apagado no se dice el error de leer a cualquiera —le
  // saldría en rojo a todo el patio sin que pueda hacer nada—, solo al
  // admin, que es quien puede arreglarlo.
  const falla = g.fallaSubir || ((g.activo || esAdmin()) && g.fallaLeer);
  if (!g.activo && !falla) {
    // Sin la ubicación propia, la pastilla solo sale si hay a quién ver.
    if (!aquiOtros && !otraPlat) { caja.innerHTML = ''; return; }
    texto = aquiOtros ? `${compas(aquiOtros)} aquí` : `${enOtra} en ${otraPlat.nombre} · ir`;
    alTocar = aquiOtros ? () => enfocarOtros(plat, t) : irA(otraPlat);
  } else if (falla) {
    malo = true;
    texto = g.fallaSubir ? 'El servidor no acepta tu ubicación · ver' : 'No se pudo ver a los demás · ver';
    alTocar = () => avisar(`El servidor respondió: «${falla}». `
      + (/ubicaciones/.test(falla)
        ? 'Falta crear la tabla de ubicaciones: el administrador tiene que correr el bloque GPS de sql/migracion.sql en Supabase.'
        : 'Se vuelve a intentar solo cada 15 segundos.'));
  } else if (!t) {
    texto = (esAdmin() ? 'Este plano no tiene GPS · calibrar' : 'Este plano todavía no tiene GPS') + gente;
    alTocar = esAdmin() ? () => { panelFondo(); $('#h-gps')?.scrollIntoView({ block: 'start' }); }
      : () => avisar('El administrador tiene que calibrar el GPS de este plano desde «Fondo del mapa».');
  } else if (g.error && !g.yo) {
    // Sin GPS propio —la oficina, un navegador sin permiso— igual se ve a
    // los demás: la pastilla lo dice, en vez de enseñar solo el error.
    malo = true;
    texto = `${aquiOtros ? `${compas(aquiOtros)} aquí`
      : otraPlat ? `${enOtra} en ${otraPlat.nombre}` : 'Nadie más compartiendo'} · sin tu GPS`;
    alTocar = () => { avisar(g.error); arrancarGps(); };
  } else if (g.error) {
    malo = true;
    texto = g.error;
    alTocar = () => { arrancarGps(); pintarGps(); };
  } else if (!g.yo) {
    texto = `Buscando señal GPS…${gente}`;
  } else {
    const pt = t.aPlano(g.yo.lat, g.yo.lon);
    const aqui = Gps.dentroDelPlano(plat, t, pt, MARGEN_PLANO_M);
    const otra = !aqui && Gps.dondeCae(S.plataformas, g.yo.lat, g.yo.lon, MARGEN_PLANO_M);
    if (aqui) {
      texto = `±${Math.round(g.yo.precision)} m${gente}`;
      alTocar = () => centrarEnMi({ avisar: true });
    } else if (otra) {
      texto = `Estás en ${otra.plat.nombre} · ir`;
      alTocar = irA(otra.plat);
    } else {
      texto = `Estás fuera del patio${gente}`;
    }
  }
  // Nadie aquí pero sí en otra plataforma: la pastilla lleva hasta ellos.
  if (!alTocar && !aquiOtros && otraPlat) alTocar = irA(otraPlat);
  caja.innerHTML = `<button class="chip-gps${malo ? ' chip-gps-error' : ''}" id="chip-gps">
    ${ICO.gps}<span>${esc(texto)}</span></button>`;
  const b = $('#chip-gps');
  if (alTocar) b.onclick = gesto(alTocar); else b.disabled = true;
}

// Lleva el plano hasta los compañeros que están en este plano.
function enfocarOtros(plat, t) {
  const pts = S.gps.otros.map((o) => t.aPlano(o.lat, o.lon))
    .filter((pt) => Gps.dentroDelPlano(plat, t, pt, MARGEN_PLANO_M));
  if (pts.length) Mapa.enfocar(pts.map((pt) => ({ x: pt.x, y: pt.y, rx: 0, ry: 0 })),
    { margen: Math.max(25 * t.escala, 60) });
}

// Lleva el plano hasta el punto azul, con un poco de patio alrededor.
function centrarEnMi({ avisar: decir }) {
  const plat = plataformaActual();
  const t = Gps.transformacion(plat?.geo);
  if (!t || !S.gps.yo) return;
  const pt = t.aPlano(S.gps.yo.lat, S.gps.yo.lon);
  if (!Gps.dentroDelPlano(plat, t, pt, MARGEN_PLANO_M)) {
    if (decir) avisar('Estás fuera de este plano.');
    return;
  }
  // `enfocar` encuadra figuras; un punto es una figura de radio cero.
  // El margen son unos 25 m de patio a cada lado.
  Mapa.enfocar([{ x: pt.x, y: pt.y, rx: 0, ry: 0 }], { margen: Math.max(25 * t.escala, 60) });
}

// ------------------------------------------------------ calibrar el GPS
// Ubicar el plano en el mundo: una lista de puntos, cada uno con su sitio
// en el plano y su coordenada. Es solo del admin, y hay dos maneras:
//
//   · desde la oficina, en una ventana aparte (calibrar.html) con el
//     plano al lado de la imagen satelital: ver js/calibrar.js;
//   · caminando el patio, aquí mismo sobre el mapa: el admin se para en
//     algo que reconozca —una esquina, la caseta, la báscula—, lo toca
//     en el plano y la app promedia unos segundos de GPS. Promediar
//     importa: una sola lectura puede venir corrida cinco metros, y ese
//     error se quedaría en el plano para siempre.
//
// Las dos guardan lo mismo, y se pueden mezclar: lo que se marcó desde la
// oficina aparece al calibrar caminando, para afinarlo, y al revés.

// La ventana de la oficina. Se abre en el mismo toque del botón: si se
// abriera después de esperar algo, el navegador la tomaría por publicidad
// y la bloquearía.
function abrirCalibracionOficina() {
  const plat = plataformaActual();
  if (!esAdmin() || !plat) return;
  const v = window.open(`calibrar.html?plat=${encodeURIComponent(plat.id)}`, 'acopio-calibrar');
  if (!v) avisar('El navegador bloqueó la ventana de calibrar. Permite las ventanas emergentes para este sitio y vuelve a intentarlo.');
  else cerrarHoja();
}

function empezarCalibracion() {
  if (!esAdmin()) return;
  const plat = plataformaActual();
  if (!plat) return avisar('Todavía no hay plataformas cargadas. Sincroniza y vuelve a intentarlo.');
  if (S.historia) return avisar('Vuelve a hoy para calibrar el GPS.');
  cerrarHoja();
  S.edicion = false;              // en edición un toque agarra figuras, no marca
  // Se arranca de los puntos que ya tenga: así se puede afinar una
  // calibración —agregar un punto, quitar el malo— sin repetirla entera.
  S.calibrando = {
    plat: plat.id,
    puntos: Gps.puntosDe(plat.geo).map(({ x, y, lat, lon }) => ({ x, y, lat, lon })),
    plano: null, lecturas: []
  };
  if (!S.gps.activo) { S.gps.activo = true; recordar('acopio-gps', '1'); arrancarGps(); }
  Mapa.alMarcar((pt) => ponerPlano({ x: Math.round(pt.x), y: Math.round(pt.y) }));
  irAlMapa();
}

function cancelarCalibracion() {
  soltarCalibracion();
  montarMapa();
}

// Solo el estado, sin tocar la pantalla. montarMapa lo usa si la
// plataforma cambió a mitad: no puede llamarse a sí mismo.
function soltarCalibracion() {
  S.calibrando = null;
  Mapa.alMarcar(null);
}

function ponerPlano(pt) {
  const c = S.calibrando;
  if (!c) return;
  c.plano = pt;
  // Se mide desde que se marca el sitio: lo de antes era de otro lado.
  // La última lectura sí vale si es de hace un instante —quien toca su
  // sitio ya está parado en él—, y un teléfono quieto puede tardar en
  // dar otra: sin ella la barra se quedaba en "Midiendo…".
  const reciente = S.gps.yo && Date.now() - S.gps.yo.cuando < 5000;
  c.lecturas = reciente ? [S.gps.yo] : [];
  dibujarCalibracion();
}

// La coordenada del sitio marcado: del GPS promediado o pegada a mano.
function ponerGeo(geo) {
  const c = S.calibrando;
  if (!c?.plano) return;
  c.puntos.push({ ...c.plano, lat: +geo.lat.toFixed(7), lon: +geo.lon.toFixed(7) });
  c.plano = null; c.lecturas = [];
  dibujarCalibracion();
}

function dibujarCalibracion() {
  barraCalibrar();
  pintarGps();
}

function marcasCalibracion() {
  const c = S.calibrando;
  if (!c) return [];
  const { malos } = Gps.revisarPuntos(c.puntos);
  const m = c.puntos.map((p, i) => ({ x: p.x, y: p.y, etiqueta: String(i + 1), mala: malos.has(i) }));
  if (c.plano) m.push({ ...c.plano, etiqueta: String(c.puntos.length + 1), pendiente: true });
  return m;
}

function medirCalibracion(l) {
  const c = S.calibrando;
  if (!c?.plano) return;
  c.lecturas.push(l);
  // Las últimas treinta bastan: más no afina, y quien se queda un rato
  // largo quieto no debería ir acumulando sin fin.
  if (c.lecturas.length > 30) c.lecturas.shift();
  const n = $('#cal-medida');
  if (n) n.textContent = textoMedida();
}

function textoMedida() {
  const c = S.calibrando;
  const p = Gps.promediar(c?.lecturas);
  if (S.gps.error) return S.gps.error;
  if (!p) return c?.lecturas.length
    ? `Señal todavía floja (±${Math.round(c.lecturas.at(-1).precision)} m). Espera a cielo abierto…`
    : 'Midiendo con el GPS…';
  return `GPS: ±${Math.max(1, Math.round(p.precision))} m con ${p.n} lectura${p.n === 1 ? '' : 's'}`;
}

// La barra se arma de nuevo con cada punto, nunca con cada lectura del
// GPS: rearmarla borraba lo que se estaba escribiendo en la coordenada.
function barraCalibrar() {
  const caja = $('#barra-gps');
  const c = S.calibrando;
  if (!caja || !c) return;
  const n = c.puntos.length;
  const r = Gps.revisarPuntos(c.puntos);
  const instruccion = c.plano
    ? 'Quédate quieto en ese sitio mientras se mide. Si quedó mal marcado, vuelve a tocarlo.'
    : n === 0 ? 'Párate en un sitio que reconozcas en el plano —una esquina, la caseta— y tócalo en el plano.'
    : n < Gps.PUNTOS_PARA_ESTIRAR
      ? `Camina a otro sitio, a más de ${Gps.DISTANCIA_MINIMA_M} m. Con ${Gps.PUNTOS_PARA_ESTIRAR} o más, repartidos por las esquinas, se corrige también un plano estirado.`
      : 'Puedes guardar, o agregar más puntos para repartir el error.';
  caja.innerHTML = `<div class="barra-modo barra-calibrar">
    <div class="fila-calibrar">
      <strong>GPS · ${n} punto${n === 1 ? '' : 's'}</strong>
      ${n >= 2 ? `<button class="pastilla pastilla-fuerte" id="cal-guardar"${r.listo ? '' : ' disabled'}>Guardar</button>` : ''}
      <button class="pastilla" id="cal-cancelar" aria-label="Cancelar la calibración">${ICO.cerrar}</button>
    </div>
    <span class="pista">${esc(instruccion)}</span>
    ${c.plano ? `<span class="pista" id="cal-medida">${esc(textoMedida())}</span>
    <div class="fila-calibrar">
      <input id="cal-coord" autocomplete="off" aria-label="Coordenada o enlace de Google Maps"
        placeholder="o pega una coordenada de Google Maps">
      <button class="pastilla" id="cal-coord-usar">Usar</button>
      <button class="pastilla pastilla-fuerte" id="cal-gps">Usar mi GPS</button>
    </div>` : ''}
    ${n ? `<div class="cal-puntos">${c.puntos.map((p, i) => `
      <span class="cal-punto${r.malos.has(i) ? ' cal-punto-malo' : ''}">
        <b>${i + 1}</b>${r.conError ? ` ${Gps.metros(r.t.errores[i])}` : ''}
        <button data-quitar="${i}" aria-label="Quitar el punto ${i + 1}">${ICO.cerrar}</button></span>`).join('')}
      ${r.resumen ? `<span class="pista${r.problema ? ' cal-problema' : ''}">${esc(r.resumen)}</span>` : ''}
    </div>` : ''}
  </div>`;

  $('#cal-cancelar').onclick = cancelarCalibracion;
  for (const b of caja.querySelectorAll('[data-quitar]')) b.onclick = () => {
    c.puntos.splice(Number(b.dataset.quitar), 1);
    dibujarCalibracion();
  };
  const usar = $('#cal-coord-usar');
  if (usar) {
    const pegada = () => {
      const geo = Gps.leerCoordenadas($('#cal-coord').value);
      if (!geo) return avisar('No se entiende la coordenada. Se escribe como «6.24420, -75.58120» '
        + '(latitud, coma, longitud), o se pega el enlace de Google Maps entero.');
      ponerGeo(geo);
    };
    usar.onclick = pegada;
    $('#cal-coord').onkeydown = (e) => { if (e.key === 'Enter') pegada(); };
    $('#cal-gps').onclick = () => {
      const geo = Gps.promediar(c.lecturas);
      if (!geo) return avisar(`Todavía no hay una lectura de GPS con menos de ${Gps.PRECISION_CALIBRAR_M} m de error. `
        + 'Espera unos segundos a cielo abierto, o pega la coordenada a mano.');
      ponerGeo(geo);
    };
  }
  const guardar = $('#cal-guardar');
  if (guardar) guardar.onclick = accion(guardarCalibracion, { ocupado: 'Guardando…' });
}

async function guardarCalibracion() {
  const c = S.calibrando;
  const geo = { puntos: c.puntos.map(({ x, y, lat, lon }) => ({ x, y, lat, lon })) };
  const revision = Gps.revisarPuntos(geo.puntos);
  if (!revision.listo) return avisar(revision.resumen || 'Hacen falta al menos dos puntos.');
  const plat = S.plataformas.find((p) => p.id === c.plat);
  if (!plat) { cancelarCalibracion(); return avisar('La plataforma ya no existe.'); }
  const peor = Math.max(...Gps.transformacion(geo).errores);
  await Store.guardarPlataforma({ ...plat, geo });
  cancelarCalibracion();
  await recargar();
  refrescarMapa();
  sincronizar();
  avisar(`GPS de ${plat.nombre} calibrado con ${geo.puntos.length} puntos`
    + (geo.puntos.length >= 3 ? `; el que más se aparta, ${Gps.metros(peor)}` : '')
    + '. Camina un poco y comprueba que el punto azul cae donde estás.');
}

// ------------------------------------------------------- fondo (admin)
const paletaActual = () => ({ ...Mapa.COLORES_BASE, ...(S.config?.colores || {}) });

// Cómo quedó calibrado un plano, dicho para el admin.
function estadoCalibracion(geo) {
  const t = Gps.transformacion(geo);
  if (!t) return 'Sin calibrar: el plano funciona igual, pero nadie se ve en él.';
  const n = Gps.puntosDe(geo).length;
  return `Calibrado con ${n} puntos` + (n >= 3
    ? `; el que más se aparta, ${Gps.metros(Math.max(...t.errores))}.` : '.')
    + ' Si el punto azul no cae donde estás, calibra de nuevo: se conservan los puntos y se pueden agregar o quitar.';
}

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

    <h3 id="h-gps">GPS</h3>
    <p class="pista">${estadoCalibracion(plat.geo)}</p>
    <p class="pista">Se calibra marcando sitios del patio en el plano y su ubicación real: desde la
      oficina, en una ventana aparte con la imagen satelital, o caminando el patio con el GPS. Con
      dos basta; con cuatro o más en las esquinas sale mejor.</p>
    <div class="acciones">
      <button id="gps-satelite">${ICO.mapa}<span>Desde la oficina</span></button>
      <button id="gps-caminando">${ICO.gps}<span>Caminando el patio</span></button>
    </div>
    ${plat.geo ? '<button class="btn btn-ancho" id="gps-quitar" style="width:100%">Quitar calibración</button>' : ''}

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
  $('#gps-satelite').onclick = abrirCalibracionOficina;
  $('#gps-caminando').onclick = empezarCalibracion;
  const sinGps = $('#gps-quitar');
  if (sinGps) sinGps.onclick = accion(async () => {
    await Store.guardarPlataforma({ ...plat, geo: null });
    cerrarHoja(); await recargar(); refrescarMapa(); sincronizar();
  }, { ocupado: 'Quitando…' });

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
