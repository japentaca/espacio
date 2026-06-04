'use strict';
// Import audio module
import audio from "./audio.js?v=20260524a";
import { createSceneState, createAnimationConfig } from "./scene/sceneStateFactory.js";
import {
    makeTextSprite,
    mapRange,
    solveKeplerEccentricAnomaly,
    getSphereSegments,
    createFresnelAtmosphere
} from "./scene/sceneUtils.js";
import { addMarsParticles } from "./scene/marsParticles.js";
import { createToursController } from "./scene/toursController.js";
import { createUiController } from "./scene/uiController.js";
import { createReactiveController } from "./scene/reactiveController.js";
import { createCosmicTextController } from "./scene/cosmicTextController.js";

// Maintenance index:
// - Shared math/render helpers: ./scene/sceneUtils.js
// - Mars particle systems: ./scene/marsParticles.js
// - Scene defaults and tunings: ./scene/sceneStateFactory.js
// - Camera/probe orbit tours: ./scene/toursController.js
// - Input/resize/FPS HUD: ./scene/uiController.js
// - Audio-reactive visuals: ./scene/reactiveController.js
// - Cosmic text spawn/update: ./scene/cosmicTextController.js

// Main export object with function references
export default {
    init: sceneInit,
    initAudio: initAudio,
    audio,
    toggleAudio,
    addBase,
    addAudioSet
};

// Global variables
const myPlanets = [];
const myParticles = [];
let sceneEnabled = true;
const marsParticleTextures = {
    ember: null,
    smoke: null
};

// Shared texture loader and cache. Each call to new THREE.TextureLoader().load()
// used to create a fresh loader; the cache also avoids the same image being
// fetched twice when it appears in multiple bodies.
const sharedTextureLoader = new THREE.TextureLoader();
const textureCache = new Map();
function loadTexture(path) {
    if (!path) {
        return null;
    }
    if (textureCache.has(path)) {
        return textureCache.get(path);
    }
    const tex = sharedTextureLoader.load(path);
    textureCache.set(path, tex);
    return tex;
}

function createBodyMaterial(materialType, texture, extra) {
    const opts = Object.assign({}, extra || {});
    if (texture) {
        opts.map = texture;
    }
    const type = materialType || 'lambert';
    if (type === 'standard') {
        return new THREE.MeshStandardMaterial({
            roughness: 0.82,
            metalness: 0.02,
            ...opts
        });
    }
    if (type === 'phong') {
        return new THREE.MeshPhongMaterial(opts);
    }
    return new THREE.MeshLambertMaterial(opts);
}

// Cosmic text overlay state
let spawnCosmicTextFn = null;

// Scratch vector reused in hot animation loops to avoid per-frame allocations.
const probeScratchVecA = new THREE.Vector3();

// Audio control functions
function toggleAudio() {
    Tone.start();
    sceneEnabled = !sceneEnabled;
}

function addBase(path) {
    audio.addBase(path);
}

function addAudioSet(set) {
    const hasText = Array.isArray(set.files) && set.files.some(f => f.text);
    const intervalMin = (set.parms && set.parms.interval) ? set.parms.interval.min : 9;
    const onText = hasText
        ? (payload) => {
            if (!spawnCosmicTextFn) {
                return;
            }

            if (typeof payload === 'string') {
                spawnCosmicTextFn(payload, intervalMin, 0);
                return;
            }

            if (payload && typeof payload === 'object' && payload.text) {
                const clipDurationMs = Number(payload.durationMs);
                const intervalSec = Number.isFinite(payload.intervalSec) ? Number(payload.intervalSec) : intervalMin;
                const nextAudioInMs = Number(payload.nextAudioInMs);
                spawnCosmicTextFn(payload.text, intervalSec, clipDurationMs, nextAudioInMs);
            }
        }
        : null;
    audio.addAudioSet(set, onText);
}

function initAudio(audioMixerConfig) {
    audio.init(audioMixerConfig);
}

// Creates a planet with appropriate texture and orbit
function addPlanet(parent, radius, distance, rotationSpeed, translationSpeed, initialRotation, texturePath, orbitProfile = null, tidalLock = false, tidalLockOffset = 0, materialType = 'lambert') {
    const texture = loadTexture(texturePath);
    const segments = getSphereSegments(radius);
    const geometry = new THREE.SphereBufferGeometry(radius, segments.width, segments.height);
    const material = createBodyMaterial(materialType, texture);
    const mesh = new THREE.Mesh(geometry, material);
    
    mesh.name = `Planet ${myPlanets.length + 1}`;
    mesh.position.set(distance, 0, 0);
    
    const pivot = new THREE.Group();
    pivot.add(mesh);
    pivot.name = `Pivot ${myPlanets.length + 1}`;
    // Keep pivot at parent's local origin so child orbits are local, not double-offset.
    pivot.position.set(0, 0, 0);
    
    const planetData = { 
        mesh, 
        pivot, 
        parent, 
        radius, 
        distance, 
        rotationSpeed, 
        translationSpeed, 
        texture,
        tidalLock: Boolean(tidalLock),
        tidalLockOffset: Number(tidalLockOffset || 0),
        orbit: orbitProfile || {
            semiMajorAxis: distance,
            eccentricity: 0,
            inclination: 0,
            longitude: 0,
            meanMotion: translationSpeed,
            phase: 0
        }
    };
    
    myPlanets.push(planetData);
    parent.add(pivot);
    
    return mesh;
}

