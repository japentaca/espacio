'use strict';

export function createCosmicTextController({ threeLib, refs, makeTextSpriteFn, timeNow = () => performance.now() }) {
    const sprites = [];
    let lastAnimateNow = 0;

    function spawn(text, intervalSec) {
        const scene = refs.scene;
        const camera = refs.camera;

        if (!text || !scene || !camera) {
            return;
        }

        const nowMs = timeNow();
        const cooldownMs = (intervalSec || 9) * 1000 * 0.9;
        if (sprites.length > 0) {
            const newest = sprites[sprites.length - 1];
            if ((nowMs - newest.userData.spawnedAt) < cooldownMs) {
                return;
            }
        }

        const sprite = makeTextSpriteFn(text);
        const camRelPos = new threeLib.Vector3(
            (Math.random() - 0.5) * 38,
            82 + ((Math.random() - 0.5) * 16),
            -165
        );

        sprite.position.copy(camRelPos.clone().applyMatrix4(camera.matrixWorld));

        const fadeInDur = 1200;
        const totalDuration = (intervalSec || 9) * 1000;

        sprite.userData = {
            spawnedAt: nowMs,
            totalDuration,
            fadeInDur,
            fadeOutDur: totalDuration - fadeInDur,
            camRelPos,
            recedingSpeed: 62,
            lateralDrift: new threeLib.Vector2(
                (Math.random() - 0.5) * 5,
                2.8 + Math.random() * 1.8
            )
        };

        scene.add(sprite);
        sprites.push(sprite);
    }

    function update(now) {
        const scene = refs.scene;
        const camera = refs.camera;

        if (!scene || !camera || sprites.length === 0) {
            lastAnimateNow = now;
            return;
        }

        const textDelta = lastAnimateNow > 0 ? Math.min(0.1, (now - lastAnimateNow) * 0.001) : 0.016;

        for (let i = sprites.length - 1; i >= 0; i--) {
            const sprite = sprites[i];
            const userData = sprite.userData;
            const age = now - userData.spawnedAt;

            if (age >= userData.totalDuration) {
                scene.remove(sprite);
                if (sprite.material.map) {
                    sprite.material.map.dispose();
                }
                sprite.material.dispose();
                sprites.splice(i, 1);
                continue;
            }

            userData.camRelPos.z -= userData.recedingSpeed * textDelta;
            userData.camRelPos.x += userData.lateralDrift.x * textDelta;
            userData.camRelPos.y += userData.lateralDrift.y * textDelta;
            sprite.position.copy(userData.camRelPos.clone().applyMatrix4(camera.matrixWorld));

            let opacity;
            if (age < userData.fadeInDur) {
                opacity = age / userData.fadeInDur;
            } else {
                opacity = 1.0 - ((age - userData.fadeInDur) / userData.fadeOutDur);
            }
            sprite.material.opacity = Math.max(0, opacity) * 0.90;
        }

        lastAnimateNow = now;
    }

    return {
        spawn,
        update
    };
}
