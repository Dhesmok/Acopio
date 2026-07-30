// =====================================================================
//  El informe sale como un .xlsx armado a mano: un ZIP con XML dentro.
//  Un byte mal puesto no se nota aquí —se nota cuando alguien abre el
//  archivo en la oficina y Excel dice que está dañado—, así que la
//  prueba lo vuelve a abrir: recorre el directorio del ZIP, saca cada
//  archivo y comprueba su CRC, que es exactamente lo que hará Excel.
// =====================================================================
import { ok, titulo, cerrar } from './ayudas/decir.mjs';
import { construir, zip } from '../web/js/excel.js';

// ------------------------------------------------- un lector de ZIP mínimo
const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

const TABLA = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();
const crc32 = (b) => {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = TABLA[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};

// Devuelve { nombre: texto } leyendo el ZIP como lo lee un descompresor:
// por el DIRECTORIO CENTRAL del final, no por las cabeceras del principio.
function abrirZip(bytes) {
  // el final del directorio central: la firma, buscando desde atrás
  let fin = bytes.length - 22;
  while (fin >= 0 && u32(bytes, fin) !== 0x06054b50) fin--;
  if (fin < 0) throw new Error('no se encontró el final del directorio central');
  const cuantos = u16(bytes, fin + 10);
  let p = u32(bytes, fin + 16);

  const dec = new TextDecoder();
  const salida = {};
  for (let i = 0; i < cuantos; i++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error(`entrada ${i} sin firma central`);
    const largoNom = u16(bytes, p + 28);
    const desde = u32(bytes, p + 42);
    const nombre = dec.decode(bytes.subarray(p + 46, p + 46 + largoNom));
    const crcDicho = u32(bytes, p + 16);

    // ahora la cabecera local, donde están de verdad los datos
    if (u32(bytes, desde) !== 0x04034b50) throw new Error(`${nombre}: sin cabecera local`);
    const largo = u32(bytes, desde + 18);
    const inicio = desde + 30 + u16(bytes, desde + 26) + u16(bytes, desde + 28);
    const datos = bytes.subarray(inicio, inicio + largo);
    if (crc32(datos) !== crcDicho) throw new Error(`${nombre}: el CRC no cuadra`);
    salida[nombre] = dec.decode(datos);
    p += 46 + largoNom + u16(bytes, p + 30) + u16(bytes, p + 32);
  }
  return salida;
}

// ---------------------------------------------------------------------
titulo('El archivo del informe se abre y no está dañado.');

const columnas = [
  { clave: 'codigo', titulo: 'Código', ancho: 14 },
  { clave: 'proveedor', titulo: 'Proveedor', ancho: 28 },
  { clave: 'dias', titulo: 'Días en el patio', ancho: 16 },
  { clave: 'nota', titulo: 'Observaciones', ancho: 60 }
];
const filas = [
  { codigo: 'PG1042', proveedor: 'Minerales Andinos & Cía', dias: 12,
    nota: 'Vino con "humedad" <alta>' },
  { codigo: 'SJ1015.2', proveedor: 'San Judas', dias: 0, nota: '' },
  { codigo: 'ÑÁÉÍ-01', proveedor: 'Acentos S.A.', dias: 3, nota: 'con un control\x07 en medio' }
];

const bytes = construir(columnas, filas, 'Lotes');
const partes = abrirZip(bytes);   // revienta si el ZIP o algún CRC está mal
ok(true, 'el ZIP se recorre entero y todos los CRC cuadran');

for (const p of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
                 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml'])
  ok(p in partes, `lleva ${p}`);

// ---------------------------------------------------------------------
titulo('Lo que se lee en Excel es lo que se puso.');

const sheet = partes['xl/worksheets/sheet1.xml'];

ok(partes['xl/workbook.xml'].includes('name="Lotes"'), 'la hoja se llama como se pidió');
ok(sheet.includes('<t xml:space="preserve">Código</t>'), 'los encabezados salen con sus tildes');
ok(sheet.includes('r="A1" s="1"'), 'y en negrita (estilo 1), que es la fila de títulos');

// El caso que rompe un CSV y aquí tiene que pasar intacto
ok(sheet.includes('Vino con &quot;humedad&quot; &lt;alta&gt;'),
   'las comillas y los signos de menor/mayor van escapados, no rompen el XML');
ok(sheet.includes('ÑÁÉÍ-01'), 'y los acentos viajan tal cual, sin depender de la configuración');

// Un carácter de control suelto en una observación deja el archivo
// ilegible, y el error que muestra Excel no dice de dónde vino.
ok(!/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(sheet), 'los caracteres de control se quitan');
ok(sheet.includes('con un control en medio'), 'pero el resto del texto se conserva');

// Los números van como número: si salieran como texto no se podrían
// sumar ni ordenar, que es la mitad de para qué se pide el listado.
ok(sheet.includes('<c r="C2"><v>12</v></c>'), 'los días van como número, no como texto');
ok(sheet.includes('<c r="C3"><v>0</v></c>'), 'y un cero es un cero, no una celda vacía');

// Una celda de texto vacía no se escribe: es lo que hace Excel y deja el
// archivo más pequeño en un patio con cientos de lotes.
ok(!sheet.includes('r="D3"'), 'una observación vacía no ocupa celda');

ok(sheet.includes('autoFilter ref="A1:D4"'),
   'el rango del autofiltro abarca los títulos y las tres filas');

// ---------------------------------------------------------------------
titulo('Las columnas siguen contando bien después de la Z.');

const muchas = Array.from({ length: 30 }, (_, i) => ({ clave: `c${i}`, titulo: `T${i}` }));
const anchoSheet = abrirZip(construir(muchas, [Object.fromEntries(
  muchas.map((c, i) => [c.clave, `v${i}`]))]))['xl/worksheets/sheet1.xml'];
ok(anchoSheet.includes('r="Z1"') && anchoSheet.includes('r="AA1"') && anchoSheet.includes('r="AD1"'),
   'la columna 27 es AA y la 30 es AD');

// ---------------------------------------------------------------------
titulo('Un ZIP vacío o de un solo archivo tampoco se rompe.');

const uno = abrirZip(zip([{ nombre: 'a.txt', texto: 'hola' }]));
ok(uno['a.txt'] === 'hola', 'un archivo suelto entra y sale igual');

const sinFilas = abrirZip(construir(columnas, []))['xl/worksheets/sheet1.xml'];
ok(sinFilas.includes('<row r="1">') && !sinFilas.includes('<row r="2">'),
   'un patio sin lotes da un archivo con solo la fila de títulos');

cerrar();
