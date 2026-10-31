# Pruebas

Para correrlas hace falta Node (cualquier versión reciente). No hay que
instalar nada: ni dependencias, ni `npm install`, ni internet.

```bash
cd acopio
node pruebas/correr.mjs
```

Sale una lista de comprobaciones y, al final, `✓ las 4 tandas pasaron`.
Si alguna falla, el renglón dice `FALLA` y el proceso termina en error.

**Esta carpeta no se publica.** Solo se sube `web/` al hosting; `pruebas/`
y `sql/` se quedan en el repositorio.

## Qué prueba cada tanda

| Archivo | Qué protege |
|---|---|
| `cola.mjs` | La cola de sincronización: que un evento no se mande antes que su lote, que al reintentar suba el padre primero, que diez toques dejen un solo lote, y que un rechazo del servidor no se confunda con falta de señal. |
| `pilas-y-fechas.mjs` | Que dos celulares eligiendo el mismo número de pila no pierdan ninguna, y que un lote recibido de noche no quede fechado al día siguiente. |
| `mapa.mjs` | Que un código de lote con caracteres raros no deje el plano entero sin dibujar. |
| `sincronizacion.mjs` | Que solo se baje lo que cambió, que el historial viejo se recupere en vez de faltar en silencio, que la pasada completa note lo borrado, y que desactivar un perfil no vacíe la pantalla. |
| `gps.mjs` | Que la calibración ponga a cada uno en su sitio del plano —y no reflejado como en un espejo—, que con cuatro puntos o más se corrija un plano estirado, que un punto mal marcado salga señalado (y que no se acuse a uno bueno cuando no se puede saber), que una calibración mala se rechace, que calibrar desde la oficina sea solo del admin y en ventana aparte, que un nombre raro no rompa la capa del GPS, que moverse no rearme el plano, y que en la base cada uno escriba solo su propia ubicación. |
| `movimientos.mjs` | Que en la base solo se pueda corregir x/y del ÚLTIMO movimiento de un lote: ni uno anterior, ni otro tipo de evento, ni el autor o la hora, ni borrar. Corre contra PostgreSQL de verdad si lo hay. |

Cada tanda corre en su propio proceso: comparten globales (la base local,
el reloj) y mezclarlas daría resultados falsos.

## Cómo están hechas

No hay navegador ni base de datos de verdad. En `ayudas/` hay tres piezas:

- **`idb.mjs`** — un IndexedDB en memoria. Respeta lo que importa: `getAll`
  devuelve en orden de clave (de ahí salió un error real, porque
  `eventos:` va antes que `lotes:` alfabéticamente) y los índices existen.
- **`supabase.mjs`** — un servidor de mentira que aplica las mismas reglas
  que importan: código único en lotes y pilas, llave foránea de eventos,
  y los filtros que usa la bajada incremental. Lleva cuenta de lo que se
  mandó y de cuántas filas se bajaron, que es como se comprueba que ya no
  se baja todo cada vez.
- **`cargar.mjs`** — `store.js` importa supabase-js desde un CDN, que Node
  no puede resolver ni queremos que resuelva. Hace una copia del archivo
  **real** con esa única línea cambiada. Se prueba el código de verdad, no
  una copia paralela que se queda vieja.

## Al agregar una prueba

Empieza por hacerla fallar contra el código anterior. Una prueba que nunca
vio el error que dice cubrir no prueba nada:

```bash
git stash          # deja el código como estaba
node pruebas/correr.mjs   # tiene que FALLAR
git stash pop
node pruebas/correr.mjs   # y ahora pasar
```
