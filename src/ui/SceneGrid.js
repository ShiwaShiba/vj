import { IMPROVEMENT_SCENE_IDS } from '../scenes/registry.js';

// Resolume-style clip grid of scene cells.
export function createSceneGrid(scenes, onSelect) {
  const el = document.createElement('div');
  el.className = 'vj-scenegrid';
  const buttons = {};
  let sepInserted = false;
  scenes.forEach((s) => {
    // 改善予定グループの先頭に一度だけ全幅セパレータを挿入して二群に分ける。
    if (!sepInserted && IMPROVEMENT_SCENE_IDS.has(s.id)) {
      const sep = document.createElement('div');
      sep.className = 'vj-scenegrid-sep';
      sep.textContent = '改善予定';
      el.appendChild(sep);
      sepInserted = true;
    }
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
