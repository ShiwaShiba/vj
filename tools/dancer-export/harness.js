// Minimal standalone driver for the Dancers scene. It reproduces exactly what the
// real app's outer shell does around the (byte-identical) dancer modules:
//   Canvas.js     -> DPR-scaled context, draw in CSS px
//   Engine._loop  -> audio -> clock -> palette -> scene.update -> draw
//   SceneManager  -> stash audio/palette/clock on the scene, trail-clear, scene.draw
// The one thing it swaps out is AudioEngine (mic/WebAudio): here a synthetic
// techno signal drives the dance so it moves with no microphone.

const frac = (x) => x - Math.floor(x);
const $ = (id) => document.getElementById(id);

// ---- Canvas (mirror of engine/Canvas.js: draw in CSS px, context pre-scaled) ----
const stage = $('stage');
const canvas = $('c');
const ctx = canvas.getContext('2d', { alpha: false });
let CSS_W = 1, CSS_H = 1, DPR = 1;
function metrics() {
  DPR = Math.min(window.devicePixelRatio || 1, 2); // CONFIG.MAX_DPR
  CSS_W = Math.max(1, Math.round(stage.clientWidth));
  CSS_H = Math.max(1, Math.round(stage.clientHeight));
  canvas.width = Math.round(CSS_W * DPR);
  canvas.height = Math.round(CSS_H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); // so scenes draw in CSS px
}

// ---- Real engine pieces (from the bundle) ----
const palette = new PaletteManager();     // index 0 = MONO (white on black)
const clock = new Clock();
const scene = new DancersScene();
scene.setModeGroup('style', 1);           // default to GRAPHIC — the version under review

metrics();
scene.init(ctx, CSS_W, CSS_H);
new ResizeObserver(() => { metrics(); scene.onResize(CSS_W, CSS_H); }).observe(stage);

// ---- Synthetic audio (replaces AudioEngine): a 4-on-the-floor techno signal ----
// Supplies exactly the fields the dancers read: level, bass, mid, treble, beat,
// beatHold, bpm, ready.
const audio = { level: 0, bass: 0, mid: 0, treble: 0, beat: false, beatHold: 0, bpm: 120, ready: true };
let energyMaster = 0.70;   // ENERGY slider (0..1)
let musicOn = true;        // MIC toggle: true = simulated music, false = mic-off idle groove
let beatAccum = 0;         // our own beat-phase accumulator (fires audio.beat before clock.update)
let bars = 0;              // elapsed bars (for the slow swell)
let kickEnv = 0;           // stateful kick envelope (punchy attack, exp release)

function updateAudio(dt) {
  audio.bpm = uiBpm;
  const spb = 60 / audio.bpm; // seconds per beat

  if (!musicOn) {
    // Mic off: let the bands fall to ~0 so the scene's own low-amplitude living
    // groove (its quiet fallback) takes over. ready=false is the trigger.
    audio.ready = false;
    audio.beat = false;
    const k = Math.exp(-dt / 0.4);
    audio.level *= k; audio.bass *= k; audio.mid *= k; audio.treble *= k;
    audio.beatHold *= Math.exp(-dt / 0.3);
    return;
  }

  audio.ready = true;
  beatAccum += dt / spb;
  audio.beat = false;
  while (beatAccum >= 1) { beatAccum -= 1; bars += 0.25; kickEnv = 1; audio.beatHold = 1; audio.beat = true; }

  kickEnv *= Math.exp(-dt / 0.11);              // ~110ms kick tail
  audio.beatHold *= Math.exp(-dt / (spb * 0.5)); // decays over ~half a beat
  const hat = Math.pow(1 - frac(beatAccum * 2), 6); // 8th-note shimmer spike
  const swell = 0.5 + 0.5 * Math.sin((bars / 8) * TWO_PI - HALF_PI); // 8-bar build/relax

  const E = energyMaster;
  audio.bass   = clamp(E * (0.25 + 0.95 * kickEnv), 0, 1);
  audio.mid    = clamp(E * (0.20 + 0.35 * Math.abs(Math.sin(beatAccum * Math.PI)) + 0.25 * hat), 0, 1);
  audio.treble = clamp(E * (0.12 + 0.50 * hat) + 0.02, 0, 1);
  audio.level  = clamp(E * (0.30 + 0.45 * kickEnv + 0.25 * swell), 0, 1);
}

