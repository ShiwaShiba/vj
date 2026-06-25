// Lightweight intro reveals for the terrain lattice (格子が立ち上がる) and the roads
// (通電スイープ). Both are simple opacity ramps off the director's reveal channels,
// scaled from each material's own base opacity so the settled look is unchanged.
// THREE-free — operates on Material-like objects ({opacity, transparent}) so it is
// node-testable. The DEM ground mesh stays visible throughout (the stage); only the
// lattice + road lines animate in. Buildings ripple via reveal.js; trees in step 4.
import { clamp } from '../lib/math.js';

// Pure: a delayed 0→1 ramp. phase is when this item starts (in reveal-progress
// units), span is how long it takes — so roads light up one after another.
export const stagger = (p, phase, span = 1) => clamp((p - phase) / span, 0, 1);

export function installIntroLayers({ gridMaterials = [], roadMaterials = [], span = 0.5 }) {
  const grid = gridMaterials.map((m) => { m.transparent = true; const base = m.opacity; m.opacity = 0; return { m, base }; });
  const roads = roadMaterials.map(({ material, phase = 0 }) => { material.transparent = true; const base = material.opacity; material.opacity = 0; return { m: material, base, phase }; });

  return {
    setTerrain(p) { const k = clamp(p, 0, 1); for (const g of grid) g.m.opacity = g.base * k; },
    setRoads(p) { for (const r of roads) r.m.opacity = r.base * stagger(p, r.phase, span); },
  };
}
