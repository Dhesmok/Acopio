// =====================================================================
//  excel.js · arma un .xlsx de verdad, sin librerías
//
//  Un .xlsx es un ZIP con unos cuantos XML dentro. Se escribe a mano por
//  lo mismo que todo lo demás en esta app: no hay empaquetador ni paso de
//  compilación, así que meter una librería sería meter un archivo de
//  cientos de kilos a la caché de un celular que trabaja con dos rayas de
//  señal. Lo que hace falta aquí es una tabla de texto, y eso cabe en un
//  archivo.
//
//  Un CSV habría sido más corto, pero en un Excel en español un CSV es
//  una lotería: separador de listas, acentos y fechas cambian según cómo
//  esté configurado el equipo, y el archivo llega hecho un desastre a
//  quien no tiene por qué saber arreglarlo. El .xlsx abre igual en todas
//  partes.
// =====================================================================

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// Excel se traga cualquier texto menos los caracteres de control: uno
// suelto en una observación deja el archivo ilegible y el error que
// muestra no dice de dónde vino.
const limpio = (v) => String(v ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

// A, B, ... Z, AA, AB...
function columna(n) {
  let s = '';
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}

// Una celda. Los números van como número —para poder sumarlos y
// ordenarlos— y todo lo demás como texto en la propia celda
// (`inlineStr`), que ahorra la tabla de cadenas compartidas y con ella
// media complicación del formato.
function celda(valor, ref, estilo) {
  const s = estilo ? ` s="${estilo}"` : '';
  if (typeof valor === 'number') {
    // Un número que no es un número deja la celda vacía. Escribirlo como
    // texto ponía "NaN" en el informe, y un "NaN" en una columna de días
    // parece un dato cuando lo que dice es que la fecha estaba mal.
    return Number.isFinite(valor) ? `<c r="${ref}"${s}><v>${valor}</v></c>` : '';
  }
  const t = limpio(valor);
  if (!t) return '';                       // una celda vacía no se escribe
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is></c>`;
}

// Las fechas van como TEXTO en formato ISO (2026-07-31) a propósito. Una
// fecha de Excel es un número de días desde 1900 con su formato aparte, y
// convertirla mal por una hora de diferencia horaria corre el día entero.
// En ISO se ordena y se filtra igual de bien, y nunca es el día de antes.
export function hoja(columnas, filas) {
  const anchos = columnas.map((c, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${c.ancho || 16}" customWidth="1"/>`).join('');

  const encabezado = `<row r="1">${columnas
    .map((c, i) => celda(c.titulo, `${columna(i)}1`, 1)).join('')}</row>`;

  const cuerpo = filas.map((fila, f) => `<row r="${f + 2}">${columnas
    .map((c, i) => celda(fila[c.clave], `${columna(i)}${f + 2}`)).join('')}</row>`).join('');

  return `${XML}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols>${anchos}</cols>
<sheetData>${encabezado}${cuerpo}</sheetData>
<autoFilter ref="A1:${columna(columnas.length - 1)}${filas.length + 1}"/>
</worksheet>`;
}