// ---- Frame loop (mirror of Engine._loop + SceneManager.update/drawFrame) ----
let last = performance.now();
let running = true;
let hudTick = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(now - last, 50) / 1000; // CONFIG.DT_CLAMP_MS = 50
  last = now;
  if (!running) return;

  updateAudio(dt);
  clock.update(dt, audio.bpm, audio.beat);
  palette.update(dt);

  scene.audio = audio; scene.palette = palette; scene.clock = clock; // SceneManager stash
  scene.update(dt, audio, palette, clock);

  // Trail clear (SceneManager.drawFrame): fill bg at alpha = scene.trail.
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = rgbCss(palette.bg, scene.trail);
  ctx.fillRect(0, 0, CSS_W, CSS_H);
  scene.draw(ctx, 1);
  ctx.globalAlpha = 1;

  if ((hudTick = (hudTick + 1) % 6) === 0) drawHud();
}

function drawHud() {
  hud.textContent =
    (audio.beat ? '● ' : '· ') + 'BPM ' + audio.bpm.toFixed(0) +
    '   lvl ' + audio.level.toFixed(2) + '  bass ' + audio.bass.toFixed(2) + '  trb ' + audio.treble.toFixed(2) +
    '\n' + scene.modeGroups[0].options[scene.mg('style')] +
    ' · ' + scene.views[scene.viewIndex].name +
    ' · ' + scene.modeName() +
    (musicOn ? '' : '  · idle');
}

// ---- Controls ----
const hud = $('hud');
let uiBpm = 120;

$('play').onclick = () => { running = !running; last = performance.now(); $('play').textContent = running ? '⏸ PAUSE' : '▶ PLAY'; };
$('idle').onclick = () => { musicOn = !musicOn; $('idle').textContent = 'MIC: ' + (musicOn ? 'ON' : 'OFF'); };
$('style').onclick = () => { scene.setModeGroup('style', scene.mg('style') + 1); syncButtons(); };
$('view').onclick = () => { scene.setView(scene.viewIndex + 1); syncButtons(); };
$('mode').onclick = () => { scene.setMode(scene.modeIndex + 1); syncButtons(); };

function bindParam(id, key, valId, fmt) {
  const el = $(id), v = $(valId);
  const apply = () => { scene.params[key].value = parseFloat(el.value); v.textContent = fmt(parseFloat(el.value)); };
  el.oninput = apply; apply();
}
bindParam('count', 'count', 'vcount', (x) => x.toFixed(0));
bindParam('size', 'size', 'vsize', (x) => x.toFixed(2));
bindParam('spread', 'spread', 'vspread', (x) => x.toFixed(1));
bindParam('trail', 'trail', 'vtrail', (x) => x.toFixed(2));
$('bpm').oninput = () => { uiBpm = parseFloat($('bpm').value); $('vbpm').textContent = uiBpm.toFixed(0); };
$('energy').oninput = () => { energyMaster = parseFloat($('energy').value); $('venergy').textContent = energyMaster.toFixed(2); };

$('toggle').onclick = () => $('panel').classList.toggle('hidden');
// Tap the stage (not a control) to hide/show the panel — handy on a tablet.
stage.addEventListener('click', () => $('panel').classList.toggle('hidden'));

function syncButtons() {
  $('style').textContent = 'STYLE: ' + scene.modeGroups[0].options[scene.mg('style')];
  $('view').textContent = 'VIEW: ' + scene.views[scene.viewIndex].name;
  $('mode').textContent = 'MODE: ' + scene.modeName();
}
syncButtons();

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); $('play').click(); }
  else if (k === 's') $('style').click();
  else if (k === 'v') $('view').click();
  else if (k === 'm') $('mode').click();
  else if (k === 'i') $('idle').click();
  else if (k === 'h') $('toggle').click();
});

requestAnimationFrame(loop);
