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

## Checklist rapido antes de cerrar un cambio

1. Recargar espacio/index.html y verificar que renderiza.
2. Revisar consola por errores nuevos (warnings de resize de textura pueden existir).
3. Confirmar que no se rompio audio reactivo ni tours de camara/sonda.
