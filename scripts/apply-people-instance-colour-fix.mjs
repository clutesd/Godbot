import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/render/GodboxRenderer.ts';
let source = readFileSync(path, 'utf8');

const replacements = [
  [
    "new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, vertexColors: true })",
    "new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 })",
  ],
  [
    "new THREE.MeshStandardMaterial({ color: '#8a6a3e', roughness: 0.88, metalness: 0.05, vertexColors: true })",
    "new THREE.MeshStandardMaterial({ color: '#8a6a3e', roughness: 0.88, metalness: 0.05 })",
  ],
  [
    "new THREE.MeshStandardMaterial({ roughness: 0.86, vertexColors: true })",
    "new THREE.MeshStandardMaterial({ roughness: 0.86 })",
  ],
  [
    "new THREE.MeshStandardMaterial({ roughness: 0.95, vertexColors: true })",
    "new THREE.MeshStandardMaterial({ roughness: 0.95 })",
  ],
  [
    "new THREE.MeshStandardMaterial({ roughness: 0.88, vertexColors: true, side: THREE.DoubleSide })",
    "new THREE.MeshStandardMaterial({ roughness: 0.88, side: THREE.DoubleSide })",
  ],
];

for (const [before, after] of replacements) {
  const occurrences = source.split(before).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one occurrence of ${before}, found ${occurrences}`);
  }
  source = source.replace(before, after);
}

writeFileSync(path, source);
console.log('Removed invalid vertexColors flags from people instance-colour materials.');
