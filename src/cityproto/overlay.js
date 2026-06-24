// 2D canvas drawn over the WebGL canvas: film grain + vignette + top haze.
// This is what tips the image from "CG render" to "rendered photo".
export function makeOverlay(canvas) {
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
    ctx.globalAlpha = 0.05; ctx.globalCompositeOperation = 'overlay';
    for (let y = 0; y < H; y += 220) for (let x = 0; x < W; x += 220) ctx.drawImage(grain, x, y);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };
}
