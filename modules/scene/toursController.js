'use strict';

export function createToursController({ threeLib, state, refs, timeNow = () => performance.now() }) {
    const {
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
    } = state;

    function getCamera() {
        return refs.camera || null;
    }

    function getProbeObj() {
        return refs.probeObj || null;
    }

    function getProbePathLine() {
        return refs.probePathLine || null;
    }

    function getRandomModeSwitchDelayMs() {
        return cameraModeSwitch.minSwitchMs + Math.random() * (cameraModeSwitch.maxSwitchMs - cameraModeSwitch.minSwitchMs);
    }

    function scheduleNextModeSwitch(nowMs) {
        const now = nowMs || timeNow();
        cameraModeSwitch.nextSwitchAt = now + getRandomModeSwitchDelayMs();
    }

    function switchOrbitModeSmooth(enableSonda, nowMs) {
        const now = nowMs || timeNow();
        const camera = getCamera();

        if (!camera) {
            return;
        }

        if (cameraView.topDown) {
            cameraView.topDown = false;
        }

        if (cameraView.planetTour === enableSonda) {
            scheduleNextModeSwitch(now);
            return;
        }

        cameraModeSwitch.active = true;
        cameraModeSwitch.startedAt = now;
        cameraModeSwitch.startPos.copy(camera.position);
        cameraModeSwitch.startQuat.copy(camera.quaternion);

        if (enableSonda) {
            startPlanetTour(now);
            cameraView.planetTour = true;
        } else {
            cameraView.planetTour = false;
        }

        scheduleNextModeSwitch(now);
    }

    function startPlanetTour(nowMs) {
        const camera = getCamera();

        if (!camera || cameraTourTargets.length === 0) {
            cameraView.planetTour = false;
            return;
        }

        rebuildCameraTourOrder();

        cameraTour.index = 0;
        cameraTour.phase = 'approach';
        cameraTour.phaseStartedAt = nowMs || timeNow();
        cameraTour.angle = 0;
        cameraTour.transferFromIndex = 0;
        cameraTour.transferToIndex = cameraTourOrder.length > 1 ? 1 : 0;
        cameraTour.initialized = false;
        cameraTourWork.virtualPos.copy(camera.position);
        cameraTourWork.virtualQuat.copy(camera.quaternion);
        seedPlanetTourAngleForCurrentTarget();
    }

    function rebuildCameraTourOrder(anchorTarget = null) {
        cameraTourOrder.length = 0;

        for (let i = 0; i < cameraTourTargets.length; i++) {
            cameraTourOrder.push(cameraTourTargets[i]);
        }

        for (let i = cameraTourOrder.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const temp = cameraTourOrder[i];
            cameraTourOrder[i] = cameraTourOrder[j];
            cameraTourOrder[j] = temp;
        }

        if (anchorTarget) {
            const anchorIdx = cameraTourOrder.indexOf(anchorTarget);
            if (anchorIdx > 0) {
                const temp = cameraTourOrder[0];
                cameraTourOrder[0] = cameraTourOrder[anchorIdx];
                cameraTourOrder[anchorIdx] = temp;
            }
        }
    }

    function getCameraTourTarget(index) {
        if (cameraTourOrder.length === 0) {
            rebuildCameraTourOrder();
        }

        if (cameraTourOrder.length === 0) {
            return null;
        }
        return cameraTourOrder[index % cameraTourOrder.length] || null;
    }

    function getTargetOrbitRadius(target) {
        return (target && target.geometry && target.geometry.parameters && target.geometry.parameters.radius)
            ? target.geometry.parameters.radius
            : 18;
    }

    function setEquatorialOrbitOffset(target, angle, radiusMajor, radiusMinor, outOffset) {
        if (!target) {
            outOffset.set(0, 0, 0);
            return;
        }

        target.getWorldQuaternion(equatorBasisWork.quat);
        equatorBasisWork.up.set(0, 1, 0).applyQuaternion(equatorBasisWork.quat).normalize();
        equatorBasisWork.ref.set(1, 0, 0);

        if (Math.abs(equatorBasisWork.up.dot(equatorBasisWork.ref)) > 0.92) {
            equatorBasisWork.ref.set(0, 0, 1);
        }

        equatorBasisWork.axisA.copy(equatorBasisWork.ref)
            .addScaledVector(equatorBasisWork.up, -equatorBasisWork.ref.dot(equatorBasisWork.up));

        if (equatorBasisWork.axisA.lengthSq() < 0.000001) {
            equatorBasisWork.axisA.set(0, 0, 1);
        } else {
            equatorBasisWork.axisA.normalize();
        }

        equatorBasisWork.axisB.crossVectors(equatorBasisWork.up, equatorBasisWork.axisA).normalize();

        outOffset.copy(equatorBasisWork.axisA).multiplyScalar(Math.cos(angle) * radiusMajor);
        outOffset.addScaledVector(equatorBasisWork.axisB, Math.sin(angle) * radiusMinor);
    }

    function rebuildProbeTourOrder(anchorTarget = null) {
        probeTourOrder.length = 0;

        for (let i = 0; i < probeTargets.length; i++) {
            probeTourOrder.push(probeTargets[i]);
        }

        for (let i = probeTourOrder.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const temp = probeTourOrder[i];
            probeTourOrder[i] = probeTourOrder[j];
            probeTourOrder[j] = temp;
        }

        if (anchorTarget) {
            const anchorIdx = probeTourOrder.indexOf(anchorTarget);
            if (anchorIdx > 0) {
                const temp = probeTourOrder[0];
                probeTourOrder[0] = probeTourOrder[anchorIdx];
                probeTourOrder[anchorIdx] = temp;
            }
        }
    }

    function getProbeTourTarget(index) {
        if (probeTourOrder.length === 0) {
            rebuildProbeTourOrder();
        }

        if (probeTourOrder.length === 0) {
            return null;
        }
        return probeTourOrder[index % probeTourOrder.length] || null;
    }

    function getProbeOrbitDistance(targetRadius) {
        const baseDistance = threeLib.MathUtils.clamp(
            (targetRadius * 2.2) + probeTour.distancePadding,
            probeTour.minDistance,
            probeTour.maxDistance
        );
        return targetRadius + ((baseDistance - targetRadius) / 3);
    }

    function startProbeTour(nowMs) {
        const probeObj = getProbeObj();

        if (!probeObj || probeTargets.length === 0) {
            return;
        }

        rebuildProbeTourOrder();
        const now = nowMs || timeNow();
        probeTour.index = 0;
        probeTour.phase = 'approach';
        probeTour.phaseStartedAt = now;
        probeTour.angle = 0;
        probeTour.transferFromIndex = 0;
        probeTour.transferToIndex = probeTourOrder.length > 1 ? 1 : 0;
        probeTour.initialized = false;

        const firstTarget = getProbeTourTarget(0);
        if (firstTarget) {
            firstTarget.getWorldPosition(probeTourWork.targetPos);
            const targetRadius = getTargetOrbitRadius(firstTarget);
            const spawnDistance = getProbeOrbitDistance(targetRadius) * 1.35;

            probeObj.position.copy(probeTourWork.targetPos).add(
                new threeLib.Vector3(spawnDistance, (targetRadius * 1.4) + probeTour.baseHeight + 26, 0)
            );
            probeWork.prevPos.copy(probeObj.position);
        }

        seedProbeTourAngleForCurrentTarget();
    }

    function seedProbeTourAngleForCurrentTarget() {
        const probeObj = getProbeObj();

        if (!probeObj || probeTargets.length === 0) {
            return;
        }

        const target = getProbeTourTarget(probeTour.index);
        if (!target) {
            return;
        }

        target.getWorldPosition(probeTourWork.targetPos);
        probeTour.angle = Math.atan2(
            probeObj.position.z - probeTourWork.targetPos.z,
            probeObj.position.x - probeTourWork.targetPos.x
        );
    }

    function updateProbeRouteLine(nowMs, force = false) {
        const probePathLine = getProbePathLine();

        if (!probePathLine || probeTargets.length === 0) {
            return;
        }

        if (probeTourOrder.length === 0) {
            rebuildProbeTourOrder();
        }

        const now = nowMs || timeNow();
        if (!force && ((now - probeState.lastRouteUpdateAt) < probeState.routeUpdateMs)) {
            return;
        }

        const routePoints = [];
        for (let i = 0; i < probeTourOrder.length; i++) {
            routePoints.push(probeTourOrder[i].getWorldPosition(new threeLib.Vector3()));
        }
        if (routePoints.length > 1) {
            routePoints.push(routePoints[0].clone());
        }

        probePathLine.geometry.dispose();
        probePathLine.geometry = new threeLib.BufferGeometry().setFromPoints(routePoints);
        probeState.lastRouteUpdateAt = now;
    }

    function updateProbeTour(now, deltaSec) {
        const probeObj = getProbeObj();
        const probePathLine = getProbePathLine();

        if (!probeObj || probeTargets.length === 0) {
            return;
        }

        if (probePathLine) {
            updateProbeRouteLine(now);
        }

        let phaseElapsed = now - probeTour.phaseStartedAt;

        if (probeTour.phase === 'approach' && phaseElapsed >= probeTour.approachMs) {
            probeTour.phase = 'orbit';
            probeTour.phaseStartedAt = now;
            phaseElapsed = 0;
        } else if (probeTour.phase === 'orbit' && phaseElapsed >= probeTour.orbitMs) {
            if (probeTourOrder.length <= 1) {
                probeTour.phaseStartedAt = now;
                phaseElapsed = 0;
            } else {
                const currentTarget = getProbeTourTarget(probeTour.index);
                const reachedLoopEnd = probeTour.index >= (probeTourOrder.length - 1);

                probeTour.phase = 'transfer';
                if (reachedLoopEnd && currentTarget) {
                    rebuildProbeTourOrder(currentTarget);
                    probeTour.index = 0;
                    probeTour.transferFromIndex = 0;
                    probeTour.transferToIndex = probeTourOrder.length > 1 ? 1 : 0;
                } else {
                    probeTour.transferFromIndex = probeTour.index;
                    probeTour.transferToIndex = probeTour.index + 1;
                }
                probeTour.phaseStartedAt = now;
                phaseElapsed = 0;
                probeTourWork.fromDesiredPos.copy(probeObj.position);

                const fromTarget = getProbeTourTarget(probeTour.transferFromIndex);
                if (fromTarget) {
                    fromTarget.getWorldPosition(probeTourWork.fromTargetPos);
                } else {
                    probeTourWork.fromTargetPos.copy(probeObj.position).addScaledVector(probeWork.tan, 40);
                }
            }
        } else if (probeTour.phase === 'transfer' && phaseElapsed >= probeTour.transferMs) {
            probeTour.index = probeTour.transferToIndex;
            probeTour.phase = 'orbit';
            probeTour.phaseStartedAt = now;
            phaseElapsed = 0;
            seedProbeTourAngleForCurrentTarget();
        }

        const orbitAngularSpeed = (Math.PI * 2 * probeTour.turnsPerPlanet) / (probeTour.orbitMs * 0.001);
        let angularSpeed = orbitAngularSpeed;
        if (probeTour.phase === 'approach') {
            angularSpeed = probeTour.approachAngularSpeed;
        } else if (probeTour.phase === 'transfer') {
            angularSpeed = probeTour.transferAngularSpeed;
        }
        probeTour.angle += angularSpeed * deltaSec;
        const orbitAngle = probeTour.angle;

        if (probeTour.phase === 'transfer') {
            const toTarget = getProbeTourTarget(probeTour.transferToIndex);
            if (!toTarget) {
                return;
            }

            toTarget.getWorldPosition(probeTourWork.toTargetPos);
            const toRadius = getTargetOrbitRadius(toTarget);
            const toDistance = getProbeOrbitDistance(toRadius);
            const toHeight = (toRadius * 1.15) + probeTour.baseHeight;
            const transferProgress = threeLib.MathUtils.clamp(phaseElapsed / probeTour.transferMs, 0, 1);
            const smoothTransfer = transferProgress * transferProgress * (3 - (2 * transferProgress));
            const lookBlendRaw = threeLib.MathUtils.clamp(
                (smoothTransfer - probeTour.transferLookDelay) / (1 - probeTour.transferLookDelay),
                0,
                1
            );
            const smoothLookBlend = lookBlendRaw * lookBlendRaw * (3 - (2 * lookBlendRaw));
            const verticalBlendRaw = threeLib.MathUtils.clamp(
                (smoothTransfer - probeTour.transferVerticalDelay) / (1 - probeTour.transferVerticalDelay),
                0,
                1
            );
            const smoothVerticalBlend = verticalBlendRaw * verticalBlendRaw * (3 - (2 * verticalBlendRaw));
            const transferDistanceScale = threeLib.MathUtils.lerp(1.34, probeTour.transferArrivalScale, smoothTransfer);
            const transferHeightScale = threeLib.MathUtils.lerp(1.16, 1.0, smoothTransfer);

            probeTourWork.toOffset.set(
                Math.cos(orbitAngle + probeTour.transferArcOffset) * toDistance * transferDistanceScale,
                (toHeight * transferHeightScale) + (Math.sin((now * 0.0012) + (probeTour.transferToIndex * 0.25)) * 1.5),
                Math.sin(orbitAngle + probeTour.transferArcOffset) * toDistance * probeTour.orbitEllipseRatio * transferDistanceScale
            );
            probeTourWork.toDesiredPos.copy(probeTourWork.toTargetPos).add(probeTourWork.toOffset);

            probeTourWork.desiredPos.lerpVectors(probeTourWork.fromDesiredPos, probeTourWork.toDesiredPos, smoothTransfer);
            probeTourWork.desiredPos.y = threeLib.MathUtils.lerp(
                probeTourWork.fromDesiredPos.y,
                probeTourWork.toDesiredPos.y,
                smoothVerticalBlend
            );
            probeTourWork.desiredLook.lerpVectors(probeTourWork.fromTargetPos, probeTourWork.toTargetPos, smoothLookBlend);
            probeTourWork.desiredLook.y += toRadius * 0.22 * smoothLookBlend;
        } else {
            const target = getProbeTourTarget(probeTour.index);
            if (!target) {
                return;
            }

            target.getWorldPosition(probeTourWork.targetPos);
            const targetRadius = getTargetOrbitRadius(target);
            const orbitDistance = getProbeOrbitDistance(targetRadius);
            const orbitHeight = (targetRadius * 1.15) + probeTour.baseHeight;

            if (probeTour.phase === 'approach') {
                const progress = threeLib.MathUtils.clamp(phaseElapsed / probeTour.approachMs, 0, 1);
                const smoothProgress = progress * progress * (3 - (2 * progress));
                const approachDistance = threeLib.MathUtils.lerp(orbitDistance * 2.0, orbitDistance, smoothProgress);
                const approachHeight = threeLib.MathUtils.lerp(orbitHeight * 1.6, orbitHeight, smoothProgress);

                probeTourWork.offset.set(
                    Math.cos(orbitAngle) * approachDistance,
                    approachHeight + (Math.sin((now * 0.0012) + (probeTour.index * 0.22)) * 2.4),
                    Math.sin(orbitAngle) * approachDistance * probeTour.orbitEllipseRatio
                );
            } else {
                const distancePulse = 1 + (Math.sin((now * 0.0019) + (probeTour.index * 1.1)) * 0.06);

                setEquatorialOrbitOffset(
                    target,
                    orbitAngle,
                    orbitDistance * distancePulse,
                    orbitDistance * probeTour.orbitEllipseRatio * distancePulse,
                    probeTourWork.offset
                );
            }

            probeTourWork.desiredPos.copy(probeTourWork.targetPos).add(probeTourWork.offset);
            probeTourWork.desiredLook.copy(probeTourWork.targetPos);
            if (probeTour.phase !== 'orbit') {
                probeTourWork.desiredLook.y += targetRadius * 0.2;
            }
        }

        if (!probeTour.initialized) {
            probeTour.initialized = true;
            probeTourWork.smoothedPos.copy(probeTourWork.desiredPos);
            probeTourWork.smoothedLook.copy(probeTourWork.desiredLook);
        }

        const positionAlpha = threeLib.MathUtils.clamp(1 - Math.exp(-probeTour.positionDamping * deltaSec), 0.02, 0.24);
        const lookAlpha = threeLib.MathUtils.clamp(1 - Math.exp(-probeTour.lookDamping * deltaSec), 0.03, 0.28);
        probeTourWork.smoothedPos.lerp(probeTourWork.desiredPos, positionAlpha);
        probeTourWork.smoothedLook.lerp(probeTourWork.desiredLook, lookAlpha);

        probeWork.prevPos.copy(probeObj.position);
        probeObj.position.copy(probeTourWork.smoothedPos);

        probeWork.tan.copy(probeObj.position).sub(probeWork.prevPos);
        if (probeWork.tan.lengthSq() < 0.000001) {
            probeWork.tan.copy(probeTourWork.smoothedLook).sub(probeObj.position);
        }
        if (probeWork.tan.lengthSq() < 0.000001) {
            probeWork.tan.set(0, 0, 1);
        } else {
            probeWork.tan.normalize();
        }

        probeWork.look.copy(probeObj.position).add(probeWork.tan);
        probeObj.lookAt(probeWork.look);
    }

    function seedPlanetTourAngleForCurrentTarget() {
        const camera = getCamera();

        if (!camera || cameraTourTargets.length === 0) {
            return;
        }

        const target = getCameraTourTarget(cameraTour.index);
        if (!target) {
            return;
        }

        target.getWorldPosition(cameraTourWork.targetPos);
        cameraTour.angle = Math.atan2(
            camera.position.z - cameraTourWork.targetPos.z,
            camera.position.x - cameraTourWork.targetPos.x
        );
    }

    function updatePlanetTourCamera(now, deltaSec) {
        const camera = getCamera();

        if (!camera || cameraTourTargets.length === 0) {
            return;
        }

        if (cameraTourOrder.length === 0) {
            rebuildCameraTourOrder();
            if (cameraTourOrder.length === 0) {
                return;
            }
        }

        let phaseElapsed = now - cameraTour.phaseStartedAt;

        if (cameraTour.phase === 'approach' && phaseElapsed >= cameraTour.approachMs) {
            cameraTour.phase = 'orbit';
            cameraTour.phaseStartedAt = now;
            phaseElapsed = 0;
        } else if (cameraTour.phase === 'orbit' && phaseElapsed >= cameraTour.orbitMs) {
            if (cameraTourOrder.length <= 1) {
                cameraTour.phaseStartedAt = now;
                phaseElapsed = 0;
            } else {
                const currentTarget = getCameraTourTarget(cameraTour.index);
                const reachedLoopEnd = cameraTour.index >= (cameraTourOrder.length - 1);

                cameraTour.phase = 'transfer';
                if (reachedLoopEnd && currentTarget) {
                    rebuildCameraTourOrder(currentTarget);
                    cameraTour.index = 0;
                    cameraTour.transferFromIndex = 0;
                    cameraTour.transferToIndex = 1;
                } else {
                    cameraTour.transferFromIndex = cameraTour.index;
                    cameraTour.transferToIndex = cameraTour.index + 1;
                }
                cameraTour.phaseStartedAt = now;
                phaseElapsed = 0;
                cameraTourWork.fromDesiredPos.copy(camera.position);
                if (cameraTour.initialized) {
                    cameraTourWork.fromTargetPos.copy(cameraTourWork.smoothedLook);
                } else {
                    camera.getWorldDirection(cameraTourWork.fromOffset);
                    cameraTourWork.fromTargetPos.copy(camera.position).addScaledVector(cameraTourWork.fromOffset, 140);
                }
            }
        } else if (cameraTour.phase === 'transfer' && phaseElapsed >= cameraTour.transferMs) {
            cameraTour.index = cameraTour.transferToIndex;
            cameraTour.phase = 'orbit';
            cameraTour.phaseStartedAt = now;
            phaseElapsed = 0;
            seedPlanetTourAngleForCurrentTarget();
        }

        const orbitAngularSpeed = (Math.PI * 2 * cameraTour.turnsPerPlanet) / (cameraTour.orbitMs * 0.001);
        let angularSpeed = orbitAngularSpeed;
        if (cameraTour.phase === 'approach') {
            angularSpeed = cameraTour.approachAngularSpeed;
        } else if (cameraTour.phase === 'transfer') {
            angularSpeed = cameraTour.transferAngularSpeed;
        }

        cameraTour.angle += angularSpeed * deltaSec;
        const orbitAngle = cameraTour.angle;

        let transferProgressForTurn = 0;

        if (cameraTour.phase === 'transfer') {
            const toTarget = getCameraTourTarget(cameraTour.transferToIndex);
            if (!toTarget) {
                return;
            }

            toTarget.getWorldPosition(cameraTourWork.toTargetPos);
            const toRadius = getTargetOrbitRadius(toTarget);
            const toDistance = threeLib.MathUtils.clamp(
                (toRadius * 4.4) + cameraTour.distancePadding,
                cameraTour.minDistance,
                cameraTour.maxDistance
            );
            const toHeight = (toRadius * 1.6) + cameraTour.baseHeight;
            const transferProgress = threeLib.MathUtils.clamp(phaseElapsed / cameraTour.transferMs, 0, 1);
            const smoothTransfer = transferProgress * transferProgress * (3 - (2 * transferProgress));
            transferProgressForTurn = smoothTransfer;
            const smoothLookBlend = smoothTransfer;
            const verticalBlendRaw = threeLib.MathUtils.clamp(
                (smoothTransfer - cameraTour.transferVerticalDelay) / (1 - cameraTour.transferVerticalDelay),
                0,
                1
            );
            const smoothVerticalBlend = verticalBlendRaw * verticalBlendRaw * (3 - (2 * verticalBlendRaw));
            const transferDistanceScale = threeLib.MathUtils.lerp(1.42, cameraTour.transferArrivalScale, smoothTransfer);
            const transferHeightScale = threeLib.MathUtils.lerp(1.18, 1.03, smoothTransfer);
            const transferAngleOffset = threeLib.MathUtils.lerp(0.42, 0.08, smoothTransfer);

            cameraTourWork.toOffset.set(
                Math.cos(orbitAngle + transferAngleOffset) * toDistance * transferDistanceScale,
                (toHeight * transferHeightScale) + (Math.sin((now * 0.001) + (cameraTour.transferToIndex * 0.33)) * 2.2),
                Math.sin(orbitAngle + transferAngleOffset) * toDistance * 0.92 * transferDistanceScale
            );
            cameraTourWork.toDesiredPos.copy(cameraTourWork.toTargetPos).add(cameraTourWork.toOffset);

            cameraTourWork.desiredPos.lerpVectors(cameraTourWork.fromDesiredPos, cameraTourWork.toDesiredPos, smoothTransfer);
            cameraTourWork.desiredPos.y = threeLib.MathUtils.lerp(
                cameraTourWork.fromDesiredPos.y,
                cameraTourWork.toDesiredPos.y,
                smoothVerticalBlend
            );
            cameraTourWork.desiredLook.lerpVectors(cameraTourWork.fromTargetPos, cameraTourWork.toTargetPos, smoothLookBlend);
        } else {
            const target = getCameraTourTarget(cameraTour.index);
            if (!target) {
                return;
            }

            target.getWorldPosition(cameraTourWork.targetPos);
            const targetRadius = getTargetOrbitRadius(target);
            const orbitDistance = threeLib.MathUtils.clamp(
                (targetRadius * 4.4) + cameraTour.distancePadding,
                cameraTour.minDistance,
                cameraTour.maxDistance
            );
            const orbitHeight = (targetRadius * 1.6) + cameraTour.baseHeight;

            if (cameraTour.phase === 'approach') {
                const progress = threeLib.MathUtils.clamp(phaseElapsed / cameraTour.approachMs, 0, 1);
                const smoothProgress = progress * progress * (3 - (2 * progress));
                const approachDistance = threeLib.MathUtils.lerp(orbitDistance * 2.1, orbitDistance, smoothProgress);
                const approachHeight = threeLib.MathUtils.lerp(orbitHeight * 1.65, orbitHeight, smoothProgress);

                cameraTourWork.offset.set(
                    Math.cos(orbitAngle) * approachDistance,
                    approachHeight + (Math.sin((now * 0.0011) + (cameraTour.index * 0.37)) * 3.4),
                    Math.sin(orbitAngle) * approachDistance * 0.92
                );
            } else {
                const distancePulse = 1 + (Math.sin((now * 0.0015) + (cameraTour.index * 1.3)) * 0.08);
                const orbitEntryBlendRaw = threeLib.MathUtils.clamp(phaseElapsed / cameraTour.orbitEntryBlendMs, 0, 1);
                const orbitEntryBlend = orbitEntryBlendRaw * orbitEntryBlendRaw * (3 - (2 * orbitEntryBlendRaw));

                setEquatorialOrbitOffset(
                    target,
                    orbitAngle,
                    orbitDistance * distancePulse,
                    orbitDistance * 0.88 * distancePulse,
                    cameraTourWork.toOffset
                );

                cameraTourWork.fromOffset.set(
                    Math.cos(orbitAngle) * orbitDistance,
                    orbitHeight + (Math.sin((now * 0.0011) + (cameraTour.index * 0.37)) * 3.4),
                    Math.sin(orbitAngle) * orbitDistance * 0.92
                );

                cameraTourWork.offset.lerpVectors(cameraTourWork.fromOffset, cameraTourWork.toOffset, orbitEntryBlend);
            }

            cameraTourWork.desiredPos.copy(cameraTourWork.targetPos).add(cameraTourWork.offset);
            cameraTourWork.desiredLook.copy(cameraTourWork.targetPos);
        }

        if (!cameraTour.initialized) {
            cameraTour.initialized = true;
            cameraTourWork.smoothedLook.copy(cameraTourWork.desiredLook);
            cameraTourWork.smoothedPosY = cameraTourWork.desiredPos.y;
            cameraTourWork.smoothedLookY = cameraTourWork.desiredLook.y;
        }

        const verticalPosAlpha = threeLib.MathUtils.clamp(1 - Math.exp(-cameraTour.verticalPosDamping * deltaSec), 0.008, 0.12);
        const verticalLookAlpha = threeLib.MathUtils.clamp(1 - Math.exp(-cameraTour.verticalLookDamping * deltaSec), 0.008, 0.1);
        cameraTourWork.smoothedPosY += (cameraTourWork.desiredPos.y - cameraTourWork.smoothedPosY) * verticalPosAlpha;
        cameraTourWork.smoothedLookY += (cameraTourWork.desiredLook.y - cameraTourWork.smoothedLookY) * verticalLookAlpha;
        cameraTourWork.desiredPos.y = cameraTourWork.smoothedPosY;
        cameraTourWork.desiredLook.y = cameraTourWork.smoothedLookY;

        const lookDx = cameraTourWork.desiredLook.x - cameraTourWork.virtualPos.x;
        const lookDz = cameraTourWork.desiredLook.z - cameraTourWork.virtualPos.z;
        const planarLookDist = Math.sqrt((lookDx * lookDx) + (lookDz * lookDz));
        if (planarLookDist > 0.001 && cameraTour.phase !== 'orbit') {
            const minPitchTan = Math.tan(threeLib.MathUtils.degToRad(cameraTour.minPitchDeg));
            const maxPitchTan = Math.tan(threeLib.MathUtils.degToRad(cameraTour.maxPitchDeg));
            const desiredPitchTan = (cameraTourWork.desiredLook.y - cameraTourWork.virtualPos.y) / planarLookDist;
            const clampedPitchTan = threeLib.MathUtils.clamp(desiredPitchTan, minPitchTan, maxPitchTan);
            cameraTourWork.desiredLook.y = cameraTourWork.virtualPos.y + (clampedPitchTan * planarLookDist);
        }

        const isOrbitPhase = cameraTour.phase === 'orbit';
        const isTransferPhase = cameraTour.phase === 'transfer';
        const orbitSettle = isOrbitPhase
            ? (() => {
                const orbitSettleRaw = threeLib.MathUtils.clamp(phaseElapsed / cameraTour.orbitEntryBlendMs, 0, 1);
                return orbitSettleRaw * orbitSettleRaw * (3 - (2 * orbitSettleRaw));
            })()
            : 0;
        const positionAlpha = threeLib.MathUtils.clamp(1 - Math.exp(-cameraTour.positionDamping * deltaSec), 0.01, 0.18);
        const lookAlpha = isOrbitPhase
            ? threeLib.MathUtils.lerp(
                threeLib.MathUtils.clamp(1 - Math.exp(-(cameraTour.lookDamping + 1.8) * deltaSec), 0.03, 0.2),
                threeLib.MathUtils.clamp(1 - Math.exp(-(cameraTour.lookDamping + 4.1) * deltaSec), 0.12, 0.5),
                orbitSettle
            )
            : isTransferPhase
                ? threeLib.MathUtils.lerp(
                    threeLib.MathUtils.clamp(1 - Math.exp(-cameraTour.lookDamping * deltaSec), 0.01, 0.12),
                    threeLib.MathUtils.clamp(1 - Math.exp(-(cameraTour.lookDamping + 3.8) * deltaSec), 0.06, 0.38),
                    transferProgressForTurn
                )
                : threeLib.MathUtils.clamp(1 - Math.exp(-cameraTour.lookDamping * deltaSec), 0.01, 0.12);
        const rotationAlpha = isOrbitPhase
            ? threeLib.MathUtils.lerp(
                threeLib.MathUtils.clamp(1 - Math.exp(-(cameraTour.rotationDamping + 1.4) * deltaSec), 0.02, 0.18),
                threeLib.MathUtils.clamp(1 - Math.exp(-(cameraTour.rotationDamping + 4.6) * deltaSec), 0.1, 0.54),
                orbitSettle
            )
            : isTransferPhase
                ? threeLib.MathUtils.lerp(
                    threeLib.MathUtils.clamp(1 - Math.exp(-cameraTour.rotationDamping * deltaSec), 0.01, 0.1),
                    threeLib.MathUtils.clamp(1 - Math.exp(-(cameraTour.rotationDamping + 3.9) * deltaSec), 0.05, 0.36),
                    transferProgressForTurn
                )
                : threeLib.MathUtils.clamp(1 - Math.exp(-cameraTour.rotationDamping * deltaSec), 0.01, 0.1);

        cameraTourWork.virtualPos.lerp(cameraTourWork.desiredPos, positionAlpha);
        cameraTourWork.smoothedLook.lerp(cameraTourWork.desiredLook, lookAlpha);

        camera.up.set(0, 1, 0);
        cameraTourWork.lookMatrix.lookAt(cameraTourWork.virtualPos, cameraTourWork.smoothedLook, camera.up);
        cameraTourWork.desiredQuat.setFromRotationMatrix(cameraTourWork.lookMatrix);
        cameraTourWork.virtualQuat.slerp(cameraTourWork.desiredQuat, rotationAlpha);
        camera.position.copy(cameraTourWork.virtualPos);
        camera.quaternion.copy(cameraTourWork.virtualQuat);
    }

    return {
        scheduleNextModeSwitch,
        switchOrbitModeSmooth,
        startProbeTour,
        updateProbeRouteLine,
        updateProbeTour,
        updatePlanetTourCamera
    };
}
