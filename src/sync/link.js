import {
  buildFrame, applyFrame, buildControlSnapshot, applyControlSnapshot, controlsEqual,
} from './snapshot.js';

const CHANNEL_NAME = 'vj';

// 操作ウィンドウ側。自前 rAF で frame（毎フレーム）と control（差分時のみ）を配信する。
// Engine には触らない（無改変）。channel/raf は注入可能（テスト用）。
export function createOperatorLink({
  audioState, controlSources, onOutputConnected,
  channel = new BroadcastChannel(CHANNEL_NAME),
  raf = (cb) => requestAnimationFrame(cb),
}) {
  let running = false;
  let lastControl = null;
  channel.onmessage = (e) => {
    if (e.data && e.data.t === 'hello') {
      // 後発参加/リロードした output。現在の control を即送って同期させる。
      lastControl = buildControlSnapshot(controlSources);
      channel.postMessage({ t: 'control', snap: lastControl });
      if (onOutputConnected) onOutputConnected();
    }
  };
  function tick() {
    if (!running) return;
    if (audioState) channel.postMessage({ t: 'frame', frame: buildFrame(audioState) });
    const ctrl = buildControlSnapshot(controlSources);
    if (!controlsEqual(ctrl, lastControl)) {
      lastControl = ctrl;
      channel.postMessage({ t: 'control', snap: ctrl });
    }
    raf(tick);
  }
  return {
    start() { if (running) return; running = true; raf(tick); },
    stop() { running = false; try { channel.close(); } catch { /* noop */ } },
  };
}

// 出力ウィンドウ側。受信のみ。frame→RemoteAudio.state 上書き、control→適用。
export function createOutputLink({
  remoteAudio, controlTargets, onControl,
  channel = new BroadcastChannel(CHANNEL_NAME),
}) {
  channel.onmessage = (e) => {
    const m = e.data;
    if (!m) return;
    if (m.t === 'frame') applyFrame(m.frame, remoteAudio);
    else if (m.t === 'control') {
      if (onControl) onControl(m.snap);
      else applyControlSnapshot(m.snap, controlTargets);
    }
  };
  return {
    hello() { channel.postMessage({ t: 'hello' }); },
    stop() { try { channel.close(); } catch { /* noop */ } },
  };
}
