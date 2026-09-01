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
  else if (e.tipo === 'traslado') l.plataforma_id = e.plataforma_id;
  else if (e.tipo === 'movimiento' && e.x != null) { l.x = Number(e.x); l.y = Number(e.y); }
  l.ultimo_evento_en = e.ocurrido_en;
}

// Dónde estaba, con el mismo criterio que el estado y la pila.
//
// SI NADIE LO MOVIÓ DESPUÉS del momento que se pide, donde está hoy es
// donde estaba. Y esto no es un apaño: un acomodo pequeño NO se apunta
// —solo cuenta como traslado si la figura deja de traslaparse con donde
// estaba, ver `movimientoReal` en mapa.js—, así que la última posición
// apuntada se va quedando atrás de la de verdad. Clavar el lote ahí
// hacía que al entrar a mirar otro día el patio entero se descuadrara,
// con lotes montados unos encima de otros, incluso mirando "ahora
// mismo", que tiene que salir igualito al plano de verdad.
//
// Si sí lo movieron después, entonces la de hoy no vale y manda el
// apunte: el último anterior al momento pedido, y si no hay ninguno, el
// primero posterior, que es la marca de "de dónde salió" que se escribe
// la primera vez que un lote se traslada.
// `apuntado` dice de dónde salió la posición: de un apunte de traslado,
// o heredada de donde está el lote hoy. Quien llama lo necesita porque
// heredarla no siempre vale (ver `repartirAlrededor`).
function dondeEstaba(l, suyos, t) {
  const mov = (e) => e.tipo === 'movimiento' && e.x != null;
  const despues = suyos.find((e) => mov(e) && e.ocurrido_en > t);
  if (!despues) return { x: l.x, y: l.y, apuntado: false };
  let ultimo = null;
  for (const e of suyos) {
    if (e.ocurrido_en > t) break;
    if (mov(e)) ultimo = e;
  }
  const p = ultimo || despues;
  return { x: Number(p.x), y: Number(p.y), apuntado: true };
}

// Un lote que HOY está dentro de una pila NO tiene sitio propio en el
// plano: no se dibuja suelto, y la posición que lleva guardada es la del
// punto donde se soltó el dedo al meterlo, encima de la pila. Así que
// mirando un día en que todavía andaba suelto, "donde está hoy" no dice
// nada: los que comparten pila salen todos en el mismo punto, montados
// unos sobre otros. Eso es lo que se veía en el patio.
//
// Dónde estaba de verdad no se puede saber sin un apunte de traslado, y
// los que entraron a la pila antes de que eso se registrara no lo
// tienen. Lo que sí se sabe es que estaban POR AHÍ: una pila se arma con
// lo que ya está junto. Así que se reparten en un anillo alrededor de la
// pila —en orden fijo, para que no bailen al mover el deslizador— y van
// marcados como aproximados, igual que todo lo que aquí se supone.
//
// El radio sale de dos exigencias: caer FUERA de la pila, que puede
// estar dibujada si a esa hora ya tenía otros lotes dentro, y quedar
// suficientemente separados entre sí, que con muchos lotes es lo que
// manda. `sin(π/n)` es la mitad del hueco entre dos vecinos del anillo.
const radioDe = (o) => Math.max(Number(o.rx) || 40, Number(o.ry) || 40);

