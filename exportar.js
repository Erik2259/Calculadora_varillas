/* ==========================================================
   Calculadora de Varillas — Exportar resultado
   ----------------------------------------------------------
   Genera archivos CSV, Excel (.xlsx) y PDF sin librerías externas,
   para que funcionen también sin conexión.
   ========================================================== */

const enc = new TextEncoder();

/* ---------- Datos del resultado ---------- */
const num = (x, dec = 2) => Number(x.toFixed(dec));

/**
 * Tabla del resultado: { titulo, resumen: [[campo, valor]], cabecera: [...], filas: [[...]] }.
 * Los números van como número (Excel) y el resto como texto.
 */
export function tablaResultado(r, elegida) {
  const resumen = [
    ['Ancho (cm)', r.ancho],
    ['Largo (cm)', r.largo],
    ['Porcentaje de acero (%)', r.porcentaje],
    ['Área de la columna (cm²)', num(r.areaCol)],
    ['Acero necesario (cm²)', num(r.asReq)],
    ['Opción elegida', `${elegida.n} varillas de ${elegida.varilla.nombre} (${elegida.varilla.numero})`],
    ['Acero propuesto (cm²)', num(elegida.asProp)],
    ['Espacio entre varillas (cm)', elegida.lb > 0 && elegida.lh > 0 ? num(elegida.sepLibre, 1) : '—'],
    ['Espacio mínimo (cm)', num(elegida.sMin, 1)],
    ['¿Caben?', elegida.cabe ? 'Sí' : 'No'],
  ];
  const cabecera = ['Varilla', 'Número', 'Cantidad', 'Acero propuesto (cm²)', 'Acero real (%)', 'Espacio entre varillas (cm)', 'Espacio mínimo (cm)', '¿Caben?'];
  const filas = r.opciones.map(o => [
    o.varilla.nombre, o.varilla.numero, o.n, num(o.asProp), num(o.pctReal),
    o.lb > 0 && o.lh > 0 ? num(o.sepLibre, 1) : '—', num(o.sMin, 1), o.cabe ? 'Sí' : 'No',
  ]);
  return { titulo: 'Calculadora de Varillas', resumen, cabecera, filas };
}

