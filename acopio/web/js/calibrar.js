// =====================================================================
//  calibrar.js · ubicar el plano en el mundo, desde la oficina
//
//  Ventana aparte (calibrar.html) con el plano a un lado y la imagen
//  satelital al otro. Se toca un sitio en el plano —una esquina, la
//  caseta, un cruce de vías— y el mismo sitio en la foto; con eso el GPS
//  sabe dónde cae cada punto del dibujo. Ver `ajustar` en gps.js.
//
//  Es una ventana aparte a propósito: calibrar es de vez en cuando y del
//  administrador, y el mapa del trabajo diario no tiene por qué partirse
//  en dos ni llenarse de botones para eso.
//
//  Comparte con la app la base del navegador y la cola de subida: lo que
//  se guarda aquí sube como cualquier otro cambio, y la ventana del mapa
//  se entera al instante (BroadcastChannel).
// =====================================================================
import * as Store from './store.js';
import { sb } from './store.js';
import * as Mapa from './mapa.js';
import * as Gps from './gps.js';
import { ESRI_CLAVE } from './config.js';

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const X = `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>`;

// Las fotos satelitales, en el orden en que se ofrecen.
//
// Google va primero: en los patios de Colombia suele ser la más nítida y
// la más reciente, y es la que todo el mundo reconoce. Es la URL de
// cuadros que usa QGIS, sin clave ni API. Google no la publica, así que
// puede cambiarla o cortarla cuando quiera: por eso queda Esri al lado,
// a un toque, y la calibración no depende de ninguna de las dos.
//
// Las dos piden el mismo sitio por x/y/z (Web Mercator), así que un punto
// marcado sobre una cae en el mismo lugar sobre la otra.
const FOTOS = [
  {
    nombre: 'Google',
    url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    // cuatro servidores iguales: el navegador baja de varios a la vez
    opciones: { subdomains: '0123', maxNativeZoom: 20, attribution: 'Imágenes © Google' }
  },
  {
    nombre: 'Esri',
    // Ver ESRI_CLAVE en config.js: sin clave, el servicio público.
    url: ESRI_CLAVE
      ? `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${encodeURIComponent(ESRI_CLAVE)}`
      : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opciones: { maxNativeZoom: 19, attribution: 'Powered by <a href="https://www.esri.com">Esri</a> · '
      + 'Esri, Maxar, Earthstar Geographics, and the GIS User Community' }
  }
];

// Leaflet dibuja el satélite. Solo esta ventana lo carga: la app del
// patio no lo necesita. La huella (integrity) es la que publica Leaflet:
// si el CDN sirviera otra cosa, el navegador no la ejecuta.
const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/';
function cargarLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((listo, fallo) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = `${LEAFLET}leaflet.css`; css.crossOrigin = '';
    css.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
    const js = document.createElement('script');
    js.src = `${LEAFLET}leaflet.js`; js.crossOrigin = '';
    js.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
    js.onload = () => listo(window.L);
    js.onerror = () => fallo(new Error('sin_satelite'));
    document.head.append(css, js);
  });
}

// ------------------------------------------------------------- estado
let plat = null;            // la plataforma que se calibra
let dibujo = null;          // lo que se pinta del plano: figuras, pilas, lotes
let puntos = [];            // [{x, y, lat, lon}]
let plano = null;           // sitio tocado en el plano, esperando su coordenada
let geo = null;             // sitio tocado en la foto, esperando su sitio en el plano
let sat = null;             // { mapa, capas }
let guardado = false;

