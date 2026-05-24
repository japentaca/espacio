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
var reverbSend = new Tone.Volume({ volume: -34 })

function normalizeReverbConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return {
            type: 'algorithmic',
            wet: 1,
            decay: 2.5,
            preDelay: 0.01,
            impulsePath: null
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
        impulsePath: (typeof config.impulsePath === 'string' && config.impulsePath.trim())
            ? config.impulsePath.trim()
            : null
    }
}

function disposeReverbNode(node) {
    if (!node) {
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

    try {
        reverbSend.disconnect()
    } catch (error) {
        // No-op when there is no active connection yet.
    }

    node.connect(sendsBusReturn)
    reverbSend.connect(node)
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
    if (!config.impulsePath) {
        return null
    }

    var convolver = new Tone.Convolver()
    forceWetOnly(convolver)

    if (typeof convolver.load === 'function') {
        convolver.load(config.impulsePath).catch((error) => {
            console.warn('[mixer] impulse reverb load failed', config.impulsePath, error)
        })
    }

    return convolver
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

    var nextNode = null
    if (reverbConfig.type === 'impulse') {
        nextNode = createImpulseReverb(reverbConfig)
    }

    if (!nextNode) {
        nextNode = createAlgorithmicReverb(reverbConfig)
    }

    var prevNode = reverbNode
    reverbNode = nextNode
    connectReverbNode(reverbNode)
    disposeReverbNode(prevNode)

}