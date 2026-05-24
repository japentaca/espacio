
'use strict'
import mixer from "./mixer/mixer.js?v=20260524a"
console.log("mixer...", mixer)
import AudioSet from "./audioSet.js?v=20260524a"


export default {
    init: init,
    addAudioSet: addAudioSet,
    addBase: addBase,
    getReactiveLevel: getReactiveLevel,
    mixer: mixer
}

var myAudioSets = []
var basePlayers = [] // 
var baseMChannels = []
var baseGroups = []
var activeBaseGroupIndex = -1
var basePlaylistStarted = false
var baseTransitionTimer = null
var baseStartRetryTimer = null
var lastDuckAt = 0
var reactiveMeter = null
var reactiveMeterTap = null
var reactiveMeterAnalyser = null

const DUCKING = {
    attackSec: 0.03,
    releaseSec: 0.25,
    amountDb: 8,
    cooldownSec: 0.09
}

const BASE_PLAYLIST = {
    defaultCrossfadeSec: 10,
    fallbackHoldSec: 30,
    minimumHoldSec: 0.15,
    silentDb: -96,
    startFadeInSec: 0.8,
    stopPadSec: 0.08,
    retryStartMs: 250
}


function normalizeBaseGroup(entry) {
    var tracks = []
    var volumeDb = -3
    var crossfadeSec = BASE_PLAYLIST.defaultCrossfadeSec
    var holdSec = null

    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !Array.isArray(entry.tracks)) {
        return null
    }

    tracks = entry.tracks
        .filter((path) => typeof path === 'string' && path.trim())
        .map((path) => path.trim())

    if (Number.isFinite(entry.volumeDb)) {
        volumeDb = entry.volumeDb
    }

    if (Number.isFinite(entry.crossfadeSec) && entry.crossfadeSec > 0) {
        crossfadeSec = entry.crossfadeSec
    }

    if (Number.isFinite(entry.holdSec) && entry.holdSec > 0) {
        holdSec = entry.holdSec
    }

    if (!tracks.length) {
        return null
    }

    return {
        tracks,
        volumeDb,
        crossfadeSec,
        holdSec
    }
}

function scheduleBaseStartAttempt() {
    if (basePlaylistStarted || baseStartRetryTimer) {
        return
    }

    baseStartRetryTimer = setTimeout(() => {
        baseStartRetryTimer = null
        tryStartBasePlaylist()
    }, 0)
}

function isGroupReady(group) {
    return !!group && group.pendingLoads === 0 && group.tracks.length > 0
}

function getPlayablePlayers(group) {
    if (!group || !Array.isArray(group.players)) {
        return []
    }

    return group.players.filter((player) => {
        if (!player || !player.buffer || !Number.isFinite(player.buffer.duration)) {
            return false
        }

        return player.buffer.duration > 0
    })
}

function updateGroupDuration(group, player) {
    if (!group || !player || !player.buffer || !Number.isFinite(player.buffer.duration)) {
        return
    }

    if (player.buffer.duration > group.durationSec) {
        group.durationSec = player.buffer.duration
    }
}

function onGroupTrackLoad(group, player) {
    updateGroupDuration(group, player)
    group.pendingLoads = Math.max(group.pendingLoads - 1, 0)
    if (group.pendingLoads === 0) {
        scheduleBaseStartAttempt()
    }
}

function getParamCurrentValue(param, fallbackValue) {
    if (!param) {
        return fallbackValue
    }

    if (Number.isFinite(param.value)) {
        return param.value
    }

    return fallbackValue
}

function holdParamValue(param, atTime) {
    if (!param) {
        return
    }

    if (typeof param.cancelAndHoldAtTime === 'function') {
        param.cancelAndHoldAtTime(atTime)
    } else {
        param.cancelScheduledValues(atTime)
    }
}

function rampGroupVolume(group, fromDb, toDb, startTime, durationSec) {
    if (!group || !Array.isArray(group.channels)) {
        return
    }

    var endTime = startTime + Math.max(durationSec, 0.001)

    group.channels.forEach((channel) => {
        if (!channel || !channel.volume || !channel.volume.volume) {
            return
        }

        var volumeParam = channel.volume.volume
        holdParamValue(volumeParam, startTime)
        volumeParam.setValueAtTime(fromDb, startTime)
        volumeParam.linearRampToValueAtTime(toDb, endTime)
    })
}

function fadeGroupOut(group, startTime, durationSec) {
    if (!group || !Array.isArray(group.channels)) {
        return
    }

    var safeDuration = Math.max(durationSec, 0.001)
    var endTime = startTime + safeDuration

    group.channels.forEach((channel) => {
        if (!channel || !channel.volume || !channel.volume.volume) {
            return
        }

        var volumeParam = channel.volume.volume
        var currentValue = getParamCurrentValue(volumeParam, channel.baseLevelDb)
        holdParamValue(volumeParam, startTime)
        volumeParam.setValueAtTime(currentValue, startTime)
        volumeParam.linearRampToValueAtTime(BASE_PLAYLIST.silentDb, endTime)
    })
}

