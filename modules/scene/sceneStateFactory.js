'use strict';

export function createSceneState(threeLib) {
    return {
        SHOW_PROBE_PATH: false,
        probeTargets: [],
        probeTourOrder: [],
        cameraTourTargets: [],
        cameraTourOrder: [],
        probeTrails: [],
        probeWork: {
            tan: new threeLib.Vector3(0, 0, 1),
            look: new threeLib.Vector3(),
            tailOrigin: new threeLib.Vector3(),
            prevTail: new threeLib.Vector3(),
            prevPos: new threeLib.Vector3()
        },
        probeTour: {
            index: 0,
            phase: 'approach',
            phaseStartedAt: 0,
            approachMs: 4800,
            orbitMs: 12800,
            transferMs: 3200,
            turnsPerPlanet: 4,
            minDistance: 30,
            maxDistance: 105,
            distancePadding: 34,
            baseHeight: 10,
            angle: 0,
            approachAngularSpeed: 0.28,
            transferAngularSpeed: 0.28,
            transferFromIndex: 0,
            transferToIndex: 0,
            transferArrivalScale: 1.04,
            transferLookDelay: 0.18,
            transferVerticalDelay: 0.24,
            orbitEllipseRatio: 0.86,
            transferArcOffset: 0.36,
            positionDamping: 3.6,
            lookDamping: 4.3,
            initialized: false
        },
        probeTourWork: {
            targetPos: new threeLib.Vector3(),
            fromTargetPos: new threeLib.Vector3(),
            toTargetPos: new threeLib.Vector3(),
            desiredPos: new threeLib.Vector3(),
            fromDesiredPos: new threeLib.Vector3(),
            toDesiredPos: new threeLib.Vector3(),
            desiredLook: new threeLib.Vector3(),
            offset: new threeLib.Vector3(),
            toOffset: new threeLib.Vector3(),
            smoothedPos: new threeLib.Vector3(),
            smoothedLook: new threeLib.Vector3()
        },
        probeParticles: [],
        probeState: {
            lastRouteUpdateAt: -9999,
            routeUpdateMs: 140,
            lastFrameAt: 0
        },
        fpsState: {
            frames: 0,
            lastSampleAt: 0
        },
        cameraView: {
            topDown: false,
            topHeight: 2700,
            planetTour: false
        },
        cameraModeSwitch: {
            enabled: true,
            minSwitchMs: 30000,
            maxSwitchMs: 90000,
            nextSwitchAt: 0,
            transitionMs: 2600,
            active: false,
            startedAt: 0,
            startPos: new threeLib.Vector3(),
            startQuat: new threeLib.Quaternion(),
            targetQuat: new threeLib.Quaternion(),
            blendPos: new threeLib.Vector3()
        },
        cameraTour: {
            index: 0,
            phase: 'approach',
            phaseStartedAt: 0,
            approachMs: 6800,
            orbitMs: 18000,
            orbitEntryBlendMs: 2000,
            transferMs: 7200,
            turnsPerPlanet: 2,
            minDistance: 100,
            maxDistance: 275,
            distancePadding: 112,
            baseHeight: 34,
            angle: 0,
            approachAngularSpeed: 0.17,
            transferAngularSpeed: 0.12,
            transferFromIndex: 0,
            transferToIndex: 0,
            transferArrivalScale: 1.03,
            transferLookDelay: 0.24,
            transferVerticalDelay: 0.32,
            positionDamping: 2.6,
            lookDamping: 1.9,
            rotationDamping: 1.6,
            verticalPosDamping: 1.45,
            verticalLookDamping: 1.2,
            minPitchDeg: -9,
            maxPitchDeg: 14,
            initialized: false
        },
        cameraTourWork: {
            targetPos: new threeLib.Vector3(),
            fromTargetPos: new threeLib.Vector3(),
            toTargetPos: new threeLib.Vector3(),
            desiredPos: new threeLib.Vector3(),
            fromDesiredPos: new threeLib.Vector3(),
            toDesiredPos: new threeLib.Vector3(),
            desiredLook: new threeLib.Vector3(),
            offset: new threeLib.Vector3(),
            fromOffset: new threeLib.Vector3(),
            toOffset: new threeLib.Vector3(),
            smoothedLook: new threeLib.Vector3(),
            smoothedPosY: 0,
            smoothedLookY: 0,
            virtualPos: new threeLib.Vector3(),
            lookMatrix: new threeLib.Matrix4(),
            desiredQuat: new threeLib.Quaternion(),
            virtualQuat: new threeLib.Quaternion()
        },
        marsTrails: [],
        marsTrailWork: {
            curr: new threeLib.Vector3(),
            prev: new threeLib.Vector3()
        },
        equatorBasisWork: {
            up: new threeLib.Vector3(),
            axisA: new threeLib.Vector3(),
            axisB: new threeLib.Vector3(),
            ref: new threeLib.Vector3(),
            quat: new threeLib.Quaternion()
        },
        marsBaseScale: 1
    };
}

export function createAnimationConfig(threeLib) {
    return {
        reactiveTuning: {
            sampleMs: 38,
            attackFactor: 0.72,
            releaseFactor: 0.2,
            dbInMin: -62,
            dbInMax: -16,
            curvePower: 0.88,
            transientDbMax: 8,
            transientMaxBoost: 0.42,
            emissiveBase: 0.66,
            emissiveGain: 1.42,
            scalePulse: 0.68,
            trailOpacityBoost: 0.18
        },
        probeColorBase: new threeLib.Color(0xa8f7ff),
        probeColorHot: new threeLib.Color(0xff2a2a),
        probeEmissiveBase: new threeLib.Color(0x3aaed1),
        probeEmissiveHot: new threeLib.Color(0xff1414),
        probeColorWork: new threeLib.Color(),
        probeEmissiveWork: new threeLib.Color(),
        cameraMotion: {
            radius: 2040,
            orbitSpeed: 0.00022,
            radiusSwing: 160,
            verticalBase: 220,
            verticalAmp: 170,
            verticalSpeed: 0.00031
        }
    };
}
