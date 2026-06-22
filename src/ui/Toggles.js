// On/off toggle button.
export function createToggle(label, initial, onChange) {
  const b = document.createElement('button');
  b.className = 'vj-toggle';
  b.textContent = label;
  let state = initial;
  const apply = () => b.classList.toggle('on', state);
  apply();
  b.addEventListener('click', () => {
    state = !state;
    apply();
    onChange(state);
  });
  return { el: b, set(v) { state = v; apply(); }, get() { return state; } };
}

// Plain action button.
export function createButton(label, onClick) {
  const b = document.createElement('button');
  b.className = 'vj-btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