// ------------------------------------------------------------ arranque
async function arrancar() {
  await Store.iniciar();
  const { data } = await sb.auth.getSession();
  const uid = data.session?.user?.id;
  if (!uid) return pararCon('No hay sesión abierta. Entra a la app y vuelve a abrir la calibración desde «Fondo del mapa».');

  // Solo el admin. El servidor igual rechazaría lo que guarde otro —la
  // tabla de plataformas solo la escribe el admin—, pero enseñarle una
  // pantalla entera para que al final no se guarde sería peor.
  let rol = (await Store.perfiles()).find((p) => p.id === uid)?.rol;
  try {
    const r = await sb.from('perfiles').select('rol').eq('id', uid).maybeSingle();
    if (r.data) rol = r.data.rol;
  } catch { /* sin señal: vale lo que hay guardado en el navegador */ }
  if (rol !== 'admin') return pararCon('Calibrar el GPS es solo del administrador.');

  const id = new URLSearchParams(location.search).get('plat');
  const plats = await Store.plataformas();
  plat = plats.find((p) => p.id === id) || plats[0];
  if (!plat) return pararCon('Todavía no hay plataformas en este equipo. Abre la app, deja que sincronice y vuelve a intentarlo.');

  const [config, figuras, pilas, lotes] = await Promise.all([
    Store.config(), Store.figuras(), Store.pilas(), Store.lotes()]);
  const aqui = (x) => x.plataforma_id === plat.id;
  dibujo = {
    config: { ...config, ...plat },
    figuras: figuras.filter(aqui),
    pilas: pilas.filter((p) => aqui(p) && p.estado === 'abierta'),
    lotes: lotes.filter(aqui)
  };
  // Se arranca de los puntos que ya tenga: así se afina una calibración
  // —agregar un punto, quitar el malo— sin repetirla entera.
  puntos = Gps.puntosDe(plat.geo).map(({ x, y, lat, lon }) => ({ x, y, lat, lon }));
  pantalla();
}

function pararCon(texto) {
  $('#calibrar').innerHTML = `<div class="cal-aviso"><h1>Calibrar el GPS</h1>
    <p>${esc(texto)}</p><button class="pastilla pastilla-fuerte" id="cal-cerrar">Cerrar</button></div>`;
  $('#cal-cerrar').onclick = cerrarVentana;
}

// Se abrió con window.open desde la app, así que se puede cerrar sola.
// Si la abrieron a mano, el navegador no la deja; ahí se vuelve a la app.
function cerrarVentana() {
  window.close();
  setTimeout(() => { location.href = './'; }, 150);
}

function pantalla() {
  document.title = `Acopio · calibrar ${plat.nombre}`;
  $('#calibrar').innerHTML = `
    <header class="cal-cabecera">
      <h1>GPS · ${esc(plat.nombre)}</h1>
      <span class="crece"></span>
      <button class="pastilla pastilla-fuerte" id="cal-guardar">Guardar</button>
      <button class="pastilla" id="cal-cerrar" aria-label="Cerrar">${X}</button>
    </header>
    <div id="cal-controles"></div>
    <div class="cal-cuerpo">
      <section class="cal-lado">
        <h2>Plano</h2>
        <div class="cal-plano"><div id="lienzo-caja"></div></div>
      </section>
      <section class="cal-lado">
        <h2>Satélite</h2>
        <div class="sat-caja">
          <div id="satelite"></div>
          <div id="sat-pegar">
            <input id="cal-coord" autocomplete="off" aria-label="Coordenada o enlace de Google Maps"
              placeholder="Ir a: coordenada o enlace de Google Maps">
            <button id="cal-coord-usar">Ir</button>
          </div>
        </div>
      </section>
    </div>`;

  $('#cal-cerrar').onclick = () => {
    if (!guardado && puntos.length && !confirm('¿Cerrar sin guardar la calibración?')) return;
    cerrarVentana();
  };
  $('#cal-guardar').onclick = guardar;
  const irA = () => {
    const g = Gps.leerCoordenadas($('#cal-coord').value);
    if (!g) return decir('No se entiende la coordenada. Se escribe como «6.24420, -75.58120» '
      + '(latitud, coma, longitud), o se pega el enlace de Google Maps entero.', true);
    sat?.mapa.setView([g.lat, g.lon], Math.max(sat.mapa.getZoom(), 18));
    // Con un sitio ya marcado en el plano, la coordenada pegada ES la
    // suya. Sin él, solo se quería llegar hasta el patio.
    if (plano) ponerGeo(g);
  };
  $('#cal-coord-usar').onclick = irA;
  $('#cal-coord').onkeydown = (e) => { if (e.key === 'Enter') irA(); };

  Mapa.montar($('#lienzo-caja'), { puedeEditarFondo: () => false });
  Mapa.pintar(dibujo);
  Mapa.encuadrar();
  Mapa.alMarcar((pt) => ponerPlano({ x: Math.round(pt.x), y: Math.round(pt.y) }));

  dibujarTodo();
  montarSatelite();
}

