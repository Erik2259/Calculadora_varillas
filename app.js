/* ==========================================================
   Calculadora de Varillas — Interfaz
   ----------------------------------------------------------
     1. Formulario (lectura y validación)
     2. Resultado (respuesta, datos, otras opciones)
     3. Croquis de la columna (SVG)
     4. Historial (se guarda en el dispositivo)
     5. PWA (funcionar sin conexión, instalar, actualizar)
   ========================================================== */

import * as C from './calc.js';
import { tablaResultado, crearCSV, crearXLSX, crearPDF } from './exportar.js';

const STORAGE_HISTORIAL = 'cv_historial';
const STORAGE_CONFIG = 'cv_config';
const MAX_HISTORIAL = 20;

const $ = (sel) => document.querySelector(sel);
const fmt = (x, dec = 2) => x.toLocaleString('es-MX', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtCorto = (x) => x.toLocaleString('es-MX', { maximumFractionDigits: 2 });
const esc = (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nombreVarillas = (o) => `${o.n} varillas de ${o.varilla.nombre}`;

const el = {
  form: $('#formColumna'),
  ancho: $('#ancho'),
  largo: $('#largo'),
  porcentaje: $('#porcentaje'),
  selector: $('#selectorVarilla'),
  respuesta: $('#respuesta'),
  detalle: $('#detalle'),
  datos: $('#datos'),
  opciones: $('#opciones'),
  pasos: $('#pasos'),
  croquis: $('#croquis'),
  croquisDesc: $('#croquisDesc'),
  croquisVacio: $('#croquisVacio'),
  gVarillas: $('#gVarillas'),
  gCotas: $('#gCotas'),
  toast: $('#toast'),
};

const estado = {
  r: null,          // último resultado
  verId: null,      // varilla que se está viendo en el croquis
  calculado: false, // después del primer cálculo, los cambios se actualizan solos
};

const opcionVista = () => estado.r && (estado.r.opciones.find(o => o.varilla.id === estado.verId) || estado.r.elegida);

function leerJSON(clave, porDefecto) {
  try { const raw = localStorage.getItem(clave); return raw ? JSON.parse(raw) : porDefecto; } catch { return porDefecto; }
}
function escribirJSON(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* sin almacenamiento */ }
}

/* ----------------------------------------------------------
   1. FORMULARIO
   ---------------------------------------------------------- */
function crearOpcionesVarilla() {
  const maxD = C.diametroCm(C.VARILLAS[C.VARILLAS.length - 1]);
  for (const v of C.VARILLAS) {
    const px = (6 + 12 * C.diametroCm(v) / maxD).toFixed(1);
    const label = document.createElement('label');
    label.className = 'varilla';
    label.innerHTML = `
      <input type="radio" name="varilla" value="${esc(v.id)}">
      <span><i class="punto" style="width:${px}px;height:${px}px"></i><strong>${esc(v.nombre)}</strong><small>${esc(v.numero)}</small></span>`;
    el.selector.appendChild(label);
  }
}
const varillaElegida = () => document.querySelector('input[name="varilla"]:checked')?.value || 'auto';
function marcarVarilla(id) {
  const radio = document.querySelector(`input[name="varilla"][value="${CSS.escape(id)}"]`) || document.querySelector('input[name="varilla"][value="auto"]');
  radio.checked = true;
}

function numero(input) {
  const t = input.value.trim().replace(',', '.');
  return t === '' ? NaN : Number(t);
}

const MENSAJES = {
  ancho: (v) => isNaN(v) ? 'Escribe el ancho.' : v <= 0 ? 'El ancho debe ser mayor que 0.' : v > 1000 ? 'Revisa el ancho: es demasiado grande.' : '',
  largo: (v) => isNaN(v) ? 'Escribe el largo.' : v <= 0 ? 'El largo debe ser mayor que 0.' : v > 1000 ? 'Revisa el largo: es demasiado grande.' : '',
  porcentaje: (v) => !(v >= 0.1 && v <= 10) ? 'Usa un porcentaje entre 0.1 % y 10 %.' : '',
};

/** Lee el formulario. Si algo está mal devuelve null (y, si se pide, muestra el error junto al campo). */
function leerFormulario(mostrarErrores) {
  const valores = {};
  let ok = true;
  for (const campo of Object.keys(MENSAJES)) {
    const v = numero(el[campo]);
    const msg = MENSAJES[campo](v);
    valores[campo] = v;
    if (msg) ok = false;
    const err = $(`#${campo}-err`);
    if (mostrarErrores || !msg) {
      err.textContent = msg;
      err.hidden = !msg;
      el[campo].setAttribute('aria-invalid', msg ? 'true' : 'false');
    }
  }
  return ok ? { ...valores, diametroId: varillaElegida() } : null;
}

function actualizarChips() {
  const p = numero(el.porcentaje);
  document.querySelectorAll('.chip').forEach(ch => ch.setAttribute('aria-pressed', String(Number(ch.dataset.pct) === p)));
}

function guardarConfig() {
  escribirJSON(STORAGE_CONFIG, { porcentaje: el.porcentaje.value, diametro: varillaElegida() });
}
function cargarConfig() {
  const cfg = leerJSON(STORAGE_CONFIG, null);
  if (cfg?.porcentaje) el.porcentaje.value = cfg.porcentaje;
  if (cfg?.diametro) marcarVarilla(cfg.diametro);
}

/** Calcula y muestra. Solo se guarda en el historial al presionar "Calcular". */
function calcular({ guardar = false } = {}) {
  const entrada = leerFormulario(guardar);
  if (!entrada) {
    if (guardar) document.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }
  const antes = estado.r;
  estado.r = C.calcular(entrada);
  // Si cambió la varilla elegida en el formulario, se muestra esa en el croquis
  if (guardar || !antes || antes.auto !== estado.r.auto || antes.elegida.varilla.id !== estado.r.elegida.varilla.id) {
    estado.verId = estado.r.elegida.varilla.id;
  }
  estado.calculado = true;
  mostrarResultado();
  if (guardar) {
    guardarEnHistorial(entrada);
    actualizarWidget();
    if (matchMedia('(max-width: 899px)').matches) {
      $('#resultado').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

/** Guarda el último cálculo para el widget de Windows 11 y le avisa al service worker. */
async function actualizarWidget() {
  if (!('caches' in window) || !navigator.serviceWorker?.controller) return;
  const r = estado.r;
  const o = r.elegida;
  const datos = {
    columna: `Columna ${fmtCorto(r.ancho)} × ${fmtCorto(r.largo)} cm · acero ${fmtCorto(r.porcentaje)} %`,
    respuesta: `${o.n} varillas de ${o.varilla.nombre}`,
    asReq: `${fmt(r.asReq)} cm²`,
    asProp: `${fmt(o.asProp)} cm²`,
    separacion: o.lb > 0 && o.lh > 0 ? `${fmt(o.sepLibre, 1)} cm (mín. ${fmt(o.sMin, 1)})` : '—',
    caben: o.cabe ? 'Sí' : 'No',
  };
  try {
    const cache = await caches.open('varillas-widget-datos');
    await cache.put('./widgets/ultimo-calculo-datos.json', new Response(JSON.stringify(datos), { headers: { 'Content-Type': 'application/json' } }));
    navigator.serviceWorker.controller.postMessage({ tipo: 'widget-actualizar' });
  } catch { /* el widget es opcional */ }
}

function limpiar() {
  el.form.reset();
  el.porcentaje.value = 1;
  marcarVarilla('auto');
  ['ancho', 'largo', 'porcentaje'].forEach(c => { $(`#${c}-err`).hidden = true; el[c].setAttribute('aria-invalid', 'false'); });
  estado.r = null;
  estado.verId = null;
  estado.calculado = false;
  actualizarChips();
  mostrarResultado();
  guardarConfig();
  el.ancho.focus();
}

/* ----------------------------------------------------------
   2. RESULTADO
   ---------------------------------------------------------- */
const ICONO_OK = '<svg class="ic" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>';
const ICONO_MAL = '<svg class="ic" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>';
const ICONO_INFO = '<svg class="ic" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';

function mostrarResultado() {
  const r = estado.r;
  const o = opcionVista();
  el.respuesta.hidden = !o;
  el.detalle.hidden = !o;
  dibujarCroquis();
  if (!o) return;

  // Respuesta principal
  const recomendada = o === r.mejor;
  let aviso;
  if (o.cabe) {
    aviso = `<p class="estado estado--ok">${ICONO_OK}Las varillas caben bien en la columna.</p>`;
  } else if (o.lb <= 0 || o.lh <= 0) {
    aviso = `<p class="estado estado--mal">${ICONO_MAL}La columna es demasiado pequeña para estas varillas.</p>`;
  } else {
    aviso = `<p class="estado estado--mal">${ICONO_MAL}Las varillas quedan muy juntas: ${fmt(o.sepLibre, 1)} cm entre ellas (mínimo ${fmt(o.sMin, 1)} cm).</p>`;
  }
  if (!o.cabe) {
    aviso += r.mejor.cabe && r.mejor !== o
      ? `<button type="button" class="btn-sugerencia" data-ver="${esc(r.mejor.varilla.id)}">Mejor usa ${esc(nombreVarillas(r.mejor))} →</button>`
      : '<p class="nota">Prueba con una columna más grande o un porcentaje menor.</p>';
  }
  if (r.porcentaje < 1 || r.porcentaje > 4 || o.pctReal > 4) {
    aviso += `<p class="nota">${ICONO_INFO}Lo normal en columnas es usar entre 1 % y 4 % de acero.</p>`;
  }

  el.respuesta.innerHTML = `
    <p class="answer-label">${recomendada ? '<span class="tag">Recomendada</span>' : 'Opción elegida'}</p>
    <p class="answer-main"><span class="num">${o.n}</span> varillas de <span class="num">${esc(o.varilla.nombre)}</span> <small>(${esc(o.varilla.numero)})</small></p>
    ${aviso}`;

  // Datos principales
  el.datos.innerHTML = `
    <div><dt>Área de la columna</dt><dd>${fmt(r.areaCol)} <small>cm²</small></dd></div>
    <div><dt>Acero necesario</dt><dd>${fmt(r.asReq)} <small>cm²</small></dd></div>
    <div><dt>Acero con estas varillas</dt><dd>${fmt(o.asProp)} <small>cm²</small></dd></div>
    <div class="${o.cabe ? '' : 'mal'}"><dt>Espacio entre varillas</dt><dd>${o.lb > 0 && o.lh > 0 ? `${fmt(o.sepLibre, 1)} <small>cm</small>` : '—'}</dd></div>`;

  // Otras opciones (una por diámetro)
  el.opciones.innerHTML = r.opciones.map(op => `
    <li>
      <button type="button" class="opcion${op === o ? ' activa' : ''}" data-ver="${esc(op.varilla.id)}" aria-pressed="${op === o}">
        ${miniCroquis(op, r.ancho, r.largo)}
        <span class="opcion-texto">
          <strong>${esc(nombreVarillas(op))}</strong>
          <small>${fmt(op.asProp)} cm² de acero${op === r.mejor ? ' · <b>Recomendada</b>' : ''}</small>
        </span>
        <span class="badge ${op.cabe ? 'badge--ok' : 'badge--mal'}">${op.cabe ? `${ICONO_OK}Caben` : `${ICONO_MAL}No caben`}</span>
      </button>
    </li>`).join('');

  // Explicación en palabras
  const nDecimal = r.asReq / o.areaUna;
  el.pasos.innerHTML = `
    <li><b>Área de la columna:</b> ${fmtCorto(r.ancho)} × ${fmtCorto(r.largo)} = ${fmt(r.areaCol)} cm²</li>
    <li><b>Acero necesario:</b> el ${fmtCorto(r.porcentaje)} % de ${fmt(r.areaCol)} cm² = ${fmt(r.asReq)} cm²</li>
    <li><b>Cuántas varillas:</b> cada varilla de ${esc(o.varilla.nombre)} tiene ${fmt(o.areaUna)} cm². ${fmt(r.asReq)} ÷ ${fmt(o.areaUna)} = ${fmt(nDecimal, 1)} → se usan <b>${o.n}</b>.
      <br><small>Siempre se redondea hacia arriba, con mínimo 4 (una en cada esquina) y en número par para que queden parejas.</small></li>
    <li><b>Comprobación:</b> ${o.n} × ${fmt(o.areaUna)} cm² = ${fmt(o.asProp)} cm², que cubre los ${fmt(r.asReq)} cm² necesarios.</li>
    <li><b>¿Caben?</b> Entre varilla y varilla debe haber al menos ${fmt(o.sMin, 1)} cm para que pase el concreto. ${o.lb > 0 && o.lh > 0 ? `Aquí hay ${fmt(o.sepLibre, 1)} cm: ${o.cabe ? 'sí caben' : 'no caben'}.` : 'Aquí no hay espacio suficiente.'}</li>`;
}

/* ----------------------------------------------------------
   3. CROQUIS
   El viewBox usa el tamaño real en pantalla para que los textos
   se lean igual en celular y en computadora.
   ---------------------------------------------------------- */
const NS = 'http://www.w3.org/2000/svg';
const vista = { W: 600, H: 420 };

function ponerRect(nodo, x, y, w, h) {
  for (const [k, v] of Object.entries({ x, y, width: Math.max(0, w), height: Math.max(0, h) })) {
    nodo.setAttribute(k, v.toFixed(2));
    nodo.style.setProperty(k, `${v.toFixed(2)}px`);   // permite animar el cambio de tamaño
  }
}

function cota(x1, y1, x2, y2, texto, vertical) {
  const tx = vertical ? x1 - 10 : (x1 + x2) / 2;
  const ty = vertical ? (y1 + y2) / 2 : y1 - 10;
  return `<line class="cota" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-start="url(#flecha)" marker-end="url(#flecha)"/>
    <text class="cota-txt" x="${tx}" y="${ty}" text-anchor="middle"${vertical ? ` transform="rotate(-90 ${tx} ${ty})"` : ''}>${texto}</text>`;
}

function dibujarCroquis() {
  const o = opcionVista();
  const b = o ? estado.r.ancho : numero(el.ancho);
  const h = o ? estado.r.largo : numero(el.largo);
  const hayMedidas = b > 0 && h > 0 && b <= 1000 && h <= 1000;
  const { W, H } = vista;
  const ancho = W >= 520;

  // Márgenes para las cotas y la etiqueta de varillas
  const m = { l: 56, r: ancho && o ? 170 : 24, t: 52, b: 24 };
  const B = hayMedidas ? b : 30, Hh = hayMedidas ? h : 30;
  const s = Math.min((W - m.l - m.r) / B, (H - m.t - m.b) / Hh);
  const w = B * s, hh = Hh * s;
  const x0 = m.l + (W - m.l - m.r - w) / 2, y0 = m.t + (H - m.t - m.b - hh) / 2;

  el.croquis.classList.toggle('vacio', !hayMedidas);
  el.croquisVacio.hidden = Boolean(o);

  const rec = C.RECUBRIMIENTO_CM * s, de = C.DIAM_ESTRIBO_CM * s;
  ponerRect($('#secConcreto'), x0, y0, w, hh);
  const est = $('#secEstribo');
  ponerRect(est, x0 + rec + de / 2, y0 + rec + de / 2, w - 2 * rec - de, hh - 2 * rec - de);
  est.style.strokeWidth = `${Math.min(5, Math.max(1.5, de))}px`;

  // Varillas (se reutilizan los círculos para que se muevan suavemente)
  const pts = o ? C.posicionesVarillas(o, b, h) : [];
  const circulos = [...el.gVarillas.children];
  pts.forEach((p, i) => {
    let c = circulos[i];
    if (!c) {
      c = document.createElementNS(NS, 'circle');
      c.setAttribute('class', 'varilla-dibujo aparece');
      c.addEventListener('animationend', () => c.classList.remove('aparece'), { once: true });
      el.gVarillas.appendChild(c);
    }
    for (const [k, v] of Object.entries({ cx: x0 + p.x * s, cy: y0 + p.y * s, r: Math.max(2.5, (p.db / 2) * s) })) {
      c.setAttribute(k, v.toFixed(2));
      c.style.setProperty(k, `${v.toFixed(2)}px`);
    }
  });
  circulos.slice(pts.length).forEach(c => c.remove());

  // Cotas y etiquetas
  let svg = '';
  if (hayMedidas) {
    svg += cota(x0, y0 - 22, x0 + w, y0 - 22, `${fmtCorto(b)} cm`, false);
    svg += cota(x0 - 22, y0, x0 - 22, y0 + hh, `${fmtCorto(h)} cm`, true);
  }
  if (o && ancho) {
    const esquina = pts.filter(p => p.cara === 'arriba').sort((u, v) => v.x - u.x)[0];
    const px = x0 + esquina.x * s, py = y0 + esquina.y * s, tx = x0 + w + 36, ty = Math.max(24, y0 + 12);
    svg += `<path class="guia" d="M${px} ${py} L${tx - 12} ${ty} L${tx - 4} ${ty}"/>
      <text class="etiqueta" x="${tx}" y="${ty + 5}">${o.n} varillas</text>
      <text class="etiqueta-sub" x="${tx}" y="${ty + 22}">de ${esc(o.varilla.nombre)} (${esc(o.varilla.numero)})</text>`;
  }
  if (o && o.lb > 0 && o.lh > 0) {
    // Flecha del espacio entre las dos varillas más cercanas
    const arriba = pts.filter(p => p.cara === 'arriba').sort((u, v) => u.x - v.x);
    const segunda = o.gobierna === 'b'
      ? arriba[1]
      : pts.filter(p => p.cara === 'izq').sort((u, v) => u.y - v.y)[0] || pts.filter(p => p.cara === 'abajo')[0];
    const p1 = arriba[0], p2 = segunda;
    const r = (p1.db / 2) * s;
    const cls = o.cabe ? 'sep ok' : 'sep mal';
    const mk = o.cabe ? 'flecha' : 'flechaMal';
    const txt = `${fmt(o.sepLibre, 1)} cm`;
    if (o.gobierna === 'b') {
      const y = y0 + p1.y * s, xa = x0 + p1.x * s + r, xb = x0 + p2.x * s - r;
      svg += `<g class="${cls}"><line x1="${xa}" y1="${y}" x2="${xb}" y2="${y}" marker-start="url(#${mk})" marker-end="url(#${mk})"/>
        <text x="${(xa + xb) / 2}" y="${y + r + 18}" text-anchor="middle">${txt}</text></g>`;
    } else {
      const x = x0 + p1.x * s, ya = y0 + p1.y * s + r, yb = y0 + p2.y * s - r;
      svg += `<g class="${cls}"><line x1="${x}" y1="${ya}" x2="${x}" y2="${yb}" marker-start="url(#${mk})" marker-end="url(#${mk})"/>
        <text x="${x + r + 8}" y="${(ya + yb) / 2 + 4}">${txt}</text></g>`;
    }
  }
  el.gCotas.innerHTML = svg;

  el.croquisDesc.textContent = o
    ? `Columna de ${fmtCorto(b)} por ${fmtCorto(h)} centímetros con ${nombreVarillas(o)}. ${o.cabe ? 'Las varillas caben.' : 'Las varillas no caben.'}`
    : 'Croquis de la columna sin datos.';
}

/** Croquis pequeño para la lista de opciones. */
function miniCroquis(o, b, h, size = 44) {
  const pad = 4;
  const s = Math.min((size - 2 * pad) / b, (size - 2 * pad) / h);
  const w = b * s, hh = h * s, x0 = (size - w) / 2, y0 = (size - hh) / 2;
  const puntos = C.posicionesVarillas(o, b, h)
    .map(p => `<circle cx="${(x0 + p.x * s).toFixed(1)}" cy="${(y0 + p.y * s).toFixed(1)}" r="${Math.max(1.4, (p.db / 2) * s).toFixed(1)}"/>`).join('');
  return `<svg class="mini" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <rect x="${x0}" y="${y0}" width="${w}" height="${hh}" rx="1"/>${puntos}</svg>`;
}

/* ----------------------------------------------------------
   4. HISTORIAL
   ---------------------------------------------------------- */
function guardarEnHistorial(entrada) {
  const o = opcionVista();
  const lista = leerJSON(STORAGE_HISTORIAL, []);
  lista.unshift({
    fecha: new Date().toISOString(),
    ancho: entrada.ancho,
    largo: entrada.largo,
    porcentaje: entrada.porcentaje,
    diametroId: entrada.diametroId,
    diametro: o.varilla.nombre,
    n: o.n,
    asReq: estado.r.asReq,
    asProp: o.asProp,
  });
  escribirJSON(STORAGE_HISTORIAL, lista.slice(0, MAX_HISTORIAL));
}

function mostrarHistorial() {
  const lista = leerJSON(STORAGE_HISTORIAL, []);
  $('#historialVacio').hidden = lista.length > 0;
  $('#btnBorrarHistorial').hidden = lista.length === 0;
  $('#listaHistorial').innerHTML = lista.map((h, i) => {
    const fecha = new Date(h.fecha).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
    return `<li><button type="button" class="hist" data-i="${i}">
      <strong>${h.n} varillas de ${esc(h.diametro)}</strong>
      <span>Columna de ${fmtCorto(h.ancho)} × ${fmtCorto(h.largo)} cm · ${fmtCorto(h.porcentaje)} % de acero</span>
      <small>${esc(fecha)}</small>
    </button></li>`;
  }).join('');
}

function abrirDelHistorial(i) {
  const h = leerJSON(STORAGE_HISTORIAL, [])[i];
  if (!h) return;
  el.ancho.value = h.ancho;
  el.largo.value = h.largo;
  el.porcentaje.value = h.porcentaje;
  marcarVarilla(h.diametroId || 'auto');
  actualizarChips();
  $('#dlgHistorial').close();
  estado.r = null;
  calcular();
  $('#resultado').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ----------------------------------------------------------
   EVENTOS
   ---------------------------------------------------------- */
el.form.addEventListener('submit', (e) => { e.preventDefault(); calcular({ guardar: true }); guardarConfig(); });
el.form.addEventListener('input', () => {
  actualizarChips();
  if (estado.calculado) calcular(); else dibujarCroquis();   // el croquis se actualiza mientras escribes
  guardarConfig();
});
document.querySelectorAll('.chip').forEach(ch => ch.addEventListener('click', () => {
  el.porcentaje.value = ch.dataset.pct;
  el.porcentaje.dispatchEvent(new Event('input', { bubbles: true }));
}));
$('#btnLimpiar').addEventListener('click', limpiar);

// Ver otra opción en el croquis
$('#resultado').addEventListener('click', (e) => {
  const boton = e.target.closest('[data-ver]');
  if (!boton) return;
  estado.verId = boton.dataset.ver;
  mostrarResultado();
  if (boton.classList.contains('opcion') && matchMedia('(max-width: 899px)').matches) {
    $('#croquisZona').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});

// Historial
$('#btnHistorial').addEventListener('click', () => { mostrarHistorial(); $('#dlgHistorial').showModal(); });
$('#listaHistorial').addEventListener('click', (e) => {
  const b = e.target.closest('[data-i]');
  if (b) abrirDelHistorial(Number(b.dataset.i));
});
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', (e) => {
  if (e.target === d || e.target.closest('[data-cerrar]')) d.close();   // clic afuera o en la X
}));
$('#btnBorrarHistorial').addEventListener('click', () => {
  const dlg = $('#dlgConfirmar');
  dlg.returnValue = '';
  dlg.showModal();
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'si') return;
    try { localStorage.removeItem(STORAGE_HISTORIAL); } catch { /* sin almacenamiento */ }
    mostrarHistorial();
  }, { once: true });
});

