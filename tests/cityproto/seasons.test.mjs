import assert from 'node:assert';
import { test } from 'node:test';
import { SEASON_NAMES as DIRECTOR_NAMES } from '../../src/cityproto/director.js';
import { SEASON_NAMES, MONO_SETTLED, COLOR_PALETTE, GRAD, seasonEndpoints } from '../../src/cityproto/seasons.js';

test('SEASON_NAMES is the single source re-exported from director', () => {
  assert.deepStrictEqual(SEASON_NAMES, DIRECTOR_NAMES, 're-export must equal director order');
  assert.deepStrictEqual(SEASON_NAMES, ['spring', 'summer', 'autumn', 'winter']);
});

test('MONO_SETTLED has 4 well-formed entries with sane ranges', () => {
  assert.strictEqual(MONO_SETTLED.length, 4);
  for (const s of MONO_SETTLED) {
    for (const k of ['scale', 'density', 'toneLo', 'toneHi', 'shimmer', 'snow']) {
      assert.strictEqual(typeof s[k], 'number', `${k} present and numeric`);
    }
    assert.ok(s.density >= 0 && s.density <= 1, 'density in [0,1]');
    assert.ok(s.snow >= 0 && s.snow <= 1, 'snow in [0,1]');
    assert.ok(s.shimmer >= 0 && s.shimmer <= 1, 'shimmer in [0,1]');
    assert.ok(s.toneLo < s.toneHi, 'base grey below crown grey');
    assert.ok(s.toneLo >= 0 && s.toneHi <= 1, 'greys in [0,1]');
  }
});

test('seasonal character: summer densest+darkest, winter sparsest+snowy', () => {
  const [spring, summer, autumn, winter] = MONO_SETTLED;
  assert.ok(summer.density >= Math.max(spring.density, autumn.density, winter.density), 'summer densest');
  assert.ok(winter.density <= Math.min(spring.density, summer.density, autumn.density), 'winter sparsest');
  assert.ok(summer.toneHi < spring.toneHi, 'summer crown darker than spring (新緑→濃緑)');
  assert.ok(winter.snow > 0, 'winter has snow');
  assert.strictEqual(spring.snow, 0, 'spring no snow');
  assert.ok(autumn.shimmer > 0, 'autumn shimmers');
});

test('seasonEndpoints selects cur=index, prev=previous-with-wrap', () => {
  for (let i = 0; i < 4; i++) {
    const ep = seasonEndpoints(i);
    assert.deepStrictEqual(ep.cur, MONO_SETTLED[i], 'cur is this season');
    assert.deepStrictEqual(ep.prev, MONO_SETTLED[(i + 3) % 4], 'prev wraps');
    assert.deepStrictEqual(ep.colorCur, COLOR_PALETTE[i]);
    assert.deepStrictEqual(ep.colorPrev, COLOR_PALETTE[(i + 3) % 4]);
  }
});

test('continuity invariant: endpoints(i).cur === endpoints(i+1).prev (no wrap pop)', () => {
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    assert.deepStrictEqual(seasonEndpoints(i).cur, seasonEndpoints(next).prev,
      `prog=1 of season ${i} must equal prog=0 baseline of season ${next}`);
    assert.deepStrictEqual(seasonEndpoints(i).colorCur, seasonEndpoints(next).colorPrev);
  }
});

test('COLOR_PALETTE: 4 rgb triplets in 0..1 (shader units, not 0..255)', () => {
  assert.strictEqual(COLOR_PALETTE.length, 4);
  for (const c of COLOR_PALETTE) {
    assert.strictEqual(c.length, 3);
    for (const ch of c) assert.ok(ch >= 0 && ch <= 1, 'channel in 0..1');
  }
});

test('GRAD exposes the single-source gradient constants', () => {
  assert.strictEqual(typeof GRAD.base, 'number');
  assert.strictEqual(typeof GRAD.span, 'number');
  assert.ok(GRAD.span > 0);
});
