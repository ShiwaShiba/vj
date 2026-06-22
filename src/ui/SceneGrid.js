// Resolume-style clip grid of scene cells.
export function createSceneGrid(scenes, onSelect) {
  const el = document.createElement('div');
  el.className = 'vj-scenegrid';
  const buttons = {};
  scenes.forEach((s) => {
    const b = document.createElement('button');
    b.className = 'vj-cell';
    b.textContent = s.name;
    b.addEventListener('click', () => onSelect(s.id));
    el.appendChild(b);
    buttons[s.id] = b;
  });
  return {
    el,
    setActive(id) {
      for (const k in buttons) buttons[k].classList.toggle('active', k === id);
    },
  };
}
