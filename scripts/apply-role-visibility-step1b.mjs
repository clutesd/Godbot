import fs from 'node:fs';

const path = 'src/render/GodboxRenderer.ts';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing renderer anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Ambiguous renderer anchor: ${label}`);
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
  "import { roleVisualColor } from './people/RoleVisualProfile';",
  "import { roleVisualColor } from './people/RoleVisualProfile';\nimport { createRoleGarmentMaterial, updateRoleGarmentMaterial } from './people/RoleGarmentPresentation';",
  'role garment import',
);

replaceOnce(
  "  private readonly peopleMantles: THREE.InstancedMesh;\n  private readonly peopleVisuals = new PeopleVisualStateStore();",
  "  private readonly peopleMantles: THREE.InstancedMesh;\n  /** Unlit-but-daylight-gated upper-torso cloth that keeps role colour readable at tiny scale. */\n  private readonly peopleRoleGarments: THREE.InstancedMesh;\n  private readonly roleGarmentMaterial: THREE.MeshBasicMaterial;\n  private readonly peopleVisuals = new PeopleVisualStateStore();",
  'role garment fields',
);

replaceOnce(
  "    this.people = new THREE.InstancedMesh(peopleGeometry, peopleMaterial, visiblePersonBudget);\n    this.people.castShadow = true;\n    this.people.frustumCulled = false;\n    this.peopleHeads = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.12, 1), peopleMaterial, visiblePersonBudget);",
  "    this.people = new THREE.InstancedMesh(peopleGeometry, peopleMaterial, visiblePersonBudget);\n    this.people.castShadow = true;\n    this.people.frustumCulled = false;\n    this.roleGarmentMaterial = createRoleGarmentMaterial();\n    this.peopleRoleGarments = new THREE.InstancedMesh(\n      new THREE.CylinderGeometry(0.132, 0.15, 0.29, 6),\n      this.roleGarmentMaterial,\n      visiblePersonBudget,\n    );\n    this.peopleRoleGarments.frustumCulled = false;\n    this.peopleHeads = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.12, 1), peopleMaterial, visiblePersonBudget);",
  'role garment construction',
);

replaceOnce(
  "    this.scene.add(this.people, this.peopleHeads, this.peopleArms, this.peopleLegs, this.peopleTools, this.peopleHeadwear, this.peopleCargo, this.peopleMantles);",
  "    this.scene.add(this.people, this.peopleRoleGarments, this.peopleHeads, this.peopleArms, this.peopleLegs, this.peopleTools, this.peopleHeadwear, this.peopleCargo, this.peopleMantles);",
  'role garment scene registration',
);

replaceOnce(
  "    this.people.count = count;\n    this.peopleHeads.count = count;",
  "    this.people.count = count;\n    this.peopleRoleGarments.count = count;\n    this.peopleHeads.count = count;",
  'role garment instance count',
);

replaceOnce(
  "      this.people.setColorAt(index, this.personColor);\n      this.setInstanceTransform(this.peopleHeads, index, display.x, footY + 0.84 * heightScale + poseLift, display.z, heightScale, heightScale, heightScale, 0, facing + (pose?.headRotation ?? 0), 0);",
  "      this.people.setColorAt(index, this.personColor);\n      // A narrow upper-torso cloth shell carries the occupational family through shade and at\n      // documentary distance. It is geometry, not a billboard/icon, and follows the body pose.\n      this.setInstanceTransform(\n        this.peopleRoleGarments, index, display.x, footY + 0.53 * heightScale + poseLift, display.z,\n        heightScale * buildScale, heightScale, heightScale * buildScale, 0,\n        facing + (pose?.pelvisRotation ?? 0), person.appearance?.posture ?? 0,\n      );\n      this.personDetailColor.copy(roleVisualColor(person.role, culture?.style.primary ?? '#d96c86', {\n        roleWeight: person.role === 'child' || person.role === 'elder' || !person.role ? 0.6 : 0.9,\n        materialQuality: 0.55,\n      }));\n      this.peopleRoleGarments.setColorAt(index, this.personDetailColor);\n      this.setInstanceTransform(this.peopleHeads, index, display.x, footY + 0.84 * heightScale + poseLift, display.z, heightScale, heightScale, heightScale, 0, facing + (pose?.headRotation ?? 0), 0);",
  'role garment per-person presentation',
);

replaceOnce(
  "    this.people.instanceMatrix.needsUpdate = true;\n    this.peopleHeads.instanceMatrix.needsUpdate = true;",
  "    this.people.instanceMatrix.needsUpdate = true;\n    this.peopleRoleGarments.instanceMatrix.needsUpdate = true;\n    this.peopleHeads.instanceMatrix.needsUpdate = true;",
  'role garment matrix upload',
);

replaceOnce(
  "    if (this.people.instanceColor) this.people.instanceColor.needsUpdate = true;\n    if (this.peopleHeads.instanceColor) this.peopleHeads.instanceColor.needsUpdate = true;",
  "    if (this.people.instanceColor) this.people.instanceColor.needsUpdate = true;\n    if (this.peopleRoleGarments.instanceColor) this.peopleRoleGarments.instanceColor.needsUpdate = true;\n    if (this.peopleHeads.instanceColor) this.peopleHeads.instanceColor.needsUpdate = true;",
  'role garment colour upload',
);

replaceOnce(
  "    this.ecology.animate(elapsedSeconds, daylight);",
  "    this.ecology.animate(elapsedSeconds, daylight);\n    updateRoleGarmentMaterial(this.roleGarmentMaterial, daylight);",
  'daylight-gated role garment brightness',
);

fs.writeFileSync(path, source);
console.log('Applied role visibility Step 1b renderer wiring.');