const DEFAULT_SCENE3D_CONFIG = {
    camera: {
        fov: 70,
        near: 1,
        far: 9000,
        position: { x: 0, y: 0, z: 800 }
    },
    sun: {
        radius: 100,
        segments: { width: 64, height: 48 },
        texturePath: './img/1k_sun.jpg',
        rotationSpeedY: 0.0007,
        glow: {
            radius: 114,
            segments: { width: 32, height: 22 },
            color: '#ffbb66',
            opacity: 0.06
        },
        light: {
            color: '#ffb84d',
            intensity: 1.15,
            distance: 2400
        }
    },
    lights: {
        ambient: {
            color: '#2f3c58',
            intensity: 0.26
        },
        hemisphere: {
            skyColor: '#6f8fc5',
            groundColor: '#1a0f08',
            intensity: 0.34,
            position: { x: 0, y: 1, z: 0 }
        }
    },
    sky: {
        radius: 5000,
        segments: { width: 48, height: 28 },
        texturePath: './img/2k_stars_milky_way.jpg',
        rotationSpeed: { x: 0.0006, y: 0.0005, z: -0.0004 }
    },
    renderer: {
        antialias: false,
        powerPreference: 'high-performance',
        maxPixelRatio: 1.5
    },
    bodies: [
        {
            key: 'mars',
            parent: 'sun',
            radius: 18,
            distance: 520,
            rotationSpeed: 0.003,
            translationSpeed: 0.009,
            texturePath: './img/1k_mars.jpg',
            orbit: { semiMajorAxis: 520, eccentricity: 0.093, inclinationDeg: 1.85, longitudeDeg: 49.5, meanMotion: 0.0052, phase: 1.2 }
        },
        {
            key: 'mercury',
            parent: 'sun',
            radius: 9,
            distance: 150,
            rotationSpeed: 0.0085,
            translationSpeed: 0.011,
            texturePath: './img/2k_mercury.jpg',
            orbit: { semiMajorAxis: 150, eccentricity: 0.205, inclinationDeg: 7, longitudeDeg: 48.3, meanMotion: 0.36, phase: 0.7 }
        },
        {
            key: 'venus',
            parent: 'sun',
            radius: 15,
            distance: 220,
            rotationSpeed: 0.006,
            translationSpeed: 0.007,
            texturePath: './img/1k_venus_surface.jpg',
            orbit: { semiMajorAxis: 220, eccentricity: 0.01, inclinationDeg: 3.4, longitudeDeg: 76.7, meanMotion: 0.279, phase: 3.4 },
            atmosphere: { radius: 16.9, color: '#f3b77a', power: 3.2, intensity: 0.58 }
        },
        {
            key: 'earth',
            parent: 'sun',
            radius: 16,
            distance: 390,
            rotationSpeed: 0.0055,
            translationSpeed: 0.0086,
            texturePath: './img/earth_day_4096.jpg',
            orbit: { semiMajorAxis: 390, eccentricity: 0.0167, inclinationDeg: 0.4, longitudeDeg: 11.3, meanMotion: 0.0062, phase: 2.15 },
            atmosphere: { radius: 17.6, color: '#5faeff', power: 3.9, intensity: 0.52 }
        },
        {
            key: 'earthMoon',
            parent: 'earth',
            mode: 'displacement',
            radius: 3.4,
            distance: 52,
            rotationSpeed: 0.028,
            translationSpeed: 0.028,
            tidalLock: true,
            tidalLockOffset: 3.141592653589793,
            texturePath: './img/pv_moon_213_moon.jpg',
            displacementMapPath: './img/moon_ldem_3_8bit.jpg',
            displacementScale: 0.32,
            shininess: 5,
            segmentBoost: { width: 8, height: 6 },
            orbit: { semiMajorAxis: 52, eccentricity: 0.055, inclinationDeg: 18, longitudeDeg: 28, meanMotion: 0.028, phase: 0.9 }
        },
        {
            key: 'jupiter',
            parent: 'sun',
            radius: 38,
            distance: 860,
            rotationSpeed: 0.003,
            translationSpeed: 0.006,
            texturePath: './img/1k_jupiter.jpg',
            orbit: { semiMajorAxis: 860, eccentricity: 0.049, inclinationDeg: 1.3, longitudeDeg: 100.5, meanMotion: 0.0027, phase: 5 }
        },
        {
            key: 'saturn',
            parent: 'sun',
            radius: 31,
            distance: 1200,
            rotationSpeed: 0.0024,
            translationSpeed: 0.0048,
            texturePath: './img/2k_saturn.jpg',
            orbit: { semiMajorAxis: 1200, eccentricity: 0.056, inclinationDeg: 2.5, longitudeDeg: 113.7, meanMotion: 0.0032, phase: 0.6 },
            rings: {
                innerRadius: 46,
                outerRadius: 74,
                segments: 96,
                texturePath: './img/2k_saturn_ring_alpha.png',
                opacity: 0.86,
                tiltDeg: 80
            }
        },
        {
            key: 'uranus',
            parent: 'sun',
            radius: 28,
            distance: 1450,
            rotationSpeed: 0.0024,
            translationSpeed: 0.0034,
            texturePath: './img/2k_uranus.jpg',
            orbit: { semiMajorAxis: 1450, eccentricity: 0.047, inclinationDeg: 0.8, longitudeDeg: 74, meanMotion: 0.0042, phase: 1.9 }
        },
        {
            key: 'neptune',
            parent: 'sun',
            radius: 27,
            distance: 1780,
            rotationSpeed: 0.0022,
            translationSpeed: 0.003,
            texturePath: './img/2k_neptune.jpg',
            orbit: { semiMajorAxis: 1780, eccentricity: 0.009, inclinationDeg: 1.8, longitudeDeg: 131.8, meanMotion: 0.0035, phase: 4.2 }
        },
        {
            key: 'phobos',
            parent: 'mars',
            radius: 2.4,
            distance: 28,
            rotationSpeed: 0.012,
            translationSpeed: 0.055,
            texturePath: './img/pv_moon_215_phobos.jpg',
            orbit: { semiMajorAxis: 28, eccentricity: 0.018, inclinationDeg: 24, longitudeDeg: 5, meanMotion: 0.055, phase: 0.3 }
        },
        {
            key: 'deimos',
            parent: 'mars',
            radius: 1.8,
            distance: 40,
            rotationSpeed: 0.01,
            translationSpeed: 0.038,
            texturePath: './img/pv_moon_201_deimos.jpg',
            orbit: { semiMajorAxis: 40, eccentricity: 0.012, inclinationDeg: 34, longitudeDeg: 88, meanMotion: 0.038, phase: 2.1 }
        },
        {
            key: 'io',
            parent: 'jupiter',
            radius: 4.4,
            distance: 66,
            rotationSpeed: 0.01,
            translationSpeed: 0.05,
            texturePath: './img/pv_moon_209_io.jpg',
            orbit: { semiMajorAxis: 66, eccentricity: 0.004, inclinationDeg: 12, longitudeDeg: 140, meanMotion: 0.05, phase: 1.4 }
        },
        {
            key: 'europa',
            parent: 'jupiter',
            radius: 4.1,
            distance: 78,
            rotationSpeed: 0.009,
            translationSpeed: 0.041,
            texturePath: './img/pv_moon_205_europa.jpg',
            orbit: { semiMajorAxis: 78, eccentricity: 0.009, inclinationDeg: 26, longitudeDeg: 220, meanMotion: 0.041, phase: 3.1 }
        },
        {
            key: 'ganymede',
            parent: 'jupiter',
            radius: 5,
            distance: 93,
            rotationSpeed: 0.008,
            translationSpeed: 0.032,
            texturePath: './img/pv_moon_206_ganymede.jpg',
            orbit: { semiMajorAxis: 93, eccentricity: 0.002, inclinationDeg: 37, longitudeDeg: 300, meanMotion: 0.032, phase: 5.5 }
        },
        {
            key: 'callisto',
            parent: 'jupiter',
            radius: 4.8,
            distance: 112,
            rotationSpeed: 0.007,
            translationSpeed: 0.021,
            tidalLock: true,
            texturePath: './img/callisto_real.png',
            orbit: { semiMajorAxis: 112, eccentricity: 0.007, inclinationDeg: 14, longitudeDeg: 26, meanMotion: 0.021, phase: 2.7 }
        },
        {
            key: 'titan',
            parent: 'saturn',
            radius: 4.8,
            distance: 88,
            rotationSpeed: 0.009,
            translationSpeed: 0.023,
            texturePath: './img/pv_moon_221_titan.jpg',
            orbit: { semiMajorAxis: 88, eccentricity: 0.029, inclinationDeg: 21, longitudeDeg: 170, meanMotion: 0.023, phase: 0.8 }
        },
        {
            key: 'enceladus',
            parent: 'saturn',
            radius: 1.2,
            distance: 58,
            rotationSpeed: 0.011,
            translationSpeed: 0.038,
            tidalLock: true,
            texturePath: './img/enceladus_real.jpg',
            orbit: { semiMajorAxis: 58, eccentricity: 0.0047, inclinationDeg: 28, longitudeDeg: 81, meanMotion: 0.038, phase: 1.6 }
        },
        {
            key: 'rhea',
            parent: 'saturn',
            radius: 2.9,
            distance: 82,
            rotationSpeed: 0.009,
            translationSpeed: 0.029,
            tidalLock: true,
            texturePath: './img/rhea_real.jpg',
            orbit: { semiMajorAxis: 82, eccentricity: 0.001, inclinationDeg: 27, longitudeDeg: 212, meanMotion: 0.029, phase: 5.2 }
        },
        {
            key: 'iapetus',
            parent: 'saturn',
            radius: 2.8,
            distance: 168,
            rotationSpeed: 0.004,
            translationSpeed: 0.011,
            tidalLock: true,
            texturePath: './img/iapetus_real.png',
            orbit: { semiMajorAxis: 168, eccentricity: 0.028, inclinationDeg: 43, longitudeDeg: 310, meanMotion: 0.011, phase: 3.9 }
        },
        {
            key: 'triton',
            parent: 'neptune',
            radius: 4.2,
            distance: 72,
            rotationSpeed: 0.009,
            translationSpeed: 0.02,
            texturePath: './img/pv_moon_223_triton.jpg',
            orbit: { semiMajorAxis: 72, eccentricity: 0, inclinationDeg: 140, longitudeDeg: 250, meanMotion: 0.02, phase: 4 }
        },
        {
            key: 'marsMoonClassic',
            parent: 'mars',
            radius: 4,
            distance: 42,
            rotationSpeed: 0.008,
            translationSpeed: 0.005,
            texturePath: './img/1k_moon.jpg',
            orbit: { semiMajorAxis: 42, eccentricity: 0.035, inclinationDeg: 5.1, longitudeDeg: 12, meanMotion: 0.021, phase: 2.3 }
        }
    ],
    probeTargetKeys: ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'],
    cameraTourTargetKeys: ['earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'],
    marsEffects: {
        aura: {
            color: '#ff4d1f',
            intensity: 1.1,
            distance: 210
        },
        trails: {
            count: 4,
            baseRadius: 3.6,
            radiusStep: 0.5,
            color: '#ff5a2a',
            baseOpacity: 0.14,
            opacityStep: 0.02
        }
    }
};

