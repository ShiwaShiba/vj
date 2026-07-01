// src/scenes/orb/orbCore.js
// Owns all THREE state for the Noise Orb: 140k GPU points on a unit sphere, a
// simplex-FBM + Worley displacement/brightness shader (AdditiveBlending), and a
// RenderPass -> UnrealBloomPass composer. Pure rendering; all time/audio values
// arrive through setUniforms from OrbScene. Deterministic (no random here).
import { buildOrbGeometry, ORB } from './orbDrive.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// --- Ashima simplex 3D + 5-octave FBM + Worley cellular (verbatim from reference vj-blob.html) ---
const GLSL_NOISE = /* glsl */`
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z);
    vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }
  float fbm(vec3 p){
    float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*snoise(p); p*=2.0; a*=0.5; } return s;
  }
  vec3 hash3(vec3 p){
    p=vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6)));
    return fract(sin(p)*43758.5453123);
  }
  float worley(vec3 p){
    vec3 ip=floor(p); vec3 fp=fract(p); float d=1.0;
    for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++){
      vec3 g=vec3(float(x),float(y),float(z));
      vec3 o=hash3(ip+g); vec3 r=g+o-fp; d=min(d,dot(r,r));
    }
    return sqrt(d);
  }
`;

const VERT = GLSL_NOISE + /* glsl */`
  uniform float uTime,uMorphSpeed,uNoiseScale,uDisplace,uCellEdge,uPointSize,uPixelRatio;
  uniform float uBassSwell,uTravelAmt,uTreble,uFastFlow,uSweepK,uSweepFlow,uBurstCos,uBurstEnv;
  uniform vec3 uSweepAxis,uBurstAxis;
  attribute float aSeed;
  varying float vBright;
  void main(){
    vec3 dir=normalize(position);
    float t=uTime*uMorphSpeed;
    vec3 sp=dir*uNoiseScale;
    float f=fbm(sp+vec3(0.0,0.0,t));
    float cell=worley(sp*1.45+vec3(t*0.6));
    float wall=1.0-smoothstep(0.0,0.45,cell);                 // bright at cell walls
    float disp=f*0.55+wall*uCellEdge*0.7;
    float radius=1.0+uDisplace*disp+uBassSwell*0.28;          // BASS: global swell
    radius+=uTreble*0.05*snoise(dir*9.0+vec3(uFastFlow));     // TREBLE: fine radial crackle
    vec4 mv=modelViewMatrix*vec4(dir*radius,1.0);
    gl_Position=projectionMatrix*mv;
    gl_PointSize=uPointSize*(0.7+0.6*aSeed)*uPixelRatio*(4.0/-mv.z); // k=4.0 (guards against giant splats)
    // MID: morphing light-front sweeping the worley walls (wobbling axis, breathing band count)
    float cr=0.5+0.5*sin(dot(dir,uSweepAxis)*uSweepK-uSweepFlow+aSeed*1.1);
    // BASS kick: expanding ring burst in cos-space (no acos/exp on the GPU)
    float q=(dot(dir,uBurstAxis)-uBurstCos)*4.0; q=1.0-q*q;
    cr=max(cr, q>0.0 ? q*q*uBurstEnv : 0.0);
    float depthFade=clamp(0.55+0.45*(radius-0.8),0.3,1.2);
    float base=(0.10+1.5*wall*uCellEdge+0.45*max(disp,0.0))*(0.8+0.6*aSeed);
    vBright=base*depthFade*(1.0+uBassSwell*0.8)
          + wall*uCellEdge*uTravelAmt*cr*cr*cr*depthFade*(0.8+0.6*aSeed);
    if(uTreble>0.001) vBright*=1.0+uTreble*0.7*snoise(dir*7.0-vec3(uFastFlow)); // brightness shimmer
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uColor; uniform float uExposure;
  varying float vBright;
  void main(){
    vec2 uv=gl_PointCoord-0.5; float d=length(uv);
    float a=smoothstep(0.5,0.0,d); a*=a;                       // soft round sprite
    gl_FragColor=vec4(uColor*vBright*uExposure, a);
  }
`;

export function createOrbCore({ THREE, renderer }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  const BASE_Z = 4.4;                    // camera distance at size=1.0
  camera.position.set(0, 0, BASE_Z);

  const { positions, seeds } = buildOrbGeometry(ORB.COUNT);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const uniforms = {
    uTime:      { value: 0 },
    uMorphSpeed:{ value: 0.45 }, uNoiseScale: { value: 1.70 }, uDisplace: { value: 0.42 },
    uCellEdge:  { value: 0.55 }, uPointSize:  { value: 1.70 }, uExposure: { value: 1.15 },
    uColor:     { value: new THREE.Color(1, 1, 1) },
    uPixelRatio:{ value: renderer.getPixelRatio() },
    uBassSwell: { value: 0 }, uTravelAmt: { value: 0 }, uTreble: { value: 0 }, uFastFlow: { value: 0 },
    uSweepAxis: { value: new THREE.Vector3(0, 1, 0) }, uSweepK: { value: ORB.WAVE_K }, uSweepFlow: { value: 0 },
    uBurstAxis: { value: new THREE.Vector3(0, 1, 0) }, uBurstCos: { value: -2 }, uBurstEnv: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: VERT, fragmentShader: FRAG,
  });

  const points = new THREE.Points(geo, material);
  scene.add(points);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.05, 0.6, 0.0);
  composer.addPass(bloom);

  function resize(w, h) {
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h); composer.setSize(w, h);
    uniforms.uPixelRatio.value = renderer.getPixelRatio();
  }
  function setUniforms(o) {
    for (const k in o) {
      const u = uniforms[k]; if (!u) continue;
      const v = o[k];
      if (Array.isArray(v) && u.value && u.value.fromArray) u.value.fromArray(v);
      else u.value = v;
    }
  }
  function setTint(rgb) {               // palette.fg is [0..255]; assign components directly (no colorspace conversion, stays monochrome)
    const c = uniforms.uColor.value;
    c.r = rgb[0] / 255; c.g = rgb[1] / 255; c.b = rgb[2] / 255;
  }
  function setBloom(strength) { bloom.strength = strength; }
  function setDrawFraction(frac) {
    const f = Math.min(1, Math.max(0.05, frac));
    geo.setDrawRange(0, Math.max(1, Math.floor(ORB.COUNT * f)));
  }
  function rotate(rx, ry) { points.rotation.x = rx; points.rotation.y = ry; }
  function setSize(s) { camera.position.z = BASE_Z / Math.max(0.2, s); } // overall on-screen size via camera dolly; apparent radius ∝ s, density/brightness preserved
  function render() { composer.render(); }
  function dispose() {
    geo.dispose(); material.dispose();
    if (bloom.dispose) bloom.dispose();
    if (composer.dispose) composer.dispose();
  }
  return { scene, camera, points, uniforms, resize, setUniforms, setTint, setBloom, setDrawFraction, rotate, setSize, render, dispose };
}
