import assert from 'node:assert';
import { test } from 'node:test';
import { RemoteAudio } from '../../src/sync/RemoteAudio.js';
import { createOperatorLink, createOutputLink } from '../../src/sync/link.js';

function fakeChannel() {
  return {
    posts: [], onmessage: null,
    postMessage(m) { this.posts.push(m); },
    close() {},
    deliver(data) { if (this.onmessage) this.onmessage({ data }); },
  };
}
function manualRaf() {
  let pending = null;
  const raf = (cb) => { pending = cb; };
  raf.step = () => { const cb = pending; pending = null; if (cb) cb(); };
  return raf;
}
function sources() {
  const scene = { id: 'dancers', modeIndex: 0, modes: null, modeGroups: null, params: {} };
  const scenes = { byId: { dancers: scene }, next: null, activeId: () => 'dancers', currentScene: () => scene, goto() {} };
  const palette = { index: 0, brightness: 1, contrast: 1, accentStrength: 1, invert: false,
    set() {}, setBrightness() {}, setContrast() {}, setAccentStrength() {}, setInvert() {} };
  const overlay = { hud: false, grain: false, scanlines: false, vignette: false };
  return { scenes, palette, overlay };
}

test('operator: 毎 tick で frame、control は差分時のみ', () => {
  const ch = fakeChannel(); const raf = manualRaf();
  const audioState = { level: 0.1, bass: 0, mid: 0, treble: 0, beat: false, beatHold: 0, bpm: 120,
    spectrum: new Uint8Array(0), waveform: new Uint8Array(0) };
  const link = createOperatorLink({ audioState, controlSources: sources(), channel: ch, raf });
  link.start(); raf.step();
  const kinds1 = ch.posts.map((p) => p.t);
  assert.ok(kinds1.includes('frame'));
  assert.ok(kinds1.includes('control')); // 初回は lastControl=null と差分
  ch.posts.length = 0;
  raf.step(); // 状態変化なし
  const kinds2 = ch.posts.map((p) => p.t);
  assert.ok(kinds2.includes('frame'));
  assert.ok(!kinds2.includes('control')); // 差分なし→control は出さない
});

test('operator: hello 受信で control を即 post＋onOutputConnected', () => {
  const ch = fakeChannel(); const raf = manualRaf();
  let connected = 0;
  const audioState = { level: 0, bass: 0, mid: 0, treble: 0, beat: false, beatHold: 0, bpm: 120,
    spectrum: new Uint8Array(0), waveform: new Uint8Array(0) };
  const link = createOperatorLink({ audioState, controlSources: sources(), channel: ch, raf,
    onOutputConnected: () => { connected++; } });
  link.start();
  ch.deliver({ t: 'hello' });
  assert.strictEqual(connected, 1);
  assert.ok(ch.posts.some((p) => p.t === 'control'));
});

test('output: frame で state 上書き、control で applyControlSnapshot', () => {
  const ch = fakeChannel();               // 注入したフェイクチャンネルのみ使用（実 BroadcastChannel を作らない）
  const remoteAudio = new RemoteAudio();
  let appliedSnap = null;
  const link = createOutputLink({ remoteAudio, controlTargets: sources(), channel: ch,
    onControl: (snap) => { appliedSnap = snap; } });
  ch.deliver({ t: 'frame', frame: { level: 0.9, bass: 0.5, mid: 0.4, treble: 0.3,
    beat: true, beatHold: 1, bpm: 140, spectrum: new Uint8Array([5]), waveform: new Uint8Array([6]) } });
  assert.strictEqual(remoteAudio.state.bpm, 140);
  assert.strictEqual(remoteAudio.state.beat, true);
  ch.deliver({ t: 'control', snap: { sceneId: 'dancers', modeIndex: 0, viewIndex: null,
    modeGroups: {}, params: {}, palette: { index: 0, brightness: 1, contrast: 1, accentStrength: 1, invert: false },
    overlay: { hud: false, grain: false, scanlines: false, vignette: false } } });
  assert.ok(appliedSnap);
  assert.strictEqual(appliedSnap.sceneId, 'dancers');
  link.stop();
});

test('output: hello() で hello を post', () => {
  const ch = fakeChannel();
  const link = createOutputLink({ remoteAudio: new RemoteAudio(), controlTargets: sources(), channel: ch });
  link.hello();
  assert.ok(ch.posts.some((p) => p.t === 'hello'));
});
