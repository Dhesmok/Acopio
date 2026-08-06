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

const ESTADOS = {
  por_muestrear: 'Por muestrear', muestreado: 'Muestreado', remuestreo: 'Remuestreo',
  facturado: 'Facturado', devolucion: 'Devolución',
  plataforma: 'Plataforma 5', despachado: 'Despachado'
};
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
            historia: null };

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
  diana:     ico('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>')
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
  const [lotes, pilas, prov, figuras, config, cola, gente, malos] = await Promise.all([
    Store.lotes(), Store.pilas(), Store.proveedores(),
    Store.figuras(), Store.config(), Store.pendientes(),
    Store.perfiles(), Store.fallidos()
  ]);
  S.gente = gente; S.rechazados = malos.length;
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
        <button class="chip-sync" id="chip"><span class="punto"></span><span id="chip-txt">—</span></button>
        <button class="icono" id="menu" aria-label="Cuenta">⋮</button>
      </header>
      <nav class="pestanas">
        <button data-t="mapa" aria-selected="true">Mapa</button>
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
  // El mapa va a sangre completa: sin márgenes ni tope de ancho. La
  // lista sí se centra, porque un renglón de texto muy largo se lee mal.
  const m = $('#main');
  if (m) m.className = S.pestana === 'mapa' ? 'a-sangre' : '';
  // las barras del mapa flotan sobre TODA la pantalla, así que hay que
  // recogerlas al salir de la pestaña o se quedarían sobre la lista
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
  const { lotes, pilas, aproximados } = planoEn(t, {
    lotes: S.lotes, pilas: S.pilas, indice: h.indice
  });
  if (aproximados !== h.aproximados) { h.aproximados = aproximados; rotularHistoria(); }
  Mapa.pintar({ config: S.config, figuras: S.figuras, pilas, lotes });
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
  if (l.estado === 'despachado' || l.estado === 'plataforma') {
    return avisar(`${l.codigo}: ${ESTADOS[l.estado]}. Ya salió del patio, no se dibuja en el plano.`);
  }
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
const lotesQueCoinciden = () => {
  const q = S.busquedaMapa.trim().toUpperCase();
  const f = S.mapaFiltro;
  if (!q && f.campo === 'ninguno') return null;
  return S.lotes.filter((l) => {
    // Solo por código. La pregunta que responde este buscador es "¿dónde
    // está el PG1042?"; buscar por volqueta ya lo hace el botón de
    // filtros de al lado, y teniéndolo ahí, aceptar placas aquí solo
    // servía para que un código tecleado a medias trajera lotes que no
    // se estaban buscando.
    if (q && !l.codigo.toUpperCase().includes(q)) return false;
    return f.campo === 'ninguno' ? true
      : f.campo === 'proveedor' ? l.proveedor_id === f.valor
      : f.campo === 'estado' ? l.estado === f.valor
      : f.campo === 'placa' ? (l.placa || '') === f.valor
      : f.campo === 'material' ? (l.material || 'granel') === f.valor
      : true;
  });
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
// despachado o en plataforma ya no está en el patio. Para encuadrar hay
// que traducir de lote a la figura que de verdad está en el plano.
function figurasEnElPlano(lotes) {
  const vistas = new Map();
  for (const l of lotes || []) {
    if (l.estado === 'despachado' || l.estado === 'plataforma') continue;
    const f = l.pila_id ? S.pilas.find((p) => p.id === l.pila_id && p.estado === 'abierta') : l;
    if (f) vistas.set(f.id, f);
  }
  return [...vistas.values()];
}

function panelFiltro() {
  const placas = [...new Set(S.lotes.map((l) => l.placa).filter(Boolean))].sort();
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
      ${Object.entries(ESTADOS).map(([k, v]) => `<button data-campo="estado" data-valor="${k}"
        aria-pressed="${S.mapaFiltro.campo === 'estado' && S.mapaFiltro.valor === k}"
        >${v}</button>`).join('')}
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
    </div>`;

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
  if (!S.busquedaMapa.trim()) { n.textContent = ''; n.dataset.vacio = 'no'; return; }
  const cuantos = (lotesQueCoinciden() || []).length;
  n.textContent = cuantos === 0 ? 'ninguno' : String(cuantos);
  n.dataset.vacio = cuantos === 0 ? 'si' : 'no';
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
    config: S.config, figuras: S.figuras, pilas: S.pilas, lotes: S.lotes,
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
        ${terrones(col)}
        <circle class="vq-monton" r="40" fill="${esc(col)}" stroke="#14171a" stroke-width="2"/>
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
const volqueta = () => `
  <g transform="translate(0 -34)"><g class="vq-volco">
    <path d="M2 0 L98 0 L92 -36 L4 -36 Z" fill="var(--amarillo)" stroke="#14171a" stroke-width="3"/>
    <path d="M14 -8 L86 -8" stroke="#14171a" stroke-width="2" opacity=".35"/>
  </g></g>
  <path d="M0 -34 L110 -34 L110 -24 L0 -24 Z" fill="#14171a"/>
  <path d="M102 -34 L102 -64 L116 -72 L134 -72 L134 -24 L102 -24 Z"
        fill="var(--amarillo)" stroke="#14171a" stroke-width="3"/>
  <path d="M110 -62 L116 -66 L128 -66 L128 -50 L110 -50 Z" fill="#e9e5dc" stroke="#14171a" stroke-width="2"/>
  ${[32, 64, 124].map((x) => `<g><circle cx="${x}" cy="-15" r="15" fill="#14171a"/>
    <circle cx="${x}" cy="-15" r="6" fill="#e9e5dc"/></g>`).join('')}`;

// Los terrones que salen por detrás. Cada uno con su retardo y su caída,
// para que no parezca una sola pieza bajando.
const terrones = (col) => [
  [4, -8, 0], [-20, 6, 60], [16, 12, 110], [-8, -16, 160], [-26, -4, 210]
].map(([dx, dy, ret], i) => `
  <g class="vq-terron" style="--dx:${dx}px; --dy:${dy}px; animation-delay:${620 + ret}ms">
    <path transform="rotate(${i * 47})" d="M-7 -6 L6 -8 L9 4 L-2 8 L-8 2 Z"
      fill="${esc(col)}" stroke="#14171a" stroke-width="2"/>
  </g>`).join('');

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
    usuario_id: S.perfil.id
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

function siguienteCodigoPila() {
  const usados = S.pilas.map((p) => parseInt(p.codigo, 10)).filter((n) => !isNaN(n));
  let n = 1;
  while (usados.includes(n)) n++;
  return String(n);
}

// ------------------------------------------------------------------ lista
function pintarLista() {
  const prov = Object.fromEntries(S.proveedores.map((p) => [p.id, p.abreviatura]));
  const pilas = Object.fromEntries(S.pilas.map((p) => [p.id, p.codigo]));
  const q = S.busqueda.trim().toUpperCase();
  const conteo = (e) => S.lotes.filter((l) => l.estado === e).length;
  const nVenc = S.lotes.filter(vencido).length;

  const visibles = S.lotes.filter((l) => {
    if (S.filtro === 'vencidas') { if (!vencido(l)) return false; }
    else if (S.filtro !== 'todos' && l.estado !== S.filtro) return false;
    return !q || l.codigo.includes(q) || (pilas[l.pila_id] || '').includes(q);
  }).sort((a, b) => (b.ultimo_evento_en || '').localeCompare(a.ultimo_evento_en || ''));

  $('#main').innerHTML = `
    <input class="buscador" id="q" placeholder="Buscar lote o pila…" value="${esc(S.busqueda)}">
    <div class="filtros">
      <button data-f="todos" aria-pressed="${S.filtro === 'todos'}">Todos · ${S.lotes.length}</button>
      ${nVenc ? `<button data-f="vencidas" aria-pressed="${S.filtro === 'vencidas'}">Sin recoger · ${nVenc}</button>` : ''}
      ${Object.entries(ESTADOS).map(([k, v]) =>
        `<button data-f="${k}" aria-pressed="${S.filtro === k}">${v} · ${conteo(k)}</button>`).join('')}
    </div>
    <div class="lista">
      ${visibles.length ? visibles.map((l) => tarjeta(l, prov, pilas)).join('')
        : `<div class="vacio"><strong>No hay lotes que coincidan</strong>
             ${S.lotes.length ? 'Cambia el filtro o la búsqueda.' : 'Agrega el primero desde el mapa.'}</div>`}
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

function tarjeta(l, prov, pilas) {
  const v = vencido(l), r = textoRecogida(l), d = dias(l.estado_desde);
  return `<button class="lote" data-id="${l.id}" data-estado="${l.estado}" data-vencida="${v ? 'si' : 'no'}">
    <span class="barra"></span>
    <span class="cuerpo">
      <span class="codigo">${codigoHTML(l.codigo)}</span>
      <span class="meta">
        <span>${esc(prov[l.proveedor_id] || '—')}</span>
        ${l.placa ? `<span>${esc(l.placa)}</span>` : ''}
        <span class="dias" data-alerta="${v ? 'si' : 'no'}">${r || (d === 0 ? 'hoy' : `hace ${d} d`)}</span>
      </span>
    </span>
    <span class="lado">
      <span class="etiqueta" data-e="${l.estado}">${ESTADOS[l.estado]}</span>
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
    <h3>Sesión</h3>
    <div class="acciones">
      <button id="cerrar">Volver</button>
      <button id="salir" class="btn-peligro">Cerrar sesión</button>
    </div>`);
  $('#cerrar').onclick = cerrarHoja;
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
      volqueta: l.placa || '',
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
      · volqueta ${esc(l.placa || '—')} · recibido ${esc(l.fecha_recepcion)}</div>
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
      ${Object.entries(ESTADOS).filter(([k]) => k !== l.estado)
        .map(([k, v]) => `<button data-estado="${k}">${v}</button>`).join('')}
    </div>

    ${esAdmin() && enDevolucion(l) ? `
    <h3>${l.fecha_recogida ? 'Cambiar fecha de recogida' : 'Fecha de recogida'}</h3>
    <div class="acciones">
      <input type="date" id="f-recogida" value="${l.fecha_recogida || hoyISO(DIAS_RECOGIDA_SUGERIDOS)}">
      <button id="programar">${l.fecha_recogida ? 'Actualizar' : 'Programar'}</button>
    </div>
    <p class="pista">El compromiso de recogida lo fija y lo cambia solo el administrador,
       aunque cualquiera pueda declarar la devolución.</p>` : ''}

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
    <div class="campo">
      <label for="a-placa">Placa de la volqueta</label>
      <input id="a-placa" class="placa" data-mono spellcheck="false"
        autocapitalize="characters" value="${esc(l.placa || '')}">
    </div>
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

  document.querySelectorAll('.hoja .acciones button[data-estado]').forEach((b) => {
    b.onclick = accion(async () => {
      if (b.dataset.estado === 'devolucion') return pedirRecogida(l);
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

  soloLetrasYNumeros($('#a-placa'));
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
      codigo, placa: $('#a-placa').value.trim().toUpperCase(), proveedor_id: $('#a-prov').value
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

function pedirRecogida(l) {
  abrirHoja(`
    <h2>${codigoHTML(l.codigo)} · devolución</h2>
    <div class="sub">¿Hasta qué día tiene el proveedor para recoger el material?</div>
    <div class="campo" style="margin-top:14px">
      <label for="r-fecha">Fecha de recogida</label>
      <input type="date" id="r-fecha" value="${hoyISO(DIAS_RECOGIDA_SUGERIDOS)}" min="${hoyISO()}">
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
      <button id="a-plataforma" class="btn-lleno btn-ancho">Llevar a plataforma 5</button>
      <button id="archivar-pila" class="btn-ancho btn-peligro">Quitar la pila del mapa</button>
    </div>
    <p class="pista">Llevarla a plataforma 5 pasa todos sus lotes a ese estado y cierra la pila. Quitarla del mapa devuelve los lotes al patio y la archiva; su historial se conserva.</p>`}

    <h3>Lotes en esta pila</h3>
    <div class="lista">
      ${dentro.length ? dentro.map((l) => `
        <div class="fila-pila">
          <button class="lote" data-id="${l.id}" data-estado="${l.estado}" data-vencida="${vencido(l) ? 'si' : 'no'}">
            <span class="barra"></span>
            <span class="cuerpo"><span class="codigo">${codigoHTML(l.codigo)}</span>
              <span class="meta"><span>${esc(prov[l.proveedor_id] || '—')}</span>
              <span>${esc(l.placa || '')}</span></span></span>
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

  const ap = $('#a-plataforma');
  if (ap) ap.onclick = accion(async () => {
    const ok = await confirmar({
      titulo: `¿Llevar la pila ${p.codigo} a plataforma 5?`,
      detalle: `Sus ${dentro.length} lote${dentro.length === 1 ? '' : 's'} pasan a ese estado y salen del mapa, y la pila se cierra. Queda en el historial de cada lote.`,
      aceptar: 'Llevarla'
    });
    if (!ok) return fichaPila(id);
    for (const l of dentro) {
      await Store.registrarEvento({
        lote_id: l.id, tipo: 'cambio_estado', estado_nuevo: 'plataforma', usuario_id: S.perfil.id
      });
    }
    await Store.renombrarPila(id, { estado: 'consumida' });
    cerrarHoja(); await recargar(); sincronizar();
  }, { ocupado: 'Llevando…' });

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
    <div class="campo">
      <label for="f-placa">Placa de la volqueta</label>
      <input id="f-placa" class="placa" data-mono autocomplete="off"
             inputmode="text" autocapitalize="characters" spellcheck="false">
    </div>
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
  soloLetrasYNumeros($('#f-placa'));
  $('#fm-granel').onclick = () => elegirMaterial('granel');
  $('#fm-bigbag').onclick = () => elegirMaterial('bigbag');

  $('#f-cancelar').onclick = cerrarHoja;
  const falla = (t) => { const e = $('#f-error'); if (e) { e.hidden = false; e.textContent = t; } };
  $('#f-guardar').onclick = accion(async () => {
    $('#f-error').hidden = true;
    const num = $('#f-num').value.trim().toUpperCase();
    const placa = $('#f-placa').value.trim().toUpperCase();
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
  const c = S.config;
  abrirHoja(`
    <h2>Fondo del mapa</h2>
    <div class="sub">Solo tú puedes cambiarlo. Los contratistas lo ven, no lo editan.</div>

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
         ['devolucion', 'Devolución'], ['despachado', 'Despachado'],
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
      id: Store.uuid(), forma, etiqueta: null,
      x: c2.x, y: c2.y, rx: forma === 'rectangulo' ? 110 : 80, ry: 70, rot: 0,
      color: '#c7cdc5', orden: S.figuras.length
    });
    cerrarHoja(); await recargar(); sincronizar();
  }, { ocupado: 'Agregando…' });
  $('#add-rect').onclick = agregar('rectangulo');
  $('#add-elipse').onclick = agregar('elipse');

  const quitar = $('#quitar-img');
  if (quitar) quitar.onclick = accion(async () => {
    await Store.guardarConfig({ ...S.config, imagen_url: null });
    cerrarHoja(); await recargar(); sincronizar();
  }, { ocupado: 'Quitando…' });

  $('#colores-base').onclick = accion(async () => {
    await Store.guardarConfig({ ...S.config, colores: { ...Mapa.COLORES_BASE } });
    cerrarHoja(); await recargar(); sincronizar();
  }, { ocupado: 'Restaurando…' });

  $('#guardar-fondo').onclick = accion(async () => {
    const colores = { ...paletaActual() };
    document.querySelectorAll('[data-color]').forEach((i) => { colores[i.dataset.color] = i.value; });
    const cfg = {
      ...S.config, colores,
      ancho: Number($('#c-ancho').value) || 1000,
      alto: Number($('#c-alto').value) || 700,
      color_fondo: $('#c-color').value,
      imagen_opacidad: $('#c-op') ? Number($('#c-op').value) : (S.config.imagen_opacidad ?? 1)
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
    await Store.guardarConfig(cfg);
    cerrarHoja(); await recargar(); Mapa.encuadrar(); sincronizar();
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
