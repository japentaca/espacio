'use strict'
export default class {

  constructor(parms) {
    this.delayOffDb = -128
    this.volume = new Tone.Volume().connect(parms.masterOutput)
    this.eq = new Tone.EQ3(0, 0, 0)
    this.input = new Tone.Volume().connect(this.eq)
    this.dynamicsNode = null

    this.reverbSend = new Tone.Volume({ volume: -34 }).connect(parms.reverbSend)
    this.pingPongDelayNode = new Tone.PingPongDelay({ wet: 1 }).connect(this.volume)
    this.feedbackDelayNode = new Tone.FeedbackDelay({ wet: 1 }).connect(this.volume)
    this.pingPongSend = new Tone.Volume({ volume: this.delayOffDb }).connect(this.pingPongDelayNode)
    this.feedbackSend = new Tone.Volume({ volume: this.delayOffDb }).connect(this.feedbackDelayNode)
    this._rerouteOutputs()

    return
  }

  _rerouteOutputs() {
    this.eq.disconnect()

    if (this.dynamicsNode) {
      this.dynamicsNode.disconnect()
      this.eq.connect(this.dynamicsNode)
      this.dynamicsNode.connect(this.volume)
      this.dynamicsNode.fan(this.reverbSend, this.pingPongSend, this.feedbackSend)
      return
    }

    this.eq.connect(this.volume)
    this.eq.fan(this.reverbSend, this.pingPongSend, this.feedbackSend)
  }

  _normalizeDelayType(value) {
    if (typeof value !== 'string') {
      return 'pingpong'
    }

    var normalized = value.toLowerCase().replace(/[-_\s]/g, '')
    if (normalized === 'feedback') {
      return 'feedback'
    }

    return 'pingpong'
  }

  _normalizeDelayConfig(value) {
    if (Number.isFinite(value)) {
      return {
        type: 'pingpong',
        sendDb: value
      }
    }

    if (!value || typeof value !== 'object') {
      return null
    }

    var sendDb = null
    if (Number.isFinite(value.sendDb)) sendDb = value.sendDb
    else if (Number.isFinite(value.volumeDb)) sendDb = value.volumeDb
    else if (Number.isFinite(value.send)) sendDb = value.send
    else if (Number.isFinite(value.level)) sendDb = value.level
    else if (Number.isFinite(value.db)) sendDb = value.db

    var config = {
      type: this._normalizeDelayType(value.type),
      sendDb: Number.isFinite(sendDb) ? sendDb : this.delayOffDb,
      time: (typeof value.time === 'string' || Number.isFinite(value.time)) ? value.time : value.delayTime,
      feedback: Number.isFinite(value.feedback) ? value.feedback : null,
      wet: Number.isFinite(value.wet) ? value.wet : null
    }

    return config
  }

  _setDelayTime(node, delayTime) {
    if (!node || !node.delayTime || delayTime == null) {
      return
    }

    if (typeof delayTime === 'string' || Number.isFinite(delayTime)) {
      node.delayTime.value = delayTime
    }
  }

  _setDelayFeedback(node, feedback) {
    if (!node || !node.feedback || !Number.isFinite(feedback)) {
      return
    }

    node.feedback.value = feedback
  }

  _setDelayWet(node, wet) {
    if (!node || !node.wet || !Number.isFinite(wet)) {
      return
    }

    var safeWet = Math.min(Math.max(wet, 0), 1)
    node.wet.value = safeWet
  }

  _createCompressorOptions(config) {
    var options = {}

    if (!config || typeof config !== 'object') {
      return options
    }

    if (Number.isFinite(config.threshold)) options.threshold = config.threshold
    if (Number.isFinite(config.ratio)) options.ratio = config.ratio
    if (Number.isFinite(config.attack)) options.attack = config.attack
    if (Number.isFinite(config.release)) options.release = config.release
    if (Number.isFinite(config.knee)) options.knee = config.knee

    return options
  }