// El croquis usa su tamaño real como viewBox
new ResizeObserver(([entrada]) => {
  const { width, height } = entrada.contentRect;
  if (!width || !height) return;
  vista.W = Math.round(width);
  vista.H = Math.round(height);
  el.croquis.setAttribute('viewBox', `0 0 ${vista.W} ${vista.H}`);
  dibujarCroquis();
}).observe($('#croquisZona'));

/* ----------------------------------------------------------
   5. PWA
   ---------------------------------------------------------- */
function mostrarToast(mensaje, textoBoton, accion) {
  el.toast.innerHTML = `<span>${esc(mensaje)}</span>`;
  if (textoBoton) {
    const b = Object.assign(document.createElement('button'), { className: 'btn btn-primary', textContent: textoBoton });
    b.addEventListener('click', accion);
    el.toast.appendChild(b);
  } else {
    setTimeout(() => { el.toast.hidden = true; }, 3000);
  }
  el.toast.hidden = false;
}

// Service Worker: guarda la app para usarla sin internet y avisa si hay versión nueva
if ('serviceWorker' in navigator) {
  const habiaVersion = Boolean(navigator.serviceWorker.controller);
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    } catch (err) {
      console.warn('No se pudo registrar el Service Worker:', err);
    }
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (habiaVersion) mostrarToast('Hay una nueva versión de la app.', 'Actualizar', () => location.reload());
  });
}

