// =====================================================================
//  app.js · armazón: mapa, lista, fichas y formularios
// =====================================================================
import * as Store from './store.js';
import { sb } from './store.js';
import * as Mapa from './mapa.js';
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
const TIPOS_PILA = {
  alimentacion: 'Alimentación a planta', devolucion: 'Devolución',
  espera: 'En espera', otro: 'Otro'
};

const S = { perfil: null, pestana: 'mapa', filtro: 'todos', busqueda: '', edicion: false,
            lotes: [], pilas: [], proveedores: [], figuras: [], gente: [], config: {},
            pendientes: 0, idsPendientes: new Set(), rechazados: 0, sync: null,
            actualizacion: false,
            // filtro del mapa: resalta lo que coincide y atenúa el resto
            mapaFiltro: { campo: 'ninguno', valor: null },
            recorrido: null };

const esAdmin = () => S.perfil?.rol === 'admin';
const soloLectura = () => S.perfil?.rol === 'empresa';

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
  cerrar:    ico('<path d="M18 6L6 18M6 6l12 12"/>')
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
const vencido = (l) => !!l.fecha_recogida && l.fecha_recogida < hoyISO();
function textoRecogida(l) {
  if (!l.fecha_recogida) return null;
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
  setInterval(sincronizar, 20_000);
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
  return (r * 299 + g * 587 + b * 114) / 1000 > 165 ? '#14171a' : '#ffffff';
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

const decirError = (e) =>
  avisar(`No se pudo guardar: ${e?.message || e}. El cambio quedó en el celular; se reintenta solo.`);

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
      <div id="franja" hidden class="franja"><div></div></div>
      <nav class="pestanas">
        <button data-t="mapa" aria-selected="true">Mapa</button>
        <button data-t="lotes" aria-selected="false">Lotes</button>
      </nav>
    </div>
    <main id="main"></main>
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
  if (S.pestana !== 'mapa') return pintarLista();
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
      'Tu usuario todavía no está habilitado en el servidor · lo que registres se guarda aquí, pero no sube. Avisa al administrador.';
    f.onclick = () => avisar(
      'El administrador tiene que activar tu perfil en la base de datos (perfiles → activo). '
      + 'Mientras tanto puedes seguir trabajando: todo queda guardado en el celular y sube solo cuando te habiliten.');
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
function montarMapa() {
  // Rearmar la barra no puede costar el encuadre en el que se estaba
  const vistaPrevia = document.querySelector('#lienzo') ? Mapa.obtenerVista() : null;

  $('#main').innerHTML = `
    <div class="pantalla-mapa">
      ${S.recorrido ? `<div class="barra-modo">
        <span>Recorrido del lote en pantalla</span>
        <button class="pastilla" id="quitar-recorrido">Quitar</button></div>` : ''}
      <div id="barra-forma"></div>
      <div class="mapa-caja">
        <div id="lienzo-caja"></div>
        <div class="mapa-controles">
          <div class="ctrl-izq">
            ${soloLectura() ? '' : `<button class="btn-mapa btn-mapa-primario" id="nuevo"
              >${ICO.mas}<span>Nuevo lote</span></button>`}
            <div class="grupo-herramientas">
              <button class="btn-mapa" id="r-filtrar" aria-label="Filtrar">
                ${ICO.filtro}<span>Filtrar</span></button>
              ${soloLectura() ? '' : `<button class="btn-mapa" id="r-editar" aria-label="Editar formas">
                ${ICO.editar}<span>${S.edicion ? 'Salir de editar' : 'Editar formas'}</span></button>`}
              ${esAdmin() ? `<button class="btn-mapa" id="r-fondo" aria-label="Fondo del mapa">
                ${ICO.fondo}<span>Fondo del mapa</span></button>` : ''}
            </div>
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
    alTocar: (tipo, id) => {
      if (tipo === 'lote') fichaLote(id);
      else if (tipo === 'pila') fichaPila(id);
      else if (esAdmin()) fichaFigura(id);
    },
    alSeleccionar: (tipo, obj) => barraForma(tipo, obj),
    alTocarVacio: () => { if (S.edicion) barraEdicion(); },
    alGuardarGeom: async (tipo, obj, origen) => {
      const tabla = tipo === 'lote' ? 'lotes' : tipo === 'pila' ? 'pilas' : 'mapa_figuras';
      await Store.guardarFigura(tabla, { ...obj });
      if (tipo === 'lote' && origen) await anotarRecorrido(obj, origen);
      await recargar();
      sincronizar();
    },
    alSoltarSobre: manejarSoltar
  });
  refrescarMapa();
  Mapa.fijarVista(vistaPrevia);

  $('#zoom-mas').onclick = () => Mapa.acercar(0.8);
  $('#zoom-menos').onclick = () => Mapa.acercar(1.25);
  $('#encuadrar').onclick = () => Mapa.encuadrar();
  if ($('#nuevo')) $('#nuevo').onclick = formLote;
  $('#r-filtrar').onclick = panelFiltro;
  if ($('#r-fondo')) $('#r-fondo').onclick = panelFondo;
  if ($('#r-editar')) $('#r-editar').onclick = () => { S.edicion = !S.edicion; montarMapa(); };
  if (S.edicion) $('#r-editar')?.setAttribute('aria-pressed', 'true');
  actualizarChipFiltro();

  Mapa.editar(S.edicion);
  if (S.edicion) barraEdicion();
  const qr = $('#quitar-recorrido');
  if (qr) qr.onclick = () => { S.recorrido = null; montarMapa(); Mapa.encuadrar(); };
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

// Lo que coincide se ve normal; lo demás se atenúa, no se esconde
function calcularDestacados() {
  const f = S.mapaFiltro;
  if (f.campo === 'ninguno') return null;
  const coincide = (l) =>
    f.campo === 'proveedor' ? l.proveedor_id === f.valor
    : f.campo === 'estado' ? l.estado === f.valor
    : f.campo === 'placa' ? (l.placa || '') === f.valor
    : f.campo === 'material' ? (l.material || 'granel') === f.valor
    : true;
  const ids = new Set(S.lotes.filter(coincide).map((l) => l.id));
  for (const p of S.pilas)
    if (S.lotes.some((l) => l.pila_id === p.id && ids.has(l.id))) ids.add(p.id);
  if (f.campo === 'material')
    for (const l of S.lotes) if ((l.material || 'granel') === f.valor) ids.add(l.id);
  for (const g of S.figuras) ids.add(g.id);
  return ids;
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
  refrescarMapa();
}

function refrescarMapa() {
  if (S.pestana !== 'mapa' || !document.querySelector('#lienzo-caja')) return;
  Mapa.pintar({
    config: S.config, figuras: S.figuras, pilas: S.pilas, lotes: S.lotes,
    destacados: calcularDestacados(), recorrido: S.recorrido
  });
}

function barraEdicion() {
  $('#barra-forma').innerHTML = `
    <div class="barra-modo">
      <span>Modo edición · toca cualquier lote, pila o figura del fondo para ajustar su tamaño, su giro o su contorno</span>
      <button class="pastilla" id="salir-edicion">Salir</button>
    </div>`;
  $('#salir-edicion').onclick = () => { S.edicion = false; montarMapa(); };
}

function barraForma(tipo, obj) {
  const nombre = tipo === 'lote' ? obj.codigo
    : tipo === 'pila' ? `Pila ${obj.codigo}` : (obj.etiqueta || 'Figura');
  const ayuda = obj.forma === 'poligono'
    ? 'arrastra los vértices, toca un “+” para agregar uno y toca un vértice para quitarlo'
    : 'arrastra el punto de la esquina para el tamaño y el de arriba para girar';
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

// Soltar un lote sobre otro arma una pila; sobre una pila, lo mete.
async function manejarSoltar(lote, blanco) {
  if (soloLectura()) return refrescarMapa();

  if (blanco.tipo === 'pila') {
    await Store.guardarFigura('lotes', { ...lote });
    await Store.registrarEvento({
      lote_id: lote.id, tipo: 'ingreso_pila', pila_id: blanco.obj.id, usuario_id: S.perfil.id
    });
    await recargar();
    return;
  }

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
  await recargar();
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
      <span class="codigo">${esc(l.codigo)}</span>
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

function abrirHoja(html) {
  $('#modal').innerHTML = `<div class="velo"><div class="hoja">${html}</div></div>`;
  $('.velo').onclick = (e) => { if (e.target === $('.velo')) cerrarHoja(); };
}
const cerrarHoja = () => { $('#modal').innerHTML = ''; };

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
    <p class="pista">Nada se perdió: siguen en pantalla marcados como “sin subir”.
       Corrige la causa (normalmente el primero de la lista) y usa Reintentar;
       lo que solo estaba esperándolo sube detrás, en el mismo orden en que se registró.</p>
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
    <h3>Sesión</h3>
    <div class="acciones">
      <button id="cerrar">Volver</button>
      <button id="salir" class="btn-peligro">Cerrar sesión</button>
    </div>`);
  $('#cerrar').onclick = cerrarHoja;
  $('#salir').onclick = async () => {
    if (S.pendientes > 0 && !confirm(`Hay ${S.pendientes} cambios sin subir. Si cierras sesión ahora se pierden. ¿Continuar?`)) return;
    await Store.salir();
    location.reload();
  };
}

