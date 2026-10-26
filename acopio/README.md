# Mapa de acopio

App web instalable (PWA) para controlar lotes y pilas en el patio, pensada para señal intermitente: **guardar nunca falla**. Todo cambio se escribe en el celular y sube solo cuando vuelve la señal.

```
sql/schema.sql        base de datos (Supabase / Postgres)
sql/migracion.sql     actualiza una base en uso sin borrar datos
sql/diagnostico.sql   qué falta y quién no está habilitado; no cambia nada
sql/duplicados.sql    limpiar lotes repetidos y eventos huérfanos
sql/fechas.sql        corregir lotes fechados un día adelante (UTC)
sql/redondear.sql     vuelve círculos los lotes a granel que ya existían
sql/reset.sql         borra todo, solo para empezar de cero a propósito
web/                  la app: se sube tal cual a un hosting estático
pruebas/              `node pruebas/correr.mjs`, sin instalar nada
DEPLOY.md             cómo publicarla
```

Solo se publica `web/`. `sql/` y `pruebas/` se quedan en el repositorio.

## 1. Base de datos (10 minutos)

1. Crear proyecto gratuito en [supabase.com](https://supabase.com):
   - **Región: East US (North Virginia).** Desde Colombia el tráfico sale por Miami, así que Virginia responde más rápido que São Paulo. No se puede cambiar después.
   - **Postgres**, no OrioleDB (sigue en beta, no recomendado para producción).
   - **Data API: habilitada.** Es la puerta por la que entra la app; sin ella `supabase-js` no puede conectarse.
2. **SQL Editor → New query**, pegar el contenido de `sql/schema.sql` y ejecutar.
   **Si la base ya está en uso, NO uses schema.sql ni reset.sql**: ejecuta `sql/migracion.sql`, que agrega lo que falte sin borrar lotes, pilas ni eventos. Se puede correr las veces que sea necesario.
3. **Authentication → Providers → Email**: desactivar "Confirm email" (no hay correos corporativos que confirmar).
4. **Authentication → Sign In / Providers → desactivar "Allow new users to sign up"**. Sin esto, cualquiera con la clave `anon` (que es pública) podría crearse una cuenta. Con esto, los usuarios solo los creas tú.
5. **Authentication → Users → Add user**: crear un usuario por persona (correo puede ser inventado y estable, p. ej. `juan@acopio.local`, con contraseña).
6. **Asignar los roles**: la forma rápida es ejecutar `sql/usuarios.sql`, que activa a todos y hace admin a quien tenga correo `@infinita.com`. También se puede a mano en **Table editor → perfiles**, marcando `activo = true` y ajustando el `rol`. Todo perfil nace inactivo y sin acceso a nada hasta que tú lo habilites.
   - `admin` → el tuyo. Único que puede editar el fondo del mapa y los proveedores.
   - `contratista` → registra lotes, los mueve, arma pilas, cambia estados.
   - `empresa` → solo lectura, para quien revisa desde la oficina.
   - `contratista` → registra y actualiza en campo
   - `empresa` → solo lectura (para quien revisa desde la oficina)
   - `admin` → todo, más administrar proveedores
7. **Table editor → proveedores**: reemplazar los de ejemplo por los reales (la abreviatura es la que se usa en el código del lote: `ABG`).

## 2. Configurar la app

En `web/js/config.js` pegar dos datos del panel de Supabase:

```js
export const SUPABASE_URL = 'https://xxxxx.supabase.co';        // Settings → General → Project URL
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_...';   // Settings → Claves API → Clave publicable
```

La **clave publicable** es la que va en el navegador (reemplaza a la antigua `anon`). Es pública por diseño: viaja dentro del JavaScript y cualquiera puede leerla. Quien protege los datos es la política RLS del esquema más la sesión iniciada; sin usuario activo no se lee ni un registro.

**Nunca** copies aquí una **clave secreta** (`sb_secret_...`): esa ignora RLS por completo y solo se usa desde un servidor.

## 3. Publicar

Paso a paso en **[DEPLOY.md](DEPLOY.md)**: se publica solo la carpeta `web/`, sin compilación, en Netlify (con GitHub para que cada cambio suba solo, o arrastrando la carpeta para una prueba rápida). El HTTPS que da Netlify es requisito para que la app se pueda instalar y funcione sin señal.

Para probar antes en el computador: `cd web && python3 -m http.server 8000` y abrir `http://localhost:8000`.

## 4. Instalar en los celulares

Abrir el enlace en Chrome → menú **⋮ → Agregar a pantalla de inicio**. Queda con ícono propio y abre en pantalla completa. En iPhone hay que hacerlo desde Safari → Compartir → Añadir a inicio.

La primera entrada necesita señal (para validar la contraseña). De ahí en adelante la app abre y guarda sin internet.

## Cómo funciona el mapa

La pantalla principal es el plano del patio.

- **Cada lote es una figura** con su código encima y el color de su estado. Su posición en el plano es su ubicación real en el acopio, pero **solo se puede mover en modo edición**: fuera de él, el dedo sobre el plano lo desplaza y un toque abre la ficha.
- **El plano va de borde a borde y los controles flotan encima.** A la izquierda las herramientas (buscar, filtrar, editar formas; "Otro día" y fondo solo para el admin) y abajo a la derecha "Nuevo lote". Se acerca y aleja con los dedos o la rueda del ratón. En la cabecera, junto al trofeo, el botón de información (ⓘ) abre **la leyenda de colores**: qué significa cada color de lote y de pila, y las formas y marcas del plano. En pantalla angosta las herramientas se quedan solo con su ícono para no robarle espacio al patio; de resto es idéntico y cambia solo con el ancho, sin recargar. La lista de lotes sí conserva sus márgenes, porque un renglón de texto muy largo se lee mal.
- **"Mover y editar"** activa el modo edición, y es el único sitio donde el plano se deja tocar: ahí se arrastran las figuras y un toque muestra sus manijas para estirarlas, girarlas o mover sus vértices. Las pilas se ajustan igual que los lotes, porque crecen a medida que se apila material.
- **Soltar un lote encima de otro crea una pila** con los dos y le asigna el siguiente consecutivo libre. Soltarlo sobre una pila existente lo mete en ella. Las dos cosas preguntan antes, y si se cancela el lote vuelve exactamente a donde estaba.
- **Las pilas se ven como un óvalo con su nombre.** Al tocarla se ve qué lotes contiene, y ahí mismo se le cambia el nombre y el destino (alimentación a planta, devolución, espera).
- **Para sacar un lote de una pila**, se abre su ficha y se usa "Sacar de la pila": vuelve al mapa, junto a ella.
- **Un toque abre la ficha**: estado, recogida, observaciones e historial completo, con el nombre de quién hizo cada cambio. Cambiar el estado pregunta antes, porque escribe un evento que nadie puede borrar después. Toda hoja se cierra con la equis de su esquina, que se queda a la vista por larga que sea: con un historial de veinte movimientos, el botón del final quedaba a un rato de desplazamiento.
- **La forma se elige en la ficha**: círculo o rectángulo, este último para los bigbags.
- **Filtrar el mapa** por proveedor, estado o placa de volqueta: lo que coincide se resalta y el resto queda atenuado, sin desaparecer. El filtro activo queda como una pastilla azul sobre el plano y se quita tocándola.
- **Buscar un lote en el plano.** El buscador de la lista dice si un lote existe; este dice dónde está. Se escribe el código o la placa sobre el propio plano: lo demás se atenúa, al lado del campo va cuántos quedaron y, en cuanto son pocos, el plano se desliza solo hasta encuadrarlos. Se acumula con el filtro, así que se puede buscar dentro de un filtro ya puesto.
- **"Ver en el mapa" desde la ficha** hace el mismo viaje desde el otro lado: quita el filtro que hubiera, lleva el plano hasta el lote y lo rodea unos segundos con un aro de cinta de peligro. Si el lote está dentro de una pila, se resalta la pila, que es la figura que se dibuja. Un lote despachado o en plataforma ya no está en el plano, y la app lo dice en vez de no hacer nada.
- **El recorrido se guarda solo**: cada vez que un lote se traslada de verdad queda registrado. Si solo se acomoda unos metros sobre el mismo sitio (la figura sigue traslapando su posición anterior) no cuenta como traslado. "Ver recorrido" dibuja el rastro numerado sobre el plano.
- **Granel o Bigbag**: el tipo de material define la figura (**círculo** el granel, rectángulo el bigbag) y se puede filtrar por él. "Dibujar a mano" convierte cualquier lote en un polígono editable vértice por vértice, con las esquinas suavizadas.
- **La volqueta descarga el lote nuevo.** Al registrar un lote entra una volqueta por un lado del plano, levanta el volco, cae el material y ahí queda el lote; luego sigue de largo. Dura 1,7 segundos y se salta tocando la pantalla. Va **solo al registrar**, que pasa una vez por lote, y nunca al cambiar de estado, que pasa veinte veces al día: una animación que se ve dos veces es un premio, a la quinta es un obstáculo. No retrasa nada —el lote ya está guardado y subiendo antes de que la volqueta entre, la escena solo ocupa la espera que ya había—, vive en una capa aparte porque el plano se redibuja entero en cada sincronización, y no se reproduce si el celular pide menos movimiento.
- **El granel nace redondo.** Un montón de material volcado no tiene una dirección larga, así que el óvalo estaba inventando una. El círculo por defecto tiene la misma superficie que el óvalo anterior, para que el patio no cambie de densidad. Si en la realidad quedó alargado, se estira a mano con las manijas. Al pasar un lote de bigbag a granel, o al salir de "dibujar a mano", el círculo conserva la superficie que la figura tenía: quien agrandó un lote no lo ve encoger por cambiar el material. Los lotes que ya existían se emparejan corriendo `sql/redondear.sql` una vez — conserva la superficie de cada uno, no toca bigbags ni polígonos, y se puede correr las veces que sea.
- **Plataforma 5**: un botón lleva allá un lote suelto o una pila completa. El material sale del mapa y la pila se cierra.
- **Las pilas se disuelven solas**: si queda un solo lote, deja de ser pila y el lote vuelve al patio. La pila se archiva, no se borra, así que su historial de entradas y salidas se conserva.
- **Formas editables**: óvalo, rectángulo o polígono. El polígono deja mover cada vértice, agregar puntos tocando los "+" de los lados y quitarlos tocando el vértice.
- **Los colores los define el admin** desde el panel Fondo: cada estado y cada tipo de pila. La app calcula sola si el texto encima debe ir claro u oscuro.
- **Un lote despachado sale del mapa** y queda en la lista, filtrable por su estado.
- Dos dedos para acercar y alejar; un dedo para desplazarse, empiece donde empiece —también encima de un lote, mientras no se esté en modo edición—. El zoom se ancla donde están los dedos, así que el plano no se escapa de donde uno está mirando.

### GPS: dónde estoy yo y dónde están los demás

El botón **Ubicación** (la flecha, en las herramientas del mapa) prende el GPS del celular.

- **Uno mismo es el punto azul**, con un halo que es el margen de error que da el teléfono (±5 m es lo normal a cielo abierto). Al prenderlo, el plano va hasta el punto; la pastilla que aparece debajo de las herramientas dice la precisión y cuántos compañeros hay en ese plano, y tocarla vuelve a llevar el plano hasta uno.
- **Los compañeros son puntos negros con su nombre.** Se ve a todo el que tenga la ubicación prendida en ese momento. Si su última posición tiene más de minuto y medio, el punto sale desvaído; a los diez minutos deja de verse solo.
- **Compartir es parte de prenderlo, y solo dentro del patio.** La posición sube mientras cae en el plano de alguna plataforma calibrada (con 30 m de margen para la vía de entrada). Fuera de ahí no sale nada del teléfono y se retira la que hubiera. Al apagar el botón o cerrar sesión se borra al instante. No se guarda ningún rastro: hay una sola fila por persona, que se pisa en cada lectura. La primera vez que se prende, la app lo explica antes de pedir el permiso.
- **Si estás en otra plataforma**, la pastilla dice "Estás en Ye · ir" y con un toque cambia de plano.
- **Solo funciona con la app abierta.** Con el teléfono en el bolsillo el GPS se apaga para no gastar batería, y vuelve al sacarlo. Necesita HTTPS (Netlify ya lo da) y el permiso de ubicación del navegador.
- **La ubicación no pasa por la cola.** Es lo único de la app que no se guarda para subir después: una posición que llega diez minutos tarde pintaría a alguien donde ya no está. Sin señal, simplemente no se comparte.

**Calibrar (admin, una vez por plataforma).** El plano no es un mapa: son unidades inventadas sobre un dibujo, así que hay que decirle a la app dónde cae ese dibujo en el mundo. En **Fondo del mapa → GPS → Calibrar el GPS**:

1. Párate en un sitio que reconozcas en el plano —una esquina, la caseta, la báscula— y tócalo en el plano. Quédate quieto unos segundos: la app promedia varias lecturas del GPS. **Usar este punto.**
2. Camina al otro extremo del patio (al menos 20 m; cuanto más lejos, mejor) y repite.

En vez de caminar se puede pegar en cada punto la coordenada de Google Maps ("6.24420, -75.58120"), por ejemplo mirando la foto satelital desde la oficina. Con dos puntos la app saca la escala, el giro y el desplazamiento del plano. Para que cuadre en todo el patio, el dibujo tiene que respetar las proporciones del patio real (ver "Tamaño del patio"). Después de calibrar, camina un poco y comprueba que el punto azul cae donde estás.

Requiere correr `sql/migracion.sql` una vez: agrega la columna de calibración a `plataformas`, la tabla `ubicaciones` y sus permisos (cada uno escribe y borra solo la suya; la hora la pone el servidor).

### El fondo, solo para el admin

Con el rol `admin`, el menú de opciones del mapa incluye **Fondo del mapa**: tamaño del patio, color, una foto aérea o plano subido desde el celular (con transparencia regulable) y figuras geométricas para dibujar la caseta, la vía o los límites. Los contratistas lo ven pero no lo pueden mover.

## Cómo está construido

- **Mover no es lo mismo que cambiar.** La posición y la forma se guardan directo en la fila del lote, porque se mueven muchas veces al día y no aportan al historial. Un trigger impide que un movimiento altere el estado, la pila o la fecha de recogida: eso solo cambia con un evento.
- **Los eventos son la única verdad.** Nadie edita ni borra: cambiar un estado, mover un lote a una pila o dejar una observación son eventos que se agregan al historial. El estado actual del lote lo calcula un trigger a partir del log. Por eso la trazabilidad es completa y una corrección nunca borra lo anterior.
- **Idempotencia.** Cada evento nace con un identificador generado en el celular, así que reintentar la subida veinte veces no duplica nada.
- **Cola local.** Los cambios se encolan en IndexedDB y suben en orden. Si el servidor rechaza uno, se aparta para que no bloquee la fila, **pero sigue mostrándose en pantalla marcado como rechazado**: nada desaparece por un error del servidor. Desde la franja roja se puede reintentar una vez corregida la causa.
- **Solo se baja lo que cambió.** Cada tabla recuerda hasta dónde llegó y pide únicamente lo posterior; la marca la pone el servidor, no el celular, porque un teléfono con la hora corrida no puede decidir qué se sincroniza. Antes se bajaba todo cada veinte segundos y se borraba y reescribía la base local entera. Una vez cada diez minutos sí se hace una pasada completa: es la única que nota lo que se borró en el servidor.
- **Hay pruebas, y hay que hacerlas fallar primero.** `node pruebas/correr.mjs`, sin instalar nada. Cubren la cola de sincronización, el choque de nombres de pila, las fechas, el escapado del mapa y la bajada incremental. Una prueba que nunca vio el error que dice cubrir no prueba nada: en `pruebas/LEEME.md` está cómo comprobarlo.
- **El historial no se queda corto en silencio.** La descarga inicial trae los eventos recientes, no todos. Todo lote tiene exactamente un evento de recepción y los eventos no se borran nunca, así que tener el de recepción demuestra tener la historia entera: si falta, la ficha va a buscar la de ese lote y la guarda. Sin señal, lo dice en pantalla en vez de mostrar un historial incompleto como si fuera completo.
- **La cola respeta las dependencias.** Un evento no se manda antes que su lote. Si el lote todavía no confirmó, el evento espera; si el servidor lo rechazó, el evento se marca como bloqueado en vez de gastar sus intentos contra un padre que no existe. Sin esto, un lote rechazado dejaba una fila de errores `eventos_lote_id_fkey` que no señalaban al culpable. Al reintentar se conserva el orden original, así que el lote sube primero.
- **Ningún botón que escribe se queda mudo.** Mientras trabaja se bloquea y lo dice; si falla, muestra el motivo. Un botón que no daba señal de vida invitaba a tocarlo diez veces, y cada toque era un lote más.
- **El nombre de una pila no es su identidad.** La identidad es el `id`, generado en el celular. El consecutivo lo elige cada teléfono por su cuenta, así que dos personas sin señal escogen el mismo número: al subir, la segunda se renombra al siguiente libre y se avisa. Los lotes que ya tenía dentro no se mueven, porque apuntan al `id`, no al número.
- **Las fechas del patio son locales; los instantes, UTC.** `fecha_recepcion` es el día del reloj de quien registra: calcularla desde UTC fechaba al día siguiente todo lo recibido después de las 7 de la noche. `creado_en` y `ocurrido_en` sí van en UTC, que es lo correcto para un instante.
- **Fuera de modo edición, el plano no se mueve.** Tocar un lote abre su ficha; arrastrar el dedo desplaza el plano, aunque el dedo empiece encima de una figura. Mover, estirar o girar exige entrar en "Mover y editar". Antes cualquier roce mientras se consultaba el mapa dejaba el lote en otro sitio, y el único aviso era que la figura había cambiado de lugar.
- **Lo que cambia el significado se pregunta antes.** Arrastrar un lote o una pila —por corto que sea el arrastre—, meterlo en una pila, armar una pila, cambiar de estado, sacarlo, llevar una pila a plataforma o quitarla del mapa: todo eso confirma. Cancelar devuelve la figura exactamente a donde estaba. Ajustar tamaño, giro o vértices no pregunta: para eso hay que agarrar una manija concreta, y no se hace sin querer.
- **El rótulo se ajusta a su figura, no al revés.** Su tamaño lo calcula el mapa a partir de lo grande que es la figura y lo largo que es el texto: un código de ocho caracteres no cabe en el mismo óvalo que uno de tres, y una caseta enorme no se rotula con la misma letra que un lote. Para una elipse se mide la cuerda a la altura del renglón, no el rectángulo inscrito, que es mucho más estrecho. Hay un suelo de 11 px: un código absurdamente largo prefiere sobresalir dos píxeles a volverse ilegible. Y en un polígono el rótulo se ancla en el centro de sus vértices, no en el origen, que al arrastrarlos deja de estar dentro de la figura.
- **Los textos de la app no conversan.** Un aviso dice qué pasa o qué hacer, nunca responde a quien lo provocó. Nada de "ahora sí se puede…".
- **Ningún fallo se queda callado.** Los botones los cubre su propio envoltorio; los gestos del mapa —arrastrar, soltar sobre una pila, ajustar una forma— no pasan por ningún botón, así que van envueltos aparte; y detrás de los dos hay una red que atrapa cualquier cosa que se escape. Antes eso terminaba en la consola del navegador, que nadie mira desde un celular en el patio.
- **Nada de lo que viene de la base se dibuja en crudo.** El mapa se arma con `innerHTML`, así que un código de lote con `<` no rompía solo esa figura: dejaba el plano entero sin dibujar, para todos.
- **Cerrar sesión borra lo del celular, así que primero intenta subirlo.** Si algo queda sin subir, hay que decidirlo a propósito en una pantalla que lo explica, no aceptando un aviso del navegador sin leerlo.
- **Una versión nueva no entra sola.** La app vive en la caché del celular para abrir sin señal, así que un cambio publicado queda listo pero no se aplica hasta recargar. La app lo detecta y lo ofrece en la franja de arriba, en vez de recargarse sola mientras alguien registra un lote.

## Cuando algo no sube

1. Mirar la franja de arriba en la app. *"Sin acceso"* significa que el perfil no está habilitado en la base: mientras lo esté, el servidor no devuelve ni acepta nada, y lo hace sin dar error.
2. Ejecutar `sql/diagnostico.sql` en el SQL Editor de Supabase. Los bloques 3 y 4 son los que importan: quién está activo y qué políticas faltan.
3. Si falta alguna política, ejecutar `sql/migracion.sql`: las agrega sin tocar los datos.
4. Con la causa corregida, en la app tocar la franja roja → **Reintentar**. Lo represado sube solo y en orden.
5. Para lotes repetidos, `sql/duplicados.sql`.
- **El color dejó de ser el dato.** En Excel el color *era* la información; aquí es la consecuencia visible del estado.
- **Las devoluciones se marcan solas.** Al declarar una devolución la app exige la fecha de recogida. Mientras el proveedor no se lleve el material, el lote se pinta con franja de advertencia apenas pasa ese día y aparece el filtro "Sin recoger" con los días de retraso. Cuando el material sale, se cambia el estado a *Despachado* y el compromiso se cierra solo.
- **El compromiso de recogida lo maneja el admin.** Cualquiera en campo puede declarar una devolución, y al hacerlo la app le pide la fecha, porque sin fecha no hay compromiso. Pero **cambiar** esa fecha después es solo del admin: el contratista la ve, no la edita. Así una fecha pactada con el proveedor no se corre desde el patio.

## Pendiente para las siguientes fases

- Fotos del lote al recibirlo (comprimidas, en la misma cola de sincronización).
- Notificación automática de devoluciones vencidas.
- Enlace con los tiquetes de báscula (el campo `tiquete_ref` ya está listo).