// ------------------------------------------------------------- puntos
function ponerPlano(pt) { plano = pt; completar(); }
function ponerGeo(g) { geo = { lat: +g.lat.toFixed(7), lon: +g.lon.toFixed(7) }; completar(); }

// Con las dos mitades —el sitio en el plano y su coordenada— el punto
// entra en la lista; con una sola, espera la otra. El orden da igual.
function completar() {
  if (plano && geo) {
    puntos.push({ ...plano, ...geo });
    plano = null; geo = null;
  }
  guardado = false;
  dibujarTodo();
}

function dibujarTodo() {
  const r = Gps.revisarPuntos(puntos);
  controles(r);
  Mapa.pintarGps({ marcas: [
    ...puntos.map((p, i) => ({ x: p.x, y: p.y, etiqueta: String(i + 1), mala: r.malos.has(i) })),
    ...(plano ? [{ ...plano, etiqueta: String(puntos.length + 1), pendiente: true }] : [])
  ] });
  pintarSatelite(r);
}

function controles(r) {
  const n = puntos.length;
  const instruccion = plano && !geo ? 'Ahora toca ese mismo sitio en el satélite.'
    : geo && !plano ? 'Ahora toca ese mismo sitio en el plano.'
    : n === 0 ? 'Toca en el plano un sitio que se reconozca desde el aire —una esquina, la caseta, '
      + 'un cruce de vías— y luego el mismo sitio en el satélite. Para llegar al patio en el satélite, '
      + 'pega arriba un enlace de Google Maps.'
    : n < Gps.PUNTOS_PARA_ESTIRAR
      ? `Sigue con otro sitio, lejos de los anteriores. Con ${Gps.PUNTOS_PARA_ESTIRAR} o más, `
        + 'repartidos por las esquinas, se corrige también un plano estirado.'
      : 'Puedes guardar, o agregar más puntos para repartir el error.';
  $('#cal-controles').innerHTML = `
    <p class="cal-instruccion">${esc(instruccion)}</p>
    ${n ? `<div class="cal-puntos">${puntos.map((p, i) => `
      <span class="cal-punto${r.malos.has(i) ? ' cal-punto-malo' : ''}">
        <b>${i + 1}</b>${r.conError ? ` ${Gps.metros(r.t.errores[i])}` : ''}
        <button data-quitar="${i}" aria-label="Quitar el punto ${i + 1}">${X}</button></span>`).join('')}
      ${r.resumen ? `<span class="cal-resumen${r.problema ? ' cal-problema' : ''}">${esc(r.resumen)}</span>` : ''}
    </div>` : ''}`;
  for (const b of document.querySelectorAll('[data-quitar]')) b.onclick = () => {
    puntos.splice(Number(b.dataset.quitar), 1);
    guardado = false;
    dibujarTodo();
  };
  $('#cal-guardar').disabled = !r.listo;
}

// Un aviso en el renglón de instrucciones, sin tapar ni el plano ni la foto.
function decir(texto, malo = false) {
  const p = $('.cal-instruccion');
  if (!p) return;
  p.textContent = texto;
  p.classList.toggle('cal-problema', malo);
}