// Lo mínimo que Excel exige para no dar el archivo por dañado. `fills`
// lleva dos aunque solo se use uno: Excel da error si el segundo, el
// `gray125`, no está.
const ESTILOS = `${XML}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2">
  <font><sz val="11"/><name val="Calibri"/></font>
  <font><b/><sz val="11"/><name val="Calibri"/></font>
</fonts>
<fills count="2">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
</fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const CONTENIDOS = `${XML}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const RAIZ = `${XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const LIBRO_RELS = `${XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const libro = (nombre) => `${XML}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${esc(nombre)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

// --------------------------------------------------------------- el ZIP
// Se guarda sin comprimir (método 0). Comprimir pediría desinflar a mano
// o pasar por CompressionStream, y el archivo que sale de aquí son unas
// decenas de kilobytes de texto: no vale la pena el código.
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// Un escritor de bytes que crece solo, para no andar contando de antemano
// cuánto va a ocupar cada cabecera.
function bloc() {
  let b = new Uint8Array(1 << 16), n = 0;
  const sitio = (k) => {
    if (n + k <= b.length) return;
    let m = b.length;
    while (m < n + k) m *= 2;
    const otro = new Uint8Array(m); otro.set(b.subarray(0, n)); b = otro;
  };
  return {
    get largo() { return n; },
    u16(v) { sitio(2); b[n++] = v & 0xFF; b[n++] = (v >>> 8) & 0xFF; },
    u32(v) { sitio(4); for (let i = 0; i < 4; i++) b[n++] = (v >>> (i * 8)) & 0xFF; },
    crudo(bytes) { sitio(bytes.length); b.set(bytes, n); n += bytes.length; },
    cerrar: () => b.slice(0, n)
  };
}

// La fecha de cada entrada del ZIP va fija en 1980-01-01, que es el cero
// del formato. No aporta nada al informe —la fecha que importa está
// dentro— y dejarla en 0 da un mes 0 y un día 0, que algunos lectores
// estrictos rechazan. 1980-01-01 = (0 << 9) | (1 << 5) | 1.
const FECHA_DOS = (1 << 5) | 1;

export function zip(archivos) {
  const cod = new TextEncoder();
  const salida = bloc(), central = [];

  for (const { nombre, texto } of archivos) {
    const nom = cod.encode(nombre), datos = cod.encode(texto);
    const crc = crc32(datos), desde = salida.largo;
    // cabecera local
    salida.u32(0x04034b50);
    salida.u16(20); salida.u16(0x0800);   // 0x0800 = los nombres van en UTF-8
    salida.u16(0);                        // sin comprimir
    salida.u16(0); salida.u16(FECHA_DOS); // fecha fija y válida (ver abajo)
    salida.u32(crc); salida.u32(datos.length); salida.u32(datos.length);
    salida.u16(nom.length); salida.u16(0);
    salida.crudo(nom); salida.crudo(datos);
    central.push({ nom, crc, largo: datos.length, desde });
  }

  const inicioCentral = salida.largo;
  for (const e of central) {
    salida.u32(0x02014b50);
    salida.u16(20); salida.u16(20); salida.u16(0x0800);
    salida.u16(0); salida.u16(0); salida.u16(0);
    salida.u32(e.crc); salida.u32(e.largo); salida.u32(e.largo);
    salida.u16(e.nom.length); salida.u16(0); salida.u16(0);
    salida.u16(0); salida.u16(0); salida.u32(0);
    salida.u32(e.desde);
    salida.crudo(e.nom);
  }
  const largoCentral = salida.largo - inicioCentral;

  salida.u32(0x06054b50);
  salida.u16(0); salida.u16(0);
  salida.u16(central.length); salida.u16(central.length);
  salida.u32(largoCentral); salida.u32(inicioCentral);
  salida.u16(0);
  return salida.cerrar();
}

// -------------------------------------------------------------- la puerta
// `columnas`: [{ clave, titulo, ancho }]  ·  `filas`: objetos con esas claves
export function construir(columnas, filas, nombreHoja = 'Datos') {
  return zip([
    { nombre: '[Content_Types].xml', texto: CONTENIDOS },
    { nombre: '_rels/.rels', texto: RAIZ },
    { nombre: 'xl/workbook.xml', texto: libro(nombreHoja) },
    { nombre: 'xl/_rels/workbook.xml.rels', texto: LIBRO_RELS },
    { nombre: 'xl/styles.xml', texto: ESTILOS },
    { nombre: 'xl/worksheets/sheet1.xml', texto: hoja(columnas, filas) }
  ]);
}

// Baja el archivo al teléfono. El enlace se crea, se pulsa solo y se
// tira; la URL se suelta después, porque soltarla antes de tiempo deja la
// descarga a medias en algunos navegadores.
export function descargar(bytes, nombreArchivo) {
  const url = URL.createObjectURL(new Blob([bytes],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url; a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