// Botón "Instalar" (aparece solo si el navegador lo permite)
let eventoInstalar = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  eventoInstalar = e;
  $('#btnInstall').hidden = false;
});
$('#btnInstall').addEventListener('click', async () => {
  if (!eventoInstalar) return;
  eventoInstalar.prompt();
  await eventoInstalar.userChoice;
  eventoInstalar = null;
  $('#btnInstall').hidden = true;
});
window.addEventListener('appinstalled', () => { $('#btnInstall').hidden = true; mostrarToast('Aplicación instalada.'); });

// Aviso de "Sin conexión"
const actualizarConexion = () => { $('#offline').hidden = navigator.onLine; };
window.addEventListener('online', actualizarConexion);
window.addEventListener('offline', actualizarConexion);

// Controles de la barra de título: tema, limpiar, copiar, imprimir y pantalla completa
const STORAGE_TEMA = 'varillas.tema';
function aplicarTema(tema) {
  if (tema) document.documentElement.dataset.theme = tema; else delete document.documentElement.dataset.theme;
}
function temaActual() {
  return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
aplicarTema(leerJSON(STORAGE_TEMA, null));
$('#btnTema').addEventListener('click', () => {
  const nuevo = temaActual() === 'dark' ? 'light' : 'dark';
  aplicarTema(nuevo);
  escribirJSON(STORAGE_TEMA, nuevo);
});

$('#btnLimpiarTop').addEventListener('click', limpiar);

function textoResultado() {
  const o = opcionVista();
  const r = estado.r;
  return [
    `Columna ${fmtCorto(r.ancho)} × ${fmtCorto(r.largo)} cm, acero ${fmtCorto(r.porcentaje)} %`,
    `${nombreVarillas(o)} (${o.varilla.numero})`,
    `Acero necesario: ${fmt(r.asReq)} cm² · propuesto: ${fmt(o.asProp)} cm²`,
    `Espacio entre varillas: ${o.lb > 0 && o.lh > 0 ? fmt(o.sepLibre, 1) + ' cm' : '—'} (mínimo ${fmt(o.sMin, 1)} cm) · ${o.cabe ? 'caben' : 'no caben'}`,
  ].join('\n');
}

async function copiarResultado() {
  if (!opcionVista()) { mostrarToast('Primero calcula para poder copiar el resultado.'); return; }
  try {
    await navigator.clipboard.writeText(textoResultado());
    mostrarToast('Resultado copiado.');
  } catch {
    mostrarToast('No se pudo copiar el resultado.');
  }
}
$('#btnCopiar').addEventListener('click', copiarResultado);

$('#btnImprimir').addEventListener('click', () => {
  if (!opcionVista()) { mostrarToast('Primero calcula para poder imprimir el resultado.'); return; }
  window.print();
});

const btnPantalla = $('#btnPantalla');
btnPantalla.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { mostrarToast('No se pudo cambiar a pantalla completa.'); }
});
document.addEventListener('fullscreenchange', () => btnPantalla.setAttribute('aria-pressed', String(!!document.fullscreenElement)));

