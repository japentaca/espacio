export const getDefaultSceneDefinition = () => ({
    initializeScene: true,
    scene3d: {},
    audioMixer: {},
    audioSetLibrary: {},
    audioQueue: [],
    baseTracks: []
});

export const deepClone = (value) => {
    if (typeof structuredClone === "function") {
        return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value));
};

function normalizeBaseTrackEntry(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
    }

    if (!Array.isArray(entry.tracks)) {
        return null;
    }

    const tracks = entry.tracks
        .filter((path) => typeof path === "string" && path.trim())
        .map((path) => path.trim());

    if (!tracks.length) {
        return null;
    }

    const normalizedEntry = {
        tracks
    };

    if (Number.isFinite(entry.crossfadeSec) && entry.crossfadeSec > 0) {
        normalizedEntry.crossfadeSec = entry.crossfadeSec;
    }

    if (Number.isFinite(entry.holdSec) && entry.holdSec > 0) {
        normalizedEntry.holdSec = entry.holdSec;
    }

    if (Number.isFinite(entry.volumeDb)) {
        normalizedEntry.volumeDb = entry.volumeDb;
    }

    return normalizedEntry;
}

function normalizeAudioMixerConfig(audioMixerConfig, validationWarnings) {
    if (!audioMixerConfig || typeof audioMixerConfig !== "object" || Array.isArray(audioMixerConfig)) {
        return {};
    }

    const normalizedMixer = { ...audioMixerConfig };
    const normalizedBuses = {};
    const usedBusNames = new Set();

    const registerBus = (busName, busDefinition, sourcePath) => {
        if (typeof busName !== "string" || !busName.trim()) {
            validationWarnings.push(`${sourcePath} has an empty bus name`);
            return;
        }

        const safeBusName = busName.trim();
        if (!busDefinition || typeof busDefinition !== "object" || Array.isArray(busDefinition)) {
            validationWarnings.push(`${sourcePath}.${safeBusName} is not a valid object`);
            return;
        }

        if (usedBusNames.has(safeBusName)) {
            validationWarnings.push(`${sourcePath}.${safeBusName} is duplicated`);
            return;
        }

        usedBusNames.add(safeBusName);
        normalizedBuses[safeBusName] = { ...busDefinition };
    };

    if (Array.isArray(audioMixerConfig.aux)) {
        const normalizedAux = [];

        audioMixerConfig.aux.forEach((auxEntry, index) => {
            const auxPath = `audioMixer.aux[${index}]`;
            if (!auxEntry || typeof auxEntry !== "object" || Array.isArray(auxEntry)) {
                validationWarnings.push(`${auxPath} is not a valid object`);
                return;
            }

            const auxName = (typeof auxEntry.name === "string") ? auxEntry.name.trim() : "";
            if (!auxName) {
                validationWarnings.push(`${auxPath} is missing name`);
                return;
            }

            const normalizedAuxEntry = {
                ...auxEntry,
                name: auxName
            };

            normalizedAux.push(normalizedAuxEntry);
            registerBus(auxName, normalizedAuxEntry, "audioMixer.aux");

            const target = (typeof normalizedAuxEntry.target === "string")
                ? normalizedAuxEntry.target.toLowerCase()
                : "";

            if (!normalizedMixer.reverb && (target === "reverb" || target === "impulse")) {
                normalizedMixer.reverb = { ...normalizedAuxEntry };
            }
        });

        normalizedMixer.aux = normalizedAux;
    }

    if (audioMixerConfig.reverb && typeof audioMixerConfig.reverb === "object" && !Array.isArray(audioMixerConfig.reverb)) {
        normalizedMixer.reverb = { ...audioMixerConfig.reverb };

        if (typeof normalizedMixer.reverb.name === "string" && normalizedMixer.reverb.name.trim()) {
            registerBus(normalizedMixer.reverb.name.trim(), {
                ...normalizedMixer.reverb,
                target: "reverb"
            }, "audioMixer.reverb");
        }
    }

    if (audioMixerConfig.buses && typeof audioMixerConfig.buses === "object" && !Array.isArray(audioMixerConfig.buses)) {
        Object.entries(audioMixerConfig.buses).forEach(([busName, busDefinition]) => {
            registerBus(busName, busDefinition, "audioMixer.buses");
        });
    }

    if (Object.keys(normalizedBuses).length) {
        normalizedMixer.buses = normalizedBuses;
    }

    return normalizedMixer;
}

