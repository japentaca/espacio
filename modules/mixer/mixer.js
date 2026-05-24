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
var reverbNode = new Tone.Reverb({ wet: 1 }).connect(sendsBusReturn)
var reverbSend = new Tone.Volume({ volume: -34 }).connect(reverbNode)


var delayNode = new Tone.PingPongDelay({ wet: 1 }).connect(sendsBusReturn)
var delaySend = new Tone.Volume().connect(delayNode)

export function addChannel() {
    var c = new mixerChannel({ masterOutput, reverbSend, delaySend })
    //console.log("mixerchannl", c)

    channels.push(c)
    return c
}
function init() {

}