function repartirAlrededor(grupo, pila) {
  grupo.sort((a, b) => String(a.codigo ?? a.id).localeCompare(String(b.codigo ?? b.id),
    'es', { numeric: true }));
  const mayor = Math.max(...grupo.map(radioDe));
  const cx = Number(pila?.x ?? grupo[0].x), cy = Number(pila?.y ?? grupo[0].y);
  const afuera = (pila ? radioDe(pila) : 0) + mayor + 14;
  const holgados = grupo.length > 1 ? (mayor * 1.15) / Math.sin(Math.PI / grupo.length) : 0;
  const r = Math.max(afuera, holgados);
  grupo.forEach((l, i) => {
    const a = (2 * Math.PI * i) / grupo.length - Math.PI / 2;
    l.x = cx + r * Math.cos(a);
    l.y = cy + r * Math.sin(a);
    l._aprox = true;
  });
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
  // El desempate importa y no es adorno: los dos apuntes de un traslado
  // —de dónde salió y a dónde llegó— se escribieron seguidos, y los
  // guardados antes de que la hora avanzara sola comparten milisegundo.
  // Sin desempatar, el orden lo decide cómo vengan de IndexedDB, que los
  // devuelve por clave (un uuid al azar): la pareja llegaba al revés la
  // mitad de las veces. `registrado_en` es la hora en que el servidor los
  // recibió, y la cola sube en orden, así que ese sí los separa bien.
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  for (const lista of suyos.values())
    lista.sort((a, b) =>
      cmp(String(a.ocurrido_en), String(b.ocurrido_en))
      || cmp(String(a.registrado_en ?? ''), String(b.registrado_en ?? ''))
      || cmp(String(a.id ?? ''), String(b.id ?? '')));
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
  const sinSitio = new Map();          // los que hay que repartir, por pila
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
    // La plataforma es distinta de los demás campos: NO tiene valor de
    // nacimiento apuntado, porque la recepción no dice en qué patio
    // entró. Así que si lo trasladaron después del momento pedido pero no
    // antes, no hay forma de saber dónde estaba: se deja la de hoy y el
    // lote sale marcado, como todo lo que se supone.
    if (mios.some((e) => e.tipo === 'traslado' && e.ocurrido_en > t)
        && !mios.some((e) => e.tipo === 'traslado' && e.ocurrido_en <= t)) aprox = true;
    // De lo que ya se comió la planta no se guarda el recorrido: ocupa
    // mucho y no se dibuja en ningún plano de hoy (ver `podarRecorridos`
    // en store.js). Mirando un día en que ese lote SÍ estaba en el patio,
    // entonces, no hay forma de saber dónde: se deja donde estaba al
    // final y se marca, como todo lo que aquí se supone. Si alguien pidió
    // más historia y los apuntes volvieron a bajar, esto no se cumple y
    // el lote sale en su sitio de verdad.
    if (l.estado === 'alimentado' && !mios.some((e) => e.tipo === 'movimiento')) aprox = true;
    if (aprox) { copia._aprox = true; aproximados++; }

    for (const e of mios) { if (e.ocurrido_en > t) break; aplicar(copia, e); }
    // La posición se decide APARTE y va la última, porque `aplicar` la
    // pisa con cada traslado apuntado y aquí manda otro criterio.
    const sitio = dondeEstaba(l, mios, t);
    copia.x = sitio.x; copia.y = sitio.y;
    // Suelto entonces, en una pila hoy y sin ningún traslado apuntado:
    // la posición que trae es la del sitio donde se soltó el dedo al
    // meterlo a la pila, no la del patio. Se aparta para repartirla.
    if (l.pila_id && !copia.pila_id && !sitio.apuntado) {
      if (!sinSitio.has(l.pila_id)) sinSitio.set(l.pila_id, []);
      sinSitio.get(l.pila_id).push(copia);
    }
    reconstruidos.push(copia);
  }

  for (const [pilaId, grupo] of sinSitio)
    repartirAlrededor(grupo, pilas.find((p) => p.id === pilaId));
  aproximados = reconstruidos.filter((l) => l._aprox).length;

  // Una pila se ve si ya existía y si en ese momento tenía algo dentro.
  // Su ciclo de vida no se guarda como evento, pero no hace falta: una
  // pila vacía no se dibuja nunca, ni entonces ni ahora.
  const conLotes = new Set(reconstruidos.map((l) => l.pila_id).filter(Boolean));
  const pilasEntonces = pilas
    .filter((p) => conLotes.has(p.id) && (!p.creado_en || p.creado_en <= t))
    .map((p) => ({ ...p, estado: 'abierta' }));

  return { lotes: reconstruidos, pilas: pilasEntonces, aproximados };
}