async function guardar() {
  const nuevo = { puntos: puntos.map(({ x, y, lat, lon }) => ({ x, y, lat, lon })) };
  const revision = Gps.revisarPuntos(nuevo.puntos);
  if (!revision.listo) return decir(revision.resumen || 'Hacen falta al menos dos puntos.', true);
  const b = $('#cal-guardar');
  b.disabled = true; b.textContent = 'Guardando…';
  try {
    // Lo más nuevo que haya de la plataforma, no lo que se leyó al abrir:
    // el admin pudo cambiar el fondo en la app mientras esto estaba abierto.
    const actual = (await Store.plataformas()).find((p) => p.id === plat.id) || plat;
    await Store.guardarPlataforma({ ...actual, geo: nuevo });
    plat = { ...actual, geo: nuevo };
    guardado = true;
    avisarALaApp();
    const r = await Store.sincronizar();
    const t = Gps.transformacion(nuevo);
    decir(`Guardado con ${nuevo.puntos.length} puntos`
      + (nuevo.puntos.length >= 3 ? `; el que más se aparta, ${Gps.metros(Math.max(...t.errores))}` : '')
      + (r.ok ? '. Ya está en el servidor.' : '. Quedó en este equipo y sube solo en cuanto haya señal.')
      + ' En el patio, comprueba que el punto azul cae donde estás.');
  } catch (e) {
    decir(`No se pudo guardar: ${e?.message || e}`, true);
  } finally {
    b.textContent = 'Guardar';
    b.disabled = !Gps.revisarPuntos(puntos).listo;
  }
}

// La ventana del mapa recarga la plataforma ya, sin esperar a su vuelta
// de sincronización. Si el navegador no tiene el canal, la app lo verá
// igual en su siguiente vuelta.
function avisarALaApp() {
  try { new BroadcastChannel('acopio').postMessage({ tipo: 'calibrado', plataforma: plat.id }); }
  catch { /* navegador viejo: se entera al sincronizar */ }
}

// ---------------------------------------------------------- el satélite
async function montarSatelite() {
  const caja = $('#satelite');
  let L;
  try {
    L = await cargarLeaflet();
  } catch {
    caja.innerHTML = '<p class="sat-sin-red">Sin señal no se puede cargar la imagen satelital. '
      + 'Vuelve a abrir esta ventana cuando haya internet.</p>';
    return;
  }
  const mapa = L.map(caja, { maxZoom: 21, zoomSnap: 0.5 });
  // Pasado el último zoom que tiene cada foto se amplía la última: para
  // apuntar una esquina sirve, y es mejor que quedarse sin imagen.
  const capas = Object.fromEntries(FOTOS.map((f) =>
    [f.nombre, L.tileLayer(f.url, { maxZoom: 21, ...f.opciones })]));
  // Se recuerda cuál se eligió: si Google un día no responde y se pasa a
  // Esri, la siguiente vez no hay que volver a cambiarla.
  let elegida = null;
  try { elegida = localStorage.getItem('acopio-foto'); } catch { /* sin almacenamiento */ }
  (capas[elegida] || capas[FOTOS[0].nombre]).addTo(mapa);
  L.control.layers(capas, null, { position: 'topleft' }).addTo(mapa);
  mapa.on('baselayerchange', (e) => {
    try { localStorage.setItem('acopio-foto', e.name); } catch { /* sin almacenamiento */ }
  });
  mapa.attributionControl.setPrefix(false);
  sat = { mapa, capas: L.layerGroup().addTo(mapa) };
  mapa.on('click', (e) => ponerGeo({ lat: e.latlng.lat, lon: e.latlng.lng }));
  // Leaflet mide su caja una vez. Si cambia —la ventana, o el renglón de
  // instrucciones que crece—, hay que decírselo: si no, la foto queda
  // corrida respecto a donde se toca, y cada punto se marca unos metros
  // al lado de donde se apuntó.
  new ResizeObserver(() => mapa.invalidateSize({ pan: false })).observe(caja);
  vistaInicial();
  pintarSatelite(Gps.revisarPuntos(puntos));
}

// Dónde abrir el satélite. Buscar un patio desde el mapa del mundo entero
// es lo que haría perder la tarde, así que se prueba en orden: lo que ya
// esté calibrado, otra plataforma ya calibrada, y si no, Colombia y la
// pista de pegar un enlace para llegar.
async function vistaInicial() {
  const esquinas = (pl, t) => [[0, 0], [pl.ancho, pl.alto]].map(([x, y]) => {
    const g = t.aGeo(Number(x) || 0, Number(y) || 0); return [g.lat, g.lon];
  });
  const t = Gps.transformacion({ puntos });
  if (t) return sat.mapa.fitBounds(esquinas(plat, t), { padding: [20, 20] });
  if (puntos[0]) return sat.mapa.setView([puntos[0].lat, puntos[0].lon], 18);
  const otra = (await Store.plataformas()).find((p) => Gps.transformacion(p.geo));
  if (otra) return sat.mapa.fitBounds(esquinas(otra, Gps.transformacion(otra.geo)), { padding: [20, 20] });
  sat.mapa.setView([4.6, -74.1], 6);
}