/* ---------- CSV ---------- */
const celdaCsv = (v) => {
  const s = String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function crearCSV(t) {
  const lineas = [
    [t.titulo],
    ...t.resumen,
    [],
    t.cabecera,
    ...t.filas,
  ].map(fila => fila.map(celdaCsv).join(','));
  // BOM para que Excel reconozca UTF-8 (acentos, ², ×)
  return new Blob(['﻿' + lineas.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
}

/* ---------- Excel (.xlsx = zip de XML, sin compresión) ---------- */
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (const b of bytes) c = TABLA_CRC[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** Zip "store" (sin comprimir). archivos: [{ nombre, datos: Uint8Array }] */
function crearZip(archivos) {
  const partes = [];
  const central = [];
  let desplazamiento = 0;
  for (const { nombre, datos } of archivos) {
    const n = enc.encode(nombre);
    const crc = crc32(datos);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034B50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);          // nombres en UTF-8
    local.setUint32(14, crc, true);
    local.setUint32(18, datos.length, true);
    local.setUint32(22, datos.length, true);
    local.setUint16(26, n.length, true);
    partes.push(new Uint8Array(local.buffer), n, datos);

    const ent = new DataView(new ArrayBuffer(46));
    ent.setUint32(0, 0x02014B50, true);
    ent.setUint16(4, 20, true);
    ent.setUint16(6, 20, true);
    ent.setUint16(8, 0x0800, true);
    ent.setUint32(16, crc, true);
    ent.setUint32(20, datos.length, true);
    ent.setUint32(24, datos.length, true);
    ent.setUint16(28, n.length, true);
    ent.setUint32(42, desplazamiento, true);
    central.push(new Uint8Array(ent.buffer), n);
    desplazamiento += 30 + n.length + datos.length;
  }
  const tamCentral = central.reduce((s, p) => s + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054B50, true);
  fin.setUint16(8, archivos.length, true);
  fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true);
  fin.setUint32(16, desplazamiento, true);
  return [...partes, ...central, new Uint8Array(fin.buffer)];
}

const escXml = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function letraColumna(i) { return String.fromCharCode(65 + i); }

export function crearXLSX(t) {
  const filasXml = [];
  const agregar = (fila, estilo = 0) => {
    const r = filasXml.length + 1;
    const celdas = fila.map((v, i) => {
      const ref = `${letraColumna(i)}${r}`;
      return typeof v === 'number'
        ? `<c r="${ref}" s="${estilo}"><v>${v}</v></c>`
        : `<c r="${ref}" s="${estilo}" t="inlineStr"><is><t>${escXml(v)}</t></is></c>`;
    }).join('');
    filasXml.push(`<row r="${r}">${celdas}</row>`);
  };
  agregar([t.titulo], 1);
  t.resumen.forEach(f => agregar(f));
  agregar([]);
  agregar(t.cabecera, 1);
  t.filas.forEach(f => agregar(f));

  const xml = (s) => enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${s}`);
  const ns = 'http://schemas.openxmlformats.org/';
  const archivos = [
    { nombre: '[Content_Types].xml', datos: xml(`<Types xmlns="${ns}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`) },
    { nombre: '_rels/.rels', datos: xml(`<Relationships xmlns="${ns}package/2006/relationships"><Relationship Id="rId1" Type="${ns}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { nombre: 'xl/workbook.xml', datos: xml(`<workbook xmlns="${ns}spreadsheetml/2006/main" xmlns:r="${ns}officeDocument/2006/relationships"><sheets><sheet name="Resultado" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { nombre: 'xl/_rels/workbook.xml.rels', datos: xml(`<Relationships xmlns="${ns}package/2006/relationships"><Relationship Id="rId1" Type="${ns}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${ns}officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { nombre: 'xl/styles.xml', datos: xml(`<styleSheet xmlns="${ns}spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`) },
    { nombre: 'xl/worksheets/sheet1.xml', datos: xml(`<worksheet xmlns="${ns}spreadsheetml/2006/main"><cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="8" width="22" customWidth="1"/></cols><sheetData>${filasXml.join('')}</sheetData></worksheet>`) },
  ];
  return new Blob(crearZip(archivos), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/* ---------- PDF (una página A4 con Helvetica) ---------- */
// WinAnsi: los caracteres Latin-1 se escriben tal cual; el resto se reemplaza.
const SUSTITUTOS = { '—': '-', '–': '-', '×': 'x', '≥': '>=', '≤': '<=', '“': '"', '”': '"', '’': "'" };
function textoPdf(s) {
  let out = '';
  for (const ch of String(s)) {
    const c = SUSTITUTOS[ch] ?? ch;
    for (const k of c) {
      const code = k.charCodeAt(0);
      if (code === 0x28 || code === 0x29 || code === 0x5C) out += '\\' + k;
      else if (code >= 32 && code <= 255) out += `\\${code.toString(8).padStart(3, '0')}`;
      else out += '?';
    }
  }
  return out;
}

export function crearPDF(t, enlace) {
  const cmd = [];
  const texto = (x, y, s, tam = 11, negrita = false) =>
    cmd.push(`BT /${negrita ? 'F2' : 'F1'} ${tam} Tf ${x} ${y} Td (${textoPdf(s)}) Tj ET`);

  let y = 800;
  texto(40, y, t.titulo, 20, true);
  y -= 16;
  cmd.push(`0.6 g 40 ${y} 515 1 re f 0 g`);
  y -= 26;
  for (const [campo, valor] of t.resumen) {
    texto(40, y, campo, 11, true);
    texto(230, y, valor, 11);
    y -= 18;
  }

  y -= 14;
  texto(40, y, 'Todas las opciones', 13, true);
  y -= 22;
  // Columnas de la tabla: se omiten las más largas para que quepa en A4
  const idx = [0, 2, 3, 4, 5, 7];
  const x0 = [40, 150, 215, 320, 405, 505];
  const encabezados = ['Varilla', 'Cantidad', 'Acero (cm2)', 'Acero real (%)', 'Espacio (cm)', 'Caben'];
  encabezados.forEach((h, i) => texto(x0[i], y, h, 9.5, true));
  y -= 4;
  cmd.push(`0.6 g 40 ${y} 515 0.7 re f 0 g`);
  y -= 14;
  for (const fila of t.filas) {
    idx.forEach((c, i) => texto(x0[i], y, fila[c], 9.5));
    y -= 15;
  }
  if (enlace) {
    y -= 12;
    texto(40, y, 'Abrir en la app:', 9, true);
    y -= 13;
    // El enlace puede ser largo: se parte en líneas de 95 caracteres
    for (let i = 0; i < enlace.length; i += 95) {
      texto(40, y, enlace.slice(i, i + 95), 8);
      y -= 11;
    }
  }

  const contenido = cmd.join('\n');
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const pos = [];
  objetos.forEach((o, i) => { pos.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  pos.forEach(p => { pdf += `${String(p).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  // Todo el PDF es ASCII (los acentos van en octal), así que 1 carácter = 1 byte
  return new Blob([pdf], { type: 'application/pdf' });
}
