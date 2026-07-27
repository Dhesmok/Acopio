# Mapa de acopio

App web instalable (PWA) para controlar lotes y pilas en el patio, pensada para señal intermitente: **guardar nunca falla**. Todo cambio se escribe en el celular y sube solo cuando vuelve la señal.

```
sql/schema.sql        base de datos (Supabase / Postgres)
sql/migracion.sql     actualiza una base en uso sin borrar datos
sql/reset.sql         borra todo, solo para empezar de cero a propósito
web/                  la app: se sube tal cual a un hosting estático
DEPLOY.md             cómo publicarla
```

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

- **Cada lote es una figura** con su código encima y el color de su estado. Se arrastra con el dedo para moverlo: esa posición es su ubicación real en el acopio.
- **El plano va de borde a borde y los controles flotan encima.** A la izquierda, "Nuevo lote" y debajo las herramientas (filtrar, editar formas, fondo); a la derecha, acercar, alejar y encuadrar. En pantalla angosta las herramientas se quedan solo con su ícono para no robarle espacio al patio; de resto es idéntico y cambia solo con el ancho, sin recargar. La lista de lotes sí conserva sus márgenes, porque un renglón de texto muy largo se lee mal.
- **"Editar formas"** activa el modo edición: ahí un solo toque sobre cualquier lote, pila o figura del fondo muestra sus manijas, para estirarlo, girarlo o mover sus vértices. Fuera de ese modo, mantener presionado hace lo mismo. Las pilas se ajustan igual que los lotes, porque crecen a medida que se apila material.
- **Soltar un lote encima de otro crea una pila** con los dos y le asigna el siguiente consecutivo libre. Soltarlo sobre una pila existente lo mete en ella.
- **Las pilas se ven como un óvalo con su nombre.** Al tocarla se ve qué lotes contiene, y ahí mismo se le cambia el nombre y el destino (alimentación a planta, devolución, espera).
- **Para sacar un lote de una pila**, se abre su ficha y se usa "Sacar de la pila": vuelve al mapa, junto a ella.
- **Un toque abre la ficha**: estado, recogida, observaciones e historial completo, con el nombre de quién hizo cada cambio.
- **La forma se elige en la ficha**: óvalo o rectángulo, este último para los bigbags. Mantener presionado sigue sirviendo para estirar y girar.
- **Filtrar el mapa** por proveedor, estado o placa de volqueta: lo que coincide se resalta y el resto queda atenuado, sin desaparecer. El filtro activo queda como una pastilla azul sobre el plano y se quita tocándola.
- **El recorrido se guarda solo**: cada vez que un lote se traslada de verdad queda registrado. Si solo se acomoda unos metros sobre el mismo sitio (la figura sigue traslapando su posición anterior) no cuenta como traslado. "Ver recorrido" dibuja el rastro numerado sobre el plano.
- **Granel o Bigbag**: el tipo de material define la figura (óvalo el granel, rectángulo el bigbag) y se puede filtrar por él. "Dibujar a mano" convierte cualquier lote en un polígono editable vértice por vértice, con las esquinas suavizadas.
- **Plataforma 5**: un botón lleva allá un lote suelto o una pila completa. El material sale del mapa y la pila se cierra.
- **Las pilas se disuelven solas**: si queda un solo lote, deja de ser pila y el lote vuelve al patio. La pila se archiva, no se borra, así que su historial de entradas y salidas se conserva.
- **Formas editables**: óvalo, rectángulo o polígono. El polígono deja mover cada vértice, agregar puntos tocando los "+" de los lados y quitarlos tocando el vértice.
- **Los colores los define el admin** desde el panel Fondo: cada estado y cada tipo de pila. La app calcula sola si el texto encima debe ir claro u oscuro.
- **Un lote despachado sale del mapa** y queda en la lista, filtrable por su estado.
- Dos dedos para acercar y alejar; un dedo sobre el fondo para desplazarse. El zoom se ancla donde están los dedos, así que el plano no se escapa de donde uno está mirando.

### El fondo, solo para el admin

Con el rol `admin`, el menú de opciones del mapa incluye **Fondo del mapa**: tamaño del patio, color, una foto aérea o plano subido desde el celular (con transparencia regulable) y figuras geométricas para dibujar la caseta, la vía o los límites. Los contratistas lo ven pero no lo pueden mover.

## Cómo está construido

- **Mover no es lo mismo que cambiar.** La posición y la forma se guardan directo en la fila del lote, porque se mueven muchas veces al día y no aportan al historial. Un trigger impide que un movimiento altere el estado, la pila o la fecha de recogida: eso solo cambia con un evento.
- **Los eventos son la única verdad.** Nadie edita ni borra: cambiar un estado, mover un lote a una pila o dejar una observación son eventos que se agregan al historial. El estado actual del lote lo calcula un trigger a partir del log. Por eso la trazabilidad es completa y una corrección nunca borra lo anterior.
- **Idempotencia.** Cada evento nace con un identificador generado en el celular, así que reintentar la subida veinte veces no duplica nada.
- **Cola local.** Los cambios se encolan en IndexedDB y suben en orden. Si el servidor rechaza uno, se aparta para que no bloquee la fila, **pero sigue mostrándose en pantalla marcado como rechazado**: nada desaparece por un error del servidor. Desde la franja roja se puede reintentar una vez corregida la causa.
- **El color dejó de ser el dato.** En Excel el color *era* la información; aquí es la consecuencia visible del estado.
- **Las devoluciones se marcan solas.** Al declarar una devolución la app exige la fecha de recogida. Mientras el proveedor no se lleve el material, el lote se pinta con franja de advertencia apenas pasa ese día y aparece el filtro "Sin recoger" con los días de retraso. Cuando el material sale, se cambia el estado a *Despachado* y el compromiso se cierra solo.
- **El compromiso de recogida lo maneja el admin.** Cualquiera en campo puede declarar una devolución, y al hacerlo la app le pide la fecha, porque sin fecha no hay compromiso. Pero **cambiar** esa fecha después es solo del admin: el contratista la ve, no la edita. Así una fecha pactada con el proveedor no se corre desde el patio.

## Pendiente para las siguientes fases

- Fotos del lote al recibirlo (comprimidas, en la misma cola de sincronización).
- Notificación automática de devoluciones vencidas.
- Enlace con los tiquetes de báscula (el campo `tiquete_ref` ya está listo).
