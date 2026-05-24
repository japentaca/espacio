'use strict'
export default class {

  constructor(set, MChannel, onTransient, channelFactory) {
    const safeSet = (set && typeof set === 'object') ? set : {}
    const safeParms = (safeSet.parms && typeof safeSet.parms === 'object') ? safeSet.parms : {}
    console.log("comienza", safeParms.name)

    this.listNextStepTime = 0
    this.listCurrStep = 0
    this.lastStepAt = performance.now()
    this.activeClipEndsAt = 0
    this.onTransient = typeof onTransient === 'function' ? onTransient : null
    this.mainChannel = MChannel
    this.channelFactory = typeof channelFactory === 'function' ? channelFactory : null
    this.myAudioSet = { ...safeSet }
    this.myAudioSet.files = Array.isArray(safeSet.files) ? safeSet.files : []
    this.myAudioSet.parms = (safeSet.parms && typeof safeSet.parms === 'object') ? safeSet.parms : {}
    this.myAudioSet.effects = (safeSet.effects && typeof safeSet.effects === 'object') ? safeSet.effects : {}

    this.intervalMin = (this.myAudioSet.parms.interval && Number.isFinite(this.myAudioSet.parms.interval.min))
      ? this.myAudioSet.parms.interval.min
      : 9
    this.intervalMax = (this.myAudioSet.parms.interval && Number.isFinite(this.myAudioSet.parms.interval.max))
      ? this.myAudioSet.parms.interval.max
      : this.intervalMin

    this.currInterval = _.random(this.intervalMin, this.intervalMax)
    this.playMode = this.resolvePlayMode(this.myAudioSet)
    this.playbackTailMs = (Number.isFinite(this.myAudioSet.parms.playbackTailMs))
      ? this.myAudioSet.parms.playbackTailMs
      : 90

    this.baseEffects = this.getBaseEffects(this.myAudioSet.effects)
    this.matrix = this.normalizeMatrix(this.myAudioSet.effects.matrix)
    this.channelNodes = {}
    this.channelMixers = {}

    console.log(this.myAudioSet)

    this.setupKnownMatrixChannels()

    this.myAudioSet.files.forEach(audioFile => {
      //console.log(audioFile)
      audioFile.player = new Tone.Player("./audio/" + audioFile.path)
      //set.player.connect(volumeNode)
      //if (set.effects.playbackRate) audioFile.player.playbackRate = set.effects.playbackRate
      //if (set.effects.grainSize) audioFile.player.grainSize = set.effects.grainSize

      audioFile.player.volume.value = 0
      //audioFile.player.mixerChannel = mixer.addChannel()
      //MChannel.connectInput(audioFile.player)
      audioFile.player.connect(this.getChannelInputNode(audioFile))



      //audioFile.player.connect(outputNode)
    })

    this.shuffled = _.shuffle(Object.keys(this.myAudioSet.files))
    //setInterval(this.advance, 1000)

    return

  }

  getBaseEffects(effects) {
    if (!effects || typeof effects !== 'object') {
      return {}
    }

    const baseEffects = {}
    if (Object.prototype.hasOwnProperty.call(effects, 'volume')) baseEffects.volume = effects.volume
    if (Object.prototype.hasOwnProperty.call(effects, 'delay')) baseEffects.delay = effects.delay
    if (Object.prototype.hasOwnProperty.call(effects, 'reverb')) baseEffects.reverb = effects.reverb
    if (effects.eq && typeof effects.eq === 'object') baseEffects.eq = { ...effects.eq }
    if (Object.prototype.hasOwnProperty.call(effects, 'compressor')) {
      baseEffects.compressor = effects.compressor
    }

    return baseEffects
  }

  normalizeMatrix(matrix) {
    if (!matrix || typeof matrix !== 'object') {
      return null
    }

    const defaultChannel = (typeof matrix.defaultChannel === 'string' && matrix.defaultChannel.trim())
      ? matrix.defaultChannel.trim()
      : 'main'

    const channels = {}
    if (matrix.channels && typeof matrix.channels === 'object') {
      Object.entries(matrix.channels).forEach(([channelName, channelEffects]) => {
        if (typeof channelName !== 'string' || !channelName.trim()) {
          return
        }

        channels[channelName.trim()] = (channelEffects && typeof channelEffects === 'object')
          ? channelEffects
          : {}
      })
    }

    const routingRules = Array.isArray(matrix.routingRules)
      ? matrix.routingRules.filter((rule) => rule && typeof rule === 'object')
      : []

    return {
      defaultChannel,
      channels,
      routingRules
    }
  }

  setupKnownMatrixChannels() {
    const knownChannelNames = new Set(['main'])

    if (this.matrix) {
      knownChannelNames.add(this.matrix.defaultChannel)

      Object.keys(this.matrix.channels).forEach((channelName) => {
        knownChannelNames.add(channelName)
      })

      this.matrix.routingRules.forEach((rule) => {
        if (typeof rule.channel === 'string' && rule.channel.trim()) {
          knownChannelNames.add(rule.channel.trim())
        }
      })
    }

    knownChannelNames.forEach((channelName) => {
      this.ensureChannel(channelName)
    })
  }