async function fichaLote(id) {
  const l = await Store.lote(id);
  if (!l) return;
  const prov = S.proveedores.find((p) => p.id === l.proveedor_id);
  const pila = S.pilas.find((p) => p.id === l.pila_id);
  const eventos = await Store.historial(id);
  const r = textoRecogida(l);
  const lectura = soloLectura();

  abrirHoja(`
    <h2>${esc(l.codigo)}</h2>
    <div class="sub">${esc(prov?.nombre || '—')} · ${MATERIALES[l.material || 'granel']}
      · volqueta ${esc(l.placa || '—')} · recibido ${esc(l.fecha_recepcion)}</div>
    <div class="fila-chips">
      <span class="etiqueta" data-e="${l.estado}">${ESTADOS[l.estado]}</span>
      <span class="dias">${dias(l.estado_desde) === 0 ? 'desde hoy' : `hace ${dias(l.estado_desde)} días`}</span>
      ${pila ? `<span class="pila-tag">Pila ${esc(pila.codigo)}</span>` : ''}
    </div>
    ${r ? `<div class="dias" data-alerta="${vencido(l) ? 'si' : 'no'}" style="margin:6px 0">
             Recogida ${esc(l.fecha_recogida)} · ${esc(r)}</div>` : ''}

    ${lectura ? '' : `
    <h3>Cambiar estado</h3>
    <div class="acciones">
      ${Object.entries(ESTADOS).filter(([k]) => k !== l.estado)
        .map(([k, v]) => `<button data-estado="${k}">${v}</button>`).join('')}
    </div>

    ${esAdmin() ? `
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
      <input id="a-placa" data-mono value="${esc(l.placa || '')}">
    </div>
    <div class="campo">
      <label for="a-prov">Proveedor</label>
      <select id="a-prov">
        ${S.proveedores.map((p) => `<option value="${p.id}" ${p.id === l.proveedor_id ? 'selected' : ''}
          >${esc(p.abreviatura)} · ${esc(p.nombre)}</option>`).join('')}
      </select>
    </div>
    <button class="btn btn-ancho" id="a-guardar" style="width:100%">Guardar corrección</button>` : ''}

    <h3>Observación</h3>
    <div class="campo"><textarea id="nota" rows="2" placeholder="Qué se observó en el lote"></textarea></div>
    <button class="btn btn-ancho" id="guardar-nota" style="width:100%">Guardar observación</button>`}

    <h3>Historial</h3>
    <ul class="linea-tiempo">
      ${eventos.map((e) => `<li>
        <div class="cuando">${new Date(e.ocurrido_en).toLocaleString('es-CO')} · ${esc(quien(e.usuario_id))}</div>
        <div class="que">${textoEvento(e)}</div>
        ${e.nota ? `<div class="nota">${esc(e.nota)}</div>` : ''}</li>`).join('')}
    </ul>
    <button class="btn btn-ancho" id="cerrar" style="width:100%;margin-top:10px">Cerrar</button>`);

  $('#cerrar').onclick = cerrarHoja;
  if (lectura) return;

  document.querySelectorAll('.hoja .acciones button[data-estado]').forEach((b) => {
    b.onclick = accion(async () => {
      if (b.dataset.estado === 'devolucion') return pedirRecogida(l);
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
  if (sacar) sacar.onclick = accion(async () => { await sacarDePila(l, pila); cerrarHoja(); },
    { ocupado: 'Sacando…' });

  document.querySelectorAll('.hoja button[data-material]').forEach((b) => {
    b.onclick = accion(async () => {
      const material = b.dataset.material;
      const cambios = { material };
      // si estaba dibujado a mano se respeta; si no, toma la figura del material
      if (l.forma !== 'poligono') cambios.forma = FORMA_DE[material];
      await Store.actualizarLote(l.id, cambios);
      cerrarHoja(); await recargar(); sincronizar();
    });
  });

  const pol = $('#poligono');
  if (pol) pol.onclick = accion(async () => {
    const cambios = l.forma === 'poligono'
      ? { forma: FORMA_DE[l.material || 'granel'] }
      : { forma: 'poligono', puntos: l.puntos?.length >= 3 ? l.puntos : Mapa.puntosPorDefecto(l.rx, l.ry) };
    await Store.actualizarLote(l.id, cambios);
    cerrarHoja(); await recargar(); sincronizar();
    abrirEdicion('lote', { ...l, ...cambios });
  });

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

// Al salir de la pila el lote vuelve al mapa, junto a ella
async function sacarDePila(l, pila, { revisar = true } = {}) {
  const a = Math.random() * Math.PI * 2;
  const x = (pila?.x ?? l.x) + Math.cos(a) * ((pila?.rx ?? 80) + 70);
  const y = (pila?.y ?? l.y) + Math.sin(a) * ((pila?.ry ?? 60) + 60);
  await Store.guardarFigura('lotes', { ...l, x, y });
  await Store.registrarEvento({ lote_id: l.id, tipo: 'salida_pila', usuario_id: S.perfil.id });
  if (revisar && pila) await revisarPila(pila);
  await recargar(); sincronizar();
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
    <h2>${esc(l.codigo)} · devolución</h2>
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

  abrirHoja(`
    <h2>Pila ${esc(p.codigo)}</h2>
    <div class="sub">${TIPOS_PILA[p.tipo] || p.tipo} · ${dentro.length} lote${dentro.length === 1 ? '' : 's'}</div>
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
    <button class="btn btn-ancho" id="guardar-pila" style="width:100%">Guardar</button>`}

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
            <span class="cuerpo"><span class="codigo">${esc(l.codigo)}</span>
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

    <button class="btn btn-ancho" id="cerrar" style="width:100%;margin-top:14px">Cerrar</button>`);

  $('#cerrar').onclick = cerrarHoja;
  document.querySelectorAll('.hoja .lote').forEach((c) => { c.onclick = () => fichaLote(c.dataset.id); });
  document.querySelectorAll('.hoja [data-sacar]').forEach((b) => {
    b.onclick = accion(async (ev) => {
      ev.stopPropagation();
      const l = await Store.lote(b.dataset.sacar);
      await sacarDePila(l, p);
      cerrarHoja();
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
      <input id="f-placa" data-mono autocomplete="off">
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
    await Store.crearLote({
      codigo, proveedor_id, placa,
      material, forma: FORMA_DE[material],
      x: c.x + (Math.random() - 0.5) * 90, y: c.y + (Math.random() - 0.5) * 70,
      usuario_id: S.perfil.id
    });
    cerrarHoja(); await recargar(); sincronizar();
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
      <button id="guardar-fondo" class="btn-lleno">Guardar</button>
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
      <button id="g-guardar" class="btn-lleno">Guardar</button>
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
