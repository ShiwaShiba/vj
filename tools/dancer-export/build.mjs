// Assembles a single self-contained HTML from the real (verbatim) Dancers
// modules plus the standalone harness. No external bundler, no dependencies.
//
// Source of truth is the repository's own `src/` — this script bundles whatever
// dancer code is checked out. Run it on `feat/dancer-graphic-airborne` to get
// the GRAPHIC (brush-croquis / airborne) build; run it on main to get the
// PICTO/base build. The output HTML is a git-ignored artifact — regenerate it,
// don't commit it.
//
// Each module is wrapped in its own IIFE that returns an exports object into a
// shared `__mods` registry — a faithful flattening of the ES-module graph. This
// preserves per-module scope, so module-private names (e.g. DancerRig's own
// `lerp`, groove's `frac`) never collide with each other or the harness. Imports
// become `const { A } = __mods['dep']` destructures; the `export` keyword is
// stripped and the exported names are returned from the IIFE.
//
// Usage:  node tools/dancer-export/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', '..', 'src'); // the repo's live source tree

// Dependency order: each module appears after everything it imports.
const MODULES = [
  'lib/math.js',
  'color/palettes.js',
  'color/PaletteManager.js',
  'engine/Clock.js',
  'scenes/Scene.js',
  'scenes/dancers/spring.js',
  'scenes/dancers/poses.js',
  'scenes/dancers/couplings.js',
  'scenes/dancers/groove.js',
  'scenes/dancers/moves.js',
  'scenes/dancers/audioMap.js',
  'scenes/dancers/Choreographer.js',
  'scenes/dancers/DancerRig.js',
  'scenes/dancers/DancersScene.js',
];

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?\s*$/;
const EXPORT_DECL_RE = /^export\s+(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)/;

function wrapModule(rel) {
  const code = readFileSync(join(SRC, rel), 'utf8');
  const imports = [];
  const exports = [];
  const body = [];
  for (const line of code.split('\n')) {
    const im = line.match(IMPORT_RE);
    if (im) {
      const spec = im[2];
      const key = posix.normalize(posix.join(posix.dirname(rel), spec));
      const binds = im[1].split(',').map((s) => s.trim()).filter(Boolean).map((n) => {
        const as = n.split(/\s+as\s+/);
        return as.length === 2 ? `${as[0].trim()}: ${as[1].trim()}` : n;
      });
      imports.push(`  const { ${binds.join(', ')} } = __mods[${JSON.stringify(key)}];`);
      continue;
    }
    if (/^export\s*\{/.test(line) || /^export\s+default\b/.test(line) || /^export\s*\*/.test(line)) {
      throw new Error(`unsupported export form in ${rel}: ${line}`);
    }
    const ex = line.match(EXPORT_DECL_RE);
    if (ex) exports.push(ex[1]);
    body.push(line.replace(/^export\s+/, ''));
  }
  return [
    `__mods[${JSON.stringify(rel)}] = (function () {`,
    `  'use strict';`,
    ...imports,
    ...body.map((l) => (l.length ? '  ' + l : l)),
    `  return { ${exports.join(', ')} };`,
    `})();`,
  ].join('\n');
}

const parts = ['const __mods = {};'];
for (const rel of MODULES) parts.push(wrapModule(rel));
// Expose to the harness exactly what it references.
parts.push(
  `const { DancersScene } = __mods['scenes/dancers/DancersScene.js'];`,
  `const { PaletteManager } = __mods['color/PaletteManager.js'];`,
  `const { Clock } = __mods['engine/Clock.js'];`,
  `const { rgbCss, clamp, TWO_PI, HALF_PI } = __mods['lib/math.js'];`
);
const bundle = parts.join('\n\n');

// Sanity: no stray top-level import/export should survive the transform.
for (const line of bundle.split('\n')) {
  if (/^import\b/.test(line)) throw new Error('leftover top-level import: ' + line);
  if (/^export\b/.test(line)) throw new Error('leftover top-level export: ' + line);
}

const harness = readFileSync(join(HERE, 'harness.js'), 'utf8');
let html = readFileSync(join(HERE, 'template.html'), 'utf8');
if (!html.includes('/*__BUNDLE__*/') || !html.includes('/*__HARNESS__*/')) {
  throw new Error('template placeholders missing');
}
html = html.replace('/*__BUNDLE__*/', () => bundle).replace('/*__HARNESS__*/', () => harness);

const outPath = join(HERE, 'dancers-standalone.html');
writeFileSync(outPath, html);
console.log('wrote', outPath);
console.log('modules:', MODULES.length, '| bundle', bundle.length, 'chars | html', html.length, 'chars');
