import assert from 'node:assert';
import { test } from 'node:test';
import { RemoteAudio } from '../../src/sync/RemoteAudio.js';
import { AudioEngine } from '../../src/audio/AudioEngine.js';

test('RemoteAudio.state は AudioEngine.state とキー互換', () => {
  const r = new RemoteAudio();
  const real = new AudioEngine(); // コンストラクタは AudioContext を作らない
  const realKeys = Object.keys(real.state).sort();
  const remoteKeys = Object.keys(r.state).sort();
  for (const k of realKeys) assert.ok(remoteKeys.includes(k), `欠落キー: ${k}`);
});

test('update()/start() は安全な no-op、state は数値で初期化', () => {
  const r = new RemoteAudio();
  assert.doesNotThrow(() => r.update(123));
  assert.strictEqual(typeof r.state.bpm, 'number');
  assert.strictEqual(r.state.beat, false);
  assert.ok(r.state.spectrum instanceof Uint8Array);
});
