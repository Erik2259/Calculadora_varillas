# Calculadora de Varillas (PWA)

Recibe las medidas de una columna rectangular y el porcentaje de acero que quieres. Con eso calcula cuánta área de acero hace falta y propone cuántas varillas usar y de qué diámetro. Muestra un croquis de la columna con las varillas y avisa si caben o si quedan muy juntas.

Funciona sin internet (después de la primera carga) y se puede instalar como aplicación.

## Archivos

```
Calculadora_varillas/
├── index.html          La página: formulario, resultado, croquis e historial
├── style.css           Estilos (claro/oscuro automático, celular y computadora)
├── calc.js             Solo los cálculos (no toca la pantalla)
├── app.js              La interfaz: lee el formulario, dibuja el croquis, historial
├── sw.js               Service Worker: guarda la app para usarla sin internet
├── manifest.json       Datos para instalar la app (nombre, íconos, colores)
├── tests/
│   └── calc.test.mjs   Pruebas de los cálculos
├── icons/              Íconos de la app
└── assets/logo.svg     Logo
```

## Cómo calcula

1. **Área de la columna** = ancho × largo
2. **Acero necesario** = área × porcentaje / 100
3. **Área de una varilla** = π × diámetro² / 4 (1" = 2.54 cm)
4. **Número de varillas** = acero necesario ÷ área de una varilla, redondeado hacia arriba, con mínimo 4 (una por esquina) y en número par (para que queden parejas)
5. **¿Caben?** El espacio entre varillas debe ser de al menos 4 cm (o 1.5 veces el diámetro, lo que sea mayor), considerando 4 cm de recubrimiento y un estribo de 3/8".

**Automático:** revisa todas las varillas y recomienda la que desperdicia menos acero entre las de 1/2" o más que caben.

| Varilla | Diámetro (cm) | Área (cm²) |
|---|---:|---:|
| 3/8" (#3) | 0.95 | 0.71 |
| 1/2" (#4) | 1.27 | 1.27 |
| 5/8" (#5) | 1.59 | 1.98 |
| 3/4" (#6) | 1.91 | 2.85 |
| 1" (#8) | 2.54 | 5.07 |
| 1 1/4" (#10) | 3.18 | 7.92 |

**Ejemplo:** columna de 30 × 45 cm al 2 % → área 1,350 cm² → acero necesario 27.00 cm² → con varilla de 5/8" (1.98 cm² c/u): 27.00 ÷ 1.98 = 13.6 → **14 varillas de 5/8"** (27.71 cm²), con 4.6 cm entre varillas: sí caben.

## Ejecutar en localhost

El Service Worker solo funciona en `http://localhost` o `https://`, así que no basta con abrir `index.html` con doble clic. Desde la carpeta del proyecto:

```bash
python -m http.server 8080
```

Y abrir `http://localhost:8080` en el navegador.

## Instalar como aplicación

En Chrome o Edge aparece el botón **Instalar** arriba a la derecha (o el ícono de instalar en la barra de direcciones). En el celular: menú del navegador → *Agregar a la pantalla principal*.

## Sin internet y actualizaciones

- En la primera visita se guardan todos los archivos. Después la app abre y calcula sin internet.
- Para publicar cambios, sube el número de `CACHE_VERSION` en `sw.js`; la app mostrará "Hay una nueva versión de la app" con el botón **Actualizar**.

## Historial

Los últimos 20 cálculos se guardan en el dispositivo (`localStorage`). Tocar uno lo vuelve a abrir.

## Pruebas

```bash
node --test tests/calc.test.mjs
```

## Widget de Windows 11

Con la app instalada en Windows 11 (Edge o Chrome), abre el panel de widgets (**Win + W**) → *Agregar widgets* → **Último cálculo**. Muestra la última columna calculada y tiene los botones *Abrir calculadora* y *Nuevo cálculo*. Está definido en `manifest.json` (`widgets`), con la tarjeta adaptable en `widgets/` y la lógica en `sw.js`. Para probarlo se necesita WinAppSDK 1.2 y el modo de desarrollador activado; para publicarlo en Microsoft Store, empaquétala con PWABuilder desde una URL pública.
