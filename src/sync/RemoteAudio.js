// output ウィンドウ用の音源スタブ。マイク/AudioContext を持たず、AudioEngine.state と
// 同形の state を公開する。値は operator から受信したフレームで applyFrame() が上書きする。
export class RemoteAudio {
  constructor() {
    this.state = {
      ready: true,
      level: 0, bass: 0, mid: 0, treble: 0,
      beat: false, beatHold: 0,
      bpm: 120,
      spectrum: new Uint8Array(0),
      waveform: new Uint8Array(0),
    };
  }
  update() {}              // Engine._loop が毎フレーム呼ぶ。受信駆動なので何もしない。
  async start() { return true; }
}
