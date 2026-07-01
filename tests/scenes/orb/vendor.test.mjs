import assert from 'node:assert';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const PP = join(root, 'src/vendor/three-addons/postprocessing');
const SH = join(root, 'src/vendor/three-addons/shaders');

const FILES = [
  [join(PP, 'Pass.js'), 'Pass'],
  [join(PP, 'EffectComposer.js'), 'EffectComposer'],
  [join(PP, 'RenderPass.js'), 'RenderPass'],
  [join(PP, 'ShaderPass.js'), 'ShaderPass'],
  [join(PP, 'MaskPass.js'), 'MaskPass'],
  [join(PP, 'UnrealBloomPass.js'), 'UnrealBloomPass'],
  [join(SH, 'CopyShader.js'), 'CopyShader'],
  [join(SH, 'LuminosityHighPassShader.js'), 'LuminosityHighPassShader'],
];

test('all bloom addon files are vendored and reference their symbol', () => {
  for (const [path, sym] of FILES) {
    assert.ok(existsSync(path), `missing ${path}`);
    const src = readFileSync(path, 'utf8');
    assert.ok(src.length > 200, `${path} looks truncated`);
    assert.ok(new RegExp(`\\b${sym}\\b`).test(src), `${path} references ${sym}`);
    assert.ok(!/^<!DOCTYPE/i.test(src.trimStart()), `${path} is an HTML error page`);
  }
});

test('vendored addons carry no absolute/CDN import URLs (importmap-resolved)', () => {
  for (const [path] of FILES) {
    const src = readFileSync(path, 'utf8');
    assert.ok(!/from\s+['"]https?:\/\//.test(src), `${path} has an absolute import`);
    assert.ok(!/unpkg|cdn\.jsdelivr|skypack/.test(src), `${path} references a CDN`);
  }
});