/* ----------------------------------------------------------
   Compartir (Web Share API) y recibir (Web Share Target)
   ---------------------------------------------------------- */
/** Enlace que reabre la app con la misma columna: ?b=ancho&h=largo&p=porcentaje&v=varilla */
function enlaceCompartido() {
  const r = estado.r;
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('b', r.ancho);
  u.searchParams.set('h', r.largo);
  u.searchParams.set('p', r.porcentaje);
  u.searchParams.set('v', r.auto ? 'auto' : r.elegida.varilla.id);
  return u.href;
}

async function compartirTexto() {
  // El enlace va dentro de "text" (sin campo "url"): WhatsApp y otras apps ignoran "text" si llega "url"
  const datos = { title: 'Calculadora de Varillas', text: `${textoResultado()}\n\n${enlaceCompartido()}` };
  if (!navigator.share) {
    // Sin Web Share (p. ej. Firefox de escritorio): se copia el texto con el enlace
    try {
      await navigator.clipboard.writeText(datos.text);
      mostrarToast('Compartir no está disponible; se copió el resultado con el enlace.');
    } catch { mostrarToast('Tu navegador no permite compartir.'); }
    return;
  }
  try {
    await navigator.share(datos);
  } catch (err) {
    if (err.name !== 'AbortError') mostrarToast('No se pudo compartir el resultado.');
  }
}

