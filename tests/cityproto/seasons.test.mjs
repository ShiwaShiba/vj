import assert from 'node:assert';
import { test } from 'node:test';
import { SEASON_NAMES as DIRECTOR_NAMES } from '../../src/cityproto/director.js';
import {
  SEASON_NAMES, MONO_SETTLED, COLOR_PALETTE, GRAD, seasonEndpoints,
  PARTICLE, PARTICLE_COLOR, particleEndpoints,
  CHROMA_VARIANTS, setChromaVariant,
  SUMMER_FRESH_TONE, SUMMER_DEEP_TONE, SUMMER_FRESH_COLOR, SUMMER_DEEP_COLOR,
  agedSummerTone, agedSummerColor,
} from '../../src/cityproto/seasons.js';

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

test('夏の経年: age 0=新緑 / 0.5=濃緑 / 1=settled、端点は厳密一致(誤差ゼロ)', () => {
  // 端点で mix を呼ばない設計 ⇒ 浮動小数の誤差なく stop と完全一致
  assert.deepStrictEqual(agedSummerTone(0), SUMMER_FRESH_TONE);
  assert.deepStrictEqual(agedSummerTone(0.5), SUMMER_DEEP_TONE);
  assert.deepStrictEqual(agedSummerTone(1), { toneLo: MONO_SETTLED[1].toneLo, toneHi: MONO_SETTLED[1].toneHi });
  assert.deepStrictEqual(agedSummerColor(0, COLOR_PALETTE[1]), SUMMER_FRESH_COLOR);
  assert.deepStrictEqual(agedSummerColor(0.5, COLOR_PALETTE[1]), SUMMER_DEEP_COLOR);
  assert.deepStrictEqual(agedSummerColor(1, COLOR_PALETTE[1]), COLOR_PALETTE[1]);
});

test('夏の経年: 新緑→濃緑は暗くなり(濃く)、tone は単調に深まる(toneHi: fresh>deep)', () => {
  assert.ok(SUMMER_FRESH_TONE.toneHi > SUMMER_DEEP_TONE.toneHi, '新緑の方が明るい(crown)');
  // 0→0.5 で toneHi は単調減少(深まる)
  let prev = agedSummerTone(0).toneHi;
  for (const a of [0.1, 0.2, 0.3, 0.4, 0.5]) {
    const hi = agedSummerTone(a).toneHi;
    assert.ok(hi <= prev + 1e-9, `toneHi 単調減少 @${a}`);
    prev = hi;
  }
});