function stopGroupPlayers(group, stopAt) {
    if (!group || !Array.isArray(group.players)) {
        return
    }

    group.players.forEach((player) => {
        if (!player) {
            return
        }

        try {
            player.stop(stopAt)
        } catch (error) {
            // Ignore stop errors when player is already stopped.
        }
    })
}

function getGroupHoldSec(group) {
    if (!group) {
        return BASE_PLAYLIST.fallbackHoldSec
    }

    if (Number.isFinite(group.holdSec) && group.holdSec > 0) {
        return group.holdSec
    }

    var effectiveDuration = Number.isFinite(group.durationSec) && group.durationSec > 0
        ? group.durationSec
        : BASE_PLAYLIST.fallbackHoldSec

    var computedHold = effectiveDuration - group.crossfadeSec
    if (!Number.isFinite(computedHold)) {
        return BASE_PLAYLIST.fallbackHoldSec
    }

    return Math.max(computedHold, BASE_PLAYLIST.minimumHoldSec)
}

function clearBaseTransitionTimer() {
    if (baseTransitionTimer) {
        clearTimeout(baseTransitionTimer)
        baseTransitionTimer = null
    }
}

function scheduleNextTransition(currentIndex, groupStartAt) {
    clearBaseTransitionTimer()

    if (!basePlaylistStarted || baseGroups.length <= 1) {
        return
    }

    var currentGroup = baseGroups[currentIndex]
    if (!currentGroup) {
        return
    }

    var holdSec = getGroupHoldSec(currentGroup)
    var transitionAt = groupStartAt + holdSec
    var delayMs = Math.max((transitionAt - Tone.now()) * 1000, 0)
    var nextIndex = (currentIndex + 1) % baseGroups.length

    baseTransitionTimer = setTimeout(() => {
        transitionToGroup(nextIndex, currentIndex)
    }, delayMs)
}

function startGroup(groupIndex, startTime, fadeInSec) {
    var group = baseGroups[groupIndex]
    if (!group || !isGroupReady(group)) {
        return false
    }

    var playablePlayers = getPlayablePlayers(group)
    if (!playablePlayers.length) {
        return false
    }

    var now = Tone.now()
    var at = Math.max(startTime || now, now)
    var shouldLoop = baseGroups.length === 1

    playablePlayers.forEach((player) => {
        player.loop = shouldLoop
    })

    rampGroupVolume(group, BASE_PLAYLIST.silentDb, group.volumeDb, at, Math.max(fadeInSec, 0.001))

    playablePlayers.forEach((player) => {
        try {
            player.start(at)
        } catch (error) {
            console.warn("[audio] base start failed", error)
        }
    })

    return true
}

function transitionToGroup(nextIndex, previousIndex) {
    if (!basePlaylistStarted) {
        return
    }

    var nextGroup = baseGroups[nextIndex]
    var previousGroup = baseGroups[previousIndex]

    if (!nextGroup || !previousGroup) {
        return
    }

    if (!isGroupReady(nextGroup)) {
        baseTransitionTimer = setTimeout(() => {
            transitionToGroup(nextIndex, previousIndex)
        }, BASE_PLAYLIST.retryStartMs)
        return
    }

    var now = Tone.now() + 0.01
    if (!startGroup(nextIndex, now, nextGroup.crossfadeSec)) {
        baseTransitionTimer = setTimeout(() => {
            transitionToGroup(nextIndex, previousIndex)
        }, BASE_PLAYLIST.retryStartMs)
        return
    }

    fadeGroupOut(previousGroup, now, nextGroup.crossfadeSec)
    stopGroupPlayers(previousGroup, now + nextGroup.crossfadeSec + BASE_PLAYLIST.stopPadSec)

    activeBaseGroupIndex = nextIndex
    scheduleNextTransition(nextIndex, now)
}

function tryStartBasePlaylist() {
    if (basePlaylistStarted || !baseGroups.length) {
        return
    }

    var firstGroup = baseGroups[0]
    if (!isGroupReady(firstGroup)) {
        baseStartRetryTimer = setTimeout(() => {
            baseStartRetryTimer = null
            tryStartBasePlaylist()
        }, BASE_PLAYLIST.retryStartMs)
        return
    }

    var startAt = Tone.now() + 0.05
    if (!startGroup(0, startAt, BASE_PLAYLIST.startFadeInSec)) {
        baseStartRetryTimer = setTimeout(() => {
            baseStartRetryTimer = null
            tryStartBasePlaylist()
        }, BASE_PLAYLIST.retryStartMs)
        return
    }

    basePlaylistStarted = true
    activeBaseGroupIndex = 0
    scheduleNextTransition(0, startAt)
}

