'use strict';

export function makeTextSprite(text, threeLib) {
    const canvasW = 1024;
    const canvasH = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvasW, canvasH);

    const fontSize = 46;
    ctx.font = `italic ${fontSize}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const maxWidth = canvasW - 100;
    const lineHeight = fontSize * 1.42;
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(testLine).width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    if (currentLine) {
        lines.push(currentLine);
    }

    const totalTextH = lines.length * lineHeight;
    const startY = (canvasH - totalTextH) / 2 + (lineHeight / 2);

    ctx.shadowColor = 'rgba(160, 220, 255, 1.0)';
    ctx.shadowBlur = 32;
    ctx.fillStyle = 'rgba(210, 238, 255, 0.45)';
    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], canvasW / 2, startY + (i * lineHeight));
    }

    ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgba(238, 250, 255, 0.97)';
    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], canvasW / 2, startY + (i * lineHeight));
    }

    const texture = new threeLib.CanvasTexture(canvas);
    const material = new threeLib.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0,
        blending: threeLib.AdditiveBlending,
        depthWrite: false
    });
    const sprite = new threeLib.Sprite(material);
    sprite.scale.set(200, 50, 1);
    return sprite;
}

export function mapRange(value, inMin, inMax, outMin, outMax) {
    return outMin + ((outMax - outMin) * ((value - inMin) / (inMax - inMin)));
}

export function solveKeplerEccentricAnomaly(meanAnomaly, eccentricity) {
    let E = meanAnomaly;
    for (let i = 0; i < 4; i++) {
        const f = E - (eccentricity * Math.sin(E)) - meanAnomaly;
        const fp = 1 - (eccentricity * Math.cos(E));
        E -= f / fp;
    }
    return E;
}

export function getSphereSegments(radius) {
    if (radius >= 90) {
        return { width: 64, height: 48 };
    }
    if (radius >= 30) {
        return { width: 40, height: 28 };
    }
    if (radius >= 14) {
        return { width: 28, height: 18 };
    }
    return { width: 18, height: 12 };
}

export function createFresnelAtmosphere(radius, colorHex, power, intensity, threeLib) {
    const geometry = new threeLib.SphereBufferGeometry(radius, 32, 24);
    const material = new threeLib.ShaderMaterial({
        uniforms: {
            uColor: { value: new threeLib.Color(colorHex) },
            uPower: { value: power },
            uIntensity: { value: intensity },
            uOpacity: { value: 1.0 },
            uCameraPos: { value: new threeLib.Vector3() }
        },
        vertexShader: `
            varying vec3 vWorldPos;
            varying vec3 vWorldNormal;

            void main() {
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vWorldPos = worldPos.xyz;
                vWorldNormal = normalize(mat3(modelMatrix) * normal);
                gl_Position = projectionMatrix * viewMatrix * worldPos;
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uPower;
            uniform float uIntensity;
            uniform float uOpacity;
            uniform vec3 uCameraPos;

            varying vec3 vWorldPos;
            varying vec3 vWorldNormal;

            void main() {
                vec3 viewDir = normalize(uCameraPos - vWorldPos);
                float fresnel = pow(1.0 - max(dot(normalize(vWorldNormal), viewDir), 0.0), uPower);
                float alpha = clamp(fresnel * uIntensity * uOpacity, 0.0, 1.0);
                gl_FragColor = vec4(uColor, alpha);
            }
        `,
        transparent: true,
        blending: threeLib.AdditiveBlending,
        depthWrite: false,
        side: threeLib.BackSide
    });

    return new threeLib.Mesh(geometry, material);
}
