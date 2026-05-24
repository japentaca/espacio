'use strict'
export default class {

  constructor(parms) {
    this.volume = new Tone.Volume().connect(parms.masterOutput)
    this.eq = new Tone.EQ3(0, 0, 0)
    this.input = new Tone.Volume().connect(this.eq)
    this.dynamicsNode = null

    this.reverbSend = new Tone.Volume({ volume: -34 }).connect(parms.reverbSend)
    this.delaySend = new Tone.Volume({ volume: -128 }).connect(parms.delaySend)
    this._rerouteOutputs()

    return
  }

  _rerouteOutputs() {
    this.eq.disconnect()

    if (this.dynamicsNode) {
      this.dynamicsNode.disconnect()
      this.eq.connect(this.dynamicsNode)
      this.dynamicsNode.connect(this.volume)
      this.dynamicsNode.fan(this.reverbSend, this.delaySend)
      return
    }

    this.eq.connect(this.volume)
    this.eq.fan(this.reverbSend, this.delaySend)
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
    if (!Number.isFinite(value)) {
      return this
    }

    this.delaySend.volume.value = value
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