function collectKnownBusNames(audioMixerConfig) {
    const knownBusNames = new Set(["reverb", "delay"]);

    if (!audioMixerConfig || typeof audioMixerConfig !== "object") {
        return knownBusNames;
    }

    if (!audioMixerConfig.buses || typeof audioMixerConfig.buses !== "object") {
        return knownBusNames;
    }

    Object.keys(audioMixerConfig.buses).forEach((busName) => {
        if (typeof busName === "string" && busName.trim()) {
            knownBusNames.add(busName.trim());
        }
    });

    return knownBusNames;
}

function normalizeSetSends(container, path, knownBusNames, validationWarnings) {
    if (!container || typeof container !== "object" || !Array.isArray(container.sends)) {
        return;
    }

    const validSends = container.sends
        .map((sendEntry, index) => {
            if (!sendEntry || typeof sendEntry !== "object" || Array.isArray(sendEntry)) {
                validationWarnings.push(`${path}[${index}] is not a valid send object`);
                return null;
            }

            const busName = (typeof sendEntry.bus === "string") ? sendEntry.bus.trim() : "";
            if (!busName) {
                validationWarnings.push(`${path}[${index}] is missing 'bus'`);
                return null;
            }

            if (!knownBusNames.has(busName)) {
                validationWarnings.push(`${path}[${index}] references unknown bus '${busName}'`);
                return null;
            }

            const normalizedSend = {
                ...sendEntry,
                bus: busName
            };

            if (typeof normalizedSend.tap === "string") {
                const tapValue = normalizedSend.tap.toLowerCase();
                if (tapValue === "pre" || tapValue === "post") {
                    normalizedSend.tap = tapValue;
                } else {
                    validationWarnings.push(`${path}[${index}] has invalid tap '${normalizedSend.tap}', expected 'pre' or 'post'`);
                    delete normalizedSend.tap;
                }
            }

            return normalizedSend;
        })
        .filter(Boolean);

    if (validSends.length) {
        container.sends = validSends;
        return;
    }

    delete container.sends;
}

function normalizeDelayType(value) {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.toLowerCase().replace(/[\s_-]/g, "");
    if (normalized === "pingpong" || normalized === "pingpongdelay") {
        return "pingpong";
    }

    if (normalized === "feedback" || normalized === "feedbackdelay") {
        return "feedback";
    }

    return null;
}

function resolveBusDefinition(audioMixerConfig, busName) {
    if (!audioMixerConfig || typeof audioMixerConfig !== "object") {
        return null;
    }

    if (!audioMixerConfig.buses || typeof audioMixerConfig.buses !== "object") {
        return null;
    }

    if (!Object.prototype.hasOwnProperty.call(audioMixerConfig.buses, busName)) {
        return null;
    }

    const busDefinition = audioMixerConfig.buses[busName];
    if (!busDefinition || typeof busDefinition !== "object" || Array.isArray(busDefinition)) {
        return null;
    }

    return busDefinition;
}

function resolveSendTarget(sendEntry, audioMixerConfig) {
    const busName = sendEntry.bus;
    if (busName === "reverb" || busName === "delay") {
        return busName;
    }

    const busDefinition = resolveBusDefinition(audioMixerConfig, busName);
    const hints = [
        busDefinition && busDefinition.target,
        busDefinition && busDefinition.kind,
        busDefinition && busDefinition.effect,
        busDefinition && busDefinition.family,
        busDefinition && busDefinition.routeTo,
        busDefinition && busDefinition.type,
        busName
    ];

    for (let i = 0; i < hints.length; i += 1) {
        if (typeof hints[i] !== "string") {
            continue;
        }

        const hint = hints[i].toLowerCase();
        if (hint.includes("reverb") || hint === "impulse" || hint === "algorithmic" || hint === "freeverb" || hint === "jcreverb") {
            return "reverb";
        }

        if (hint.includes("delay") || hint === "pingpong" || hint === "feedback") {
            return "delay";
        }
    }

    return null;
}

