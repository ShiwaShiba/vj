// A labelled range slider bound to a scene param entry { value, min, max, step }.
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
  input.addEventListener('input', () => onInput(parseFloat(input.value)));
  // Track wrapper carries a centre tick (::after at 50%) so the slider's exact
  // midpoint is visible as a reference — the thumb sits on it at mid-travel.
  const track = document.createElement('div');
  track.className = 'vj-slider-track';
  track.appendChild(input);
  wrap.appendChild(span);
  wrap.appendChild(track);
  return wrap;
}
