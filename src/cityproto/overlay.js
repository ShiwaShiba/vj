// 2D canvas drawn over the WebGL canvas: film grain + vignette + top haze,
// plus the data-source credits (OSM/地理院/PLATEAU). This is what tips the
// image from "CG render" to "rendered photo".
// `getCredits` is an optional () => string[] read each frame; it returns the
// baked manifest's `attribution` once the city loads (single source of truth —
// the line is never hardcoded), null/empty until then.
// `getIntensity` is an optional () => number (0..1) read each frame; it rides the
// film-grain alpha with the music (audio LIVE). null/undefined ⇒ the resting look
// (grain 0.05). Mapped grain alpha = 0.04 + 0.06·clamp(intensity,0,1).
export function makeOverlay(canvas, getCredits, getIntensity) {
  const ctx = canvas.getContext('2d');
  const grain = document.createElement('canvas'); grain.width = grain.height = 220;
  const gx = grain.getContext('2d'), id = gx.createImageData(220, 220), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const n = 200 + ((Math.random() * 55) | 0); d[i] = d[i+1] = d[i+2] = n; d[i+3] = 255; }
  gx.putImageData(id, 0, 0);
  function resize() {
    const dpr = Math.min(devicePixelRatio, 2);
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
  }
  addEventListener('resize', resize); resize();
  return function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const vg = ctx.createRadialGradient(W*0.5, H*0.46, H*0.25, W*0.5, H*0.5, H*0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    const hz = ctx.createLinearGradient(0, H*0.12, 0, H*0.42);
    hz.addColorStop(0, 'rgba(7,8,10,0.85)'); hz.addColorStop(1, 'rgba(7,8,10,0)');
    ctx.fillStyle = hz; ctx.fillRect(0, H*0.12, W, H*0.30);
    const gi = getIntensity ? getIntensity() : null;
    const grainAlpha = gi == null ? 0.05 : 0.04 + 0.06 * Math.max(0, Math.min(1, gi));
    ctx.globalAlpha = grainAlpha; ctx.globalCompositeOperation = 'overlay';
    for (let y = 0; y < H; y += 220) for (let x = 0; x < W; x += 220) ctx.drawImage(grain, x, y);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    drawCredits(ctx, getCredits && getCredits(), H, Math.min(devicePixelRatio, 2));
  };
}

// Data-source credits — small, low-contrast, bottom-left (monochrome; the lattice
// grey 0xc2cad6 keeps it consistent with the scene's line work). Pure draw helper
// so the wiring is verifiable headlessly with a mock 2D context. `credits` is the
// manifest's `attribution` array (null/empty until the city loads → draws nothing).
export function drawCredits(ctx, credits, H, dpr = 1) {
  if (!credits || !credits.length) return;
  const fs = Math.round(10.5 * dpr), pad = 12 * dpr, lh = fs * 1.45;
  ctx.font = `${fs}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
  ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 2 * dpr; // legible over bright frames
  ctx.fillStyle = 'rgba(194,202,214,0.34)';
  let y = H - pad;
  for (let i = credits.length - 1; i >= 0; i--) { ctx.fillText(credits[i], pad, y); y -= lh; } // array order reads top→down
  ctx.shadowBlur = 0;
}
