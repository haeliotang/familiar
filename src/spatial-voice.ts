export function updateVoiceListener(context: BaseAudioContext, position: [number, number, number], forward: [number, number, number], up: [number, number, number]) {
  const listener = context.listener
  if (listener.positionX) {
    listener.positionX.value = position[0]
    listener.positionY.value = position[1]
    listener.positionZ.value = position[2]
    listener.forwardX.value = forward[0]
    listener.forwardY.value = forward[1]
    listener.forwardZ.value = forward[2]
    listener.upX.value = up[0]
    listener.upY.value = up[1]
    listener.upZ.value = up[2]
  } else {
    listener.setPosition(...position)
    listener.setOrientation(...forward, ...up)
  }
}

export function spatialVoice(context: BaseAudioContext, position: [number, number, number], forward: [number, number, number], up: [number, number, number], output: AudioNode = context.destination) {
  updateVoiceListener(context, position, forward, up)
  const panner = context.createPanner()
  panner.panningModel = 'HRTF'
  panner.distanceModel = 'inverse'
  panner.refDistance = 6
  panner.rolloffFactor = 0.5
  panner.connect(output)
  return panner
}
