// =====================================================================
//  El mapa se dibuja metiendo texto en innerHTML. Un código de lote con
//  un "<" dejaba el plano entero sin dibujar, y para todos.
// =====================================================================
import { ok, titulo, cerrar } from './ayudas/decir.mjs';

globalThis.addEventListener = () => {};

const lienzo = {
  attrs: {}, innerHTML: '', isConnected: true,
  getAttribute: (k) => lienzo.attrs[k],
  setAttribute: (k, v) => { lienzo.attrs[k] = v; },
  addEventListener() {}, querySelector: () => null, querySelectorAll: () => []
};
const Mapa = await import('../web/js/mapa.js');
Mapa.montar({ set innerHTML(_) {}, querySelector: () => lienzo }, {});

titulo('Un código o una etiqueta con caracteres raros no rompen el mapa.');

const veneno = 'AB<script>&"malo';
Mapa.pintar({
  config: { ancho: 1000, alto: 700, color_fondo: '#e4e7e2' },
  figuras: [{ id: 'f1', forma: 'rectangulo', x: 10, y: 10, rx: 50, ry: 50, rot: 0,
              color: '#c7cdc5', etiqueta: veneno }],
  pilas:   [{ id: 'p1', codigo: veneno, tipo: 'otro', estado: 'abierta',
              forma: 'elipse', x: 100, y: 100, rx: 90, ry: 60, rot: 0 }],
  lotes:   [{ id: 'l1', codigo: veneno, estado: 'por_muestrear', pila_id: null,
              forma: 'elipse', x: 200, y: 200, rx: 46, ry: 34, rot: 0 }]
});

const svg = lienzo.innerHTML;
ok(svg.length > 0, 'el mapa se dibujó');
ok(!svg.includes('<script'), 'no quedó ninguna etiqueta <script> suelta en el SVG');
ok(svg.includes('AB&lt;script&gt;&amp;&quot;malo'),
   'el texto peligroso salió escapado, y se sigue leyendo tal cual');

// Si las etiquetas no cierran bien, el navegador no dibuja nada
const balanceado = (s) => {
  const cuenta = (xs) => xs.reduce((a, x) => (a[x] = (a[x] || 0) + 1, a), {});
  const abre = cuenta([...s.matchAll(/<([a-zA-Z]+)(?:\s[^>]*?)?(?<!\/)>/g)].map((m) => m[1]));
  const cierra = cuenta([...s.matchAll(/<\/([a-zA-Z]+)>/g)].map((m) => m[1]));
  return Object.keys(cierra).every((k) => abre[k] === cierra[k]);
};
ok(balanceado(svg), 'las etiquetas del SVG quedaron balanceadas (el mapa no se parte)');

// El caso real que lo motivó: un número de lote con un "<" de más
lienzo.innerHTML = '';
Mapa.pintar({
  config: { ancho: 1000, alto: 700 }, figuras: [], pilas: [],
  lotes: [{ id: 'l2', codigo: 'PG12<5', estado: 'por_muestrear', pila_id: null,
            forma: 'elipse', x: 0, y: 0, rx: 46, ry: 34, rot: 0 }]
});
ok(lienzo.innerHTML.includes('PG12&lt;5'), 'un código tipo "PG12<5" se dibuja sin romper nada');

cerrar();