function getSendLevelDb(sendEntry) {
    if (Number.isFinite(sendEntry.levelDb)) return sendEntry.levelDb;
    if (Number.isFinite(sendEntry.sendDb)) return sendEntry.sendDb;
    if (Number.isFinite(sendEntry.db)) return sendEntry.db;
    if (Number.isFinite(sendEntry.level)) return sendEntry.level;

    return null;
}

function applyDelaySendConfig(sendEntry, effects, busDefinition) {
    const currentDelay = effects.delay;
    const delayConfig = (currentDelay && typeof currentDelay === "object" && !Array.isArray(currentDelay))
        ? { ...currentDelay }
        : {};

    const sendDb = getSendLevelDb(sendEntry);
    if (Number.isFinite(sendDb)) {
        delayConfig.sendDb = sendDb;
    }

    const busDelayType = normalizeDelayType(busDefinition && busDefinition.delayType)
        || normalizeDelayType(busDefinition && busDefinition.type)
        || normalizeDelayType(sendEntry.type);

    if (busDelayType) {
        delayConfig.type = busDelayType;
    }

    const rawTime = (sendEntry.time != null)
        ? sendEntry.time
        : ((busDefinition && busDefinition.time != null)
            ? busDefinition.time
            : (busDefinition && busDefinition.delayTime));

    if (typeof rawTime === "string" || Number.isFinite(rawTime)) {
        delayConfig.time = rawTime;
    }

    const rawFeedback = Number.isFinite(sendEntry.feedback)
        ? sendEntry.feedback
        : (busDefinition && Number.isFinite(busDefinition.feedback) ? busDefinition.feedback : null);

    if (Number.isFinite(rawFeedback)) {
        delayConfig.feedback = rawFeedback;
    }

    const rawWet = Number.isFinite(sendEntry.wet)
        ? sendEntry.wet
        : (busDefinition && Number.isFinite(busDefinition.wet) ? busDefinition.wet : null);

    if (Number.isFinite(rawWet)) {
        delayConfig.wet = rawWet;
    }

    effects.delay = delayConfig;
}

function applySendToEffects(sendEntry, setPath, index, effects, audioMixerConfig, validationWarnings) {
    const sendPath = `${setPath}.sends[${index}]`;
    const levelDb = getSendLevelDb(sendEntry);
    if (!Number.isFinite(levelDb)) {
        validationWarnings.push(`${sendPath} is missing levelDb/sendDb`);
        return;
    }

    if (sendEntry.tap === "pre") {
        validationWarnings.push(`${sendPath} uses tap 'pre', but runtime currently applies sends post-fader`);
    }

    const target = resolveSendTarget(sendEntry, audioMixerConfig);
    if (!target) {
        validationWarnings.push(`${sendPath} could not resolve target effect for bus '${sendEntry.bus}'`);
        return;
    }

    const busDefinition = resolveBusDefinition(audioMixerConfig, sendEntry.bus);
    if (target === "reverb") {
        effects.reverb = levelDb;
        return;
    }

    if (target === "delay") {
        applyDelaySendConfig(sendEntry, effects, busDefinition);
    }
}