test('夏の経年: age を変えても age=1 で settled に一致＝サイクル境界(夏cur=秋prev)は不変', () => {
  // 経年中(age<1)は cur が動くが、wrap で参照される age=1 は settled に一致
  const wrapCur = seasonEndpoints(1, 1);
  assert.deepStrictEqual(wrapCur.cur, MONO_SETTLED[1], 'age=1 mono cur = settled');
  assert.deepStrictEqual(wrapCur.colorCur, COLOR_PALETTE[1], 'age=1 chroma cur = settled');
  assert.deepStrictEqual(wrapCur.colorCur, seasonEndpoints(2, 1).colorPrev, '夏cur(age1)=秋prev');
  // age=0(新緑)は settled と異なる＝経年が実際に効いている
  assert.notDeepStrictEqual(seasonEndpoints(1, 0).colorCur, COLOR_PALETTE[1], 'age=0 は新緑で settled と別');
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

// --- step 5: falling particles (petals / leaves / snow) descriptor ---

test('PARTICLE has 4 well-formed entries with sane ranges', () => {
  assert.strictEqual(PARTICLE.length, 4);
  for (const p of PARTICLE) {
    for (const k of ['amount', 'size', 'sway', 'fall', 'grey', 'spin']) {
      assert.strictEqual(typeof p[k], 'number', `${k} present and numeric`);
    }
    assert.ok(p.amount >= 0 && p.amount <= 1, 'amount in [0,1]');
    assert.ok(p.size > 0, 'size positive');
    assert.ok(p.fall > 0, 'fall speed positive');
    assert.ok(p.sway >= 0, 'sway non-negative');
    assert.ok(p.grey >= 0 && p.grey <= 1, 'grey in [0,1]');
  }
});

test('particle character: summer emits ~none, winter snow densest, autumn flutters most', () => {
  const [spring, summer, autumn, winter] = PARTICLE;
  assert.strictEqual(summer.amount, 0, 'summer has (almost) no particles');
  assert.ok(winter.amount >= Math.max(spring.amount, autumn.amount), 'winter snow densest emission');
  assert.ok(autumn.sway > winter.sway, 'autumn leaves flutter more than snow drifts');
  assert.ok(winter.grey >= spring.grey, 'snow brightest mono value');
});

test('PARTICLE_COLOR: 4 rgb triplets, snow (winter) is achromatic white in chroma mode too', () => {
  assert.strictEqual(PARTICLE_COLOR.length, 4);
  for (const c of PARTICLE_COLOR) {
    assert.strictEqual(c.length, 3);
    for (const ch of c) assert.ok(ch >= 0 && ch <= 1, 'channel in 0..1');
  }
  assert.deepStrictEqual(PARTICLE_COLOR[3], [1.0, 1.0, 1.0], 'snow stays white (守る線)');
});

test('particleEndpoints selects cur=index, prev=previous-with-wrap', () => {
  for (let i = 0; i < 4; i++) {
    const ep = particleEndpoints(i);
    assert.deepStrictEqual(ep.cur, PARTICLE[i], 'cur is this season');
    assert.deepStrictEqual(ep.prev, PARTICLE[(i + 3) % 4], 'prev wraps');
    assert.deepStrictEqual(ep.colorCur, PARTICLE_COLOR[i]);
    assert.deepStrictEqual(ep.colorPrev, PARTICLE_COLOR[(i + 3) % 4]);
  }
});

test('particle continuity invariant: endpoints(i).cur === endpoints(i+1).prev (seamless wrap)', () => {
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    assert.deepStrictEqual(particleEndpoints(i).cur, particleEndpoints(next).prev,
      `prog=1 of particle season ${i} must equal prog=0 baseline of season ${next}`);
    assert.deepStrictEqual(particleEndpoints(i).colorCur, particleEndpoints(next).colorPrev);
  }
});

// --- step 6: swappable chroma registers (the C-key colour mode, look-pick) ---

test('CHROMA_VARIANTS: default register `current` exists, every variant is 4×rgb in 0..1', () => {
  assert.ok(CHROMA_VARIANTS.current, 'default register `current` present');
  assert.ok(Object.keys(CHROMA_VARIANTS).length >= 2, 'at least two registers to pick between');
  for (const [name, pal] of Object.entries(CHROMA_VARIANTS)) {
    assert.strictEqual(pal.length, 4, `${name} has 4 seasons`);
    for (const c of pal) {
      assert.strictEqual(c.length, 3, `${name} hue is rgb`);
      for (const ch of c) assert.ok(ch >= 0 && ch <= 1, `${name} channel in 0..1`);
    }
  }
});

test('back-compat exports track the default register', () => {
  assert.deepStrictEqual(COLOR_PALETTE, CHROMA_VARIANTS.current, 'COLOR_PALETTE == default register');
  assert.deepStrictEqual(PARTICLE_COLOR,
    [CHROMA_VARIANTS.current[0], CHROMA_VARIANTS.current[1], CHROMA_VARIANTS.current[2], [1.0, 1.0, 1.0]]);
});

test('setChromaVariant swaps the active register; unknown name is a no-op', () => {
  try {
    setChromaVariant('muted');
    assert.deepStrictEqual(seasonEndpoints(0).colorCur, CHROMA_VARIANTS.muted[0], 'canopy follows muted');
    assert.deepStrictEqual(particleEndpoints(0).colorCur, CHROMA_VARIANTS.muted[0], 'particle follows muted');
    setChromaVariant('no-such-variant');
    assert.deepStrictEqual(seasonEndpoints(0).colorCur, CHROMA_VARIANTS.muted[0], 'unknown name leaves active unchanged');
  } finally {
    setChromaVariant('current'); // reset module state for the rest of the suite
  }
});

test('守る線: winter particle chroma is white in EVERY register', () => {
  try {
    for (const name of Object.keys(CHROMA_VARIANTS)) {
      setChromaVariant(name);
      assert.deepStrictEqual(particleEndpoints(3).colorCur, [1.0, 1.0, 1.0], `snow white under ${name}`);
      assert.deepStrictEqual(particleEndpoints(0).colorPrev, [1.0, 1.0, 1.0], `winter→spring prev white under ${name}`);
    }
  } finally {
    setChromaVariant('current');
  }
});

test('chroma continuity holds after a register swap (no colour pop at the wrap)', () => {
  try {
    setChromaVariant('mid');
    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      assert.deepStrictEqual(seasonEndpoints(i).colorCur, seasonEndpoints(next).colorPrev, `canopy ${i}→${next}`);
      assert.deepStrictEqual(particleEndpoints(i).colorCur, particleEndpoints(next).colorPrev, `particle ${i}→${next}`);
    }
  } finally {
    setChromaVariant('current');
  }
});
