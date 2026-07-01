// src/scenes/yeast/yeastCore.js
// Owns all THREE state for YEAST. Screen-space metaball splat:
//   pass 1 — instanced quads additively splat a Wyvill field into a HalfFloat RT
//   pass 2 — (Task 5) fullscreen iso-threshold shading turns the field into cells
//   pass 3 — (Task 5) UnrealBloom
// This file has NO randomness; all geometry/time/audio arrive via setInstances/setUniforms.
import { YEAST } from './yeastDrive.js';

// --- pass 1: splat. Base quad in [-1,1]^2; instance places it at aCenter with support R.
// gl_Position computed directly in clip space from uViewport (no camera matrices).
const SPLAT_VERT = /* glsl */`
  precision highp float;
  attribute vec3 position;            // base quad corner, xy in [-1,1]
  attribute vec2 aCenter;             // normalized cell center
  attribute float aRadius;            // normalized cell radius (0 => no splat)
  attribute float aDepth;             // [0,1]
  attribute float aBud;               // budAmount [0,1] (bud lobes dim slightly)
  uniform vec2 uViewport;             // drawing-buffer size (px)
  uniform vec2 uHalf;                 // uViewport*0.5
  uniform float uScale;               // 0.5*min(uViewport) — normalized->px, scalar => round FOV
  uniform float uFusion, uFocusPlane, uDof;
  varying vec2 vLocal;
  varying float vAmp;
  void main() {
    float blur = abs(aDepth - uFocusPlane);
    float sup = ${YEAST.SUP_A.toFixed(3)} + ${YEAST.SUP_B.toFixed(3)} * uFusion;
    float Rn = aRadius * sup * (1.0 + ${YEAST.DOF_R.toFixed(3)} * blur * 2.0 * uDof);
    float amp = (1.0 - ${YEAST.DOF_AMP.toFixed(3)} * blur * 2.0 * uDof) * (aBud > 0.001 ? 0.9 : 1.0);
    vLocal = position.xy;
    vAmp = aRadius > 0.0 ? max(amp, 0.0) : 0.0;     // radius 0 => contributes nothing
    vec2 px = aCenter * uScale + uHalf + position.xy * (Rn * uScale);
    vec2 clip = (px / uViewport) * 2.0 - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
  }
`;

const SPLAT_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vLocal;
  varying float vAmp;
  void main() {
    float q = dot(vLocal, vLocal);                  // (d/R)^2 within the quad
    if (q >= 1.0 || vAmp <= 0.0) discard;
    float t = 1.0 - q;
    gl_FragColor = vec4(vAmp * t * t * t, 0.0, 0.0, 1.0);   // Wyvill kernel, additive
  }
`;

// --- pass-through (Task 4 only; replaced by shading in Task 5): show the raw field grayscale.
const FS_VERT = /* glsl */`
  precision highp float;
  attribute vec3 position; attribute vec2 uv; varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const PASSTHRU_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uField; varying vec2 vUv;
  void main() { float F = texture2D(uField, vUv).r; float v = clamp(F * 0.6, 0.0, 1.0); gl_FragColor = vec4(v, v, v, 1.0); }
`;

export function createYeastCore({ THREE, renderer }) {
  // ensure half-float color buffers are renderable/blendable on WebGL2
  const gl = renderer.getContext();
  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('EXT_color_buffer_half_float');

  const N = 2 * YEAST.COUNT;
  // --- splat scene: instanced quads
  const base = new THREE.InstancedBufferGeometry();
  const quad = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
  base.setAttribute('position', new THREE.BufferAttribute(quad, 3));
  base.setIndex([0, 1, 2, 0, 2, 3]);
  const aCenter = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2);
  const aRadius = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
  const aDepth = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
  const aBud = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
  aCenter.setUsage(THREE.DynamicDrawUsage); aRadius.setUsage(THREE.DynamicDrawUsage);
  aDepth.setUsage(THREE.DynamicDrawUsage); aBud.setUsage(THREE.DynamicDrawUsage);
  base.setAttribute('aCenter', aCenter); base.setAttribute('aRadius', aRadius);
  base.setAttribute('aDepth', aDepth); base.setAttribute('aBud', aBud);
  base.instanceCount = N;

  const splatUniforms = {
    uViewport: { value: new THREE.Vector2(1, 1) }, uHalf: { value: new THREE.Vector2(0.5, 0.5) },
    uScale: { value: 1 }, uFusion: { value: 0.6 }, uFocusPlane: { value: 0.5 }, uDof: { value: 0.6 },
  };
  const splatMat = new THREE.RawShaderMaterial({
    uniforms: splatUniforms, vertexShader: SPLAT_VERT, fragmentShader: SPLAT_FRAG,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const splatScene = new THREE.Scene();
  splatScene.add(new THREE.Mesh(base, splatMat));
  const dummyCam = new THREE.Camera();   // shader ignores it; render() needs some camera

  // --- field RT (HalfFloat, additive target)
  let fieldRT = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });

  // --- fullscreen pass-through (Task 4). Replaced by shading composer in Task 5.
  const fsQuad = new THREE.BufferGeometry();
  fsQuad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  fsQuad.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const showUniforms = { uField: { value: fieldRT.texture } };
  const showMat = new THREE.RawShaderMaterial({ uniforms: showUniforms, vertexShader: FS_VERT, fragmentShader: PASSTHRU_FRAG });
  const showScene = new THREE.Scene();
  showScene.add(new THREE.Mesh(fsQuad, showMat));

  function resize(w, h) {
    renderer.setSize(w, h);
    const v = new THREE.Vector2(); renderer.getDrawingBufferSize(v);
    fieldRT.setSize(v.x, v.y);
    showUniforms.uField.value = fieldRT.texture;
    splatUniforms.uViewport.value.set(v.x, v.y);
    splatUniforms.uHalf.value.set(v.x * 0.5, v.y * 0.5);
    splatUniforms.uScale.value = 0.5 * Math.min(v.x, v.y);
  }
  function setInstances(state) {
    aCenter.array.set(interleaveXY(state.px, state.py, aCenter.array));
    aRadius.array.set(state.pr); aDepth.array.set(state.pd); aBud.array.set(state.pbud);
    aCenter.needsUpdate = aRadius.needsUpdate = aDepth.needsUpdate = aBud.needsUpdate = true;
    if (state.activeSlots != null) base.instanceCount = Math.max(1, Math.min(N, state.activeSlots | 0));
  }
  function setUniforms(o) {
    for (const k in o) { const u = splatUniforms[k]; if (u) u.value = o[k]; }
  }
  function render() {
    renderer.setRenderTarget(fieldRT);
    renderer.setClearColor(0x000000, 1); renderer.clear();
    renderer.render(splatScene, dummyCam);
    renderer.setRenderTarget(null);
    renderer.render(showScene, dummyCam);
  }
  function dispose() {
    base.dispose(); splatMat.dispose(); fsQuad.dispose(); showMat.dispose(); fieldRT.dispose();
  }
  return { resize, setInstances, setUniforms, render, dispose, _splatUniforms: splatUniforms };
}

// pack px[],py[] (length n) into a flat xy array of length 2n
function interleaveXY(px, py, out) {
  for (let i = 0; i < px.length; i++) { out[i * 2] = px[i]; out[i * 2 + 1] = py[i]; }
  return out;
}