function normalizeInsertsToEffects(channel, effects, setPath, validationWarnings) {
    if (!Array.isArray(channel.inserts)) {
        return;
    }

    channel.inserts.forEach((insertEntry, index) => {
        const insertPath = `${setPath}.inserts[${index}]`;
        if (!insertEntry || typeof insertEntry !== "object" || Array.isArray(insertEntry)) {
            validationWarnings.push(`${insertPath} is not a valid insert object`);
            return;
        }

        const insertType = (typeof insertEntry.type === "string") ? insertEntry.type.toLowerCase() : "";
        if (!insertType) {
            validationWarnings.push(`${insertPath} is missing type`);
            return;
        }

        if (insertType === "eq" || insertType === "eq3") {
            const eq = (effects.eq && typeof effects.eq === "object" && !Array.isArray(effects.eq))
                ? { ...effects.eq }
                : {};

            if (Number.isFinite(insertEntry.high)) eq.high = insertEntry.high;
            if (Number.isFinite(insertEntry.mid)) eq.mid = insertEntry.mid;
            if (Number.isFinite(insertEntry.low)) eq.low = insertEntry.low;

            effects.eq = eq;
            return;
        }

        if (insertType === "compressor" || insertType === "multiband" || insertType === "multibandcompressor") {
            const compressor = {};

            if (insertType === "multiband" || insertType === "multibandcompressor") {
                compressor.type = "multiband";
            }

            if (Number.isFinite(insertEntry.threshold)) compressor.threshold = insertEntry.threshold;
            if (Number.isFinite(insertEntry.ratio)) compressor.ratio = insertEntry.ratio;
            if (Number.isFinite(insertEntry.attack)) compressor.attack = insertEntry.attack;
            if (Number.isFinite(insertEntry.release)) compressor.release = insertEntry.release;
            if (Number.isFinite(insertEntry.knee)) compressor.knee = insertEntry.knee;
            if (Number.isFinite(insertEntry.lowFrequency)) compressor.lowFrequency = insertEntry.lowFrequency;
            if (Number.isFinite(insertEntry.highFrequency)) compressor.highFrequency = insertEntry.highFrequency;

            if (insertEntry.low && typeof insertEntry.low === "object") compressor.low = { ...insertEntry.low };
            if (insertEntry.mid && typeof insertEntry.mid === "object") compressor.mid = { ...insertEntry.mid };
            if (insertEntry.high && typeof insertEntry.high === "object") compressor.high = { ...insertEntry.high };

            effects.compressor = compressor;
            return;
        }

        validationWarnings.push(`${insertPath} type '${insertEntry.type}' is not mapped to runtime effects`);
    });
}

function applyConsoleChannelToEffects(setDefinition, setPath, audioMixerConfig, validationWarnings) {
    if (!setDefinition || typeof setDefinition !== "object") {
        return;
    }

    if (!setDefinition.channel || typeof setDefinition.channel !== "object" || Array.isArray(setDefinition.channel)) {
        return;
    }

    const channel = setDefinition.channel;
    const effects = (setDefinition.effects && typeof setDefinition.effects === "object" && !Array.isArray(setDefinition.effects))
        ? { ...setDefinition.effects }
        : {};

    if (Number.isFinite(channel.faderDb) && !Object.prototype.hasOwnProperty.call(effects, "volume")) {
        effects.volume = channel.faderDb;
    }

    normalizeInsertsToEffects(channel, effects, `${setPath}.channel`, validationWarnings);

    if (Array.isArray(channel.sends)) {
        channel.sends.forEach((sendEntry, index) => {
            applySendToEffects(sendEntry, `${setPath}.channel`, index, effects, audioMixerConfig, validationWarnings);
        });
    }

    if (Array.isArray(effects.sends)) {
        effects.sends.forEach((sendEntry, index) => {
            applySendToEffects(sendEntry, `${setPath}.effects`, index, effects, audioMixerConfig, validationWarnings);
        });
    }

    setDefinition.effects = effects;
}

function normalizeAudioSetDefinition(setDefinition, setId, knownBusNames, validationWarnings, audioMixerConfig) {
    const normalizedSet = deepClone(setDefinition);

    if (normalizedSet.channel && typeof normalizedSet.channel === "object" && !Array.isArray(normalizedSet.channel)) {
        normalizeSetSends(normalizedSet.channel, `audioSetLibrary.${setId}.channel.sends`, knownBusNames, validationWarnings);
    }

    if (normalizedSet.effects && typeof normalizedSet.effects === "object" && !Array.isArray(normalizedSet.effects)) {
        normalizeSetSends(normalizedSet.effects, `audioSetLibrary.${setId}.effects.sends`, knownBusNames, validationWarnings);
    }

    applyConsoleChannelToEffects(normalizedSet, `audioSetLibrary.${setId}`, audioMixerConfig, validationWarnings);

    return normalizedSet;
}

