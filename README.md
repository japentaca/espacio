# ESPACIO

Experiencia inmersiva 3D para web, enfocada en exploracion espacial, visuales audio-reactivos y arquitectura modular con configuracion declarativa.

## Resumen

ESPACIO es un proyecto frontend estatico que renderiza una escena 3D en navegador usando modulos JavaScript y recursos multimedia (texturas, audio, efectos visuales).

El arranque y comportamiento principal se controlan desde un archivo de configuracion JSON, para facilitar mantenimiento y evoluciones sin hardcodear reglas en multiples modulos.

## Caracteristicas

- Escena 3D modular con responsabilidades separadas.
- Configuracion declarativa de escena en scene.definition.json.
- Sistema de audio por colas y sets.
- Controladores especializados para tours, UI, texto cosmico y reactividad.
- Proyecto apto para desarrollo local y GitHub Codespaces.

## Stack

- HTML5
- CSS3
- JavaScript ES Modules
- Three.js

## Estructura sugerida

```text
.
|-- index.html
|-- index.css
|-- scene.definition.json
|-- favicon.svg
|-- favicon.ico
|-- css/
|-- img/
|-- audio/
|   |-- set2/
|   `-- set4/
|-- lib/
|-- modules/
|   |-- scene.js
|   |-- audio.js
|   |-- audioSet.js
|   |-- mixer/
|   `-- scene/
|       |-- CHANGE_MAP.md
|       |-- sceneUtils.js
|       |-- sceneStateFactory.js
|       |-- toursController.js
|       |-- uiController.js
|       |-- reactiveController.js
|       `-- cosmicTextController.js
|-- rio/
`-- README.md
```

## Inicio rapido (local)

Requisito: servidor HTTP local (no abrir index.html con file://).

### Opcion A: Python

```bash
python -m http.server 8000
```

Abrir en navegador:

```text
http://localhost:8000/
```

### Opcion B: Node.js

```bash
npx serve -l 8000
```

## Inicio rapido (GitHub Codespaces)

1. Abrir el repositorio en GitHub.
2. Ir a Code > Codespaces > Create codespace on main.
3. En la terminal del Codespace ejecutar:

```bash
python -m http.server 8000
```

4. Abrir el puerto 8000 cuando GitHub lo detecte.
5. Acceder a la URL publicada del Codespace.

Nota:

- Si no hay configuracion de devcontainer, el flujo sigue siendo valido porque este proyecto es estatico.
- Verificar que el puerto 8000 quede en visibilidad Public o segun necesidad de acceso.

## Configuracion principal

Archivo clave: scene.definition.json

Campos esperados:

- initializeScene: habilita/deshabilita arranque de escena 3D.
- scene3d: definicion de camara, luces, planetas, orbitas y efectos.
- baseTracks: grupos de tracks con crossfade y hold.
- audioSetLibrary: diccionario de sets de audio disponibles.
- audioQueue: orden de reproduccion por ids o definiciones inline.

Compatibilidad:

- El runtime prioriza audioQueue y mantiene soporte legacy para audioSets como fallback.

Ejemplo conceptual de baseTracks:

```json
{
  "tracks": ["./audio/a.mp3", "./audio/b.mp3"],
  "crossfadeSec": 10,
  "holdSec": 32,
  "volumeDb": -3
}
```

## Mantenimiento

- Orquestador principal: modules/scene.js
- Utilidades y shaders: modules/scene/sceneUtils.js
- Estado inicial y defaults: modules/scene/sceneStateFactory.js
- Tours orbitales: modules/scene/toursController.js
- Input, resize y HUD: modules/scene/uiController.js
- Visuales audio-reactivos: modules/scene/reactiveController.js
- Texto cosmico: modules/scene/cosmicTextController.js

Recomendacion:

- Mantener un CHANGE_MAP.md actualizado en modules/scene/ para facilitar trabajo colaborativo.

## Flujo de deploy recomendado

1. Validar localmente que rutas relativas cargan bien.
2. Confirmar que no hay 404 en texturas, audio y modulos.
3. Publicar archivos en hosting estatico.
4. Forzar recarga en navegador despues de deploy.

## Checklist de validacion

- La escena inicia sin errores de consola.
- Se cargan texturas de cuerpos celestes.
- Se reproducen tracks de audio esperados.
- Tours, UI y elementos reactivos responden correctamente.
- Rendimiento estable en desktop y mobile.

## Roadmap sugerido

- Integrar pipeline de assets (optimizacion de imagenes/audio).
- Agregar verificacion automatica de rutas de recursos.
- Definir versionado semantico y changelog.
- Documentar presets de calidad grafica por dispositivo.

## Licencia

Estado actual: sin licencia explicita.

Hasta definir una licencia, aplicar criterio de "todos los derechos reservados" para uso externo.