  _createDynamicsNode(config) {
    if (config === false || config == null) {
      return null
    }

    if (config === true) {
      return new Tone.Compressor()
    }

    if (typeof config === 'string') {
      var typeFromString = config.toLowerCase()
      if (typeFromString === 'off' || typeFromString === 'none') {
        return null
      }
      if (typeFromString === 'multiband') {
        if (typeof Tone.MultibandCompressor === 'function') {
          return new Tone.MultibandCompressor()
        }
        return new Tone.Compressor()
      }

      return new Tone.Compressor()
    }

    if (typeof config !== 'object') {
      return null
    }

    var type = (typeof config.type === 'string' ? config.type : 'compressor').toLowerCase()
    if (type === 'off' || type === 'none') {
      return null
    }

    if (type === 'multiband') {
      if (typeof Tone.MultibandCompressor !== 'function') {
        return new Tone.Compressor(this._createCompressorOptions(config))
      }

      var mbOptions = {
        lowFrequency: Number.isFinite(config.lowFrequency) ? config.lowFrequency : 250,
        highFrequency: Number.isFinite(config.highFrequency) ? config.highFrequency : 2000,
        low: this._createCompressorOptions(config.low),
        mid: this._createCompressorOptions(config.mid),
        high: this._createCompressorOptions(config.high)
      }

      return new Tone.MultibandCompressor(mbOptions)
    }

    return new Tone.Compressor(this._createCompressorOptions(config))
  }

  connectInput(input) {
    input.connect(this.input)

    return this
  }
  sendDelay(value) {
    var config = this._normalizeDelayConfig(value)
    if (!config) {
      return this
    }

    var isFeedback = config.type === 'feedback'

    this.pingPongSend.volume.value = isFeedback ? this.delayOffDb : config.sendDb
    this.feedbackSend.volume.value = isFeedback ? config.sendDb : this.delayOffDb

    var delayNode = isFeedback ? this.feedbackDelayNode : this.pingPongDelayNode
    this._setDelayTime(delayNode, config.time)
    this._setDelayFeedback(delayNode, config.feedback)
    this._setDelayWet(delayNode, config.wet)

    return this
  }
  setEq(values) {
    if (!values || typeof values !== 'object') {
      return this
    }

    if (Number.isFinite(values.high)) this.eq.high.value = values.high
    if (Number.isFinite(values.mid)) this.eq.mid.value = values.mid
    if (Number.isFinite(values.low)) this.eq.low.value = values.low

    return this
  }
  sendReverb(value) {
    if (!Number.isFinite(value)) {
      return this
    }

    this.reverbSend.volume.value = value
    return this
  }
  setVolume(value) {
    if (!Number.isFinite(value)) {
      return this
    }

    this.volume.volume.value = value
    return this
  }

  setCompressor(config) {
    if (this.dynamicsNode && typeof this.dynamicsNode.dispose === 'function') {
      this.dynamicsNode.dispose()
    } else if (this.dynamicsNode) {
      this.dynamicsNode.disconnect()
    }

    this.dynamicsNode = this._createDynamicsNode(config)
    this._rerouteOutputs()

    return this
  }

  applyEffects(effects) {
    if (!effects || typeof effects !== 'object') {
      return this
    }

    if (Object.prototype.hasOwnProperty.call(effects, 'volume')) {
      this.setVolume(effects.volume)
    }

    if (Object.prototype.hasOwnProperty.call(effects, 'delay')) {
      this.sendDelay(effects.delay)
    }

    if (Object.prototype.hasOwnProperty.call(effects, 'reverb')) {
      this.sendReverb(effects.reverb)
    }

    if (effects.eq && typeof effects.eq === 'object') {
      this.setEq(effects.eq)
    }

    if (Object.prototype.hasOwnProperty.call(effects, 'compressor')) {
      this.setCompressor(effects.compressor)
    }

    return this
  }


}


