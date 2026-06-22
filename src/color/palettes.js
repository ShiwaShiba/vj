import { hexToRgb } from '../lib/math.js';

// Minimal-techno palette system (Ryoji Ikeda / Raster-Noton / Carsten Nicolai).
// Monochrome-first, high contrast, restrained. Ramps are mostly single-hue
// tonal scales so scenes read as data, not rainbow. `mono` is the default.
const RAW = [
  // Stark white-on-black — the default. Pure data.
  { id: 'mono', name: 'MONO', bg: '#000000', fg: '#ffffff', accent: '#ffffff',
    ramp: ['#ffffff', '#c4c4c4', '#7d7d7d', '#3a3a3a', '#ededed'] },
  // Inverted: black-on-paper. Print / Swiss.
  { id: 'paper', name: 'PAPER', bg: '#f2f1ec', fg: '#000000', accent: '#000000',
    ramp: ['#000000', '#2c2c2c', '#6e6e6e', '#a8a8a8', '#101010'] },
  // White field with a single red signal. Ikeda red.
  { id: 'signal', name: 'SIGNAL', bg: '#000000', fg: '#f4f4f4', accent: '#ff2200',
    ramp: ['#ffffff', '#d6d6d6', '#8c8c8c', '#ff2200', '#ffffff'] },
  // Phosphor amber monochrome — old CRT / oscilloscope.
  { id: 'amber', name: 'AMBER', bg: '#050300', fg: '#ffb000', accent: '#ffd37a',
    ramp: ['#ffe9c0', '#ffb000', '#c77800', '#6e3f00', '#ffd37a'] },
  // Cold cyan monochrome — minimal, clinical.
  { id: 'cyan', name: 'CYAN', bg: '#00060a', fg: '#bdf3ff', accent: '#36e0ff',
    ramp: ['#eaffff', '#7fe9ff', '#36b6d8', '#0e5d72', '#cdfbff'] },
  // Near-mono ink blue — quiet, architectural.
  { id: 'ink', name: 'INK', bg: '#0a0a0d', fg: '#e8e8ee', accent: '#5b6cff',
    ramp: ['#e8e8ee', '#9aa0c0', '#5b6cff', '#2a2f55', '#f0f0f6'] },
  // Green phosphor terminal — CRT / data console (Kraftwerk readout).
  { id: 'term', name: 'TERM', bg: '#020803', fg: '#33ff77', accent: '#aaffcc',
    ramp: ['#d9ffe6', '#33ff77', '#19c456', '#0a5e2c', '#bfffd6'] },
  // Blueprint — navy field, pale drafting lines. Architectural.
  { id: 'blpr', name: 'BLPR', bg: '#0a1a33', fg: '#cfe3ff', accent: '#7fb3ff',
    ramp: ['#eaf2ff', '#9fc4ff', '#5b8fe0', '#27508f', '#dce8ff'] },
  // Cool slate monochrome with an ice-blue signal. Quiet, industrial.
  { id: 'steel', name: 'STEEL', bg: '#16181c', fg: '#cdd3da', accent: '#8fd0e6',
    ramp: ['#eef1f4', '#aeb6bf', '#6c7480', '#363b42', '#dfe4e9'] },
  // Warm cream paper, sepia ink, faded brick signal. Print / Swiss, warm.
  { id: 'bone', name: 'BONE', bg: '#ece6d8', fg: '#2a2317', accent: '#b5482e',
    ramp: ['#2a2317', '#54452f', '#897153', '#b8a888', '#3a3122'] },
  // Black field, dim warm white, a single deep blood-red. Noir.
  { id: 'noir', name: 'NOIR', bg: '#070506', fg: '#cfc7c7', accent: '#b3121f',
    ramp: ['#e6dede', '#a89a9a', '#6e5c5c', '#b3121f', '#efe8e8'] },
  // Monochrome with one magenta accent. Raster-Noton.
  { id: 'violet', name: 'VIOLET', bg: '#08060c', fg: '#ece8f2', accent: '#d23bff',
    ramp: ['#f3eefb', '#c9b9e6', '#a274cc', '#d23bff', '#efe6fb'] },
];

export const PALETTES = RAW.map((p) => ({
  id: p.id,
  name: p.name,
  bg: hexToRgb(p.bg),
  fg: hexToRgb(p.fg),
  accent: hexToRgb(p.accent),
  ramp: p.ramp.map(hexToRgb),
}));