  mergeEffects(baseEffects, overrideEffects) {
    const merged = { ...baseEffects }

    if (!overrideEffects || typeof overrideEffects !== 'object') {
      return merged
    }

    if (Object.prototype.hasOwnProperty.call(overrideEffects, 'volume')) {
      merged.volume = overrideEffects.volume
    }
    if (Object.prototype.hasOwnProperty.call(overrideEffects, 'delay')) {
      merged.delay = overrideEffects.delay
    }
    if (Object.prototype.hasOwnProperty.call(overrideEffects, 'reverb')) {
      merged.reverb = overrideEffects.reverb
    }

    if (overrideEffects.eq && typeof overrideEffects.eq === 'object') {
      merged.eq = {
        ...(merged.eq && typeof merged.eq === 'object' ? merged.eq : {}),
        ...overrideEffects.eq
      }
    }

    if (Object.prototype.hasOwnProperty.call(overrideEffects, 'compressor')) {
      merged.compressor = overrideEffects.compressor
    }

    return merged
  }

  getChannelEffects(channelName) {
    if (!this.matrix) {
      return { ...this.baseEffects }
    }

    const overrideEffects = this.matrix.channels[channelName] || {}
    return this.mergeEffects(this.baseEffects, overrideEffects)
  }

  applyMixerEffects(mixerChannel, effects) {
    if (!mixerChannel || !effects || typeof effects !== 'object') {
      return
    }

    const mixerEffects = { ...effects }
    delete mixerEffects.volume

    if (typeof mixerChannel.applyEffects === 'function') {
      mixerChannel.applyEffects(mixerEffects)
      return
    }

    if (Object.prototype.hasOwnProperty.call(mixerEffects, 'delay') && Number.isFinite(mixerEffects.delay)) {
      mixerChannel.sendDelay(mixerEffects.delay)
    }

    if (Object.prototype.hasOwnProperty.call(mixerEffects, 'reverb') && Number.isFinite(mixerEffects.reverb)) {
      mixerChannel.sendReverb(mixerEffects.reverb)
    }

    if (mixerEffects.eq && typeof mixerEffects.eq === 'object') {
      mixerChannel.setEq(mixerEffects.eq)
    }

    if (Object.prototype.hasOwnProperty.call(mixerEffects, 'compressor')
      && typeof mixerChannel.setCompressor === 'function') {
      mixerChannel.setCompressor(mixerEffects.compressor)
    }
  }

  createMixerChannel(channelName) {
    if (channelName === 'main' || !this.channelFactory) {
      return this.mainChannel
    }

    const extraChannel = this.channelFactory()
    return extraChannel || this.mainChannel
  }

  ensureChannel(channelName) {
    const normalizedName = (typeof channelName === 'string' && channelName.trim())
      ? channelName.trim()
      : 'main'

    if (this.channelNodes[normalizedName]) {
      return this.channelNodes[normalizedName]
    }

    const mixerChannel = this.createMixerChannel(normalizedName)
    const channelEffects = this.getChannelEffects(normalizedName)
    this.applyMixerEffects(mixerChannel, channelEffects)

    const inputNode = new Tone.Volume()
    if (Object.prototype.hasOwnProperty.call(channelEffects, 'volume') && Number.isFinite(channelEffects.volume)) {
      inputNode.volume.value = channelEffects.volume
    }

    mixerChannel.connectInput(inputNode)

    this.channelNodes[normalizedName] = inputNode
    this.channelMixers[normalizedName] = mixerChannel

    return inputNode
  }

  isRuleMatch(file, rule) {
    if (!rule || typeof rule !== 'object') {
      return false
    }

    const spec = (rule.match && typeof rule.match === 'object') ? rule.match : rule
    let hasConstraint = false

    const safeText = {
      id: typeof file.id === 'string' ? file.id : '',
      path: typeof file.path === 'string' ? file.path : '',
      text: typeof file.text === 'string' ? file.text : ''
    }

    if (typeof spec.id === 'string') {
      hasConstraint = true
      if (safeText.id !== spec.id) return false
    }

    if (typeof spec.path === 'string') {
      hasConstraint = true
      if (safeText.path !== spec.path) return false
    }

    if (typeof spec.text === 'string') {
      hasConstraint = true
      if (safeText.text !== spec.text) return false
    }

    const regexChecks = [
      ['idRegex', safeText.id],
      ['pathRegex', safeText.path],
      ['textRegex', safeText.text]
    ]

    for (let i = 0; i < regexChecks.length; i++) {
      const key = regexChecks[i][0]
      const value = regexChecks[i][1]
      if (typeof spec[key] !== 'string' || !spec[key]) {
        continue
      }

      hasConstraint = true

      try {
        const re = new RegExp(spec[key])
        if (!re.test(value)) return false
      } catch (error) {
        return false
      }
    }

    return hasConstraint
  }

