'use strict'
import mixerChannel from "./mixerChannel.js?v=20260524a"

//console.log("mixerChannel...", mixerChannel)
var compressor = new Tone.Compressor({
    threshold: -22,
    ratio: 3,
    attack: 0.02,
    release: 0.2
}).toDestination()
var masterOutput = new Tone.Volume().connect(compressor)
var analyser = new Tone.Analyser("waveform", 256)
compressor.connect(analyser)
var meter = {
    getValue: function () {
        var values = analyser.getValue()
        var peak = 0

        for (var i = 0; i < values.length; i++) {
            var v = Math.abs(values[i])
            if (v > peak) peak = v
        }

        if (peak <= 0.000001) return -100
        return Tone.gainToDb(peak)
    }
};
export default {
    init: init,
    addChannel: addChannel,
    meter: meter
    //channels: channels

}


//masterOutput.mute = true
var channels = []

var sendsBusReturn = new Tone.Volume().connect(masterOutput)
var reverbNode = null
var reverbSend = new Tone.Volume({ volume: 0 })

function normalizeAuxEffectType(type) {
    if (typeof type !== 'string') {
        return null
    }

    var normalized = type.toLowerCase().replace(/[\s_-]/g, '')

    if (normalized === 'eq3' || normalized === 'eq') return 'eq3'
    if (normalized === 'compressor') return 'compressor'
    if (normalized === 'multiband' || normalized === 'multibandcompressor') return 'multibandcompressor'
    if (normalized === 'filter' || normalized === 'highpass' || normalized === 'lowpass') return normalized
    if (normalized === 'algorithmic' || normalized === 'reverb' || normalized === 'tonereverb') return 'algorithmic'
    if (normalized === 'impulse' || normalized === 'convolver' || normalized === 'impulsereverb') return 'impulse'
    if (normalized === 'volume' || normalized === 'gain') return 'volume'

    return null
}

function normalizeAuxEffects(effects) {
    if (!Array.isArray(effects)) {
        return []
    }

    return effects
        .map((entry) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                return null
            }

            var type = normalizeAuxEffectType(entry.type)
            if (!type) {
                console.error('[mixer] aux effect requires a valid type', entry)
                return null
            }

            return {
                ...entry,
                type: type
            }
        })
        .filter(Boolean)
}

function normalizeReverbConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return {
            type: 'algorithmic',
            wet: 1,
            decay: 2.5,
            preDelay: 0.01,
            impulsePath: null,
            sendTrimDb: 0,
            effects: []
        }
    }

    var type = (typeof config.type === 'string') ? config.type.toLowerCase() : 'algorithmic'
    if (type !== 'impulse' && type !== 'algorithmic') {
        type = 'algorithmic'
    }

    return {
        type: type,
        wet: Number.isFinite(config.wet) ? config.wet : 1,
        decay: Number.isFinite(config.decay) ? config.decay : 2.5,
        preDelay: Number.isFinite(config.preDelay) ? config.preDelay : 0.01,
        sendTrimDb: Number.isFinite(config.sendTrimDb) ? config.sendTrimDb : 0,
        effects: normalizeAuxEffects(config.effects),
        impulsePath: (typeof config.impulsePath === 'string' && config.impulsePath.trim())
            ? config.impulsePath.trim()
            : null
    }
}

function disposeReverbNode(node) {
    if (!node) {
        return
    }

    if (typeof node._disposeChain === 'function') {
        node._disposeChain()
        return
    }

    if (typeof node.disconnect === 'function') {
        node.disconnect()
    }

    if (typeof node.dispose === 'function') {
        node.dispose()
    }
}

function connectReverbNode(node) {
    if (!node) {
        return
    }

    var inputNode = node.input || node
    var outputNode = node.output || node

    try {
        reverbSend.disconnect()
    } catch (error) {
        // No-op when there is no active connection yet.
    }

    outputNode.connect(sendsBusReturn)
    reverbSend.connect(inputNode)
}

function replaceReverbNode(nextNode) {
    var prevNode = reverbNode
    reverbNode = nextNode
    connectReverbNode(reverbNode)
    disposeReverbNode(prevNode)
}

function forceWetOnly(node) {
    if (!node) {
        return
    }

    if (node.wet && typeof node.wet.value !== 'undefined') {
        node.wet.value = 1
    }

    // Some effects expose an explicit dry control in dB.
    if (node.dry && typeof node.dry.value !== 'undefined') {
        node.dry.value = -Infinity
    }
}

function createAlgorithmicReverb(config) {
    var node = new Tone.Reverb({
        wet: 1,
        decay: config.decay,
        preDelay: config.preDelay
    })

    forceWetOnly(node)
    return node
}