function cloneConfigValue(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

function mergeSceneConfig(baseValue, overrideValue) {
    if (Array.isArray(baseValue)) {
        return Array.isArray(overrideValue) ? cloneConfigValue(overrideValue) : cloneConfigValue(baseValue);
    }

    if (!baseValue || typeof baseValue !== 'object') {
        return (overrideValue === undefined) ? baseValue : overrideValue;
    }

    const result = { ...baseValue };
    if (!overrideValue || typeof overrideValue !== 'object' || Array.isArray(overrideValue)) {
        return result;
    }

    Object.keys(overrideValue).forEach((key) => {
        const overrideField = overrideValue[key];
        const baseField = baseValue[key];

        if (Array.isArray(overrideField)) {
            result[key] = cloneConfigValue(overrideField);
            return;
        }

        if (overrideField && typeof overrideField === 'object' && baseField && typeof baseField === 'object' && !Array.isArray(baseField)) {
            result[key] = mergeSceneConfig(baseField, overrideField);
            return;
        }

        result[key] = overrideField;
    });

    return result;
}

function buildScene3dConfig(scene3dConfig) {
    return mergeSceneConfig(DEFAULT_SCENE3D_CONFIG, scene3dConfig || {});
}

function toOrbitProfile(orbitConfig, distance, translationSpeed) {
    const orbit = orbitConfig || {};
    const inclination = (typeof orbit.inclination === 'number')
        ? orbit.inclination
        : THREE.MathUtils.degToRad(Number(orbit.inclinationDeg || 0));
    const longitude = (typeof orbit.longitude === 'number')
        ? orbit.longitude
        : THREE.MathUtils.degToRad(Number(orbit.longitudeDeg || 0));

    return {
        semiMajorAxis: (typeof orbit.semiMajorAxis === 'number') ? orbit.semiMajorAxis : distance,
        eccentricity: (typeof orbit.eccentricity === 'number') ? orbit.eccentricity : 0,
        inclination,
        longitude,
        meanMotion: (typeof orbit.meanMotion === 'number') ? orbit.meanMotion : translationSpeed,
        phase: (typeof orbit.phase === 'number') ? orbit.phase : 0
    };
}


// Main scene initialization function
function sceneInit(scene3dConfig) {
    const runtimeSceneConfig = buildScene3dConfig(scene3dConfig);
    
    let camera, scene, renderer;
    let sunObj, skyObj;
    let sunGlow = null;
    let sunLight = null;
    let ambientLight = null;
    let hemiLight = null;
    let mars, jupiter, mercury, venus, earth, saturn, uranus, neptune, earthMoon;
    let venusAtmosphere = null;
    let earthAtmosphere = null;
    let saturnRings = null;
    let marsAura = null;
    let probeObj = null;
    let probePathLine = null;
    let probeParticleCloud = null;
    const {
        SHOW_PROBE_PATH,
        probeTargets,
        probeTourOrder,
        cameraTourTargets,
        cameraTourOrder,
        probeTrails,
        probeWork,
        probeTour,
        probeTourWork,
        probeParticles,
        probeState,
        fpsState,
        cameraView,
        cameraModeSwitch,
        cameraTour,
        cameraTourWork,
        marsTrails,
        marsTrailWork,
        equatorBasisWork,
        marsBaseScale
    } = createSceneState(THREE);
    const tourRefs = {
        camera: null,
        probeObj: null,
        probePathLine: null,
        renderer: null
    };
    const cosmicTextRefs = {
        scene: null,
        camera: null
    };
    const toursController = createToursController({
        threeLib: THREE,
        state: {
            cameraModeSwitch,
            cameraView,
            cameraTour,
            cameraTourWork,
            cameraTourOrder,
            cameraTourTargets,
            probeTour,
            probeTourWork,
            probeTourOrder,
            probeTargets,
            probeWork,
            probeState,
            equatorBasisWork
        },
        refs: tourRefs
    });
    const uiController = createUiController({
        refs: tourRefs,
        cameraView,
        cameraModeSwitch,
        scheduleNextModeSwitch: (nowMs) => toursController.scheduleNextModeSwitch(nowMs),
        switchOrbitModeSmooth: (enableSonda, nowMs) => toursController.switchOrbitModeSmooth(enableSonda, nowMs)
    });
    const cosmicTextController = createCosmicTextController({
        threeLib: THREE,
        refs: cosmicTextRefs,
        makeTextSpriteFn: (text, options) => makeTextSprite(text, THREE, options)
    });

    // Comet-style ribbon trail. The state and update function are hoisted to
    // the sceneInit scope so the animate() loop (defined at the same level)
    // can call updateProbeRibbon() without going through init()'s closure.
    const PROBE_RIBBON_SEGMENTS = 60;
    const PROBE_RIBBON_WIDTH_HEAD = 5.5;
    const PROBE_RIBBON_WIDTH_TAIL = 0.3;
    const PROBE_RIBBON_VEL_STRIDE = 2;

    const probeHistory = new Array(PROBE_RIBBON_SEGMENTS);
    for (let i = 0; i < PROBE_RIBBON_SEGMENTS; i++) {
        probeHistory[i] = new THREE.Vector3();
    }
    let probeHistoryFilled = 0;
    let probeHistoryHead = 0;
    let probeRibbon = null;
    let probeRibbonGeo = null;
    let probeRibbonMat = null;
    let probeRibbonPositions = null;

    const ribbonTmpForward = new THREE.Vector3();
    const ribbonTmpToCam = new THREE.Vector3();
    const ribbonTmpSide = new THREE.Vector3();
    const ribbonTmpViewDir = new THREE.Vector3();
    const ribbonTmpFallback = new THREE.Vector3();

    function init() {
        const cameraCfg = runtimeSceneConfig.camera || {};
        const sunCfg = runtimeSceneConfig.sun || {};
        const skyCfg = runtimeSceneConfig.sky || {};
        const rendererCfg = runtimeSceneConfig.renderer || {};
        const lightsCfg = runtimeSceneConfig.lights || {};
        const bodyMap = new Map();

        // Camera setup
        camera = new THREE.PerspectiveCamera(
            Number(cameraCfg.fov || 70),
            window.innerWidth / window.innerHeight,
            Number(cameraCfg.near || 1),
            Number(cameraCfg.far || 9000)
        );
        camera.position.set(
            Number((cameraCfg.position && cameraCfg.position.x) || 0),
            Number((cameraCfg.position && cameraCfg.position.y) || 0),
            Number((cameraCfg.position && cameraCfg.position.z) || 800)
        );
        tourRefs.camera = camera;
        cosmicTextRefs.camera = camera;
        
        // Scene setup
        scene = new THREE.Scene();
        window.scene = scene;
        cosmicTextRefs.scene = scene;
        
        // Sun creation
        const sunTexture = loadTexture(sunCfg.texturePath || './img/1k_sun.jpg');
        const sunGeometry = new THREE.SphereBufferGeometry(
            Number(sunCfg.radius || 100),
            Number((sunCfg.segments && sunCfg.segments.width) || 48),
            Number((sunCfg.segments && sunCfg.segments.height) || 32)
        );
        const sunMaterial = new THREE.MeshBasicMaterial({ map: sunTexture });
        sunObj = new THREE.Mesh(sunGeometry, sunMaterial);
        sunObj.name = "Sol";
        scene.add(sunObj);

        // Add a soft additive shell and point light so the sun can react to audio energy.
        const sunGlowCfg = sunCfg.glow || {};
        const sunGlowGeometry = new THREE.SphereBufferGeometry(
            Number(sunGlowCfg.radius || 114),
            Number((sunGlowCfg.segments && sunGlowCfg.segments.width) || 24),
            Number((sunGlowCfg.segments && sunGlowCfg.segments.height) || 16)
        );
        const sunGlowMaterial = new THREE.MeshBasicMaterial({
            color: sunGlowCfg.color || '#ffbb66',
            transparent: true,
            opacity: Number(sunGlowCfg.opacity || 0.06),
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.FrontSide
        });
        sunGlow = new THREE.Mesh(sunGlowGeometry, sunGlowMaterial);
        sunGlow.name = "SunGlow";
        sunObj.add(sunGlow);

        const sunLightCfg = sunCfg.light || {};
        sunLight = new THREE.PointLight(
            sunLightCfg.color || '#ffb84d',
            Number(sunLightCfg.intensity || 1.15),
            Number(sunLightCfg.distance || 2400)
        );
        sunLight.position.set(0, 0, 0);
        sunObj.add(sunLight);

        // Fill lights to avoid flat shading on the night side and improve depth.
        const ambientCfg = lightsCfg.ambient || {};
        ambientLight = new THREE.AmbientLight(
            ambientCfg.color || '#2f3c58',
            Number(ambientCfg.intensity || 0.26)
        );
        scene.add(ambientLight);

        const hemiCfg = lightsCfg.hemisphere || {};
        hemiLight = new THREE.HemisphereLight(
            hemiCfg.skyColor || '#6f8fc5',
            hemiCfg.groundColor || '#1a0f08',
            Number(hemiCfg.intensity || 0.34)
        );
        hemiLight.position.set(
            Number((hemiCfg.position && hemiCfg.position.x) || 0),
            Number((hemiCfg.position && hemiCfg.position.y) || 1),
            Number((hemiCfg.position && hemiCfg.position.z) || 0)
        );
        scene.add(hemiLight);
        
        // Sky/background creation
        const skyTexture = loadTexture(skyCfg.texturePath || './img/2k_stars_milky_way.jpg');
        const skyGeometry = new THREE.SphereBufferGeometry(
            Number(skyCfg.radius || 5000),
            Number((skyCfg.segments && skyCfg.segments.width) || 32),
            Number((skyCfg.segments && skyCfg.segments.height) || 16)
        );
        const skyMaterial = new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide });
        skyObj = new THREE.Mesh(skyGeometry, skyMaterial);
        skyObj.name = "Sky";
        scene.add(skyObj);
        
        // Renderer setup
        renderer = new THREE.WebGLRenderer({
            antialias: rendererCfg.antialias === true,
            powerPreference: rendererCfg.powerPreference || 'high-performance'
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Number(rendererCfg.maxPixelRatio || 1.5)));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.domElement.style.display = 'block';
        document.body.appendChild(renderer.domElement);
        tourRefs.renderer = renderer;
        uiController.createFpsHud();

        const assignPlanetRef = (key, mesh) => {
            switch (key) {
                case 'mars': mars = mesh; break;
                case 'mercury': mercury = mesh; break;
                case 'venus': venus = mesh; break;
                case 'earth': earth = mesh; break;
                case 'earthMoon': earthMoon = mesh; break;
                case 'jupiter': jupiter = mesh; break;
                case 'saturn': saturn = mesh; break;
                case 'uranus': uranus = mesh; break;
                case 'neptune': neptune = mesh; break;
                default: break;
            }
        };

        const buildBody = (bodyCfg) => {
            if (!bodyCfg || typeof bodyCfg !== 'object') {
                return;
            }

            const parentKey = bodyCfg.parent || 'sun';
            const parentObj = (parentKey === 'sun') ? sunObj : bodyMap.get(parentKey);
            if (!parentObj) {
                console.warn('[scene] missing body parent', bodyCfg.key, parentKey);
                return;
            }

            const distance = Number(bodyCfg.distance || 0);
            const rotationSpeed = Number(bodyCfg.rotationSpeed || 0);
            const translationSpeed = Number(bodyCfg.translationSpeed || 0);
            const orbitProfile = toOrbitProfile(bodyCfg.orbit, distance, translationSpeed);
            const tidalLock = bodyCfg.tidalLock === true;
            const tidalLockOffset = (typeof bodyCfg.tidalLockOffset === 'number')
                ? Number(bodyCfg.tidalLockOffset)
                : THREE.MathUtils.degToRad(Number(bodyCfg.tidalLockOffsetDeg || 0));
            let mesh = null;

            if (bodyCfg.mode === 'displacement') {
                const colorTexture = loadTexture(bodyCfg.texturePath);
                const displacementMap = bodyCfg.displacementMapPath
                    ? loadTexture(bodyCfg.displacementMapPath)
                    : null;
                const baseSegments = getSphereSegments(Number(bodyCfg.radius || 1));
                const segmentBoost = bodyCfg.segmentBoost || {};
                const geometry = new THREE.SphereBufferGeometry(
                    Number(bodyCfg.radius || 1),
                    Number(baseSegments.width + (segmentBoost.width || 0)),
                    Number(baseSegments.height + (segmentBoost.height || 0))
                );
                const material = createBodyMaterial('phong', colorTexture, {
                    displacementMap,
                    displacementScale: Number(bodyCfg.displacementScale || 0),
                    shininess: Number(bodyCfg.shininess || 0)
                });
                mesh = new THREE.Mesh(geometry, material);
                mesh.position.set(distance, 0, 0);

                const pivot = new THREE.Group();
                pivot.add(mesh);
                pivot.position.set(0, 0, 0);
                parentObj.add(pivot);

                myPlanets.push({
                    mesh,
                    pivot,
                    parent: parentObj,
                    radius: Number(bodyCfg.radius || 1),
                    distance,
                    rotationSpeed,
                    translationSpeed,
                    texture: colorTexture,
                    tidalLock,
                    tidalLockOffset,
                    orbit: orbitProfile
                });
            } else {
                mesh = addPlanet(
                    parentObj,
                    Number(bodyCfg.radius || 1),
                    distance,
                    rotationSpeed,
                    translationSpeed,
                    bodyCfg.initialRotation || [0, 0, 0],
                    bodyCfg.texturePath,
                    orbitProfile,
                    tidalLock,
                    tidalLockOffset,
                    bodyCfg.materialType
                );
            }

            if (!mesh) {
                return;
            }

            if (typeof bodyCfg.name === 'string' && bodyCfg.name.trim()) {
                mesh.name = bodyCfg.name.trim();
            }

            if (bodyCfg.atmosphere && typeof bodyCfg.atmosphere === 'object') {
                const atmosphere = createFresnelAtmosphere(
                    Number(bodyCfg.atmosphere.radius || (Number(bodyCfg.radius || 1) + 1)),
                    bodyCfg.atmosphere.color || '#ffffff',
                    Number(bodyCfg.atmosphere.power || 3),
                    Number(bodyCfg.atmosphere.intensity || 0.5),
                    THREE
                );
                mesh.add(atmosphere);
                if (bodyCfg.key === 'venus') venusAtmosphere = atmosphere;
                if (bodyCfg.key === 'earth') earthAtmosphere = atmosphere;
            }

            if (bodyCfg.rings && typeof bodyCfg.rings === 'object') {
                const rings = bodyCfg.rings;
                const alphaTexture = loadTexture(rings.texturePath);
                alphaTexture.wrapS = THREE.ClampToEdgeWrapping;
                alphaTexture.wrapT = THREE.ClampToEdgeWrapping;
                alphaTexture.minFilter = THREE.LinearFilter;
                alphaTexture.magFilter = THREE.LinearFilter;
                alphaTexture.generateMipmaps = false;

                const innerRadius = Number(rings.innerRadius || 1);
                const outerRadius = Number(rings.outerRadius || 2);
                const ringGeo = new THREE.RingBufferGeometry(innerRadius, outerRadius, Number(rings.segments || 96));
                const ringPositions = ringGeo.attributes.position;
                const ringUvs = ringGeo.attributes.uv;
                const ringSpan = outerRadius - innerRadius;

                for (let i = 0; i < ringPositions.count; i += 1) {
                    const x = ringPositions.getX(i);
                    const y = ringPositions.getY(i);
                    const radius = Math.sqrt((x * x) + (y * y));
                    const radialU = THREE.MathUtils.clamp((radius - innerRadius) / ringSpan, 0, 1);
                    ringUvs.setXY(i, radialU, 0.5);
                }

                ringUvs.needsUpdate = true;
                const ringMat = new THREE.MeshBasicMaterial({
                    map: alphaTexture,
                    alphaMap: alphaTexture,
                    transparent: true,
                    opacity: Number(rings.opacity || 0.85),
                    side: THREE.DoubleSide,
                    depthWrite: false
                });
                const ringMesh = new THREE.Mesh(ringGeo, ringMat);
                ringMesh.rotation.x = THREE.MathUtils.degToRad(Number(rings.tiltDeg || 80));
                mesh.add(ringMesh);
                saturnRings = ringMesh;
            }

            if (typeof bodyCfg.key === 'string' && bodyCfg.key.trim()) {
                bodyMap.set(bodyCfg.key.trim(), mesh);
                assignPlanetRef(bodyCfg.key.trim(), mesh);
            }
        };

        (runtimeSceneConfig.bodies || []).forEach((bodyCfg) => {
            buildBody(bodyCfg);
        });

        (runtimeSceneConfig.probeTargetKeys || []).forEach((key) => {
            const mesh = bodyMap.get(key);
            if (mesh) {
                probeTargets.push(mesh);
            }
        });

        (runtimeSceneConfig.cameraTourTargetKeys || []).forEach((key) => {
            const mesh = bodyMap.get(key);
            if (mesh) {
                cameraTourTargets.push(mesh);
            }
        });

        // Probe uses the same phased tour logic as camera, but across all planets.
        const probeGeometry = new THREE.SphereBufferGeometry(3.6, 12, 10);
        const probeMaterial = new THREE.MeshStandardMaterial({
            color: 0xa8f7ff,
            emissive: 0x3aaed1,
            emissiveIntensity: 1.35,
            roughness: 0.45,
            metalness: 0.05
        });
        probeObj = new THREE.Mesh(probeGeometry, probeMaterial);
        probeObj.name = 'Probe';
        probeObj.position.set(0, 0, 0);
        scene.add(probeObj);
        tourRefs.probeObj = probeObj;
        startProbeTour(performance.now());

        for (let i = 0; i < 6; i++) {
            // legacy sphere chain removed; trail is now a comet ribbon below.
        }

        // Comet-style ribbon trail mesh. State and update live in the
        // sceneInit scope; this block only wires the mesh into the scene
        // and seeds the history with the probe's starting position.
        const ribbonVertexCount = PROBE_RIBBON_SEGMENTS * 2;
        probeRibbonPositions = new Float32Array(ribbonVertexCount * 3);
        const ribbonAT = new Float32Array(ribbonVertexCount);
        const ribbonASide = new Float32Array(ribbonVertexCount);
        const ribbonIndices = [];
        for (let i = 0; i < PROBE_RIBBON_SEGMENTS; i++) {
            const t = i / (PROBE_RIBBON_SEGMENTS - 1);
            ribbonAT[i * 2] = t;
            ribbonAT[(i * 2) + 1] = t;
            ribbonASide[i * 2] = -1;
            ribbonASide[(i * 2) + 1] = 1;
        }
        for (let i = 0; i < PROBE_RIBBON_SEGMENTS - 1; i++) {
            const a = i * 2;
            const b = (i * 2) + 1;
            const c = (i + 1) * 2;
            const d = ((i + 1) * 2) + 1;
            ribbonIndices.push(a, b, c, b, d, c);
        }

        probeRibbonGeo = new THREE.BufferGeometry();
        probeRibbonGeo.setAttribute('position', new THREE.BufferAttribute(probeRibbonPositions, 3));
        probeRibbonGeo.setAttribute('aT', new THREE.BufferAttribute(ribbonAT, 1));
        probeRibbonGeo.setAttribute('aSide', new THREE.BufferAttribute(ribbonASide, 1));
        probeRibbonGeo.setIndex(ribbonIndices);
        probeRibbonGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);

        probeRibbonMat = new THREE.ShaderMaterial({
            uniforms: {
                uHeadColor: { value: new THREE.Color(0xa8f7ff) },
                uTailColor: { value: new THREE.Color(0x1a2f6e) },
                uHotColor: { value: new THREE.Color(0xff5522) },
                uOpacity: { value: 0.95 },
                uDrive: { value: 0.0 },
                uTime: { value: 0.0 }
            },
            vertexShader: [
                'attribute float aT;',
                'attribute float aSide;',
                'varying float vT;',
                'varying float vSide;',
                'void main() {',
                '  vT = aT;',
                '  vSide = aSide;',
                '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
                '}'
            ].join('\n'),
            fragmentShader: [
                'uniform vec3 uHeadColor;',
                'uniform vec3 uTailColor;',
                'uniform vec3 uHotColor;',
                'uniform float uOpacity;',
                'uniform float uDrive;',
                'uniform float uTime;',
                'varying float vT;',
                'varying float vSide;',
                'void main() {',
                '  float side = 1.0 - abs(vSide);',
                '  float halo = pow(side, 1.6);',
                '  float core = pow(side, 8.0);',
                '  float headT = 1.0 - vT;',
                '  float headFade = pow(headT, 0.6);',
                '  float coreFade = pow(headT, 1.2);',
                '  vec3 col = mix(uTailColor, uHeadColor, headFade);',
                '  col += uHotColor * uDrive * coreFade * 0.8;',
                '  float alpha = uOpacity * (halo * headFade * 0.55 + core * coreFade * 0.85);',
                '  float shimmer = 0.5 + 0.5 * sin(vT * 30.0 - uTime * 2.0);',
                '  alpha *= (0.82 + 0.18 * shimmer);',
                '  gl_FragColor = vec4(col, alpha);',
                '}'
            ].join('\n'),
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        probeRibbon = new THREE.Mesh(probeRibbonGeo, probeRibbonMat);
        probeRibbon.frustumCulled = false;
        probeRibbon.renderOrder = 5;
        scene.add(probeRibbon);

        for (let i = 0; i < PROBE_RIBBON_SEGMENTS; i++) {
            probeHistory[i].copy(probeObj.position);
        }

        const probeParticleCount = 64;
        const probeParticlePositions = new Float32Array(probeParticleCount * 3);
        const probeParticleColors = new Float32Array(probeParticleCount * 3);
        const probeParticleGeometry = new THREE.BufferGeometry();
        probeParticleGeometry.setAttribute('position', new THREE.BufferAttribute(probeParticlePositions, 3));
        probeParticleGeometry.setAttribute('color', new THREE.BufferAttribute(probeParticleColors, 3));
        const probeParticleMaterial = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 2.4,
            vertexColors: true,
            transparent: true,
            opacity: 0.52,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        probeParticleCloud = new THREE.Points(probeParticleGeometry, probeParticleMaterial);
        scene.add(probeParticleCloud);

        for (let i = 0; i < probeParticleCount; i++) {
            probeParticles.push({
                pos: new THREE.Vector3().copy(probeObj.position),
                vel: new THREE.Vector3(0, 0, 0),
                life: 0,
                tint: (Math.random() - 0.5) * 0.24
            });
            probeParticlePositions[i * 3] = probeObj.position.x;
            probeParticlePositions[(i * 3) + 1] = probeObj.position.y;
            probeParticlePositions[(i * 3) + 2] = probeObj.position.z;
            probeParticleColors[i * 3] = 0.66;
            probeParticleColors[(i * 3) + 1] = 0.97;
            probeParticleColors[(i * 3) + 2] = 1;
        }

        tourRefs.probePathLine = null;
        if (SHOW_PROBE_PATH) {
            const probePathGeometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(),
                new THREE.Vector3()
            ]);
            const probePathMaterial = new THREE.LineBasicMaterial({
                color: 0x65d9ff,
                transparent: true,
                opacity: 0.32
            });
            probePathLine = new THREE.LineLoop(probePathGeometry, probePathMaterial);
            tourRefs.probePathLine = probePathLine;
            scene.add(probePathLine);
            updateProbeRouteLine(performance.now(), true);
        }
        
        if (mars) {
            addMarsParticles(mars, myParticles, marsParticleTextures, THREE, Partykals);

            const marsEffectsCfg = runtimeSceneConfig.marsEffects || {};
            const auraCfg = marsEffectsCfg.aura || {};
            marsAura = new THREE.PointLight(
                auraCfg.color || '#ff4d1f',
                Number(auraCfg.intensity || 1.1),
                Number(auraCfg.distance || 210)
            );
            marsAura.position.set(0, 0, 0);
            mars.add(marsAura);

            const trailsCfg = marsEffectsCfg.trails || {};
            const trailCount = Number(trailsCfg.count || 4);
            const baseRadius = Number(trailsCfg.baseRadius || 3.6);
            const radiusStep = Number(trailsCfg.radiusStep || 0.5);
            const trailColor = trailsCfg.color || '#ff5a2a';
            const baseOpacity = Number(trailsCfg.baseOpacity || 0.14);
            const opacityStep = Number(trailsCfg.opacityStep || 0.02);

            for (let i = 0; i < trailCount; i++) {
                const trailGeo = new THREE.SphereBufferGeometry(baseRadius - (i * radiusStep), 10, 8);
                const trailMat = new THREE.MeshBasicMaterial({
                    color: trailColor,
                    transparent: true,
                    opacity: baseOpacity - (i * opacityStep),
                    blending: THREE.AdditiveBlending,
                    depthWrite: false
                });
                const trailMesh = new THREE.Mesh(trailGeo, trailMat);
                trailMesh.visible = true;
                scene.add(trailMesh);
                marsTrails.push(trailMesh);
            }
        }
        
        // Event listeners
        window.addEventListener('resize', onWindowResize, false);
        window.addEventListener('keydown', onKeyDown, false);

        scheduleNextModeSwitch(performance.now());
    }
    function scheduleNextModeSwitch(nowMs) {
        toursController.scheduleNextModeSwitch(nowMs);
    }

    function switchOrbitModeSmooth(enableSonda, nowMs) {
        toursController.switchOrbitModeSmooth(enableSonda, nowMs);
    }

    function onKeyDown(event) {
        uiController.onKeyDown(event);
    }

    function onWindowResize() {
        uiController.onWindowResize();
    }

    function startProbeTour(nowMs) {
        toursController.startProbeTour(nowMs);
    }

    function updateProbeRouteLine(nowMs, force = false) {
        toursController.updateProbeRouteLine(nowMs, force);
    }

    function updateProbeTour(now, deltaSec) {
        toursController.updateProbeTour(now, deltaSec);
    }

    function updatePlanetTourCamera(now, deltaSec) {
        toursController.updatePlanetTourCamera(now, deltaSec);
    }

    function updateProbeRibbon(nowMs) {
        if (!probeRibbon || !probeObj) {
            return;
        }
        probeHistory[probeHistoryHead].copy(probeObj.position);
        probeHistoryHead = (probeHistoryHead + 1) % PROBE_RIBBON_SEGMENTS;
        if (probeHistoryFilled < PROBE_RIBBON_SEGMENTS) {
            probeHistoryFilled++;
        }

        const N = PROBE_RIBBON_SEGMENTS;
        const newestSlot = (probeHistoryHead - 1 + N) % N;
        const camPos = camera.position;

        for (let i = 0; i < N; i++) {
            const t = i / (N - 1);
            const w = THREE.MathUtils.lerp(PROBE_RIBBON_WIDTH_HEAD, PROBE_RIBBON_WIDTH_TAIL, t);

            const slot = (newestSlot - i + N) % N;
            const center = probeHistory[slot];

            const newerSlot = (newestSlot - Math.max(0, i - PROBE_RIBBON_VEL_STRIDE) + N) % N;
            const olderSlot = (newestSlot - Math.min(N - 1, i + PROBE_RIBBON_VEL_STRIDE) + N) % N;
            ribbonTmpForward.subVectors(probeHistory[newerSlot], probeHistory[olderSlot]);
            const velLen = ribbonTmpForward.length();
            if (velLen > 0.0001) {
                ribbonTmpForward.divideScalar(velLen);
            } else {
                ribbonTmpForward.set(0, 0, 1);
            }

            ribbonTmpToCam.subVectors(center, camPos).normalize();
            ribbonTmpSide.crossVectors(ribbonTmpForward, ribbonTmpToCam);
            let sideLen = ribbonTmpSide.length();
            if (sideLen > 0.0001) {
                ribbonTmpSide.divideScalar(sideLen);
            } else {
                camera.getWorldDirection(ribbonTmpViewDir);
                ribbonTmpFallback.crossVectors(ribbonTmpForward, ribbonTmpViewDir);
                const fallbackLen = ribbonTmpFallback.length();
                if (fallbackLen > 0.0001) {
                    ribbonTmpSide.copy(ribbonTmpFallback).divideScalar(fallbackLen);
                } else {
                    ribbonTmpSide.set(1, 0, 0);
                }
            }

            const baseIdx = i * 2;
            const sideIdx = (i * 2) + 1;
            probeRibbonPositions[baseIdx * 3] = center.x - (ribbonTmpSide.x * w);
            probeRibbonPositions[(baseIdx * 3) + 1] = center.y - (ribbonTmpSide.y * w);
            probeRibbonPositions[(baseIdx * 3) + 2] = center.z - (ribbonTmpSide.z * w);
            probeRibbonPositions[sideIdx * 3] = center.x + (ribbonTmpSide.x * w);
            probeRibbonPositions[(sideIdx * 3) + 1] = center.y + (ribbonTmpSide.y * w);
            probeRibbonPositions[(sideIdx * 3) + 2] = center.z + (ribbonTmpSide.z * w);
        }

        probeRibbonGeo.attributes.position.needsUpdate = true;

        probeRibbonMat.uniforms.uTime.value = nowMs * 0.001;
        probeRibbonMat.uniforms.uDrive.value = reactiveController.getProbeReactiveDrive();
        probeRibbonMat.uniforms.uHeadColor.value.copy(reactiveController.getProbeColorWork());
    }

    function spawnCosmicText(text, intervalSec, clipDurationMs, nextAudioInMs) {
        cosmicTextController.spawn(text, { intervalSec, clipDurationMs, nextAudioInMs });
    }

    spawnCosmicTextFn = spawnCosmicText;

    // Animation variables
    let frameCount = 0;
    const animationConfig = createAnimationConfig(THREE, {
        reactiveTuning: (runtimeSceneConfig && runtimeSceneConfig.reactive) || {}
    });
    const { cameraMotion } = animationConfig;
    const reactiveController = createReactiveController({
        threeLib: THREE,
        audioModule: audio,
        mapRangeFn: mapRange,
        config: animationConfig
    });

    function animate(now) {
        if (typeof now !== 'number') {
            now = performance.now();
        }

        requestAnimationFrame(animate);
        frameCount++;
        uiController.updateFps(now, fpsState);

        if (!sceneEnabled) {
            return;
        }

        const deltaSec = probeState.lastFrameAt > 0
            ? Math.min(0.05, (now - probeState.lastFrameAt) * 0.001)
            : 0.016;
        probeState.lastFrameAt = now;

        if (!cameraView.topDown && cameraModeSwitch.enabled && !cameraModeSwitch.active && now >= cameraModeSwitch.nextSwitchAt) {
            switchOrbitModeSmooth(!cameraView.planetTour, now);
        }

        if (cameraView.topDown) {
            camera.up.set(0, 0, -1);
            camera.position.set(0, cameraView.topHeight, 0.01);
            camera.lookAt(0, 0, 0);
        } else if (!cameraView.planetTour) {
            camera.up.set(0, 1, 0);
            const orbitAngle = now * cameraMotion.orbitSpeed;
            const orbitRadius = cameraMotion.radius + (Math.sin(now * 0.00019) * cameraMotion.radiusSwing);
            camera.position.x = Math.cos(orbitAngle) * orbitRadius * 0.32;
            camera.position.z = Math.sin(orbitAngle) * orbitRadius;
            camera.position.y = cameraMotion.verticalBase + (Math.sin(now * cameraMotion.verticalSpeed) * cameraMotion.verticalAmp);
            camera.lookAt(0, 30, 0);
        }
        
        // Update planets
        for (let i = 0; i < myPlanets.length; i++) {
            const planet = myPlanets[i];

            const orbit = planet.orbit;
            const meanAnomaly = (now * 0.001 * orbit.meanMotion) + orbit.phase;
            const E = solveKeplerEccentricAnomaly(meanAnomaly, orbit.eccentricity);
            const a = orbit.semiMajorAxis;
            const b = a * Math.sqrt(1 - (orbit.eccentricity * orbit.eccentricity));
            const x = a * (Math.cos(E) - orbit.eccentricity);
            const z = b * Math.sin(E);

            if (planet.tidalLock) {
                planet.mesh.lookAt(0, 0, 0);
                if (planet.tidalLockOffset !== 0) {
                    planet.mesh.rotateY(planet.tidalLockOffset);
                }
            } else {
                planet.mesh.rotation.y += planet.rotationSpeed;
            }

            planet.mesh.position.set(x, 0, z);
            planet.pivot.rotation.x = orbit.inclination;
            planet.pivot.rotation.y = orbit.longitude;
        }

        if (cameraView.planetTour) {
            updatePlanetTourCamera(now, deltaSec);
        }

        if (cameraModeSwitch.active) {
            const transitionProgress = THREE.MathUtils.clamp(
                (now - cameraModeSwitch.startedAt) / cameraModeSwitch.transitionMs,
                0,
                1
            );
            const smoothTransition = transitionProgress * transitionProgress * (3 - (2 * transitionProgress));

            cameraModeSwitch.blendPos.lerpVectors(cameraModeSwitch.startPos, camera.position, smoothTransition);
            cameraModeSwitch.targetQuat.copy(camera.quaternion);
            camera.quaternion.copy(cameraModeSwitch.startQuat).slerp(cameraModeSwitch.targetQuat, smoothTransition);
            camera.position.copy(cameraModeSwitch.blendPos);

            if (transitionProgress >= 1) {
                cameraModeSwitch.active = false;
            }
        }

        if (probeObj && probeTargets.length > 0) {
            updateProbeTour(now, deltaSec);

            updateProbeRibbon(now);

            probeWork.tailOrigin.copy(probeObj.position).addScaledVector(probeWork.tan, -2.5);
            for (let i = 0; i < probeTrails.length; i++) {
                const trail = probeTrails[i];
                const target = (i === 0) ? probeWork.tailOrigin : probeWork.prevTail.copy(probeTrails[i - 1].position);
                trail.position.lerp(target, Math.max(0.09, 0.29 - (i * 0.03)));
                trail.material.opacity = (0.23 - (i * 0.028)) + (Math.sin(now * 0.004 + i) * 0.015);
            }

            if (probeParticleCloud) {
                const positions = probeParticleCloud.geometry.attributes.position.array;
                const colors = probeParticleCloud.geometry.attributes.color.array;
                const probeColorWork = reactiveController.getProbeColorWork();
                const positionAttr = probeParticleCloud.geometry.attributes.position;
                const colorAttr = probeParticleCloud.geometry.attributes.color;
                for (let i = 0; i < probeParticles.length; i++) {
                    const particle = probeParticles[i];
                    particle.life -= deltaSec;
                    if (particle.life <= 0) {
                        particle.life = 0.4 + (Math.random() * 0.9);
                        probeScratchVecA.set(
                            (Math.random() - 0.5) * 2.2,
                            (Math.random() - 0.5) * 2.2,
                            (Math.random() - 0.5) * 2.2
                        );
                        particle.pos.copy(probeWork.tailOrigin).add(probeScratchVecA);
                        probeScratchVecA.set(
                            (Math.random() - 0.5) * 4,
                            (Math.random() - 0.5) * 4,
                            (Math.random() - 0.5) * 4
                        );
                        particle.vel.copy(probeWork.tan).multiplyScalar(-16 - (Math.random() * 9)).add(probeScratchVecA);
                    }

                    particle.pos.addScaledVector(particle.vel, deltaSec);
                    particle.vel.multiplyScalar(0.985);

                    positions[i * 3] = particle.pos.x;
                    positions[(i * 3) + 1] = particle.pos.y;
                    positions[(i * 3) + 2] = particle.pos.z;

                    const tintMult = 1 + particle.tint;
                    colors[i * 3] = THREE.MathUtils.clamp(probeColorWork.r * tintMult, 0, 1);
                    colors[(i * 3) + 1] = THREE.MathUtils.clamp(probeColorWork.g * tintMult, 0, 1);
                    colors[(i * 3) + 2] = THREE.MathUtils.clamp(probeColorWork.b * tintMult, 0, 1);
                }
                positionAttr.needsUpdate = true;
                if ((frameCount & 1) === 0) {
                    colorAttr.needsUpdate = true;
                }
            }
        }
        
        // Update particles
        if ((frameCount % 2) === 0) {
            for (let i = 0; i < myParticles.length; i++) {
                myParticles[i].update();
            }
        }
        
        // Update celestial bodies
        const sunRotationSpeedY = Number((runtimeSceneConfig.sun && runtimeSceneConfig.sun.rotationSpeedY) || 0.0007);
        const skyRotation = (runtimeSceneConfig.sky && runtimeSceneConfig.sky.rotationSpeed) || { x: 0.0006, y: 0.0005, z: -0.0004 };
        sunObj.rotation.y += sunRotationSpeedY;
        skyObj.rotation.x += Number(skyRotation.x || 0);
        skyObj.rotation.y += Number(skyRotation.y || 0);
        skyObj.rotation.z += Number(skyRotation.z || 0);
        reactiveController.update(now, {
            sunLight,
            ambientLight,
            hemiLight,
            sunGlow,
            jupiter,
            venusAtmosphere,
            earthAtmosphere,
            saturnRings,
            camera,
            probeObj,
            probeParticleCloud,
            probeTrails,
            mars,
            marsAura,
            marsBaseScale,
            marsTrails,
            marsTrailWork
        });
        
        cosmicTextController.update(now);

        renderer.render(scene, camera);
    }

    init();
    animate();
}
