// =====================================================================
//  historia.js · cómo estaba el patio en un momento dado
//
//  Cada cambio de un lote queda escrito como un evento que no se borra
//  nunca: entró, cambió de estado, se metió en una pila, se movió. Con
//  esa lista se puede rehacer el patio de cualquier día y hora sin tocar
//  nada de lo que hay ahora.
//
//  Se reconstruye HACIA DELANTE, aplicando uno por uno los eventos
//  anteriores al momento pedido, con las mismas reglas que usa el
//  servidor cuando llega un evento nuevo. Así lo que se ve en el pasado
//  se deriva igual que lo que se ve en el presente.
//
//  DE DÓNDE SE PARTE, que es lo que antes estaba mal.
//
//  Reconstruir hacia delante solo sale bien si se tiene la historia
//  ENTERA del lote. Cuando falta —su recepción es más vieja que lo
//  guardado en el celular— dar por hecho que acababa de llegar pintaba
//  medio patio de "por muestrear" y vaciaba las pilas, incluso mirando
//  el minuto anterior. Ahora el punto de partida se elige campo por
//  campo, y el detalle está en `planoEn`.
//
//  LO QUE NO SE PUEDE SABER NI ASÍ:
//
//  · El TAMAÑO y la FORMA de una figura no se guardan como evento —solo
//    la posición—, así que un lote que se estiró después se dibuja con
//    el tamaño de hoy. La mancha estará donde estaba; puede que no sea
//    exactamente igual de grande.
//  · Al SALIR de una pila no se apunta de cuál salió. Si el evento de
//    entrada quedó fuera de lo que hay guardado, ese lote sale suelto.
//  · Solo se puede llegar tan atrás como lleguen los eventos guardados.
//    `desde()` dice hasta dónde.
// =====================================================================

// Un lote recién recibido, antes de que le pase nada.
const nacido = (l) => ({
  ...l, estado: 'por_muestrear', pila_id: null, fecha_recogida: null
});

// Las mismas reglas que aplica el servidor al recibir un evento.
function aplicar(l, e) {
  if (e.tipo === 'cambio_estado') {
    l.estado = e.estado_nuevo;
    l.estado_desde = e.ocurrido_en;
    l.fecha_recogida = e.fecha_recogida || null;
  } else if (e.tipo === 'programar_recogida') l.fecha_recogida = e.fecha_recogida;
  else if (e.tipo === 'ingreso_pila') l.pila_id = e.pila_id;
  else if (e.tipo === 'salida_pila') l.pila_id = null;
  else if (e.tipo === 'movimiento' && e.x != null) { l.x = Number(e.x); l.y = Number(e.y); }
  l.ultimo_evento_en = e.ocurrido_en;
}

// Dónde estaba antes de moverse por primera vez.
//
// Un traslado se apunta como DOS eventos: de dónde salió y a dónde
// llegó. Así que el primer 'movimiento' posterior al momento que se pide
// lleva justo la posición que tenía entonces. Si no se movió nunca, la
// de hoy es la de siempre.
function dondeEstaba(l, suyos, t) {
  const antes = suyos.filter((e) => e.tipo === 'movimiento' && e.ocurrido_en <= t && e.x != null);
  if (antes.length) return null;                    // ya lo pone `aplicar`
  const despues = suyos.find((e) => e.tipo === 'movimiento' && e.ocurrido_en > t && e.x != null);
  return despues ? { x: Number(despues.x), y: Number(despues.y) } : null;
}

// Hasta dónde alcanza la reconstrucción: el evento más viejo que hay.
export function desde(eventos) {
  let min = null;
  for (const e of eventos) if (!min || e.ocurrido_en < min) min = e.ocurrido_en;
  return min;
}

