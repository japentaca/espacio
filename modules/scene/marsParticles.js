'use strict';

function createMarsParticleTexture(style, threeLib) {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const cx = size * 0.5;
    const cy = size * 0.5;

    ctx.clearRect(0, 0, size, size);

    if (style === 'smoke') {
        const smokeGradient = ctx.createRadialGradient(cx, cy, size * 0.08, cx, cy, size * 0.5);
        smokeGradient.addColorStop(0, 'rgba(255, 140, 76, 0.58)');
        smokeGradient.addColorStop(0.3, 'rgba(156, 46, 26, 0.46)');
        smokeGradient.addColorStop(0.7, 'rgba(50, 16, 12, 0.3)');
        smokeGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = smokeGradient;
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.49, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(255, 188, 125, 0.18)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.25, 0.35, 5.4);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
    } else {
        const emberGradient = ctx.createRadialGradient(cx, cy, size * 0.03, cx, cy, size * 0.5);
        emberGradient.addColorStop(0, 'rgba(255, 255, 225, 1)');
        emberGradient.addColorStop(0.16, 'rgba(255, 214, 120, 0.98)');
        emberGradient.addColorStop(0.44, 'rgba(255, 116, 28, 0.86)');
        emberGradient.addColorStop(0.78, 'rgba(165, 24, 12, 0.35)');
        emberGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = emberGradient;
        ctx.beginPath();
        const points = 12;
        for (let i = 0; i <= points; i++) {
            const angle = ((i / points) * Math.PI * 2) - (Math.PI * 0.5);
            const radius = (i % 2 === 0) ? (size * 0.46) : (size * 0.2);
            const px = cx + (Math.cos(angle) * radius);
            const py = cy + (Math.sin(angle) * radius);
            if (i === 0) {
                ctx.moveTo(px, py);
            } else {
                ctx.lineTo(px, py);
            }
        }
        ctx.closePath();
        ctx.fill();

        const coreGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.24);
        coreGradient.addColorStop(0, 'rgba(255, 250, 214, 0.95)');
        coreGradient.addColorStop(0.4, 'rgba(255, 180, 82, 0.82)');
        coreGradient.addColorStop(1, 'rgba(255, 90, 20, 0)');
        ctx.fillStyle = coreGradient;
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.24, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(255, 244, 193, 0.65)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
            const angle = -0.55 + (i * 0.55);
            ctx.beginPath();
            ctx.moveTo(
                cx + (Math.cos(angle + Math.PI) * size * 0.15),
                cy + (Math.sin(angle + Math.PI) * size * 0.15)
            );
            ctx.lineTo(
                cx + (Math.cos(angle) * size * 0.46),
                cy + (Math.sin(angle) * size * 0.46)
            );
            ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
    }

    const texture = new threeLib.CanvasTexture(canvas);
    texture.minFilter = threeLib.LinearFilter;
    texture.magFilter = threeLib.LinearFilter;
    texture.wrapS = threeLib.ClampToEdgeWrapping;
    texture.wrapT = threeLib.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
}

function getMarsParticleTexture(style, textureCache, threeLib) {
    if (!textureCache[style]) {
        textureCache[style] = createMarsParticleTexture(style, threeLib);
    }
    return textureCache[style];
}

export function addMarsParticles(parent, particleStore, textureCache, threeLib, partykalsLib) {
    const emberSystem = new partykalsLib.ParticlesSystem({
        container: parent,
        particles: {
            ttl: new partykalsLib.Randomizers.MinMaxRandomizer(0.8, 1.8),
            startSize: new partykalsLib.Randomizers.MinMaxRandomizer(5.2, 9.4),
            endSize: new partykalsLib.Randomizers.MinMaxRandomizer(0.6, 2.2),
            startSizeChangeAt: new partykalsLib.Randomizers.MinMaxRandomizer(0.04, 0.2),
            startAlpha: new partykalsLib.Randomizers.MinMaxRandomizer(0.247, 0.333),
            endAlpha: new partykalsLib.Randomizers.MinMaxRandomizer(0, 0.047),
            startAlphaChangeAt: new partykalsLib.Randomizers.MinMaxRandomizer(0.16, 0.34),
            velocity: new partykalsLib.Randomizers.SphereRandomizer(11.5),
            velocityBonus: new threeLib.Vector3(0, 1.25, 0),
            offset: new partykalsLib.Randomizers.SphereRandomizer(10),
            startColor: new partykalsLib.Randomizers.ColorsRandomizer(
                new threeLib.Color(1, 0.86, 0.28),
                new threeLib.Color(1, 0.42, 0.06)
            ),
            endColor: new partykalsLib.Randomizers.ColorsRandomizer(
                new threeLib.Color(0.72, 0.09, 0.03),
                new threeLib.Color(0.28, 0.02, 0.02)
            ),
            rotation: new partykalsLib.Randomizers.MinMaxRandomizer(0, Math.PI * 2),
            rotationSpeed: new partykalsLib.Randomizers.MinMaxRandomizer(-3.8, 3.8),
            texture: getMarsParticleTexture('ember', textureCache, threeLib),
            blending: 'additive'
        },
        system: {
            particlesCount: 660,
            depthWrite: false,
            emitters: new partykalsLib.Emitter({
                onInterval: new partykalsLib.Randomizers.MinMaxRandomizer(3, 9),
                interval: new partykalsLib.Randomizers.MinMaxRandomizer(0.02, 0.08)
            }),
            speed: 1
        }
    });

    const smokeSystem = new partykalsLib.ParticlesSystem({
        container: parent,
        particles: {
            ttl: new partykalsLib.Randomizers.MinMaxRandomizer(1.6, 2.9),
            globalSize: 6,
            startAlpha: new partykalsLib.Randomizers.MinMaxRandomizer(0.073, 0.14),
            endAlpha: 0,
            startAlphaChangeAt: new partykalsLib.Randomizers.MinMaxRandomizer(0.1, 0.28),
            velocity: new partykalsLib.Randomizers.SphereRandomizer(4.7),
            velocityBonus: new threeLib.Vector3(0, 0.9, 0),
            offset: new partykalsLib.Randomizers.SphereRandomizer(10.75),
            startColor: new partykalsLib.Randomizers.ColorsRandomizer(
                new threeLib.Color(0.62, 0.2, 0.11),
                new threeLib.Color(0.43, 0.08, 0.06)
            ),
            endColor: new partykalsLib.Randomizers.ColorsRandomizer(
                new threeLib.Color(0.1, 0.05, 0.04),
                new threeLib.Color(0.03, 0.02, 0.02)
            ),
            rotation: new partykalsLib.Randomizers.MinMaxRandomizer(0, Math.PI * 2),
            rotationSpeed: new partykalsLib.Randomizers.MinMaxRandomizer(-1.1, 1.1),
            texture: getMarsParticleTexture('smoke', textureCache, threeLib),
            blending: 'blend'
        },
        system: {
            particlesCount: 320,
            depthWrite: false,
            emitters: new partykalsLib.Emitter({
                onInterval: new partykalsLib.Randomizers.MinMaxRandomizer(1, 4),
                interval: new partykalsLib.Randomizers.MinMaxRandomizer(0.05, 0.2)
            }),
            speed: 1
        }
    });

    particleStore.push(emberSystem, smokeSystem);
    return emberSystem;
}