export function normalizeSceneDefinition(definition) {
    const defaults = getDefaultSceneDefinition();
    if (!definition || typeof definition !== "object") {
        return defaults;
    }

    const validationWarnings = [];
    const normalized = {
        initializeScene: definition.initializeScene !== false,
        scene3d: {},
        audioMixer: {},
        audioSetLibrary: {},
        audioQueue: [],
        baseTracks: []
    };

    if (definition.scene3d && typeof definition.scene3d === "object" && !Array.isArray(definition.scene3d)) {
        normalized.scene3d = definition.scene3d;
    }

    if (definition.audioMixer && typeof definition.audioMixer === "object" && !Array.isArray(definition.audioMixer)) {
        normalized.audioMixer = normalizeAudioMixerConfig(definition.audioMixer, validationWarnings);
    }

    const knownBusNames = collectKnownBusNames(normalized.audioMixer);

    if (definition.audioSetLibrary && typeof definition.audioSetLibrary === "object") {
        Object.entries(definition.audioSetLibrary).forEach(([id, setDefinition]) => {
            if (typeof id !== "string" || !id.trim()) {
                return;
            }

            if (!setDefinition || typeof setDefinition !== "object") {
                return;
            }

            const safeId = id.trim();
            normalized.audioSetLibrary[safeId] = normalizeAudioSetDefinition(
                setDefinition,
                safeId,
                knownBusNames,
                validationWarnings,
                normalized.audioMixer
            );
        });
    }

    const queueCandidates = Array.isArray(definition.audioQueue)
        ? definition.audioQueue
        : (Array.isArray(definition.audioSets) ? definition.audioSets : []);

    normalized.audioQueue = queueCandidates
        .map((entry, index) => {
            if (typeof entry === "string") {
                return { id: entry.trim() };
            }

            if (!entry || typeof entry !== "object") {
                return null;
            }

            if (entry.definition && typeof entry.definition === "object") {
                const inlineDefinition = normalizeAudioSetDefinition(
                    entry.definition,
                    `@inline${index}`,
                    knownBusNames,
                    validationWarnings,
                    normalized.audioMixer
                );

                return { definition: inlineDefinition };
            }

            if (typeof entry.id === "string" && entry.id.trim()) {
                return { id: entry.id.trim() };
            }

            return null;
        })
        .filter(Boolean)
        .filter((entry) => {
            if (!entry.id) {
                return true;
            }

            if (Object.prototype.hasOwnProperty.call(normalized.audioSetLibrary, entry.id)) {
                return true;
            }

            validationWarnings.push(`audioQueue references unknown audioSetLibrary id '${entry.id}'`);
            return false;
        });

    if (!normalized.audioQueue.length) {
        normalized.audioQueue = defaults.audioQueue;
    }

    if (Array.isArray(definition.baseTracks)) {
        normalized.baseTracks = definition.baseTracks
            .map(normalizeBaseTrackEntry)
            .filter(Boolean);
    }

    if (!normalized.baseTracks.length) {
        normalized.baseTracks = defaults.baseTracks;
    }

    if (validationWarnings.length) {
        validationWarnings.forEach((warning) => {
            console.warn("[bootstrap] scene definition validation", warning);
        });
    }

    return normalized;
}

export async function loadSceneDefinition(sceneDefinitionPath, options = {}) {
    const onStatus = (options && typeof options.onStatus === "function")
        ? options.onStatus
        : null;

    try {
        const response = await fetch(sceneDefinitionPath, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const rawDefinition = await response.json();
        if (onStatus) {
            onStatus({ progress: 58, message: "Configuracion cargada" });
        }

        return normalizeSceneDefinition(rawDefinition);
    } catch (error) {
        console.warn("[bootstrap] scene definition fallback", error);
        if (onStatus) {
            onStatus({ progress: 58, message: "Usando configuracion por defecto" });
        }

        return getDefaultSceneDefinition();
    }
}
