'use strict';

export function createCosmicTextController({ threeLib, refs, makeTextSpriteFn, timeNow = () => performance.now() }) {
    const sprites = [];
    let lastAnimateNow = 0;
    const tmpWorldPos = new threeLib.Vector3();

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function getViewportSizeAtDepth(camera, depth) {
        const safeDepth = Math.max(1, Math.abs(depth));
        const safeFov = Number.isFinite(camera?.fov) ? camera.fov : 60;
        const safeAspect = Number.isFinite(camera?.aspect) && camera.aspect > 0
            ? camera.aspect
            : 16 / 9;
        const halfFovRad = (safeFov * Math.PI) / 360;
        const height = 2 * Math.tan(halfFovRad) * safeDepth;
        const width = height * safeAspect;
        return { width, height };
    }

    function estimateMaxCharsPerLine(camera, depth, charSpacing) {
        const viewport = getViewportSizeAtDepth(camera, depth);
        const safeSpacing = Number.isFinite(charSpacing) && charSpacing > 0 ? charSpacing : 10.8;
        const usableWidth = viewport.width * 0.72;
        return Math.max(12, Math.floor(usableWidth / safeSpacing));
    }

    function buildLines(text, maxCharsPerLine = 34) {
        const safeMaxChars = Math.max(10, Math.floor(maxCharsPerLine || 34));
        const words = text.split(/\s+/).filter(Boolean);
        const lines = [];
        let current = '';

        for (const rawWord of words) {
            let word = rawWord;

            while (word.length > safeMaxChars) {
                if (current) {
                    lines.push(current);
                    current = '';
                }
                lines.push(word.slice(0, safeMaxChars));
                word = word.slice(safeMaxChars);
            }

            const candidate = current ? `${current} ${word}` : word;
            if (candidate.length > safeMaxChars && current) {
                lines.push(current);
                current = word;
            } else {
                current = candidate;
            }
        }

        if (current) {
            lines.push(current);
        }

        return lines.length ? lines : [text];
    }

    function parseSpawnOptions(intervalOrOptions, clipDurationMs) {
        if (intervalOrOptions && typeof intervalOrOptions === 'object') {
            return {
                intervalSec: Number(intervalOrOptions.intervalSec),
                clipDurationMs: Number(intervalOrOptions.clipDurationMs),
                nextAudioInMs: Number(intervalOrOptions.nextAudioInMs)
            };
        }

        return {
            intervalSec: Number(intervalOrOptions),
            clipDurationMs: Number(clipDurationMs),
            nextAudioInMs: NaN
        };
    }

    function spawn(text, intervalOrOptions, clipDurationMs) {
        const scene = refs.scene;
        const camera = refs.camera;

        if (!text || !scene || !camera) {
            return;
        }

        const options = parseSpawnOptions(intervalOrOptions, clipDurationMs);
        const safeIntervalSec = (Number.isFinite(options.intervalSec) && options.intervalSec > 0) ? options.intervalSec : 9;
        const nowMs = timeNow();
        const cooldownMs = safeIntervalSec * 1000 * 0.9;
        if (sprites.length > 0) {
            const newest = sprites[sprites.length - 1];
            if ((nowMs - newest.userData.spawnedAt) < cooldownMs) {
                return;
            }
        }

        const fallbackDurationMs = (safeIntervalSec || 9) * 1000;
        const clipDurationMsResolved = (Number.isFinite(options.clipDurationMs) && options.clipDurationMs > 0)
            ? options.clipDurationMs
            : fallbackDurationMs;
        const totalDuration = (Number.isFinite(options.nextAudioInMs) && options.nextAudioInMs > 0)
            ? options.nextAudioInMs
            : fallbackDurationMs;
        const assemblyReferenceMs = Math.min(clipDurationMsResolved, totalDuration);
        const assemblyBudgetMs = Math.max(1, totalDuration * 0.92);
        let sequenceWindowMs = clamp(assemblyReferenceMs * 0.45, 80, 3600);
        let travelDurationMs = clamp(sequenceWindowMs * 0.62, 60, 1200);
        const assemblyEndMs = sequenceWindowMs + travelDurationMs;
        if (assemblyEndMs > assemblyBudgetMs) {
            const scale = assemblyBudgetMs / assemblyEndMs;
            sequenceWindowMs = Math.max(1, sequenceWindowMs * scale);
            travelDurationMs = Math.max(1, travelDurationMs * scale);
        }
        const postAssemblyStartMs = sequenceWindowMs + travelDurationMs;
        const fadeOutDur = Math.max(1, totalDuration - postAssemblyStartMs);

        const groupCamRelPos = new threeLib.Vector3(
            (Math.random() - 0.5) * 38,
            82 + ((Math.random() - 0.5) * 16),
            -165
        );
        const recedingSpeed = 62;
        const lateralDrift = new threeLib.Vector2(
            (Math.random() - 0.5) * 5,
            2.8 + Math.random() * 1.8
        );

        const boardCenter = new threeLib.Vector2(0, 0);
        const charSpacing = 10.8;
        const lineSpacing = 12.2;
        const maxCharsPerLine = estimateMaxCharsPerLine(camera, Math.abs(groupCamRelPos.z), charSpacing);
        const lines = buildLines(text.trim(), maxCharsPerLine);
        const maxLineChars = lines.reduce((acc, line) => Math.max(acc, line.length), 1);
        const boardWidth = Math.max(1, (maxLineChars - 1) * charSpacing);
        const boardHeight = Math.max(1, (lines.length - 1) * lineSpacing);
        const viewport = getViewportSizeAtDepth(camera, Math.abs(groupCamRelPos.z));
        const usableBoardWidth = viewport.width * 0.76;
        const usableBoardHeight = viewport.height * 0.58;
        const boardFitScale = clamp(
            Math.min(usableBoardWidth / boardWidth, usableBoardHeight / boardHeight, 1),
            0.22,
            1
        );
        const effectiveCharSpacing = charSpacing * boardFitScale;
        const effectiveLineSpacing = lineSpacing * boardFitScale;

        const visibleChars = [];
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx];
            const lineHalf = (line.length - 1) * 0.5;
            const yOffset = ((lines.length - 1) * 0.5 - lineIdx) * effectiveLineSpacing;

            for (let charIdx = 0; charIdx < line.length; charIdx++) {
                const glyph = line[charIdx];
                if (glyph === ' ') {
                    continue;
                }

                const xOffset = (charIdx - lineHalf) * effectiveCharSpacing;
                visibleChars.push({
                    glyph,
                    targetX: boardCenter.x + xOffset,
                    targetY: boardCenter.y + yOffset
                });
            }
        }

        const totalLetters = Math.max(visibleChars.length, 1);
        for (let i = 0; i < visibleChars.length; i++) {
            const letter = visibleChars[i];
            const launchRatio = totalLetters > 1 ? i / (totalLetters - 1) : 0;
            const launchDelayMs = sequenceWindowMs * Math.pow(launchRatio, 1.12);

            const sprite = makeTextSpriteFn(letter.glyph, {
                singleGlyph: true,
                canvasW: 256,
                canvasH: 256,
                fontSize: 168,
                scaleX: 21.5 * boardFitScale,
                scaleY: 21.5 * boardFitScale,
                maxWidth: 210
            });

            const startOffset = new threeLib.Vector3(
                letter.targetX + ((Math.random() - 0.5) * 120),
                letter.targetY + 28 + (Math.random() * 56),
                -95 - (Math.random() * 95)
            );
            const targetOffset = new threeLib.Vector3(letter.targetX, letter.targetY, 0);

            tmpWorldPos.copy(groupCamRelPos).add(startOffset).applyMatrix4(camera.matrixWorld);
            sprite.position.copy(tmpWorldPos);

            sprite.userData = {
                spawnedAt: nowMs,
                totalDuration,
                fadeOutDur,
                postAssemblyStartMs,
                launchDelayMs,
                travelDurationMs,
                groupCamRelPos: groupCamRelPos.clone(),
                recedingSpeed,
                lateralDrift: lateralDrift.clone(),
                startOffset,
                targetOffset,
                baseScaleX: sprite.scale.x,
                baseScaleY: sprite.scale.y
            };

            scene.add(sprite);
            sprites.push(sprite);
        }
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

            if (!userData.groupCamRelPos || !userData.startOffset || !userData.targetOffset) {
                continue;
            }

            const isPostAssembly = age >= userData.postAssemblyStartMs;
            if (isPostAssembly) {
                userData.groupCamRelPos.z -= userData.recedingSpeed * textDelta;
                userData.groupCamRelPos.x += userData.lateralDrift.x * textDelta;
                userData.groupCamRelPos.y += userData.lateralDrift.y * textDelta;
            }

            const travelAge = age - userData.launchDelayMs;
            let letterMix = 0;
            if (travelAge >= userData.travelDurationMs) {
                letterMix = 1;
            } else if (travelAge > 0) {
                const t = clamp(travelAge / userData.travelDurationMs, 0, 1);
                letterMix = t * t * (3 - (2 * t));
            }

            tmpWorldPos
                .copy(userData.startOffset)
                .lerp(userData.targetOffset, letterMix)
                .add(userData.groupCamRelPos)
                .applyMatrix4(camera.matrixWorld);
            sprite.position.copy(tmpWorldPos);

            const sequenceOpacity = travelAge <= 0 ? 0 : (0.18 + (0.82 * letterMix));

            const baseOpacity = isPostAssembly
                ? 1.0 - ((age - userData.postAssemblyStartMs) / userData.fadeOutDur)
                : 1.0;

            let scaleMul = 1.22;
            if (letterMix > 0) {
                scaleMul = 1.22 - (0.22 * letterMix);
            }
            if (letterMix >= 1) {
                scaleMul = 1;
            }

            sprite.scale.set(
                userData.baseScaleX * scaleMul,
                userData.baseScaleY * scaleMul,
                1
            );
            sprite.material.opacity = Math.max(0, baseOpacity) * Math.max(0, sequenceOpacity) * 0.90;
        }

        lastAnimateNow = now;
    }

    return {
        spawn,
        update
    };
}