function createImpulseReverb(config) {
    var impulsePath = null
    if (typeof config.impulsePath === 'string' && config.impulsePath.trim()) {
        impulsePath = config.impulsePath.trim()
    } else if (typeof config.path === 'string' && config.path.trim()) {
        impulsePath = config.path.trim()
    } else if (typeof config.url === 'string' && config.url.trim()) {
        impulsePath = config.url.trim()
    }

    if (!impulsePath) {
        console.error('[mixer] impulse reverb requires impulsePath')
        return null
    }

    var convolver = new Tone.Convolver()
    forceWetOnly(convolver)

    if (typeof convolver.load === 'function') {
        convolver.load(impulsePath).then(() => {
            console.info('[mixer] impulse reverb loaded', impulsePath)
        }).catch((error) => {
            console.error('[mixer] impulse reverb load failed', impulsePath, error)
        })
    }

    return convolver
}

function createCompressorNode(config) {
    var options = {}

    if (Number.isFinite(config.threshold)) options.threshold = config.threshold
    if (Number.isFinite(config.ratio)) options.ratio = config.ratio
    if (Number.isFinite(config.attack)) options.attack = config.attack
    if (Number.isFinite(config.release)) options.release = config.release
    if (Number.isFinite(config.knee)) options.knee = config.knee

    return new Tone.Compressor(options)
}

function createMultibandCompressorNode(config) {
    if (typeof Tone.MultibandCompressor !== 'function') {
        return createCompressorNode(config)
    }

    var options = {
        lowFrequency: Number.isFinite(config.lowFrequency) ? config.lowFrequency : 220,
        highFrequency: Number.isFinite(config.highFrequency) ? config.highFrequency : 2200,
        low: (config.low && typeof config.low === 'object') ? { ...config.low } : {},
        mid: (config.mid && typeof config.mid === 'object') ? { ...config.mid } : {},
        high: (config.high && typeof config.high === 'object') ? { ...config.high } : {}
    }

    return new Tone.MultibandCompressor(options)
}

function createFilterNode(config) {
    var filterType = (typeof config.type === 'string' && config.type === 'lowpass') ? 'lowpass' : 'highpass'

    return new Tone.Filter({
        type: filterType,
        frequency: Number.isFinite(config.frequency) ? config.frequency : 180,
        Q: Number.isFinite(config.Q) ? config.Q : 0.707
    })
}

function createEq3Node(config) {
    return new Tone.EQ3(
        Number.isFinite(config.low) ? config.low : 0,
        Number.isFinite(config.mid) ? config.mid : 0,
        Number.isFinite(config.high) ? config.high : 0
    )
}

function createVolumeNode(config) {
    var volumeDb = null
    if (Number.isFinite(config.volumeDb)) volumeDb = config.volumeDb
    else if (Number.isFinite(config.volume)) volumeDb = config.volume
    else if (Number.isFinite(config.db)) volumeDb = config.db

    if (!Number.isFinite(volumeDb)) {
        volumeDb = 0
    }

    return new Tone.Volume({ volume: volumeDb })
}

function createAuxEffectNode(effectConfig) {
    if (!effectConfig || typeof effectConfig !== 'object') {
        return null
    }

    if (effectConfig.type === 'eq3') return createEq3Node(effectConfig)
    if (effectConfig.type === 'compressor') return createCompressorNode(effectConfig)
    if (effectConfig.type === 'multibandcompressor') return createMultibandCompressorNode(effectConfig)
    if (effectConfig.type === 'filter' || effectConfig.type === 'highpass' || effectConfig.type === 'lowpass') return createFilterNode(effectConfig)
    if (effectConfig.type === 'volume') return createVolumeNode(effectConfig)
    if (effectConfig.type === 'impulse') return createImpulseReverb(effectConfig)
    if (effectConfig.type === 'algorithmic') return createAlgorithmicReverb(effectConfig)

    return null
}

function createAuxChain(config) {
    var effectEntries = Array.isArray(config.effects) && config.effects.length
        ? config.effects
        : [{ ...config }]
    var nodes = []

    for (var i = 0; i < effectEntries.length; i++) {
        var node = createAuxEffectNode(effectEntries[i])
        if (!node) {
            console.error('[mixer] could not create aux effect node', effectEntries[i])
            nodes.forEach((createdNode) => disposeReverbNode(createdNode))
            return null
        }

        nodes.push(node)
    }

    for (var j = 0; j < nodes.length - 1; j++) {
        nodes[j].connect(nodes[j + 1])
    }

    return {
        input: nodes[0],
        output: nodes[nodes.length - 1],
        _disposeChain: function () {
            for (var k = 0; k < nodes.length; k++) {
                if (typeof nodes[k].disconnect === 'function') {
                    nodes[k].disconnect()
                }

                if (typeof nodes[k].dispose === 'function') {
                    nodes[k].dispose()
                }
            }
        }
    }
}

export function addChannel() {
    var c = new mixerChannel({ masterOutput, reverbSend })
    //console.log("mixerchannl", c)

    channels.push(c)
    return c
}
function init(config) {
    var safeConfig = (config && typeof config === 'object') ? config : {}
    var reverbConfig = normalizeReverbConfig(safeConfig.reverb)
    reverbSend.volume.value = reverbConfig.sendTrimDb

    var nextNode = createAuxChain(reverbConfig)

    replaceReverbNode(nextNode)

}