// Los eventos de cada lote, en orden. Se hace UNA vez al entrar a mirar
// atrás y se reutiliza en cada tirón del deslizador: agrupar y ordenar
// veinte mil eventos en cada cuadro es lo que hacía que arrastrar el
// deslizador se sintiera pegajoso.
export function indexar(eventos = []) {
  const suyos = new Map();
  for (const e of eventos) {
    if (!e.lote_id) continue;
    if (!suyos.has(e.lote_id)) suyos.set(e.lote_id, []);
    suyos.get(e.lote_id).push(e);
  }
  for (const lista of suyos.values())
    lista.sort((a, b) => String(a.ocurrido_en).localeCompare(String(b.ocurrido_en)));
  return suyos;
}

// El patio en el instante `t` (una marca de tiempo ISO).
//
// Devuelve lotes y pilas con la misma forma que espera el plano, así que
// se le puede dar tal cual a `Mapa.pintar`, más la cuenta de los que no
// se pudieron rehacer con certeza.
export function planoEn(t, { lotes = [], pilas = [], eventos = [], indice = null }) {
  const suyos = indice || indexar(eventos);

  const reconstruidos = [];
  let aproximados = 0;
  for (const l of lotes) {
    const mios = suyos.get(l.id) || [];
    const recibido = mios.find((e) => e.tipo === 'recepcion');
    // ¿ya existía? Si tenemos su evento de recepción manda ese; si no
    // —porque su historia es más vieja que lo guardado—, la fecha en que
    // se creó la fila.
    const entro = recibido ? recibido.ocurrido_en : (l.creado_en || l.fecha_recepcion || '');
    if (!entro || entro > t) continue;

    // El punto de partida se elige CAMPO POR CAMPO, que es la única
    // manera de que salga bien sin la historia entera:
    //
    // · Con la recepción guardada, se parte de como nació y los eventos
    //   llevan cada campo hasta el momento pedido.
    // · Sin ella, si NINGÚN evento posterior toca ese campo, el valor de
    //   hoy es el de entonces: nada lo ha cambiado desde entonces. Esto
    //   es lo que arregla el caso corriente —un lote del que no queda
    //   ningún evento guardado—, que antes salía "por muestrear" y fuera
    //   de su pila aunque se mirara el minuto anterior.
    // · Sin ella y CON eventos posteriores, el valor de hoy es seguro
    //   que no vale (algo lo cambió después), así que se vuelve al de
    //   nacimiento y el lote se marca como aproximado.
    const tocanDespues = (tipos) =>
      mios.some((e) => e.ocurrido_en > t && tipos.includes(e.tipo));
    const copia = { ...l };
    let aprox = false;
    const arrancar = (campo, valor, tipos) => {
      if (recibido) { copia[campo] = valor; return; }
      if (!tocanDespues(tipos)) return;                 // lo de hoy vale
      copia[campo] = valor;
      aprox = true;
    };
    arrancar('estado', 'por_muestrear', ['cambio_estado']);
    arrancar('pila_id', null, ['ingreso_pila', 'salida_pila']);
    arrancar('fecha_recogida', null, ['cambio_estado', 'programar_recogida']);
    if (aprox) { copia._aprox = true; aproximados++; }

    const sitio = dondeEstaba(l, mios, t);
    if (sitio) { copia.x = sitio.x; copia.y = sitio.y; }
    for (const e of mios) { if (e.ocurrido_en > t) break; aplicar(copia, e); }
    reconstruidos.push(copia);
  }

  // Una pila se ve si ya existía y si en ese momento tenía algo dentro.
  // Su ciclo de vida no se guarda como evento, pero no hace falta: una
  // pila vacía no se dibuja nunca, ni entonces ni ahora.
  const conLotes = new Set(reconstruidos.map((l) => l.pila_id).filter(Boolean));
  const pilasEntonces = pilas
    .filter((p) => conLotes.has(p.id) && (!p.creado_en || p.creado_en <= t))
    .map((p) => ({ ...p, estado: 'abierta' }));

  return { lotes: reconstruidos, pilas: pilasEntonces, aproximados };
}
