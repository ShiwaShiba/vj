import { DancersScene } from './dancers/DancersScene.js';
import { SineGrid } from './dots/SineGrid.js';
import { FlowField } from './dots/FlowField.js';
import { ParticleField } from './dots/ParticleField.js';
import { PurposeMaker } from './dots/PurposeMaker.js';
import { Tunnel } from './dots/Tunnel.js';
import { FallingCubes } from './dots/FallingCubes.js';
import { CityScene } from './city/CityScene.js';
import { Kaleidoscope } from './dots/Kaleidoscope.js';
import { Lissajous } from './dots/Lissajous.js';
import { Moire } from './dots/Moire.js';
import { SpectrumBars } from './dots/SpectrumBars.js';
import { Oscilloscope } from './dots/Oscilloscope.js';
import { Datamatrix } from './dots/Datamatrix.js';

// Ordered list of scene instances. The first is the default on launch.
export function createScenes() {
  return [
    new DancersScene(),
    new Datamatrix(),
    new SpectrumBars(),
    new SineGrid(),
    new FlowField(),
    new ParticleField(),
    new PurposeMaker(),
    new Tunnel(),
    new FallingCubes(),
    new CityScene(),
    new Kaleidoscope(),
    new Lissajous(),
    new Moire(),
    new Oscilloscope(),
  ];
}
