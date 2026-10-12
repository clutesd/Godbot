import * as THREE from 'three';

/** Camera-facing, softly eroded density cards. Shared by smoke and footfall dust; bounded pools
 * provide depth without transparent polygonal balls or a full-screen fog overlay. */
export function battleAtmosphereMaterial(color: string, opacity: number, perInstanceOpacity = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { tint: { value: new THREE.Color(color) }, opacity: { value: opacity } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `
      ${perInstanceOpacity ? 'attribute float effectOpacity; varying float vEffectOpacity;' : ''}
      varying vec2 vUv;
      varying float vSeed;
      void main() {
        ${perInstanceOpacity ? 'vEffectOpacity = effectOpacity;' : ''}
        vUv = uv;
        vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
        vSeed = dot(instanceMatrix[3].xyz, vec3(12.31, 4.17, 7.83));
        center.xy += position.xy * size;
        gl_Position = projectionMatrix * center;
      }`,
    fragmentShader: `
      ${perInstanceOpacity ? 'varying float vEffectOpacity;' : ''}
      uniform vec3 tint;
      uniform float opacity;
      varying vec2 vUv;
      varying float vSeed;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
                   mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
      }
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float density = noise(p * 3.4 + vSeed) * 0.65 + noise(p * 7.1 + vSeed) * 0.35;
        float edge = 1.0 - smoothstep(0.15, 1.0, length(p) + (density - 0.5) * 0.28);
        float alpha = edge * (0.35 + density * 0.65) * opacity ${perInstanceOpacity ? '* vEffectOpacity' : ''};
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(tint * (0.85 + density * 0.25), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