  resolveChannelName(file) {
    if (file && typeof file.channel === 'string' && file.channel.trim()) {
      return file.channel.trim()
    }

    if (!this.matrix) {
      return 'main'
    }

    for (let i = 0; i < this.matrix.routingRules.length; i++) {
      const rule = this.matrix.routingRules[i]
      if (typeof rule.channel !== 'string' || !rule.channel.trim()) {
        continue
      }

      if (this.isRuleMatch(file, rule)) {
        return rule.channel.trim()
      }
    }

    return this.matrix.defaultChannel || 'main'
  }

  getChannelInputNode(file) {
    const channelName = this.resolveChannelName(file)
    return this.ensureChannel(channelName)
  }

  getMixerChannel(channelName) {
    const normalizedName = (typeof channelName === 'string' && channelName.trim())
      ? channelName.trim()
      : 'main'

    if (this.channelMixers[normalizedName]) {
      return this.channelMixers[normalizedName]
    }

    return this.channelMixers.main || this.mainChannel
  }

  start() {

    setInterval(() => {
      this.advance()
    }, 120)
  }

  resolvePlayMode(set) {
    const rawMode = (set && set.parms && typeof set.parms.playMode === 'string')
      ? set.parms.playMode.toLowerCase()
      : 'auto'

    if (rawMode === 'wait' || rawMode === 'cut' || rawMode === 'overlap') {
      return rawMode
    }

    const files = (set && Array.isArray(set.files)) ? set.files : []
    const durations = files
      .map(file => Number(file.durationSec))
      .filter(value => Number.isFinite(value) && value > 0)

    if (!durations.length) {
      return 'wait'
    }

    const avgDuration = durations.reduce((acc, value) => acc + value, 0) / durations.length
    const sortedDurations = [...durations].sort((a, b) => a - b)
    const p85Index = Math.min(
      sortedDurations.length - 1,
      Math.max(0, Math.floor((sortedDurations.length - 1) * 0.85))
    )
    const p85Duration = sortedDurations[p85Index]
    const hasInterval = set && set.parms && set.parms.interval
      && Number.isFinite(set.parms.interval.min)
      && Number.isFinite(set.parms.interval.max)

    if (!hasInterval) {
      return 'wait'
    }

    const minInterval = set.parms.interval.min
    const avgInterval = (set.parms.interval.min + set.parms.interval.max) * 0.5
    const avgDenseRatio = avgDuration / avgInterval
    const tailDenseRatio = p85Duration / minInterval

    // Auto prefers phrase integrity, but switches to rhythm when clips are dense.
    if (avgDenseRatio >= 0.95 || tailDenseRatio >= 1.08) {
      return 'cut'
    }

    return 'wait'
  }

  isPlaybackActive() {
    for (let i = 0; i < this.myAudioSet.files.length; i++) {
      const player = this.myAudioSet.files[i].player
      if (player && player.state === 'started') {
        return true
      }
    }

    return false
  }

  isDurationWindowActive(nowMs) {
    return nowMs < this.activeClipEndsAt
  }

  shouldHoldForActivePlayback(nowMs) {
    if (this.playMode !== 'wait') {
      return false
    }

    if (this.isDurationWindowActive(nowMs)) {
      return true
    }

    return this.isPlaybackActive()
  }

  stopActivePlayers() {
    for (let i = 0; i < this.myAudioSet.files.length; i++) {
      const player = this.myAudioSet.files[i].player
      if (player && player.state === 'started') {
        player.stop()
      }
    }
    this.activeClipEndsAt = 0
  }

  estimateDurationMs(elem, playbackRate) {
    const durationSec = Number(elem.durationSec)
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      return 0
    }

    const safeRate = (typeof playbackRate === 'number' && playbackRate > 0) ? playbackRate : 1
    return (durationSec * 1000) / safeRate
  }

  advance() {

    const now = performance.now()
    const dt = (now - this.lastStepAt) / 1000
    this.lastStepAt = now
    this.listNextStepTime += dt

    if (this.listNextStepTime < this.currInterval) return
    if (this.shouldHoldForActivePlayback(now)) return

    if (this.playMode === 'cut') {
      this.stopActivePlayers()
    }

    this.currInterval = _.random(this.intervalMin, this.intervalMax)
    this.listNextStepTime = 0

    var elem = this.myAudioSet.files[this.shuffled[this.listCurrStep]]
    console.log()
    var pbr = 1
    if (this.myAudioSet.parms.playBackRate) {
      pbr = _.random(this.myAudioSet.parms.playBackRate.min, this.myAudioSet.parms.playBackRate.max, true)

      //console.log("pbr", pbr)
      elem.player.playbackRate = pbr
    }
    //var pbr = (Math.random() / 3) + .7


    if (elem.player.loaded) {
      if (this.onTransient) {
        this.onTransient(elem.text || null)
      }
      elem.player.start()

      const estimatedMs = this.estimateDurationMs(elem, pbr)
      this.activeClipEndsAt = now + estimatedMs + this.playbackTailMs
    }

    this.listCurrStep++
    if (this.listCurrStep == this.myAudioSet.files.length) {
      this.shuffled = _.shuffle(Object.keys(this.myAudioSet.files))
      this.listCurrStep = 0
    }
    //console.log("elem", elem)


  }

}

//var audioNode = new Tone