// A labelled range slider bound to a scene param entry { value, min, max, step }.
// A right-aligned numeric readout shows the live value (tabular, dim) so params
// can be calibrated to exact numbers instead of eyeballed slider positions.
export function createSlider(label, entry, onInput) {
  const wrap = document.createElement('label');
  wrap.className = 'vj-slider';
  const span = document.createElement('span');
  span.className = 'vj-slider-label';
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = entry.min;
  input.max = entry.max;
  input.step = entry.step;
  input.value = entry.value;
  const readout = document.createElement('span');
  readout.className = 'vj-slider-value';
  readout.textContent = formatSliderValue(entry.value, entry.step);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    readout.textContent = formatSliderValue(v, entry.step);
    onInput(v);
  });
  // Track wrapper carries a centre tick (::after at 50%) so the slider's exact
  // midpoint is visible as a reference — the thumb sits on it at mid-travel.
  const track = document.createElement('div');
  track.className = 'vj-slider-track';
  track.appendChild(input);
  wrap.appendChild(span);
  wrap.appendChild(track);
  wrap.appendChild(readout);
  return wrap;
}

// Decimal places implied by the step (0.1→1, 0.25→2, 1→0) so the readout shows
// exactly the precision the slider can reach — no trailing noise, no lost digits.
export function formatSliderValue(value, step) {
  const s = String(step == null ? 1 : step);
  const dot = s.indexOf('.');
  const decimals = dot < 0 ? 0 : s.length - dot - 1;
  return Number(value).toFixed(decimals);
}
