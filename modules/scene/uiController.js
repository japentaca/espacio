'use strict';

export function createUiController({ refs, cameraView, cameraModeSwitch, scheduleNextModeSwitch, switchOrbitModeSmooth, timeNow = () => performance.now() }) {
    let fpsVisible = false;
    let fpsHud = null;

    function createFpsHud() {
        fpsHud = document.createElement('div');
        fpsHud.id = 'fps-hud';
        fpsHud.textContent = 'FPS --';
        fpsHud.style.position = 'fixed';
        fpsHud.style.top = '10px';
        fpsHud.style.right = '10px';
        fpsHud.style.padding = '4px 8px';
        fpsHud.style.fontFamily = 'monospace';
        fpsHud.style.fontSize = '12px';
        fpsHud.style.color = '#9ff0ff';
        fpsHud.style.background = 'rgba(0, 0, 0, 0.55)';
        fpsHud.style.border = '1px solid rgba(159, 240, 255, 0.55)';
        fpsHud.style.borderRadius = '4px';
        fpsHud.style.zIndex = '9999';
        fpsHud.style.pointerEvents = 'none';
        fpsHud.style.display = 'none';
        document.body.appendChild(fpsHud);
        return fpsHud;
    }

    function updateFps(now, fpsState) {
        fpsState.frames++;

        if (fpsState.lastSampleAt === 0) {
            fpsState.lastSampleAt = now;
        }

        const fpsElapsed = now - fpsState.lastSampleAt;
        if (fpsElapsed >= 250) {
            const fpsValue = (fpsState.frames * 1000) / fpsElapsed;
            fpsState.frames = 0;
            fpsState.lastSampleAt = now;
            if (fpsHud && fpsVisible) {
                fpsHud.textContent = `FPS ${fpsValue.toFixed(1)}`;
            }
        }
    }

    function onKeyDown(event) {
        if (!event || !event.key) {
            return;
        }

        const key = event.key.toLowerCase();

        if (key === 'f') {
            fpsVisible = !fpsVisible;
            if (fpsHud) {
                fpsHud.style.display = fpsVisible ? 'block' : 'none';
            }
        }

        if (key === 't') {
            cameraView.topDown = !cameraView.topDown;
            if (cameraView.topDown) {
                cameraView.planetTour = false;
                cameraModeSwitch.active = false;
            } else {
                scheduleNextModeSwitch(timeNow());
            }
        }

        if (key === 'o') {
            switchOrbitModeSmooth(!cameraView.planetTour, timeNow());
        }
    }

    function onWindowResize() {
        const camera = refs.camera;
        const renderer = refs.renderer;

        if (!camera || !renderer) {
            return;
        }

        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    return {
        createFpsHud,
        updateFps,
        onKeyDown,
        onWindowResize
    };
}
