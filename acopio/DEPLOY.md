# Publicar la app

## Qué se publica

Solo la carpeta `web/`. La carpeta `sql/` no se publica: son instrucciones que ya corriste en Supabase, no hacen parte del sitio.

La carpeta `web/` debe tener exactamente esto:

```
web/
├── index.html
├── styles.css
├── sw.js
├── manifest.webmanifest
├── js/
│   ├── app.js
│   ├── store.js
│   └── config.js      ← con TU URL y TU clave publicable
└── icons/
    ├── icon-192.png
    ├── icon-512.png
    └── icon-512-maskable.png
```

Nada de comprimir en zip para GitHub. Los archivos van sueltos, con esa misma estructura de carpetas.

Antes de subir, confirma que `js/config.js` tiene tus datos reales y no los de ejemplo.

---

## Opción rápida: probar hoy mismo (2 minutos, sin GitHub)

Para tener el enlace funcionando ya y probarlo en el celular:

1. Entrar a **app.netlify.com/drop**
2. Arrastrar la carpeta `web` completa a la zona punteada
3. Netlify devuelve un enlace tipo `https://algo-raro-123.netlify.app`

Sirve para probar todo de verdad: instalar en el celular, entrar con usuario, registrar lotes, poner el celular en modo avión y ver que sigue guardando. Su límite es que cada cambio hay que volverlo a arrastrar a mano. Para eso está la opción de abajo.

---

## Opción definitiva: GitHub + Netlify

Así cada cambio que hagas se publica solo, y tienes historial de versiones del código.

### 1. Crear el repositorio

1. Entrar a **github.com** → botón **+** arriba a la derecha → **New repository**
2. Nombre: `acopio`
3. Marcar **Private**. La clave publicable no es un secreto, pero un repositorio privado es el valor por defecto sensato para algo de la empresa.
4. **Create repository**

### 2. Subir los archivos

En la página del repositorio recién creado, hacer clic en **uploading an existing file** y arrastrar las carpetas `web` y `sql` completas. GitHub respeta la estructura de carpetas. Luego **Commit changes**.

Si prefieres la terminal, desde la carpeta del proyecto:

```bash
git init
git add .
git commit -m "Mapa de acopio"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/acopio.git
git push -u origin main
```

### 3. Conectar Netlify

1. Entrar a **netlify.com** e iniciar sesión con la cuenta de GitHub
2. **Add new site → Import an existing project → GitHub**
3. Autorizar y elegir el repositorio `acopio`
4. En la configuración del despliegue:

   | Campo | Valor |
   |---|---|
   | Branch to deploy | `main` |
   | Base directory | *(vacío)* |
   | Build command | *(vacío)* |
   | Publish directory | `web` |

   El **Publish directory** es lo único que no se puede equivocar: si queda vacío, Netlify publica la raíz del repositorio y el sitio aparece en blanco.

5. **Deploy site**

En menos de un minuto queda publicado.

### 4. Ponerle un nombre decente

**Site configuration → Change site name** → por ejemplo `acopio-lotes`, y queda en `https://acopio-lotes.netlify.app`. Ese es el enlace que les pasas a los contratistas.

---

## Después de publicar

**Instalar en cada celular.** Abrir el enlace en Chrome → menú **⋮ → Agregar a pantalla de inicio**. En iPhone, desde Safari → Compartir → Añadir a inicio.

**Probar sin señal antes de entregarla.** Abrir la app con datos, registrar un lote, activar modo avión, cambiar un estado y mover un lote a una pila. Debe aparecer la franja amarilla de cambios sin subir. Al desactivar el modo avión, la franja desaparece sola. Si eso funciona, funciona en el patio.

**Al publicar cambios**, subir el número de versión en `sw.js`:

```js
const VERSION = 'acopio-v2';   // v3, v4...
```

Si no lo cambias, los celulares siguen usando la versión guardada y no ven las mejoras. Es el error más común con este tipo de app.
