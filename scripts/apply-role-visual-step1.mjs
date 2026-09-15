import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/render/GodboxRenderer.ts';
let source = readFileSync(path, 'utf8');

const replaceExactlyOnce = (before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Role visual patch: ${label} target was not found`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Role visual patch: ${label} target was not unique`);
  source = source.replace(before, after);
};

replaceExactlyOnce(
  "import { buildSocialGroups, groupKeyFor, placeInGroup, travelAnimationFor, visualTierFor, type SocialGroup, type VisualTier } from './people/PeoplePresentation';\n",
  "import { buildSocialGroups, groupKeyFor, placeInGroup, travelAnimationFor, visualTierFor, type SocialGroup, type VisualTier } from './people/PeoplePresentation';\nimport { roleVisualColor } from './people/RoleVisualProfile';\n",
  'RoleVisualProfile import',
);

replaceExactlyOnce(
`const PERSON_ROLE_CUES = {
  earth: new THREE.Color('#667a42'), water: new THREE.Color('#3f6e78'), labor: new THREE.Color('#9a6b36'),
  trade: new THREE.Color('#b58137'), guard: new THREE.Color('#4e5866'), ritual: new THREE.Color('#a45d85'),
  civic: new THREE.Color('#5b4d78'), knowledge: new THREE.Color('#58779b'), industry: new THREE.Color('#596369'),
  ordinary: new THREE.Color('#84614f'),
} as const;

`,
  '',
  'legacy role palette',
);

replaceExactlyOnce(
`      this.personColor.set(culture?.style.primary ?? '#d96c86');
      this.personColor.lerp(this.roleCue(person.role), 0.42);
      this.personColor.offsetHSL(0, 0, ((person.appearance?.materialQuality ?? 0.5) - 0.5) * 0.13);
`,
`      this.personColor.copy(roleVisualColor(person.role, culture?.style.primary ?? '#d96c86', {
        materialQuality: person.appearance?.materialQuality ?? 0.5,
      }));
`,
  'torso role colour composition',
);

replaceExactlyOnce(
`      this.personDetailColor.set(culture?.style.secondary ?? '#313550').lerp(this.roleCue(person.role), headwear === 'helmet' ? 0.2 : 0.42);
`,
`      this.personDetailColor.copy(roleVisualColor(person.role, culture?.style.secondary ?? '#313550', {
        roleWeight: headwear === 'helmet' ? 0.48 : 0.58,
        materialQuality: person.appearance?.materialQuality ?? 0.5,
      }));
`,
  'headwear role colour composition',
);

replaceExactlyOnce(
`  private roleCue(role: PersonRole | undefined): THREE.Color {
    if (role === 'farmer' || role === 'gatherer' || role === 'hunter') return PERSON_ROLE_CUES.earth;
    if (role === 'fisher' || role === 'sailor' || role === 'dock-worker') return PERSON_ROLE_CUES.water;
    if (role === 'builder' || role === 'laborer' || role === 'miner') return PERSON_ROLE_CUES.labor;
    if (role === 'trader' || role === 'merchant' || role === 'transporter') return PERSON_ROLE_CUES.trade;
    if (role === 'guard' || role === 'soldier') return PERSON_ROLE_CUES.guard;
    if (role === 'priest' || role === 'ritual-specialist') return PERSON_ROLE_CUES.ritual;
    if (role === 'administrator' || role === 'manager') return PERSON_ROLE_CUES.civic;
    if (role && ['scholar', 'scientist', 'researcher', 'medical-worker', 'healer'].includes(role)) return PERSON_ROLE_CUES.knowledge;
    if (role && ['factory-worker', 'engineer', 'machinist', 'railway-worker', 'energy-technician', 'logistics-worker', 'machine-systems-specialist', 'space-worker'].includes(role)) return PERSON_ROLE_CUES.industry;
    return PERSON_ROLE_CUES.ordinary;
  }

`,
  '',
  'legacy roleCue method',
);

writeFileSync(path, source);
console.log('Applied Step 1 occupational role visual language to GodboxRenderer.ts');
