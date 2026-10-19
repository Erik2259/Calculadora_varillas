/* Pruebas de los cálculos (calc.js).
   Ejecutar desde la carpeta del proyecto:  node --test tests/calc.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../calc.js';

const cerca = (real, esperado, tol = 0.01) =>
  assert.ok(Math.abs(real - esperado) <= tol, `esperado ≈ ${esperado}, obtenido ${real}`);
const varilla = (id) => C.VARILLAS.find(v => v.id === id);

test('área de cada varilla', () => {
  const esperadas = { '3/8': 0.71, '1/2': 1.27, '5/8': 1.98, '3/4': 2.85, '1': 5.07, '1-1/4': 7.92 };
  for (const [id, a] of Object.entries(esperadas)) cerca(C.areaVarilla(varilla(id)), a);
});

test('área de la columna y acero necesario', () => {
  const r = C.calcular({ ancho: 30, largo: 45, porcentaje: 2, diametroId: 'auto' });
  assert.equal(r.areaCol, 1350);
  cerca(r.asReq, 27);
});

test('número de varillas: hacia arriba, mínimo 4 y par', () => {
  assert.equal(C.numeroVarillas(1, 1.27).n, 4);        // 0.79 → 1 → mínimo 4
  assert.equal(C.numeroVarillas(4.8, 1.27).n, 4);      // 3.78 → 4
  assert.equal(C.numeroVarillas(6, 1.27).n, 6);        // 4.72 → 5 → par 6
  assert.equal(C.numeroVarillas(10.16, 1.27).n, 8);    // exacto 8, no suma una de más
});

test('reparto: 4 esquinas y el resto en pares hacia la cara con más espacio', () => {
  assert.deepEqual(C.distribuirVarillas(4, 20, 20), { arriba: 2, abajo: 2, izq: 0, der: 0 });
  assert.deepEqual(C.distribuirVarillas(6, 40, 20), { arriba: 3, abajo: 3, izq: 0, der: 0 });
  assert.deepEqual(C.distribuirVarillas(6, 20, 40), { arriba: 2, abajo: 2, izq: 1, der: 1 });
});

test('espacio entre varillas y mínimo de 4 cm', () => {
  const s = C.revisarSeparacion(4, 1.27, 30, 30);
  const l = 30 - 2 * (4 + C.DIAM_ESTRIBO_CM + 1.27 / 2);
  cerca(s.sepLibre, l - 1.27);
  assert.equal(s.sMin, 4);
  assert.equal(s.cabe, true);
  assert.equal(C.revisarSeparacion(4, 1.27, 10, 10).cabe, false);   // columna demasiado chica
});

test('ejemplo 30 × 45 cm al 2 %: 14 varillas de 5/8"', () => {
  const r = C.calcular({ ancho: 30, largo: 45, porcentaje: 2, diametroId: 'auto' });
  assert.equal(r.elegida.varilla.id, '5/8');
  assert.equal(r.elegida.n, 14);
  cerca(r.elegida.asProp, 27.71);
  assert.equal(r.elegida.cabe, true);
});

test('automático: si ninguna de 1/2" o más cabe, usa la de 3/8"', () => {
  const r = C.calcular({ ancho: 16, largo: 30, porcentaje: 1, diametroId: 'auto' });
  assert.equal(r.elegida.varilla.id, '3/8');
  assert.equal(r.elegida.cabe, true);
});

test('varilla elegida a mano que no cabe', () => {
  const r = C.calcular({ ancho: 20, largo: 20, porcentaje: 4, diametroId: '5/8' });
  assert.equal(r.elegida.varilla.id, '5/8');
  assert.equal(r.elegida.cabe, false);
  assert.ok(r.mejor.cabe, 'la recomendada sí cabe');
});

test('croquis: una posición por varilla, dentro de la columna', () => {
  const r = C.calcular({ ancho: 30, largo: 45, porcentaje: 2, diametroId: 'auto' });
  for (const o of r.opciones.filter(x => x.cabe)) {
    const pts = C.posicionesVarillas(o, 30, 45);
    assert.equal(pts.length, o.n);
    for (const p of pts) assert.ok(p.x > 0 && p.x < 30 && p.y > 0 && p.y < 45);
  }
});

test('si ninguna varilla cabe, se recomienda la que queda menos apretada', async () => {
  const C = await import('../calc.js');
  const r = C.calcular({ ancho: 100, largo: 100, porcentaje: 10, diametroId: 'auto' });
  assert.equal(r.mejor.cabe, false);
  const maxSep = Math.max(...r.opciones.map(o => o.sepLibre));
  assert.equal(r.mejor.sepLibre, maxSep);
  assert.ok(r.mejor.n < 500);
});
