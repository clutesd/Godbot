import * as THREE from 'three';

/** Two soft sole contacts for the observed person; constant cost, independent of crowd size. */
export function createFocalContactShadow(): THREE.InstancedMesh {
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
    vertexShader: `varying vec2 contactUv;
      void main() { contactUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 contactUv;
      void main() { float r = length((contactUv - 0.5) * 2.0);
        gl_FragColor = vec4(0.018, 0.014, 0.010, (1.0 - smoothstep(0.15, 1.0, r)) * 0.22); }`,
  });
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material, 2);
  mesh.name = 'historian-sole-contacts';
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}
