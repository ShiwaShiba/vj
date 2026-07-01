// src/scenes/yeast/yeastCore.js
// Owns all THREE state for YEAST. Screen-space metaball splat:
//   pass 1 — instanced quads additively splat a Wyvill field into a HalfFloat RT
//   pass 2 — fullscreen iso-threshold shading turns the field into cells
//   pass 3 — UnrealBloom
// This file has NO randomness; all geometry/time/audio arrive via setInstances/setUniforms.
import { YEAST } from './yeastDrive.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

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

// --- pass 2: fullscreen iso-threshold shading. Reads the field, turns it into translucent
// cell bodies with bright rims, phase-contrast halos, cored nuclei, hollow<->filled interpolation,
// a circular microscope vignette, and a mono<->slate tint. (Ported from the validated mockup.)
const SHADE_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uField;
  uniform vec2 uTexel;          // 1/bufW, 1/bufH
  uniform vec2 uHalf;           // bufW/2, bufH/2
  uniform float uScale;         // 0.5*min(buf)
  uniform float uT;             // iso threshold
  uniform float uFill, uRim, uHalo;
  uniform float uSwell, uShimmer, uExposure;
  uniform float uTint;          // 0=mono, 1=slate
  uniform vec3 uMono;           // mono cell color (palette.fg/255)
  uniform float uFov;           // FOV radius (normalized)
  varying vec2 vUv;
  float sm(float a, float b, float x){ x = clamp((x - a) / (b - a), 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }
  void main() {
    float F = texture2D(uField, vUv).r;
    float T = uT;
    float val = 0.0;
    if (F > 0.004) {
      float l = texture2D(uField, vUv - vec2(uTexel.x, 0.0)).r;
      float r = texture2D(uField, vUv + vec2(uTexel.x, 0.0)).r;
      float u = texture2D(uField, vUv - vec2(0.0, uTexel.y)).r;
      float d = texture2D(uField, vUv + vec2(0.0, uTexel.y)).r;
      float gmag = length(vec2(r - l, d - u));
      float rimW = T * (0.40 + 0.35 / max(0.2, uRim));
      float body = sm(T * 0.86, T * 1.16, F);
      float e = (F - T) / rimW;
      float rim = exp(-e * e) * (0.45 + 1.5 * min(1.0, gmag * 7.0));
      rim *= 1.0 + uShimmer * 0.8;                 // TREBLE: rim shimmer
      float o = T - F;
      float halo = 0.0;
      if (o > 0.0) {
        float h1 = (o - T * 0.55) / (T * 0.42);
        float h2 = (o - T * 1.5) / (T * 0.7);
        halo = exp(-h1 * h1) + 0.55 * exp(-h2 * h2);
        halo *= exp(-o * 3.4);
        halo *= 1.0 + uShimmer * 0.6;              // TREBLE: halo flicker
      }
      float nuc = sm(T * 2.1, T * 3.9, F);
      val = body * uFill + rim * uRim * 0.5 + halo * uHalo * 0.42 - nuc * 0.20;
      val = max(val, 0.0);
      val = pow(val, 0.88) * uExposure * (1.0 + uSwell * 0.5);   // BASS: swell brightens
    }
    vec2 pc = (gl_FragCoord.xy - uHalf) / uScale;
    float dist = length(pc);
    float vig = sm(uFov * 1.02, uFov * 0.80, dist);
    vec3 slateBg = vec3(18.0, 27.0, 38.0) / 255.0;
    vec3 slateLt = vec3(205.0, 219.0, 232.0) / 255.0;
    vec3 bg = mix(vec3(0.0), slateBg * (0.28 + 0.72 * vig), uTint);
    vec3 cell = mix(uMono * val * vig, slateLt * val, uTint);
    gl_FragColor = vec4(bg + cell, 1.0);
  }
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

  // --- pass 2: fullscreen shading scene (PlaneGeometry(2,2) fills clip space; vUv from uv)
  const shadeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const shadeUniforms = {
    uField: { value: fieldRT.texture },
    uTexel: { value: new THREE.Vector2(1, 1) }, uHalf: { value: new THREE.Vector2(0.5, 0.5) }, uScale: { value: 1 },
    uT: { value: YEAST.ISO_T }, uFill: { value: 0.34 }, uRim: { value: 1.0 }, uHalo: { value: 0.7 },
    uSwell: { value: 0 }, uShimmer: { value: 0 }, uExposure: { value: 1.0 },
    uTint: { value: 0 }, uMono: { value: new THREE.Color(1, 1, 1) }, uFov: { value: YEAST.FOV },
  };
  const shadeMat = new THREE.ShaderMaterial({
    uniforms: shadeUniforms,
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: SHADE_FRAG, depthTest: false, depthWrite: false,
  });
  const shadeScene = new THREE.Scene();
  shadeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shadeMat));

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(shadeScene, shadeCam));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.5, 0.2);   // strength/radius/threshold
  composer.addPass(bloom);

  function resize(w, h) {
    renderer.setSize(w, h);
    const v = new THREE.Vector2(); renderer.getDrawingBufferSize(v);
    fieldRT.setSize(v.x, v.y);
    shadeUniforms.uField.value = fieldRT.texture;
    shadeUniforms.uTexel.value.set(1 / v.x, 1 / v.y);
    shadeUniforms.uHalf.value.set(v.x * 0.5, v.y * 0.5);
    shadeUniforms.uScale.value = 0.5 * Math.min(v.x, v.y);
    composer.setSize(w, h);
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
    for (const k in o) {
      if (splatUniforms[k]) splatUniforms[k].value = o[k];
      if (shadeUniforms[k]) shadeUniforms[k].value = o[k];
    }
  }
  function setDrift(d) {
    if (d.fusion != null) splatUniforms.uFusion.value = d.fusion;
    if (d.focusPlane != null) splatUniforms.uFocusPlane.value = d.focusPlane;
    if (d.fill != null) shadeUniforms.uFill.value = 0.20 + 0.42 * d.fill;   // hollow<->filled band
    if (d.rim != null) shadeUniforms.uRim.value = 0.55 + 0.95 * d.rim;
    if (d.halo != null) shadeUniforms.uHalo.value = 0.30 + 0.85 * d.halo;
  }
  function setTint(v) { shadeUniforms.uTint.value = v < 0 ? 0 : v > 1 ? 1 : v; }
  function setMono(rgb) { const c = shadeUniforms.uMono.value; c.r = rgb[0] / 255; c.g = rgb[1] / 255; c.b = rgb[2] / 255; }
  function setBloom(s) { bloom.strength = s; }
  function render() {
    renderer.setRenderTarget(fieldRT);
    renderer.setClearColor(0x000000, 1); renderer.clear();
    renderer.render(splatScene, dummyCam);
    renderer.setRenderTarget(null);
    composer.render();
  }
  function dispose() {
    base.dispose(); splatMat.dispose(); shadeMat.dispose(); fieldRT.dispose();
    if (bloom.dispose) bloom.dispose(); if (composer.dispose) composer.dispose();
  }
  return { resize, setInstances, setUniforms, setDrift, setTint, setMono, setBloom, render, dispose };
}

// pack px[],py[] (length n) into a flat xy array of length 2n
function interleaveXY(px, py, out) {
  for (let i = 0; i < px.length; i++) { out[i * 2] = px[i]; out[i * 2 + 1] = py[i]; }
  return out;
}
