# Auditoría de Acopio · Rendimiento, PWA y UX · Código y pruebas

| | |
|---|---|
| Fecha | 16 de octubre de 2026 |
| Código auditado | `main` en `9979474` (Merge PR #84) |
| Áreas | **Rendimiento, PWA y UX** y **Código y pruebas**. Seguridad y Datos/sincronización quedan fuera, salvo donde se cruzan con estas dos. |
| Modalidad | Solo lectura: no se cambió nada del código. Este informe propone; el equipo decide qué se corrige. |
| Hecha con | Claude Code |

Cada hallazgo dice dónde está (`archivo:línea`), qué pasa en el patio, cómo se comprobó y qué se propone.
Lo marcado **Verificado** se reprodujo en un navegador o con la librería real. Lo marcado **Por lectura de código** no se pudo reproducir aquí y se dice por qué.

---

## Resumen

**Lo más importante:** la promesa central de la app —*abre y guarda sin señal*— hoy se rompe en tres situaciones normales del patio. Las tres se reprodujeron en Chromium:

1. **Si la app arranca sin señal y el token de acceso venció** (dura una hora por defecto en Supabase), a los 25 s aparece la pantalla de ingreso y no deja entrar. Con una señal que no contesta, la pantalla se queda en blanco.
2. **Recién instalada, o después de publicar cualquier versión nueva**, la app no abre sin señal. La librería de Supabase se baja de `esm.sh` al usarla, no está en la precarga y se borra con cada versión. Hubo 68 versiones en dos meses y medio.
3. **Un solo error de `esm.sh`** queda guardado por el service worker y deja la app en blanco, aunque haya señal, hasta la siguiente versión.

Además:

- **El contratista no puede cerrar sesión ni silenciar los sonidos** desde el menú ⋮. Pasa desde el 25 de agosto y se arregla con una línea.
- **La pestaña Lotes congela el celular**: 4,8 s al abrirla, hasta 1,6 s por tecla al buscar, y 2,6 s cada minuto mientras está abierta. Además, cierra el teclado si llega la sincronización mientras se escribe. Cifras con 1.500 lotes y la CPU frenada a la de un celular de gama media.
- **Las pruebas no ven `app.js`**, que es el 60 % del JavaScript. Además, un 30 % de las comprobaciones lee el texto del código: formatearlo con Prettier, sin cambiar nada de lo que hace, hace fallar 4 de las 9 tandas. Por eso los fallos de arriba pasan con la suite en verde.

**Lo que está bien** (detalle al final): el plano está muy cuidado para celulares lentos, la sincronización ahorra batería, el contraste está resuelto, el arranque normal es rápido (0,27 s), la suite de pruebas es rápida y corre con PostgreSQL de verdad, y el código está limpio para ESLint.

### Tabla de hallazgos

Esfuerzo: **XS** < 1 h · **S** unas horas · **M** 1–2 días.

| # | Severidad | Área | Hallazgo | Esfuerzo | Cómo se sabe |
|---|---|---|---|---|---|
| 1 | Crítico | PWA · UX | Sin señal y con el token vencido, la app pide iniciar sesión y no deja entrar | S | Verificado |
| 2 | Crítico | PWA | Un error momentáneo de `esm.sh` deja la app en blanco hasta la siguiente versión | XS | Verificado |
| 3 | Crítico | PWA · Código | supabase-js viene de `esm.sh` sin versión fija, sin precarga, y se borra con cada versión | S | Verificado |
| 4 | Alto | UX · Código | En el menú ⋮ del contratista, «Cerrar sesión» y «Silenciar los sonidos» no hacen nada | XS | Verificado |
| 5 | Alto | Rendimiento · UX | Llamadas a Supabase sin tiempo límite y con reintentos de 7 s: pantallas que esperan a la red sin decirlo | S–M | Verificado |
| 6 | Alto | Rendimiento · UX | La pestaña Lotes se rehace entera en cada tecla y en cada sincronización | S–M | Verificado |
| 7 | Alto | Pruebas | Las pruebas no ven `app.js` y un 30 % comprueba el texto del código | M | Verificado |
| 8 | Medio | PWA · datos | Cada versión nueva vuelve a bajar la app entera: 252 kB por celular (podrían ser 2 kB) | XS | Verificado |
| 9 | Medio | Rendimiento | Estirar, girar o mover vértices rehace el plano entero en cada movimiento del dedo | S | Verificado |
| 10 | Medio | Rendimiento | El admin recorre todos los eventos dos veces en cada recarga | S | Verificado |
| 11 | Medio | PWA · datos | La foto aérea del plano no está disponible sin señal y las imágenes se suben sin reducir | S | Por lectura de código |
| 12 | Medio | UX | Accesibilidad: estado de sincronización solo por color, pestañas y hojas mal anunciadas | S | Verificado (axe) |
| 13 | Medio | UX | Letra de 10–11,5 px justo en lo que más se mira | XS–S | Por lectura de código |
| 14 | Medio | Código | `app.js` sigue creciendo como un solo módulo (+22 % desde agosto) | M | Medido |
| 15 | Medio | Pruebas | Huecos de cobertura en `store.js` (63 % de las funciones) | S | Medido (c8) |
| 16 | Bajo | UX | El historial muestra «traslado» y «entrega_laboratorio» sin traducir | XS | Por lectura de código |
| 17 | Bajo | UX | «Descartar» los cambios rechazados usa `confirm()`, contra la regla propia | XS | Por lectura de código |
| 18 | Bajo | UX | Desde ayer el plano solo se acerca con dos dedos y no hay «ver todo» | XS | Por lectura de código |
| 19 | Bajo | Rendimiento | Buscar en el plano: ~160 ms por tecla | XS–S | Verificado |
| 20 | Bajo | UX | La escena de muestreo dura 6,4 s, no se salta y no se puede apagar desde la app | XS | Por lectura de código |
| 21 | Bajo | Código · PWA | Arranque frágil ante IndexedDB bloqueada o `localStorage` cerrado | XS–S | Por lectura de código |
| 22 | Bajo | Rendimiento | La cola sube de a una petición | S | Por lectura de código |
| 23 | Bajo | Rendimiento | `backdrop-filter` en el velo de las hojas | XS | Por lectura de código |
| 24 | Bajo | Código | Comentarios y documentación desactualizados | XS | Por lectura de código |
| 25 | Bajo | Código | Código muerto, selectores CSS duplicados y sin linter en CI | XS | Medido (ESLint) |

---

## Cómo se auditó

- **Lectura completa** de `web/` (los seis módulos JS, `sw.js`, `index.html`, `styles.css`, el manifiesto), de las nueve tandas de `pruebas/` con sus dobles, del workflow de CI y de la documentación.
- **Suite de pruebas** con un PostgreSQL 16 local, igual que en CI: 580 comprobaciones, 0 fallos, 4,3 s. Sin PostgreSQL, la tanda de monedas se salta sus cuentas.
- **Cobertura** con c8 (V8) sobre la suite completa.
- **Navegador:** Chromium 141 (Playwright 1.56) con la librería **real** supabase-js 2.118.0 (la que hoy entrega `esm.sh` para `@2`) y un Supabase falso (auth + PostgREST mínimo) por interceptación de red. Un servidor estático imitaba a Netlify (ETag, `max-age=0`). Pantalla de 393 × 851. Patio sintético de un año: 1.500 lotes (≈60 % en el patio), 5 plataformas, 30 pilas, 29.131 eventos.
- **CPU frenada ×4**, que es lo que usa Lighthouse para emular un celular de gama media (la máquina es un Xeon de 2,8 GHz). Se dan también cifras sin frenar donde ayudan.
- **axe-core 4.14** (WCAG 2.2 A/AA y buenas prácticas), **ESLint 10** solo con `recommended`, **Prettier 3.8**.

**Límites de la medición:**

- Chromium corre aquí sin GPU, así que no se midió el costo de filtros ni de composición.
- No hubo un teclado Android real.
- Playwright desactiva la caché HTTP cuando intercepta la red. Eso afecta al hallazgo 3 y se explica allí.

Los scripts del banco de pruebas no se suben en esta entrega. Pueden ser la semilla de las pruebas de navegador del hallazgo 7.

---

## Hallazgos

### 1. [Crítico] Sin señal y con el token vencido, la app pide iniciar sesión y no deja entrar

**Dónde:** `web/js/app.js:521-526` (`arrancar`).

**Qué pasa.** `arrancar()` decide entre la pantalla de ingreso y el patio con `sb.auth.getSession()`. Si el token de acceso venció, supabase-js intenta renovarlo por la red **antes** de contestar. Sin señal, reintenta durante ~25 s y al final devuelve `session: null`, **aunque la sesión sigue guardada en el celular**. La app lo lee como «no hay sesión» y enseña el ingreso. Al intentar entrar, dice *«Se necesita señal para entrar la primera vez»*.

**Verificado:**

- Con la librería real (supabase-js 2.118, en Node):
  - Token vigente y sin red: devuelve la sesión al instante.
  - **Token vencido y sin red:** devuelve `session: null` a los **25,4 s**, tras 8 reintentos. La sesión guardada queda intacta.
  - Red colgada: sin respuesta a los 60 s.
- En Chromium:
  - Token vencido y sin señal: **pantalla de ingreso a los 25,7 s**.
  - Señal que no contesta: **pantalla en blanco a los 60 s**.

**Cuándo pasa en el patio.** Cada vez que la app arranca de cero sin señal y ha pasado más de una hora desde la última renovación del token. «Arrancar de cero» incluye: se cerró, Android la sacó de memoria o se reinició el celular. Mientras falte la señal no se puede registrar nada, y se rompe «guardar nunca falla».

**Propuesta.** Que la interfaz no dependa de la red para arrancar:

- Si hay una sesión guardada, arrancar con ese usuario y con el perfil que ya está en IndexedDB (`Store.perfiles()`).
- Dejar la renovación para cuando vuelva la señal; supabase-js la reintenta solo.
- Mostrar el ingreso solo si no hay sesión guardada, o si el servidor la rechazó con un error que no es de red (cualquiera distinto de `AuthRetryableFetchError`).

Boceto:

```js
async function arrancar() {
  await Store.iniciar();
  const guardada = sesionGuardada();      // la que supabase-js dejó en localStorage
  if (!guardada) return pantallaIngreso();
  abrirSesion(guardada.user);             // con el perfil del celular, sin esperar a la red
  const { data, error } = await sb.auth.getSession();
  if (!data.session && error && error.name !== 'AuthRetryableFetchError') pantallaIngreso();
}
```

`sesionGuardada()` puede leer la clave `sb-<ref>-auth-token`, o usar un `storage` propio pasado a `createClient`, para no depender del nombre interno. Hay que cubrirlo con una prueba de navegador: token vencido y sin red debe abrir el patio.

---

### 2. [Crítico] Un error momentáneo de `esm.sh` deja la app en blanco hasta la siguiente versión

**Dónde:** `web/sw.js:72-83`.

**Qué pasa.** La rama de `esm.sh` guarda en la caché **cualquier** respuesta, sin mirar `res.ok`, y desde entonces la sirve antes que la red. Si `esm.sh` contesta un error (un 502 o 503, algo normal en cualquier CDN) justo cuando el service worker va a guardar la librería, ese error queda guardado. La app no vuelve a arrancar, ni siquiera con señal, hasta que se publique otra versión del service worker.

**Verificado:**

- `esm.sh` contesta 503 una vez: pantalla en blanco.
- `esm.sh` se recupera: tres recargas seguidas, y las tres siguen en blanco.
- La caché `acopio-v78` guarda la respuesta 503.

**Agravante:** en el celular, el único remedio es «borrar datos del sitio», y eso también borra la cola de cambios sin subir.

**Propuesta.** Comprobar `res.ok` antes de guardar, como ya hace la rama de la app (`sw.js:97` y `sw.js:108`). Es una línea. Con el hallazgo 3, esta rama desaparece.

---

### 3. [Crítico] supabase-js viene de `esm.sh` sin versión fija, sin precarga, y se borra con cada versión

**Dónde:**

- `web/js/store.js:6` importa `https://esm.sh/@supabase/supabase-js@2`.
- `web/sw.js:6-27`: la lista `SHELL` no la incluye.
- `web/sw.js:40-46`: al activar una versión se borran las cachés viejas, y la librería vive en ellas.

**Consecuencias verificadas** (Chromium, mirando solo la caché del service worker):

| Situación | Al abrir sin señal |
|---|---|
| Recién instalada y abierta **una** vez con señal | **Pantalla en blanco.** La página bajó la librería antes de que el service worker tomara el control, y él nunca la guardó. |
| Justo después de publicar una versión nueva (hubo 68 en dos meses y medio, hasta 8 en un día) | **Pantalla en blanco.** La caché nueva no la tiene y la vieja se borró. |
| Sin versión nueva y con dos aperturas previas con señal | Abre, pero tarda 7,6 s (ver hallazgo 5). |

**Matiz:** Playwright desactiva la caché HTTP al interceptar la red. En un celular real, la caché HTTP del navegador puede cubrir el hueco un rato, según las cabeceras que mande `esm.sh`, pero no hay garantía.

**Además, `@2` es un rango, no una versión:**

- Hoy `esm.sh` entrega la **2.118.0, publicada el 15 de octubre de 2026 (ayer)**.
- Cada celular puede tener una versión distinta, según cuándo la guardó.
- Los cambios de la librería llegan sin publicar nada. Los reintentos de 7 s del hallazgo 5 llegaron así: postgrest-js 2.102, abril de 2026.
- Las pruebas reemplazan esa línea (`pruebas/ayudas/cargar.mjs`), así que la librería real nunca se prueba.

**Propuesta.** Guardar en el repositorio una versión fija de supabase-js, empaquetada en un solo archivo ESM (~58 kB con gzip), por ejemplo en `web/vendor/supabase-js-2.x.y.mjs`:

- No hace falta paso de compilación: se descarga una vez (el `+esm` de jsDelivr, el `?bundle` de `esm.sh` o con esbuild).
- Se importa con ruta relativa y se añade a `SHELL`.
- Actualizarla pasa a ser una decisión, con su prueba.

---

### 4. [Alto] En el menú ⋮ del contratista, «Cerrar sesión» y «Silenciar los sonidos» no hacen nada

**Dónde:**

- `web/js/app.js:3156-3163`: el botón `#monedas` solo se pinta si `puedeExportar()`, es decir, para admin y empresa.
- `web/js/app.js:3176`: `$('#monedas').onclick = …` se ejecuta para todos, sin comprobar que el botón existe.

**Qué pasa.** Para el contratista, `$('#monedas')` es `null`. Esa línea lanza `TypeError: Cannot set properties of null (setting 'onclick')` y las siguientes no se ejecutan: los botones de sonido y de cerrar sesión quedan sin manejador. La red de seguridad no lo atrapa, porque `app.js:519` solo escucha `unhandledrejection` y este error es síncrono.

**Verificado:**

| Rol | «Silenciar los sonidos» | «Cerrar sesión» | Error |
|---|---|---|---|
| contratista | no cambia nada | el menú se queda abierto | `TypeError` no atrapado |
| empresa | funciona | funciona | — |
| admin | funciona | funciona | — |

**Desde cuándo:** commit `878d387`, del 25 de agosto de 2026 («Monedas: el saldo no se guarda…»). Lleva siete semanas.

**Impacto.** El contratista es quien más usa la app. No puede apagar el timbre de las tareas ni cerrar sesión. En un celular compartido entre turnos, lo que registre el siguiente queda a nombre del anterior, y las monedas también.

**Propuesta:**

- `const m = $('#monedas'); if (m) m.onclick = …`, como ya se hace con `#informe` en `app.js:3185`.
- Una prueba de navegador por rol que abra el menú.
- Que la red de seguridad escuche también `error`, no solo `unhandledrejection`.

---

### 5. [Alto] Llamadas a Supabase sin tiempo límite y con reintentos de 7 s: pantallas que esperan a la red sin decirlo

**Dónde:**

- `web/js/store.js:9-11`: el cliente de Supabase no tiene un `fetch` con tope de tiempo.
- `web/js/app.js:536`: `abrirSesion` espera la consulta del perfil antes de pintar nada.
- `web/js/app.js:3319`: `fichaLote` espera `Store.historial`, en `store.js:402-413`, antes de abrir la hoja.

**Qué pasa:**

- El service worker ya corta a los 5 s lo que es de la app (`sw.js:53-62`), pero deja pasar sin tocar todo lo que va a `supabase.co` (`sw.js:68`). Esas peticiones no tienen tope: si la conexión se queda colgada, esperan indefinidamente.
- Desde postgrest-js 2.102, cada lectura (GET) que falla por red se reintenta 3 veces, esperando 1, 2 y 4 s. Tarda unos 7 s en fallar.
- Además, la pantalla está vacía mientras arranca (`index.html:16`): no hay ni un «cargando».

**Verificado:**

- **Arranque sin señal con el token vigente:** 7,6 s de pantalla en blanco antes del patio, porque `abrirSesion` espera la consulta del perfil.
- **Abrir la ficha de un lote cuya recepción no está en el celular** (en un celular recién instalado, la mayoría de los lotes viejos):

  | Red | La ficha abre… |
  |---|---|
  | con señal | al instante |
  | el celular cree tener red, pero no pasan datos | a los **7,4 s** |
  | la petición se queda colgada | **todavía no ha abierto a los 30 s**, y nada en pantalla dice que está esperando |

- **Sincronización:** mientras una vuelta espera, la bandera `ocupado` (`store.js:757-761`) descarta las siguientes.

**Propuesta:**

1. Tope de tiempo para todo lo de Supabase:
   ```js
   createClient(URL, CLAVE, { global: { fetch: (u, o = {}) =>
     fetch(u, { ...o, signal: o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(8000)])
                                       : AbortSignal.timeout(8000) }) } });
   ```
   `AbortSignal.any` requiere Chrome 116 o Safari 17.4; para iPhones más viejos, usar un `AbortController` a mano. Al fijar la versión (hallazgo 3), decidir también si conviene apagar los reintentos (`.retry(false)`) o dejarlos con el tope.
2. Pintar primero con lo que hay en el celular y refrescar detrás:
   - En `abrirSesion`, llamar a `pantallaPrincipal()` y `recargar()` antes de pedir el perfil.
   - En `fichaLote`, abrir la hoja con el historial local y completar la parte vieja cuando llegue. El aviso «Falta señal para traer la parte más antigua» ya existe.
3. Un estado mínimo de «cargando» en `index.html`.

---

### 6. [Alto] La pestaña Lotes se rehace entera en cada tecla y en cada sincronización

**Dónde:**

- `web/js/app.js:3001-3044` (`pintarLista`).
- `web/js/app.js:578-610`: cada `recargar()` termina en `pintar()`.
- `web/styles.css:780-792`: cada tarjeta repite su animación de entrada.

**Qué pasa.** La lista no tiene tope ni paginación. Pinta todas las tarjetas con `innerHTML`, **incluido el propio campo de búsqueda**, en cada tecla y en cada vuelta de sincronización (una por minuto), aunque no haya cambiado nada.

**Verificado** (CPU ×4, patio de 1.500 lotes):

| Situación | Resultado |
|---|---|
| Abrir la pestaña (1.500 tarjetas, admin) | **4,8 s** (1,15 s sin frenar la CPU) |
| Buscar, por tecla | mediana **369 ms**, peor **1,6 s** |
| Vuelta de sincronización sin cambios, con la lista abierta (contratista, 1.197 tarjetas) | **2,6 s** de hilo principal bloqueado; la tarea más larga, 1,8 s |
| Llega la sincronización mientras se escribe en el buscador | el foco pasa a `<body>`: **en el celular se cierra el teclado** |

**Además, en cada tecla:**

- El cursor salta al final (`app.js:3038`).
- El `<input>` se destruye y se vuelve a crear. Con un teclado de Android que va componiendo la palabra, eso es justo lo que el propio código describe como problemático en `app.js:266-273` (no verificado con un teclado real).

**Propuesta:**

- No volver a crear el buscador: pintar solo el contenedor de tarjetas.
- No repintar si no cambió nada, con la misma comparación de texto que ya usa el plano (`mapa.js:285`).
- Pintar de a 100 tarjetas con «ver más», o virtualizar la lista.
- Esperar ~150 ms después de la última tecla antes de filtrar.
- No repetir la animación de entrada en los repintados.

---

### 7. [Alto] Las pruebas no ven `app.js`, y un 30 % comprueba el texto del código

**Hechos:**

- **`app.js` es el 60 % del JavaScript:** 4.169 de 6.909 líneas y 177 funciones. Las pruebas ejecutan unas 11 porciones (≈15 funciones auxiliares), recortadas del archivo por texto y evaluadas con `new Function`. El resto no tiene ninguna prueba de comportamiento: pantallas, menús, hojas y la sincronización vista desde la interfaz.
- **De las 520 llamadas `ok(…)`, ~156 (un 30 %) comprueban el TEXTO** de `app.js`, `styles.css`, `sw.js` o el SQL con expresiones regulares, por ejemplo `ok(/const antes = this\.innerHTML;/.test(acc))`.
- **Formatear el código con Prettier**, sin cambiar nada de lo que hace, **hace fallar 4 de las 9 tandas (27 comprobaciones)**.
- **Un comentario funciona como delimitador:** `pruebas/plataformas.mjs:206` recorta `app.js` hasta el comentario `// La recogida es un compromiso` (`app.js:254`). Editar o mover ese comentario rompe la prueba.
- **El Supabase de mentira** (`pruebas/ayudas/supabase.mjs:20-24`) siempre tiene una sesión válida, nunca falla por red, nunca tarda y nunca vence un token. Los hallazgos 1, 3 y 5 son invisibles para la suite por construcción.

**Consecuencia:** los fallos de este informe (menú del contratista, foco perdido, arranque sin señal) pasan con la suite en verde.

**Propuesta:**

- Añadir una tanda de navegador con Playwright. Corre en el mismo workflow de GitHub; basta Chromium sin GPU.
- Supabase falso por interceptación de red, como en el banco de esta auditoría.
- Primeras pruebas:
  - arranque sin señal, con token vigente y con token vencido;
  - menú ⋮ por rol;
  - buscar en la lista con una sincronización de por medio;
  - versión nueva y luego sin señal.
- Después, cambiar las comprobaciones de texto por comprobaciones de comportamiento a medida que se toque cada parte. Mientras existan, un formateador no se puede adoptar.

---

### 8. [Medio] Cada versión nueva vuelve a bajar la app entera: 252 kB por celular (podrían ser 2 kB)

**Dónde:** `web/sw.js:35` (`cache: 'reload'`).

**Qué pasa.** `'reload'` se salta la caché HTTP y baja cada archivo completo aunque no haya cambiado: la app, los estilos, los íconos y los dos MP3 (112 kB). La instalación, además, baja todo dos veces: una para la página y otra para la precarga.

**Verificado**, con un servidor que imita a Netlify (ETag):

| | `cache: 'reload'` (actual) | `cache: 'no-cache'` |
|---|---|---|
| Instalar | 23 descargas, 382 kB | 16 descargas, 252 kB |
| Versión nueva (solo cambia el número) | 16 descargas completas, **252 kB** | 1 completa + 15 «304», **2 kB** |

Con 68 versiones publicadas, son **hasta unos 17 MB por celular** solo en actualizaciones (si las recibió todas), más ~58 kB de supabase-js cada vez (hallazgo 3).

**Propuesta.** Cambiar a `cache: 'no-cache'`:

- Sigue preguntando siempre al servidor, que es lo que el comentario de `sw.js:32-34` quiere garantizar.
- Pero lo hace con ETag, así que lo que no cambió vuelve como «304», sin cuerpo.

Es una palabra.

---

### 9. [Medio] Estirar, girar o mover vértices rehace el plano entero en cada movimiento del dedo

**Dónde:**

- `web/js/mapa.js:919-935`: en modo `ajustando`, cada movimiento llama a `pintarYa()`.
- `web/js/mapa.js:225-228` y `mapa.js:238-288`: `pintarYa()` reescribe todo el SVG con `innerHTML`.

**Verificado** (CPU ×4, una plataforma con ~200 figuras y 1.018 nodos SVG):

- Mediana de **103 ms** por movimiento y peor de 271 ms: unos 10 cuadros por segundo.
- Sin frenar la CPU, 20 ms.
- El arrastre simple sí está bien resuelto: mueve solo los nodos de la figura (`mapa.js:913-918`).

Esto importa porque las pilas «crecen a medida que se apila material» (README) y se ajustan a menudo.

**Propuesta.** Durante el ajuste, actualizar solo los nodos de la figura y sus manijas, como hace el arrastre, y repintar todo una sola vez al soltar. Como mínimo, agrupar los repintados con `requestAnimationFrame`.

---

### 10. [Medio] El admin recorre todos los eventos dos veces en cada recarga

**Dónde:**

- `web/js/app.js:596` y `app.js:810`: `pintarLaboratorio()` se llama en `recargar()` y otra vez dentro de `pintar()`.
- `web/js/app.js:1242-1250` (`pintarLaboratorio`).
- `web/js/store.js:224-263`: `muestras()` lee la tienda `eventos` entera.

**Verificado:**

- Con la historia de un año en el celular (28.854 eventos, lo que queda después de usar «Otro día»), `muestras()` tarda **1,04 s** con la CPU ×4.
- Una vuelta de sincronización sin cambios bloquea **725 ms**; con la historia corta, 0 ms.
- `recargar()` corre después de cada sincronización (una por minuto) y de cada cambio.

**Propuesta:**

- Llamarla una sola vez por recarga.
- Recalcular solo si cambió el número de eventos o la marca `max_eventos`.
- O mantener la lista de pendientes al guardar o bajar eventos de muestreo y de entrega.

Tiene relación con el punto [6] de la auditoría anterior: los eventos crecen sin límite en el celular.

---

### 11. [Medio] La foto aérea del plano no está disponible sin señal y las imágenes se suben sin reducir

**Dónde:**

- `web/sw.js:68`: todo lo que va a `supabase.co` pasa sin la caché del service worker.
- `web/js/store.js:1196-1203` y `store.js:336-343`: las imágenes se suben tal cual.

**Por lectura de código:**

- La imagen de fondo de cada plataforma se pide a Supabase Storage, que la sirve con `max-age=3600`. Es el valor por defecto de `upload` (comprobado en storage-js 2.118).
- Pasada una hora sin señal, el navegador no puede revalidarla y el plano se queda sin su foto.
- La foto se sube tal como sale del celular o del dron, de varios megabytes, y cada teléfono la baja entera. Lo mismo pasa con las fotos de la tienda.

No se reprodujo en navegador, porque con la red interceptada no hay caché HTTP.

**Propuesta:**

- En el service worker, guardar con «stale-while-revalidate» las URLs `/storage/v1/object/public/`. Son públicas, y cada imagen nueva sube con otro nombre.
- Reducir la imagen en el celular antes de subirla (`canvas` a JPEG): unos 1.600 px para el fondo y unos 600 px para los productos.

---

### 12. [Medio] Accesibilidad: el estado de sincronización solo por color, y pestañas y hojas mal anunciadas

**Verificado con axe-core 4.14** en ingreso, plano, lista, ficha y plataformas.

**Sin problemas de contraste de color**, algo poco común. Lo que sí sale:

- **`button-name` (crítico, en todas las pantallas):** el chip de sincronización (`#chip`) se queda sin nombre. En pantallas de 400 px o menos, que son casi todos los celulares, el CSS esconde su texto con `display: none` (`styles.css:276`). Además, «Al día» y «Sin señal» (sin cambios pendientes) solo se distinguen por el color del punto (WCAG 1.4.1).
- **`aria-allowed-attr` (crítico, en todas las pantallas):** las pestañas usan `aria-selected` en botones sin `role="tab"` (`app.js:771-774`, `800` y `2130`). Un lector de pantalla no anuncia cuál está activa.
- **Las hojas** (`abrirHoja`, `app.js:3093-3113`):
  - no se marcan como diálogo (`role="dialog"`, `aria-modal`);
  - no reciben el foco al abrirse;
  - no se cierran con Escape.
- **Los `<li>`** de la clasificación y de las tareas responden al toque pero no al teclado (`app.js:1224` y `1663`).

**Propuesta:**

- En `pintarSync`, `chip.setAttribute('aria-label', texto)`, y esconder el texto con una clase «solo para lectores» en vez de `display: none`.
- `role="tablist"` en la barra y `role="tab"` en cada pestaña.
- En las hojas, `role="dialog"`, poner el foco al abrir y devolverlo al cerrar.
- Botones en lugar de `<li>` clicables.

---

### 13. [Medio] Letra de 10–11,5 px justo en lo que más se mira

**Dónde** (`web/styles.css`), y 24 reglas más por debajo de 12 px:

| Línea | Qué es | Tamaño |
|---|---|---|
| 443 | estado del lote en la lista y en la ficha | 10,5 px |
| 512 y 1300 | marca «sin subir» / «rechazado» | 11 y 10 px |
| 590 | títulos de sección de las hojas | 11 px |
| 680 y 1333 | etiquetas de los campos | 11,5 y 11 px |
| 232 | chip de sincronización | 11,5 px |

**Qué pasa.** La hoja de estilos se declara hecha para usarse «con guantes, a pleno sol y con prisa», y en contraste lo cumple. Pero justo el estado del lote, la marca de «sin subir» y las etiquetas de los formularios van en mayúsculas espaciadas de 10–11 px.

**Propuesta.** Mínimo de 12–13 px para estados, marcas y etiquetas. Probarlo afuera, al sol, con quien usa la app.

---

### 14. [Medio] `app.js` sigue creciendo como un solo módulo

**Hechos:**

- 202 kB y 4.169 líneas. En la auditoría del 21 de agosto eran 166 kB: **+22 %**.
- 177 funciones y un estado global `S` de unos 30 campos.
- 29 variantes de `cerrarHoja(); await recargar(); sincronizar();`.
- `pintarTareas()` y `pintarLaboratorio()` se ejecutan dos veces en cada recarga.
- Unas 500 líneas son el dibujo SVG de las escenas (volqueta y cuadrilla), y otras ~90 son sus sonidos.

**Propuesta.** Sin framework, con módulos ES nativos:

- Sacar primero lo que no comparte estado: `escenas.js` (volqueta, cuadrilla y sonidos), `tienda.js` y `monedas.js`, y `lista.js`.
- Una función `despuesDeGuardar()` para esas 29 variantes.
- Hacerlo **después** de tener las pruebas de navegador del hallazgo 7.

---

### 15. [Medio] Huecos de cobertura en `store.js`

**Medido con c8** (unión de las 5 tandas que cargan `store.js`):

| Módulo | Sentencias | Funciones |
|---|---|---|
| `store.js` | 82,5 % | **63 %** |
| `mapa.js` | 90 % | 87,5 % |
| `historia.js` | 99,6 % | 92 % |
| `excel.js` | 95 % | 94 % |

**Sin ninguna prueba en `store.js`:**

- `muestras()`, la lista del laboratorio.
- `observaciones()`, la paginación que evita un informe incompleto.
- `salir()`.
- Todas las de monedas y tienda.
- `actualizarLote`, `guardarFigura`, `guardarConfig`, `guardarPlataforma`, `historialPila` y `refrescarPerfiles`.

**Propuesta.** Empezar por `muestras()` y `observaciones()`: tienen lógica propia y los dobles para probarlas ya existen.

---

### 16. [Bajo] El historial muestra «traslado» y «entrega_laboratorio» sin traducir

**Dónde:**

- `web/js/app.js:3705-3719`: `textoEvento` no tiene casos para esos dos tipos.
- Esos eventos se escriben en `store.js:583`, `store.js:599` y `store.js:267-271`.

**Propuesta.** Textos como «Pasó a la plataforma X» y «Muestra entregada al laboratorio».

### 17. [Bajo] «Descartar» los cambios rechazados usa `confirm()`, contra la regla propia

**Dónde:** `web/js/app.js:3146`.

Es lo único de la app que borra trabajo sin remedio, y usa el `confirm()` del navegador. Justo lo que el propio código desaconseja en `app.js:3291`: *«Un `confirm()` del navegador se acepta sin leerlo»*.

**Propuesta.** Usar `confirmar({ peligro: true })`, como en el resto de la app.

### 18. [Bajo] Desde ayer el plano solo se acerca con dos dedos y no hay «ver todo»

**Dónde:** commit `55cf8a6` (15 de octubre), que quitó acercar, alejar y encuadrar.

**Qué pasa:**

- El pellizco exige dos dedos. Es un gesto multitáctil, y WCAG 2.5.1 pide una alternativa de un solo puntero.
- Con guantes o con una mano ocupada, es lo más difícil de hacer.
- Ya no hay un botón para volver a ver el patio entero: solo cambiando de pestaña.
- `ICO.menos`, `ICO.encuadrar` y `Mapa.acercar` quedaron sin uso.

Fue una decisión consciente; la propuesta es reconsiderarla.

**Propuesta.** Devolver al menos «ver todo». Y también acercar y alejar, o un doble toque para acercar.

### 19. [Bajo] Buscar en el plano: ~160 ms por tecla

**Verificado:** 159 ms de mediana por tecla con la CPU ×4.

**Por qué:**

- `lotesQueCoinciden()` se calcula tres veces por tecla.
- `calcularDestacados()` recorre pilas × lotes (`app.js:2208-2216`).
- Todo se dispara en cada tecla desde `app.js:2311-2316`.

**Propuesta.** Calcularlo una vez por tecla y esperar ~100 ms después de la última.

### 20. [Bajo] La escena de muestreo dura 6,4 s, no se salta y no se puede apagar desde la app

**Dónde:** `web/js/app.js:2826-2875`.

**Qué pasa:**

- Dura 6,4 s, no se salta con un toque y suena 32 veces.
- Solo se apaga con la opción «reducir movimiento» del sistema.
- Con veinte muestreos al día, choca con el criterio del propio README: «a la quinta es un obstáculo».

**Propuesta.** Un interruptor «Sin animaciones» junto a «Silenciar los sonidos», o acortar la escena.

### 21. [Bajo] Arranque frágil ante IndexedDB bloqueada o `localStorage` cerrado

**Por lectura de código:**

- **IndexedDB:** `abrir()` no maneja `onblocked` ni `onversionchange` (`store.js:20-41`). El día que la base pase a la versión 8 con otra pestaña abierta, el arranque se queda esperando para siempre.
- **Errores de arranque:** `arrancar()` no tiene `catch`. Un fallo al arrancar sale como «No se pudo guardar… El cambio quedó en el celular» (`app.js:519` y `app.js:661`), que no describe lo que pasó.
- **`localStorage`:** se lee sin `try` al cargar el módulo (`app.js:78-84`), contra el comentario de `app.js:231-237`.

### 22. [Bajo] La cola sube de a una petición

**Dónde:** `web/js/store.js:791-822` (`subir()`).

**Qué pasa:** cada operación de la cola es una petición aparte, y espera a la anterior. Tras un día sin señal, son cientos de idas y vueltas, cada una con el radio encendido.

**Propuesta.** Mandar juntos los `insertar` seguidos de una misma tabla: el upsert de PostgREST acepta listas. No se midió.

### 23. [Bajo] `backdrop-filter` en el velo de las hojas

**Dónde:** `web/styles.css:550`.

**Qué pasa:** es el mismo costo por el que se quitó de los controles del plano (`styles.css:1340-1346`), y aquí se paga cada vez que se toca un lote. No se pudo medir: aquí Chromium corre sin GPU.

### 24. [Bajo] Comentarios y documentación desactualizados

**Comentarios:**

- «Cada 20 segundos» en `app.js:2370`, `mapa.js:274` y `styles.css:782`. Son 60 s (`app.js:548`).
- La pista «Mantén presionada una figura» (`app.js:4052`) describe un gesto que ya no existe.
- `app.js:255` tiene dos caracteres dañados («pas��»).

**Documentación:**

- El README cita `sql/duplicados.sql`, que no existe, y repite la lista de roles.
- `DEPLOY.md` lista los archivos de hace meses: faltan `mapa.js`, `historia.js`, `excel.js` y `sonidos/`.
- `pruebas/LEEME.md` habla de 4 tandas; son 9.

### 25. [Bajo] Código muerto, selectores CSS duplicados y sin linter en CI

**Código sin uso:** `ICO.menos`, `ICO.encuadrar`, `ICO.capas`, `Mapa.acercar`, `Mapa.haySeleccion`, `Mapa.enEdicion` y `Store.pila`.

**ESLint** (solo `recommended`) da 8 avisos en todo el proyecto, entre ellos:

- `nacido` sin uso (`historia.js:36`);
- una asignación que no se usa (`store.js:803`);
- variables sin uso en las pruebas.

**CSS:** `styles.css` define dos veces 61 selectores; el bloque de abajo pisa al de arriba.

**Propuesta.** Adoptar ESLint en CI es barato: el código ya está limpio.

---

## Seguimiento de la auditoría anterior (`AUDITORIA-IA.txt`, 21 de agosto)

| # | Tema | Estado hoy |
|---|---|---|
| [1] | El service worker deja peticiones colgadas | **Resuelto para los archivos de la app** (`fetchConTope`, 5 s, `sw.js:53-62`). El mismo problema sigue en las llamadas a Supabase, que no pasan por el service worker: hallazgo 5. |
| [2] | Sin CI | **Resuelto.** `.github/workflows/comprobaciones.yml` corre la suite con PostgreSQL 16. Faltan el lint y las pruebas de navegador (hallazgos 7 y 25). |
| [3] | `app.js` monolítico | **Sigue, y creció un 22 %** (hallazgo 14). |
| [4] | `salir()` no comprueba la cola | Fuera de las áreas elegidas (datos). El código sigue igual (`store.js:1205-1208`). Hoy el contratista ni siquiera llega a `salir()` (hallazgo 4). |
| [5] | `hoyLocal()` y la zona horaria | Fuera de las áreas elegidas. Sin cambios; es una decisión documentada (`store.js:68-75`). |
| [6] | Los eventos crecen sin límite en el celular | **Sigue**, y ya tiene un costo medible para el admin (hallazgo 10). |
| [7] | `config.js` en el repositorio | Fuera de las áreas elegidas (seguridad). |
| [8] | Versión del service worker a mano | **Sigue** (`acopio-v78`, 68 cambios hechos a mano). Ahora con costo medido (hallazgos 3 y 8). |
| [9] | Sin linter ni formateador | **Sigue.** ESLint sale barato (8 avisos). Un formateador hoy rompería 4 tandas de pruebas: primero hay que cambiar las pruebas (hallazgo 7). |
| [10] | IndexedDB y sus versiones | **Sigue.** Faltan además `onblocked` y `onversionchange` (hallazgo 21). |

---

## Lo que está bien y conviene conservar

- **«Guardar nunca falla» se sostiene mientras la app está abierta:**
  - todo se escribe primero en IndexedDB;
  - la cola respeta dependencias;
  - lo que el servidor rechaza no desaparece de la pantalla.
- **La sincronización cuida la batería y los datos:**
  - no consulta con la pantalla apagada (`app.js:548`);
  - baja solo lo que cambió;
  - una vuelta sin cambios con el plano a la vista cuesta **0 ms**, porque el plano compara su SVG antes de tocarlo (`mapa.js:285`).
- **El plano está pensado para celulares lentos:**
  - aplaza los repintados durante los gestos;
  - convierte coordenadas sin forzar el layout;
  - las manijas se miden en píxeles de pantalla;
  - quita los rótulos durante el pellizco.
- **Contraste:** axe no encontró ningún problema de contraste. Además, se respeta «reducir movimiento» en toda la app (`styles.css:131-138`).
- **El arranque normal es rápido:** 0,27 s hasta ver el plano, y 0,57 s con la CPU ×4.
- **La suite de pruebas:**
  - 580 comprobaciones en 4,3 s, sin dependencias;
  - PostgreSQL de verdad en CI;
  - la regla de «hazla fallar primero».
- **El generador de Excel es propio, sin librerías**, y tiene 95 % de cobertura.
- **ESLint `recommended` apenas encuentra 8 avisos** en unas 10.000 líneas.
- **Los comentarios explican el porqué de cada decisión.** Eso permitió auditar las decisiones en lugar de adivinar las intenciones.

---

## Orden sugerido

Cada publicación sube la versión del service worker y, mientras no se corrija el hallazgo 3, cada subida abre el hueco de «no abre sin señal». Conviene **agrupar** los cambios en pocas publicaciones.

1. **Primera publicación** (unas horas, poco riesgo). Correcciones de una línea o casi:
   - 4: menú del contratista;
   - 2: comprobar `res.ok`;
   - 8: `'no-cache'`;
   - 16: textos del historial;
   - 17: `confirmar` en «Descartar»;
   - la etiqueta accesible del chip (12).
2. **Segunda publicación** (1–2 días):
   - 3: supabase-js fijo y dentro de la app;
   - 1: arrancar sin depender de la red;
   - 5: tope de tiempo y pintar primero.
3. **Tercera** (2–3 días):
   - 6: la lista;
   - 10: el laboratorio una sola vez;
   - 9: manijas;
   - 11: imágenes;
   - 13 y 18: letra y zoom, mejor probados en el patio.
4. **En paralelo, continuo:**
   - 7: pruebas de navegador en CI, empezando por los fallos de este informe;
   - 25: ESLint en CI;
   - 14: partir `app.js`;
   - 15: cobertura de `store.js`.

---

## Anexo A · Mediciones

Chromium 141 · pantalla de 393 × 851 · patio de 1.500 lotes y 29.131 eventos · red simulada instantánea salvo donde se indica.

| Medición | Sin frenar | CPU ×4 |
|---|---|---|
| Arranque en caliente hasta el plano | 270 ms | 566 ms |
| Ingreso y primera sincronización hasta el plano | 284 ms | — |
| Abrir la pestaña Lotes (1.500 tarjetas) | 1.154 ms | 4.813 ms |
| Buscar en la lista, por tecla (mediana / peor) | 65 / 279 ms | 369 / 1.559 ms |
| Buscar en el plano, por tecla (mediana / peor) | 77 / 78 ms | 159 / 178 ms |
| Estirar un lote, por movimiento (mediana / peor) | 20 / 24 ms | 103 / 271 ms |
| Vuelta sin cambios, contratista con la lista abierta | — | 2.633 ms bloqueado |
| Vuelta sin cambios, admin en el plano (2.722 eventos) | — | 0 ms |
| Vuelta sin cambios, admin en el plano (28.854 eventos) | — | 725 ms bloqueado |
| `muestras()` con 28.854 eventos | — | 1.038 ms |
| Entrar a «Otro día» (una de cinco tandas de historia) | — | 2,3–3,8 s |
| Deslizador de «Otro día», por día (mediana / peor) | — | 158 / 201 ms |

| Arranque sin señal (red real) | Resultado |
|---|---|
| Token vigente | patio a los 7,6 s (los reintentos del perfil) |
| Token vencido | pantalla de ingreso a los 25,7 s; no deja entrar |
| Token vencido y la red no contesta | pantalla en blanco a los 60 s |
| Recién instalada (1 apertura con señal) | pantalla en blanco |
| Después de una versión nueva | pantalla en blanco |
| Después de un 503 de `esm.sh` | pantalla en blanco, también con señal, hasta la siguiente versión |

## Anexo B · Pruebas

- **Con PostgreSQL 16:** 9 de 9 tandas, 580 comprobaciones, 0 fallos, 4,3 s.
- **Sin PostgreSQL:** 537 comprobaciones; la tanda de monedas avisa que se salta sus cuentas.
- **Después de formatear con Prettier**, sin cambiar nada de lo que hace el código: **4 de 9 tandas fallan, 27 comprobaciones**. Fallan, entre otras, los colores de estado del CSS, la escena de muestreo, «está en el patio», el admin de «Otro día» y del laboratorio, y el chip estrecho.
- **Comprobaciones que leen el texto del código:** unas 156 de 520 llamadas `ok()`:

  | Tanda | Sobre el texto |
  |---|---|
  | `monedas.mjs` | 53 de 96 |
  | `plataformas.mjs` | 52 de 101 |
  | `mapa.mjs` | 38 de 139 |
  | `historia.mjs` | 8 de 65 |
  | `tareas.mjs` | 5 de 32 |
  | `cola.mjs`, `pilas-y-fechas.mjs`, `sincronizacion.mjs`, `informe.mjs` | 0 |

- **Cobertura:** ver la tabla del hallazgo 15. `app.js` no se carga como módulo en ninguna prueba.

## Anexo C · Accesibilidad y lint

- **axe-core 4.14**, en ingreso, plano, lista, ficha y plataformas:

  | Regla | Nodos | Impacto |
  |---|---|---|
  | `aria-allowed-attr` | 12 | crítico |
  | `button-name` | 4 | crítico |
  | `region` | 18 | moderado |
  | `landmark-one-main` | 1 | moderado |

  Ningún problema de contraste.
- **ESLint 10 (`recommended`)**, sobre `web/js`, `web/sw.js` y `pruebas/`: 8 avisos.

  | Regla | Avisos |
  |---|---|
  | `no-unused-vars` | 4 |
  | `no-control-regex` | 2 (intencionados: limpian caracteres de control) |
  | `no-regex-spaces` | 1 |
  | `no-useless-assignment` | 1 |
