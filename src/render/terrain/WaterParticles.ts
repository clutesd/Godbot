import * as THREE from 'three';

/** Immutable particle origins/trajectories. Update one clock, not every position buffer each frame. */
export function animateWaterParticles(points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>,
  base: Float32Array, kind: 'rapid' | 'plunge' | 'fall'): void {
  const geometry = points.geometry;
  const data = new THREE.InterleavedBuffer(base, 8);
  geometry.setAttribute('waterParticleOrigin', new THREE.InterleavedBufferAttribute(data, 3, 0));
  geometry.setAttribute('waterParticleDirection', new THREE.InterleavedBufferAttribute(data, 2, 3));
  geometry.setAttribute('waterParticleMotion', new THREE.InterleavedBufferAttribute(data, 3, 5));
  const time = { value: 0 };
  points.material.userData['waterParticleTime'] = time;
  points.material.onBeforeCompile = shader => {
    shader.uniforms['waterParticleTime'] = time;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      uniform float waterParticleTime;
      attribute vec3 waterParticleOrigin;
      attribute vec2 waterParticleDirection;
      attribute vec3 waterParticleMotion;
      ${kind === 'rapid' ? 'attribute float waterParticleRise;' : ''}
      varying float vWaterParticleLife;`);
    const motion = kind === 'rapid' ? `
      transformed.xz += waterParticleDirection*(age-0.5)*extent;
      transformed.y += (age-0.5)*waterParticleRise+sin(age*3.14159265)*0.004;` : kind === 'plunge' ? `
      float angle = phase*6.2831853+age*0.7;
      transformed.xz += (vec2(cos(angle),sin(angle))*0.68+waterParticleDirection*0.42)*extent*age;
      transformed.y += sin(age*3.14159265)*0.012;` : `
      // Direction carries the full lip-to-impact horizontal displacement; gravity accelerates descent.
      transformed.xz += waterParticleDirection*age;
      transformed.y -= extent*age*age;`;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float phase = waterParticleMotion.x;
      float extent = waterParticleMotion.y;
      float age = fract(waterParticleTime*waterParticleMotion.z+phase);
      vWaterParticleLife = smoothstep(0.0,0.12,age)*(1.0-smoothstep(0.72,1.0,age));
      transformed = waterParticleOrigin;
      ${motion}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWaterParticleLife;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vWaterParticleLife;');
  };
  points.material.customProgramCacheKey = () => `godbox-water-particle-${kind}-v1`;
  // The position buffer contains origins, so expand bounds for the entire shader trajectory.
  geometry.computeBoundingSphere();
  let reach = 0;
  for (let i = 0; i < base.length; i += 8) {
    reach = Math.max(reach, kind === 'fall'
      ? Math.hypot(base[i + 3]!, base[i + 4]!, base[i + 6]!) : Math.hypot(base[i + 6]! * 1.2, geometry.getAttribute('waterParticleRise')?.getX(i / 8) ?? 0));
  }
  if (geometry.boundingSphere) geometry.boundingSphere.radius += reach + points.material.size;
  points.frustumCulled = true;
}

export function updateWaterParticles(points: THREE.Points | undefined, time: number): void {
  if (!points) return;
  const clock = (points.material as THREE.Material).userData['waterParticleTime'] as { value: number } | undefined;
  if (clock) clock.value = time;
}
