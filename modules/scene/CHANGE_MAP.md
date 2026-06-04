# Mapa de Cambios de Escena 3D

Este archivo indica donde modificar cada comportamiento de la experiencia en espacio/.

## Punto de entrada

- Entrada principal de escena: ../scene.js
- Inicializacion publica: sceneInit()

## Donde tocar segun objetivo

- Ajustar curvas matematicas, mapeos y helpers de render:
  - sceneUtils.js
  - Funciones: mapRange, solveKeplerEccentricAnomaly, getSphereSegments

- Cambiar estetica de texto cosmico (tipografia, glow, escala sprite):
  - sceneUtils.js
  - Funcion: makeTextSprite

- Ajustar shader de atmosfera tipo fresnel:
  - sceneUtils.js
  - Funcion: createFresnelAtmosphere

- Cambiar comportamiento o look de particulas de Marte:
  - marsParticles.js
  - Funcion principal: addMarsParticles

- Cambiar fases de recorrido, transiciones orbitales o switch automatico entre modos:
  - toursController.js
  - API principal: createToursController

- Cambiar teclado, resize o HUD de FPS:
  - uiController.js
  - API principal: createUiController

- Cambiar respuesta visual al audio (sol, probe, trails, atmosferas):
  - reactiveController.js
  - API principal: createReactiveController

- Cambiar aparicion, desplazamiento o fade del texto cosmico:
  - cosmicTextController.js
  - API principal: createCosmicTextController

- Cambiar parametros por defecto de tours, camara y estado inicial:
  - sceneStateFactory.js
  - Funciones: createSceneState, createAnimationConfig

- Cambiar creacion de planetas, orden de recorrido o wiring general:
  - ../scene.js
  - Buscar: addPlanet, startProbeTour, startPlanetTour, animate

- Cambiar teclas o modos de camara (top-down / orbita):
  - ../scene.js
  - Funcion: onKeyDown

- Cambiar input de teclado y resize:
  - ../scene.js
  - Funciones: onKeyDown, onWindowResize

## Regla de mantenimiento

Cuando una logica es reutilizable o puramente de configuracion, moverla a este directorio scene/ y dejar scene.js como orquestador.

## Opciones de rendimiento por cuerpo (scene.definition.json -> scene3d.bodies[])

- `materialType`: `"lambert"` (por defecto, mas rapido) | `"standard"` (PBR completo) | `"phong"` (caso especial con displacement).
  Con `roughness: 0.82` / `metalness: 0.02` el cambio a Lambert es visualmente identico.
  Para volver a PBR en un cuerpo concreto, agregar `"materialType": "standard"` en su entrada.
- La Luna (`mode: "displacement"`) siempre usa Phong para conservar el `displacementMap`.
- La Sonda (probe) sigue usando MeshStandardMaterial por su `emissive`.

## Reactividad de la sonda al audio (scene.definition.json -> scene3d.reactive)

- `probeSensitivity` (default `1.5`): indice multiplicador del drive final. `1.0` = neutro, `2.0` = doble de visible.
- `probeResponseCurve` (default `1.6`): exponente de la curva de respuesta.
  - `1.0` = crecimiento lineal al nivel del audio.
  - `>1.0` = picos se ven mas (ej. `1.6` acentua transitorios sin saturar bajos).
  - `<1.0` = mas reactivo en bajos (ej. `0.5` = raiz cuadrada).
- Ambos aplican ademas del `transientBoost` que ya existia para pegadas rapidas.

## Estela de la sonda (cola de cometa)

- La cadena de 6 esferas se reemplazo por un `Mesh` con `ShaderMaterial` propio (ver `../scene.js` -> bloque "Comet-style ribbon trail").
- Buffer circular de las ultimas `60` posiciones de la sonda. Cada frame se reconstruye como tira con vertices `center +/- side * width`.
- Ancho cónico: `5.5` en la cabeza, `0.3` en la cola (`PROBE_RIBBON_WIDTH_HEAD` / `PROBE_RIBBON_WIDTH_TAIL`).
- Shader combina:
  - `core` (alpha `pow(side, 8)`): nucleo brillante y estrecho.
  - `halo` (alpha `pow(side, 1.6)`): coma suave y ancha.
  - Color gradiente `uTailColor` -> `uHeadColor`, con `uHotColor` anadido en la cabeza cuando hay drive alto.
  - `shimmer` organico `sin(vT * 30 - uTime * 2)` para que la cola no se vea estatica.
- `uDrive` y `uHeadColor` se enchufan desde `reactiveController` cada frame.
- Las 64 particulas de la nube se mantienen como "ion spray" chispeante; el origen se acerco de 9 a 2.5 unidades detras de la sonda.

## Ajustes globales de rendimiento (scene.definition.json -> scene3d.renderer)

- `antialias: false` ya esta activo. En pantallas pequenas o moviles considerar `"maxPixelRatio": 1` para mejorar FPS.
- `powerPreference: "high-performance"` prioriza GPU discreta cuando existe.

## Checklist rapido antes de cerrar un cambio

1. Recargar espacio/index.html y verificar que renderiza.
2. Revisar consola por errores nuevos (warnings de resize de textura pueden existir).
3. Confirmar que no se rompio audio reactivo ni tours de camara/sonda.
