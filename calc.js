/* ==========================================================
   Calculadora de Varillas — Cálculos
   ----------------------------------------------------------
   Aquí solo están las matemáticas (no se toca la pantalla).
   app.js usa estas funciones para mostrar los resultados.
   ========================================================== */

/* Varillas disponibles. "pulgadas" es el diámetro nominal. */
export const VARILLAS = [
  { id: '3/8',   nombre: '3/8"',   numero: '#3',  pulgadas: 3 / 8 },
  { id: '1/2',   nombre: '1/2"',   numero: '#4',  pulgadas: 1 / 2 },
  { id: '5/8',   nombre: '5/8"',   numero: '#5',  pulgadas: 5 / 8 },
  { id: '3/4',   nombre: '3/4"',   numero: '#6',  pulgadas: 3 / 4 },
  { id: '1',     nombre: '1"',     numero: '#8',  pulgadas: 1 },
  { id: '1-1/4', nombre: '1 1/4"', numero: '#10', pulgadas: 5 / 4 },
];

export const CM_POR_PULGADA = 2.54;
export const RECUBRIMIENTO_CM = 4;                          // concreto que cubre al estribo
export const DIAM_ESTRIBO_CM = (3 / 8) * CM_POR_PULGADA;    // estribo de 3/8"
export const SEP_LIBRE_MIN_CM = 4;                          // espacio mínimo entre varillas

/* Al recomendar se prefieren varillas de 1/2" o más gruesas. */
const DIAM_MIN_RECOMENDADO_PULG = 1 / 2;

/** Diámetro de la varilla en centímetros. */
export function diametroCm(varilla) {
  return varilla.pulgadas * CM_POR_PULGADA;
}

/** Área de una varilla en cm²: π·d²/4. */
export function areaVarilla(varilla) {
  const d = diametroCm(varilla);
  return (Math.PI * d * d) / 4;
}

/**
 * Número de varillas: se redondea hacia arriba, con mínimo 4
 * (una por esquina) y siempre par (para que queden simétricas).
 */
export function numeroVarillas(asReq, areaUna) {
  // El 1e-9 evita que un error de redondeo (p. ej. 8.0000001) sume una varilla de más.
  const directo = Math.max(1, Math.ceil(asReq / areaUna - 1e-9));
  let n = Math.max(4, directo);
  if (n % 2 !== 0) n += 1;
  return { directo, n };
}

/**
 * Reparte n varillas en el contorno: 4 en las esquinas y las demás
 * de 2 en 2 (en caras opuestas), en la cara que tenga más espacio.
 * arriba/abajo incluyen las esquinas; izq/der son solo las de en medio.
 */
export function distribuirVarillas(n, b, h) {
  const dist = { arriba: 2, abajo: 2, izq: 0, der: 0 };
  for (let restantes = n - 4; restantes >= 2; restantes -= 2) {
    const espacioHoriz = b / (dist.arriba - 1);
    const espacioVert = h / (dist.izq + 1);
    if (espacioHoriz >= espacioVert) { dist.arriba++; dist.abajo++; }
    else { dist.izq++; dist.der++; }
  }
  return dist;
}

/**
 * ¿Caben las varillas? Calcula el espacio libre entre varillas vecinas
 * y lo compara con el mínimo: el mayor entre 1.5 veces el diámetro y 4 cm.
 */
export function revisarSeparacion(n, db, b, h) {
  const borde = RECUBRIMIENTO_CM + DIAM_ESTRIBO_CM + db / 2;   // del borde al centro de la varilla
  const lb = b - 2 * borde;
  const lh = h - 2 * borde;
  const sMin = Math.max(1.5 * db, SEP_LIBRE_MIN_CM);

  if (lb <= 0 || lh <= 0) {
    return { cabe: false, sepLibre: 0, sMin, lb, lh, gobierna: 'b', dist: distribuirVarillas(n, 1, 1) };
  }
  const dist = distribuirVarillas(n, lb, lh);
  const sepB = lb / (dist.arriba - 1);
  const sepH = lh / (dist.izq + 1);
  const sepLibre = Math.min(sepB, sepH) - db;
  return { cabe: sepLibre >= sMin - 1e-9, sepLibre, sMin, lb, lh, gobierna: sepB <= sepH ? 'b' : 'h', dist };
}

/** Resultado para un diámetro de varilla. */
export function calcularOpcion(varilla, datos) {
  const areaUna = areaVarilla(varilla);
  const { directo, n } = numeroVarillas(datos.asReq, areaUna);
  const asProp = n * areaUna;
  return {
    varilla,
    areaUna,
    nDirecto: directo,
    n,
    asProp,
    pctReal: (asProp / datos.areaCol) * 100,
    exceso: asProp - datos.asReq,
    ...revisarSeparacion(n, diametroCm(varilla), datos.ancho, datos.largo),
  };
}

/**
 * Recomendación: entre las varillas que caben (de preferencia de 1/2" o más),
 * la que desperdicia menos acero; si empatan, la que usa menos varillas.
 * Si ninguna cabe, la que deja más espacio entre varillas.
 */
export function recomendar(opciones) {
  const orden = (x, y) => (x.exceso - y.exceso) || (x.n - y.n);
  const practicas = opciones.filter(o => o.cabe && o.varilla.pulgadas >= DIAM_MIN_RECOMENDADO_PULG);
  const candidatas = practicas.length ? practicas : opciones.filter(o => o.cabe);
  if (candidatas.length) return [...candidatas].sort(orden)[0];
  // Ninguna cabe: se propone la que queda menos apretada (si empatan, la de menos desperdicio),
  // en vez de la de menos acero, que suele ser cientos de varillas de 3/8".
  return [...opciones].sort((x, y) => (y.sepLibre - x.sepLibre) || orden(x, y))[0];
}

/**
 * Cálculo completo.
 * entrada: { ancho, largo, porcentaje, diametroId ('auto' o el id de una varilla) }
 */
export function calcular({ ancho, largo, porcentaje, diametroId }) {
  const areaCol = ancho * largo;
  const asReq = (areaCol * porcentaje) / 100;
  const datos = { ancho, largo, porcentaje, areaCol, asReq };

  const opciones = VARILLAS.map(v => calcularOpcion(v, datos));
  const mejor = recomendar(opciones);
  const auto = diametroId === 'auto';
  const elegida = auto ? mejor : (opciones.find(o => o.varilla.id === diametroId) || mejor);

  return { ...datos, opciones, mejor, elegida, auto };
}

/** Posición (en cm) de cada varilla dentro de la sección, para dibujar el croquis. */
export function posicionesVarillas(opcion, b, h) {
  const db = diametroCm(opcion.varilla);
  const o = RECUBRIMIENTO_CM + DIAM_ESTRIBO_CM + db / 2;
  const xi = o, xf = b - o, yi = o, yf = h - o;
  const pts = [];
  const { arriba, abajo, izq, der } = opcion.dist;

  for (let i = 0; i < arriba; i++) pts.push({ x: xi + (xf - xi) * i / (arriba - 1), y: yi, db, cara: 'arriba' });
  for (let i = 0; i < abajo; i++) pts.push({ x: xi + (xf - xi) * i / (abajo - 1), y: yf, db, cara: 'abajo' });
  for (let i = 1; i <= izq; i++) pts.push({ x: xi, y: yi + (yf - yi) * i / (izq + 1), db, cara: 'izq' });
  for (let i = 1; i <= der; i++) pts.push({ x: xf, y: yi + (yf - yi) * i / (der + 1), db, cara: 'der' });
  return pts;
}
