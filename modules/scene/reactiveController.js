'use strict';

export function createReactiveController({ threeLib, audioModule, mapRangeFn, config }) {
    let level = 0;
    let smoothedLevel = -75;
    let lastAudioSampleAt = 0;
    let probeReactiveDrive = 0;

    const {
        reactiveTuning,
        probeColorBase,
        probeColorHot,
        probeEmissiveBase,
        probeEmissiveHot,
        probeColorWork,
        probeEmissiveWork
    } = config;

    function update(now, ctx) {
        const {
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
        } = ctx;

        if ((now - lastAudioSampleAt) > reactiveTuning.sampleMs) {
            level = audioModule.getReactiveLevel();
            lastAudioSampleAt = now;
        }
        const smoothingFactor = level > smoothedLevel
            ? reactiveTuning.attackFactor
            : reactiveTuning.releaseFactor;
        smoothedLevel += (level - smoothedLevel) * smoothingFactor;

        const normalizedLevel = threeLib.MathUtils.clamp(
            mapRangeFn(smoothedLevel, reactiveTuning.dbInMin, reactiveTuning.dbInMax, 0, 1),
            0,
            1
        );
        const transientRise = Math.max(0, level - smoothedLevel);
        const transientBoost = threeLib.MathUtils.clamp(
            mapRangeFn(transientRise, 0, reactiveTuning.transientDbMax, 0, reactiveTuning.transientMaxBoost),
            0,
            reactiveTuning.transientMaxBoost
        );
        probeReactiveDrive = Math.min(2.0, Math.pow(normalizedLevel, reactiveTuning.curvePower) + transientBoost);

        if (sunLight) {
            sunLight.intensity = 1.5;
            sunLight.distance = 2550;
        }
        if (ambientLight) {
            ambientLight.intensity = 0.24;
        }
        if (hemiLight) {
            hemiLight.intensity = 0.3;
        }
        if (sunGlow) {
            const glowScale = 1.08 + (Math.sin(now * 0.001) * 0.02);
            sunGlow.scale.setScalar(glowScale);
            sunGlow.material.opacity = 0.06 + (Math.sin(now * 0.0014) * 0.012);
            sunGlow.material.color.setHSL(0.1, 0.9, 0.58);
        }

        if (jupiter) {
            jupiter.scale.set(1.72, 1.72, 1.72);
        }

        if (venusAtmosphere) {
            venusAtmosphere.rotation.y += 0.002;
            venusAtmosphere.material.uniforms.uCameraPos.value.copy(camera.position);
        }
        if (earthAtmosphere) {
            earthAtmosphere.rotation.y += 0.0012;
            earthAtmosphere.material.uniforms.uCameraPos.value.copy(camera.position);
        }
        if (saturnRings) {
            saturnRings.rotation.z += 0.00035;
        }

        if (venusAtmosphere) {
            const venusShimmer = Math.sin(now * 0.0017) * 0.018;
            venusAtmosphere.material.uniforms.uOpacity.value = 0.52 + venusShimmer;
        }
        if (earthAtmosphere) {
            const earthShimmer = Math.sin((now * 0.0014) + 1.1) * 0.015;
            earthAtmosphere.material.uniforms.uOpacity.value = 0.48 + earthShimmer;
        }

        if (probeObj) {
            const probeScale = 1 + (probeReactiveDrive * reactiveTuning.scalePulse);
            const colorMix = threeLib.MathUtils.clamp(probeReactiveDrive / 1.4, 0, 1);
            probeColorWork.copy(probeColorBase).lerp(probeColorHot, colorMix);
            probeEmissiveWork.copy(probeEmissiveBase).lerp(probeEmissiveHot, colorMix);

            probeObj.scale.setScalar(probeScale);
            probeObj.material.color.copy(probeColorWork);
            probeObj.material.emissive.copy(probeEmissiveWork);
            probeObj.material.emissiveIntensity = reactiveTuning.emissiveBase + (probeReactiveDrive * reactiveTuning.emissiveGain);

            if (probeParticleCloud && probeParticleCloud.material) {
                probeParticleCloud.material.opacity = 0.45 + (colorMix * 0.3);
            }
        }

        for (let i = 0; i < probeTrails.length; i++) {
            const trail = probeTrails[i];
            const baseOpacity = 0.13 - (i * 0.018);
            trail.material.opacity = baseOpacity + (probeReactiveDrive * reactiveTuning.trailOpacityBoost * (1 - (i * 0.1)));
        }

        if (mars) {
            const marsPulse = 1.02 + (Math.sin(now * 0.0028) * 0.07);
            mars.scale.set(
                (marsBaseScale * marsPulse) + (Math.sin(now * 0.0042) * 0.028),
                (marsBaseScale * marsPulse) + (Math.sin((now * 0.0042) + 1.4) * 0.02),
                (marsBaseScale * marsPulse) + (Math.sin((now * 0.0042) + 2.2) * 0.024)
            );
        }

        if (marsAura) {
            const auraPulse = 1.06 + (Math.sin((now * 0.0016) + 0.8) * 0.22);
            marsAura.intensity = auraPulse;
            marsAura.distance = 140 + (auraPulse * 58);
            marsAura.color.setHSL(0.03 + (Math.sin(now * 0.0011) * 0.02), 0.95, 0.52);
        }

        if (mars) {
            mars.getWorldPosition(marsTrailWork.curr);
            for (let i = 0; i < marsTrails.length; i++) {
                const trail = marsTrails[i];
                const target = (i === 0) ? marsTrailWork.curr : marsTrailWork.prev.copy(marsTrails[i - 1].position);
                const lerpAlpha = 0.25 - (i * 0.025);
                trail.position.lerp(target, Math.max(0.06, lerpAlpha));
                const trailPulse = 1 + (Math.sin((now * 0.0022) + (i * 0.45)) * 0.08);
                const localPulse = trailPulse * (1 - (i * 0.09));
                trail.scale.setScalar(localPulse);
                trail.material.opacity = (0.09 - (i * 0.015)) + (trailPulse * 0.06);
                trail.material.color.setHSL(0.045 - (i * 0.005), 0.95, 0.52);
            }
        }
    }

    return {
        update,
        getProbeColorWork: () => probeColorWork,
        getProbeReactiveDrive: () => probeReactiveDrive
    };
}