// El contorno de una figura del plano, en coordenadas del plano. Las
// elipses se aproximan con 24 lados: sobre la foto no se nota.
function contornoPlano(o) {
  const r = ((o.rot || 0) * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
  const ps = o.forma === 'poligono'
    ? (o.puntos?.length >= 3 ? o.puntos : Mapa.puntosPorDefecto(o.rx, o.ry))
    : o.forma === 'rectangulo'
      ? [{ x: -o.rx, y: -o.ry }, { x: o.rx, y: -o.ry }, { x: o.rx, y: o.ry }, { x: -o.rx, y: o.ry }]
      : Array.from({ length: 24 }, (_, i) => ({ x: o.rx * Math.cos((i * Math.PI) / 12),
                                                y: o.ry * Math.sin((i * Math.PI) / 12) }));
  // el mismo giro que el `rotate()` del SVG, con la y hacia abajo
  return ps.map((p) => ({ x: o.x + p.x * co - p.y * si, y: o.y + p.x * si + p.y * co }));
}

// Los puntos sobre la foto y, en cuanto hay calibración, el plano entero
// dibujado encima: el borde, las figuras del fondo, las pilas y los
// lotes. Es la prueba que no engaña: si la caseta dibujada cae sobre la
// caseta de la foto, está bien; si cae al lado, se ve antes de guardar.
function pintarSatelite(r) {
  if (!sat) return;
  const L = window.L;
  sat.capas.clearLayers();
  if (r.t) {
    const aLatLon = (ps) => ps.map((p) => { const g = r.t.aGeo(p.x, p.y); return [g.lat, g.lon]; });
    const ancho = Number(plat.ancho) || 1000, alto = Number(plat.alto) || 700;
    L.polygon(aLatLon([{ x: 0, y: 0 }, { x: ancho, y: 0 }, { x: ancho, y: alto }, { x: 0, y: alto }]),
      { className: 'sat-borde', interactive: false }).addTo(sat.capas);
    const enPatio = (l) => !l.pila_id && !['despachado', 'alimentado', 'plataforma'].includes(l.estado);
    for (const o of [...dibujo.figuras, ...dibujo.pilas, ...dibujo.lotes.filter(enPatio)])
      L.polygon(aLatLon(contornoPlano(o)), { className: 'sat-figura', interactive: false }).addTo(sat.capas);
  }
  const marca = (lat, lon, texto, clase) => L.marker([lat, lon], {
    interactive: false, keyboard: false,
    icon: L.divIcon({ className: `sat-marca ${clase}`, html: `<span>${esc(texto)}</span>`, iconSize: [26, 26] })
  }).addTo(sat.capas);
  puntos.forEach((p, i) => {
    // Adónde lo llevan los demás puntos: la raya enseña hacia dónde y
    // cuánto se aparta el que está mal.
    if (r.conError && r.t.errores[i] > 1) {
      const g = r.t.predichos[i];
      L.polyline([[p.lat, p.lon], [g.lat, g.lon]], { className: 'sat-desvio', interactive: false }).addTo(sat.capas);
    }
    marca(p.lat, p.lon, i + 1, r.malos.has(i) ? 'sat-marca-mala' : '');
  });
  if (geo) marca(geo.lat, geo.lon, puntos.length + 1, 'sat-marca-pendiente');
}

// Como en la app: ningún fallo se queda en la consola, que nadie mira.
addEventListener('unhandledrejection', (e) => { e.preventDefault(); decir(`Algo falló: ${e.reason?.message || e.reason}`, true); });
arrancar().catch((e) => pararCon(`No se pudo abrir la calibración: ${e?.message || e}`));
