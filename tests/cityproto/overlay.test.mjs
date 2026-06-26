import assert from 'node:assert';
import { test } from 'node:test';
import { drawCredits } from '../../src/cityproto/overlay.js';

// Minimal mock of the bits of a 2D context drawCredits touches: it records every
// fillText so we can assert WHAT was drawn and WHERE, headlessly.
function mockCtx() {
  const calls = [];
  return {
    calls, font: '', textBaseline: '', textAlign: '', fillStyle: '', shadowColor: '', shadowBlur: 0,
    fillText(text, x, y) { calls.push({ text, x, y }); },
  };
}

const ATTRIB = [
  '© OpenStreetMap contributors',
  '地理院タイル（標高タイル）を加工して作成',
  '3D都市モデル（Project PLATEAU／国土交通省）',
];

test('drawCredits renders every attribution line, bottom-left, in top→down order', () => {
  const ctx = mockCtx();
  const H = 1000, dpr = 2;
  drawCredits(ctx, ATTRIB, H, dpr);
  assert.strictEqual(ctx.calls.length, ATTRIB.length, 'one line per attribution string');
  // every source string is drawn verbatim (single source of truth — no hardcoding)
  for (const s of ATTRIB) assert.ok(ctx.calls.some((c) => c.text === s), `missing credit: ${s}`);
  // all anchored at the left padding (12*dpr) and inside the bottom edge
  const pad = 12 * dpr;
  for (const c of ctx.calls) {
    assert.strictEqual(c.x, pad, 'left-aligned at the padding');
    assert.ok(c.y > 0 && c.y <= H - pad, `within the bottom margin (y=${c.y})`);
  }
  // array order reads top→down: attribution[0] sits highest (smallest y)
  const yOf = (s) => ctx.calls.find((c) => c.text === s).y;
  assert.ok(yOf(ATTRIB[0]) < yOf(ATTRIB[1]) && yOf(ATTRIB[1]) < yOf(ATTRIB[2]), 'first line is highest');
  // monochrome, low-contrast (the守る線): grey fill, not pure white, partial alpha
  assert.match(ctx.fillStyle, /rgba\(194,\s*202,\s*214,\s*0\.34\)/, 'lattice-grey, low alpha');
});

test('drawCredits draws nothing before the manifest loads (null / empty)', () => {
  for (const empty of [null, undefined, []]) {
    const ctx = mockCtx();
    drawCredits(ctx, empty, 1000, 2);
    assert.strictEqual(ctx.calls.length, 0, `no draw for ${JSON.stringify(empty)}`);
  }
});