function descargarArchivo(blob, nombre) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: nombre });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/** Genera el archivo (xlsx, csv o pdf) y lo comparte; si no se puede compartir, lo descarga. El PDF se descarga siempre. */
async function compartirArchivo(formato) {
  const r = estado.r;
  const tabla = tablaResultado(r, opcionVista());
  const blob = formato === 'xlsx' ? crearXLSX(tabla) : formato === 'csv' ? crearCSV(tabla) : crearPDF(tabla, enlaceCompartido());
  const nombre = `columna-${fmtCorto(r.ancho)}x${fmtCorto(r.largo)}.${formato}`;
  const archivo = new File([blob], nombre, { type: blob.type });
  const descargado = formato === 'pdf';
  if (descargado) {
    descargarArchivo(blob, nombre);
    mostrarToast(`Se descargó ${nombre}.`);
  }
  if (navigator.canShare?.({ files: [archivo] })) {
    try {
      await navigator.share({ title: 'Calculadora de Varillas', files: [archivo] });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  if (!descargado) {
    descargarArchivo(blob, nombre);
    mostrarToast(`Se descargó ${nombre}.`);
  }
}

function compartirResultado() {
  if (!opcionVista()) { mostrarToast('Primero calcula para poder compartir el resultado.'); return; }
  $('#dlgCompartir').showModal();
}
$('#dlgCompartir').addEventListener('click', (e) => {
  const b = e.target.closest('[data-formato]');
  if (!b) return;
  $('#dlgCompartir').close();
  if (b.dataset.formato === 'texto') compartirTexto(); else compartirArchivo(b.dataset.formato);
});
$('#btnCompartir').addEventListener('click', compartirResultado);

/** Rellena el formulario con una columna recibida por enlace o desde otra app. Devuelve true si calculó. */
function aplicarColumnaRecibida({ ancho, largo, porcentaje, varilla }) {
  const b = Number(String(ancho).replace(',', '.'));
  const h = Number(String(largo).replace(',', '.'));
  if (!(b > 0 && h > 0)) return false;
  el.ancho.value = b;
  el.largo.value = h;
  const p = Number(String(porcentaje ?? '').replace(',', '.'));
  if (p >= 0.1 && p <= 10) el.porcentaje.value = p;
  marcarVarilla(varilla || 'auto');
  actualizarChips();
  calcular({ guardar: true });
  return Boolean(estado.r);
}

/** Lee ?b=&h=&p=&v= (enlace propio) o title/text/url (share_target del manifest). */
function procesarParametrosURL() {
  const q = new URLSearchParams(location.search);
  if (![...q.keys()].length) return;
  if (q.get('nuevo') === '1') {   // viene del botón "Nuevo cálculo" del widget
    history.replaceState(null, '', location.pathname);
    el.ancho.focus();
    return;
  }

  let columna = null;
  // 1) Enlace propio, ya sea directo o dentro del parámetro "url"/"text" compartido
  const enlaces = [location.href, q.get('url'), q.get('text')?.match(/https?:\/\/\S+/)?.[0]];
  for (const enlace of enlaces) {
    try {
      const p = new URL(enlace, location.href).searchParams;
      if (p.get('b') && p.get('h')) { columna = { ancho: p.get('b'), largo: p.get('h'), porcentaje: p.get('p'), varilla: p.get('v') }; break; }
    } catch { /* no era un enlace */ }
  }
  // 2) Texto copiado de esta app: "Columna 30 × 45 cm, acero 2 %"
  if (!columna) {
    const t = `${q.get('title') || ''}\n${q.get('text') || ''}`;
    const m = t.match(/(\d+(?:[.,]\d+)?)\s*[×xX]\s*(\d+(?:[.,]\d+)?)\s*cm(?:,\s*acero\s*(\d+(?:[.,]\d+)?))?/);
    if (m) columna = { ancho: m[1], largo: m[2], porcentaje: m[3] };
  }

  if (columna && aplicarColumnaRecibida(columna)) mostrarToast('Columna recibida y calculada.');
  else if (q.has('title') || q.has('text') || q.has('url')) mostrarToast('El contenido compartido no incluye medidas de columna.');
  // Limpiar la URL para que al recargar no se repita el cálculo
  history.replaceState(null, '', location.pathname);
}

// Atajos Alt + letra
document.addEventListener('keydown', (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  const acciones = { t: '#btnTema', l: '#btnLimpiarTop', c: '#btnCopiar', p: '#btnImprimir', s: '#btnCompartir' };
  const id = acciones[e.key.toLowerCase()];
  if (id) { e.preventDefault(); $(id).click(); }
});

// Superposición de controles de ventana (barra de título personalizada)
const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => { clearTimeout(timeout); func(...args); };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};
if ('windowControlsOverlay' in navigator) {
  navigator.windowControlsOverlay.addEventListener('geometrychange', debounce((e) => {
    const visible = navigator.windowControlsOverlay.visible;
    const rect = e.titlebarAreaRect;
    console.log(`The overlay is ${visible ? 'visible' : 'hidden'}, the title bar width is ${rect.width}px`);
  }, 200));
}

/* ----------------------------------------------------------
   INICIO
   ---------------------------------------------------------- */
crearOpcionesVarilla();
cargarConfig();
actualizarChips();
actualizarConexion();
mostrarResultado();
procesarParametrosURL();