function addBase(entry) {
    var groupDefinition = normalizeBaseGroup(entry)

    if (!groupDefinition) {
        console.warn('[audio] invalid baseTracks entry', entry)
        return
    }

    var group = {
        tracks: groupDefinition.tracks,
        players: [],
        channels: [],
        volumeDb: groupDefinition.volumeDb,
        crossfadeSec: groupDefinition.crossfadeSec,
        holdSec: groupDefinition.holdSec,
        durationSec: 0,
        pendingLoads: groupDefinition.tracks.length
    }

    group.tracks.forEach((path) => {
        var baseMChannel = mixer.addChannel()
        baseMChannel.baseLevelDb = group.volumeDb
        if (baseMChannel.volume && baseMChannel.volume.volume) {
            baseMChannel.volume.volume.value = BASE_PLAYLIST.silentDb
        }

        var basePlayer = new Tone.Player({
            url: path,
            autostart: false,
            loop: false,
            onload: () => onGroupTrackLoad(group, basePlayer),
            onerror: (error) => {
                console.warn('[audio] base track load error', path, error)
                onGroupTrackLoad(group, null)
            }
        })

        baseMChannel.connectInput(basePlayer)

        group.players.push(basePlayer)
        group.channels.push(baseMChannel)
        basePlayers.push(basePlayer)
        baseMChannels.push(baseMChannel)
    })

    baseGroups.push(group)
    scheduleBaseStartAttempt()

}

function duckBase() {
    if (!baseMChannels.length) {
        return
    }

    var now = Tone.now()
    if ((now - lastDuckAt) < DUCKING.cooldownSec) {
        return
    }
    lastDuckAt = now

    baseMChannels.forEach((baseChannel) => {
        if (!baseChannel || !baseChannel.volume || !baseChannel.volume.volume) {
            return
        }

        var volumeParam = baseChannel.volume.volume
        var baseDb = (typeof baseChannel.baseLevelDb === 'number') ? baseChannel.baseLevelDb : -3
        var duckDb = baseDb - DUCKING.amountDb
        var currentValue = (typeof volumeParam.value === 'number') ? volumeParam.value : baseDb

        if (typeof volumeParam.cancelAndHoldAtTime === 'function') {
            volumeParam.cancelAndHoldAtTime(now)
        } else {
            volumeParam.cancelScheduledValues(now)
        }

        volumeParam.setValueAtTime(currentValue, now)
        volumeParam.linearRampToValueAtTime(duckDb, now + DUCKING.attackSec)
        volumeParam.linearRampToValueAtTime(baseDb, now + DUCKING.attackSec + DUCKING.releaseSec)
    })
}

function init() {
    var context = Tone.getContext ? Tone.getContext() : Tone.context
    if (context) {
        context.lookAhead = 0.03
        context.updateInterval = 0.01
    }


    mixer.init()
}

function attachReactiveMeter(channel) {
    if (!channel || !channel.volume || reactiveMeter) {
        return
    }

    reactiveMeterTap = new Tone.Compressor({
        threshold: -22,
        ratio: 3,
        attack: 0.02,
        release: 0.2
    })
    reactiveMeterAnalyser = new Tone.Analyser("waveform", 256)

    channel.volume.connect(reactiveMeterTap)
    reactiveMeterTap.connect(reactiveMeterAnalyser)

    reactiveMeter = {
        getValue: function () {
            var values = reactiveMeterAnalyser.getValue()
            var peak = 0

            for (var i = 0; i < values.length; i++) {
                var v = Math.abs(values[i])
                if (v > peak) peak = v
            }

            if (peak <= 0.000001) return -100
            return Tone.gainToDb(peak)
        }
    }
}

function getReactiveLevel() {
    if (reactiveMeter && typeof reactiveMeter.getValue === 'function') {
        return reactiveMeter.getValue()
    }

    return mixer.meter.getValue()
}

function addAudioSet(set, onText) {
    var audioSetMChannel = mixer.addChannel()
    var channelFactory = function () {
        return mixer.addChannel()
    }

    var transient = function (text) {
        duckBase()
        if (typeof onText === 'function' && text) {
            onText(text)
        }
    }

    var audioSet = new AudioSet(set, audioSetMChannel, transient, channelFactory)

    if (set && set.reactiveSource === true) {
        var reactiveChannelName = 'main'

        if (set.effects
            && set.effects.matrix
            && typeof set.effects.matrix.defaultChannel === 'string'
            && set.effects.matrix.defaultChannel.trim()) {
            reactiveChannelName = set.effects.matrix.defaultChannel.trim()
        }

        var reactiveChannel = (audioSet && typeof audioSet.getMixerChannel === 'function')
            ? audioSet.getMixerChannel(reactiveChannelName)
            : audioSetMChannel

        attachReactiveMeter(reactiveChannel || audioSetMChannel)
    }

    audioSet.start()

    myAudioSets.push(audioSet)

}


