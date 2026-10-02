import { Transport, RTVIMessage } from '@pipecat-ai/client-js'
import type { PipecatClientOptions, TransportState } from '@pipecat-ai/client-js'

// Test-only transport. Actual SDK parsing and dispatch, no network or devices.
export class VoiceTestTransport extends Transport {
  sent: RTVIMessage[] = []
  receive: (message: RTVIMessage) => void = () => {}
  initialize(_options: PipecatClientOptions, handler: (message: RTVIMessage) => void) {
    this.receive = handler
    this._state = 'ready'
  }
  async initDevices() {}
  _validateConnectionParams(value: unknown) { return value }
  async _connect() { this._state = 'ready' }
  async _disconnect() { this._state = 'disconnected' }
  sendReadyMessage() {}
  get state() { return this._state }
  set state(value: TransportState) { this._state = value }
  async getAllMics() { return [] }
  async getAllCams() { return [] }
  async getAllSpeakers() { return [] }
  updateMic() {}
  updateCam() {}
  updateSpeaker() {}
  get selectedMic() { return {} }
  get selectedCam() { return {} }
  get selectedSpeaker() { return {} }
  enableMic() {}
  enableCam() {}
  enableScreenShare() {}
  get isCamEnabled() { return false }
  get isMicEnabled() { return false }
  get isSharingScreen() { return false }
  sendMessage(message: RTVIMessage) { this.sent.push(message) }
  tracks() { return { local: {} } }
}
