import { facilityTierSpec } from '../../sim/processing/FacilityCatalog';
import { AssetBuilder, type AssetConfig } from '../assets/AssetBuilder';
import { productionBuildingShell, productionConstructionTarget } from '../assets/ProductionBuildingShell';
import { developmentPresentationEra } from '../assets/BuildingGrammar';
import { ConstructionAssembly } from '../construction/ConstructionAssembly';
import * as THREE from 'three';
import { facilityVisual, facilityVisualSignature, type FacilityPile, type FacilityVisual, type PileKind } from './FacilityPresentation';
import type { FacilityStatus } from '../../sim/processing/types';
import type { SimulationState } from '../../sim/types';

interface Motion {
  object: THREE.Object3D;
  kind: 'spin' | 'oscillate' | 'slide' | 'bob';
  axis: 'x' | 'y' | 'z';
  rate: number;
  amount: number;
  base: number;
  /** 0 = always; otherwise the motion only plays while the works is doing real work. */
  needsActivity: boolean;
}

interface Plume { group: THREE.Group; intensity: number; puffs: THREE.Mesh[]; height: number; drift: number; seed: number }

interface Entry {
  signature: string;
  buildingConfig: AssetConfig;
  targets: THREE.Group[];
  root: THREE.Group;
  visual: FacilityVisual;
  motions: Motion[];
  plumes: Plume[];
  glows: { material: THREE.MeshStandardMaterial; level: number; flicker: boolean }[];
  lamp?: { material: THREE.MeshStandardMaterial; status: FacilityStatus };
}

const LAMP: Record<FacilityStatus, { colour: string; power: number }> = {
  'under-construction': { colour: '#000000', power: 0 },
  upgrading: { colour: '#5fbf7a', power: 0.9 },
  active: { colour: '#ffb84d', power: 1.7 },
  idle: { colour: '#a58b5a', power: 0.35 },
  starved: { colour: '#6f8fb8', power: 0.6 },
  unpowered: { colour: '#d1452f', power: 0.9 },
  unstaffed: { colour: '#8a8a8a', power: 0.3 },
  blocked: { colour: '#d6b02a', power: 0.7 },
  inaccessible: { colour: '#6c6c86', power: 0.5 },
  damaged: { colour: '#5a1a12', power: 0.4 },
  ruined: { colour: '#000000', power: 0 },
};

const PILE_COLOUR: Record<PileKind, string> = {
  log: '#7a5638', lumber: '#c9a06a', charcoal: '#25282a', ore: '#7d5a48', coal: '#1d1f21', ingot: '#a7b0b5', slag: '#5d5a55', generic: '#9b9484',
};

const hash = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
};

/**
 * Draws processing facilities from simulation state. It reads facility, plot and settlement
 * records and never writes to them: a yard pile is the facility's real stock, smoke is fuel
 * really burned, motion is throughput really achieved, an unlit lantern is power really absent.
 * Layout is always input/storage -> process core -> utilities -> output/loading.
 */
export class IndustryRenderer {
  readonly group = new THREE.Group();
  private readonly entries = new Map<string, Entry>();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly cylinder = new THREE.CylinderGeometry(1, 1, 1, 14);
  private readonly cone = new THREE.CylinderGeometry(0.55, 1, 1, 14);
  private readonly sphere = new THREE.SphereGeometry(1, 12, 8);
  private readonly dome = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  private readonly torus = new THREE.TorusGeometry(1, 0.12, 6, 20);
  private readonly smoke = new THREE.MeshBasicMaterial({ color: '#4a4741', transparent: true, opacity: 0.3, depthWrite: false });
  private readonly steam = new THREE.MeshBasicMaterial({ color: '#e7e9e4', transparent: true, opacity: 0.24, depthWrite: false });

  private readonly assets: AssetBuilder;
  private readonly ownsAssets: boolean;

  constructor(assets?: AssetBuilder) {
    this.assets = assets ?? new AssetBuilder('industry-buildings'); this.ownsAssets = !assets;
    this.group.name = 'Processing facilities';
  }

  private shell(entry: Entry, parent: THREE.Object3D, name: string, width: number, depth: number, archetype = entry.buildingConfig.archetype): void {
    parent.add(productionBuildingShell(this.assets, { ...entry.buildingConfig, archetype, seed: `${entry.visual.id}:${name}` }, width, depth, name));
  }

  private material(colour: string, roughness = 0.9, metalness = 0): THREE.MeshStandardMaterial {
    const key = `${colour}:${roughness}:${metalness}`;
    let material = this.materials.get(key);
    if (!material) { material = new THREE.MeshStandardMaterial({ color: colour, roughness, metalness }); this.materials.set(key, material); }
    return material;
  }

  private add(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number],
    scale: [number, number, number], name: string, rotation: [number, number, number] = [0, 0, 0]): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position); mesh.scale.set(...scale); mesh.rotation.set(...rotation); mesh.name = name;
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  private slab(p: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, colour: string, name: string, rough = 0.9, metal = 0): THREE.Mesh {
    return this.add(p, this.box, this.material(colour, rough, metal), [x, y, z], [w, h, d], name);
  }
  private post(p: THREE.Object3D, x: number, y: number, z: number, radius: number, h: number, colour: string, name: string, metal = 0): THREE.Mesh {
    return this.add(p, this.cylinder, this.material(colour, 0.85, metal), [x, y, z], [radius, h, radius], name);
  }
  private named(parent: THREE.Object3D, name: string, x = 0, y = 0, z = 0): THREE.Group {
    const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); parent.add(g); return g;
  }

  update(state: SimulationState, elapsed: number, height: (x: number, z: number) => number): void {
    const seen = new Set<string>();
    for (const settlement of state.settlements) {
      if (!settlement.alive) continue;
      for (const facility of settlement.processing?.facilities ?? []) {
        const current = facilityVisual(state, settlement, facility);
        if (!current) continue;
        const targetTier = facility.upgrade?.toTier ?? facility.tier;
        const tier = facilityTierSpec(facility.family, targetTier)!;
        const future = facility.upgrade ? facilityVisual(state, settlement, { ...facility,
          tier: targetTier, kind: tier.kind, progress: 1, upgrade: undefined }) : current;
        const visual = { ...future!, stage: current.stage, build: current.build };

        seen.add(visual.id);
        const signature = facilityVisualSignature(visual);
        const existing = this.entries.get(visual.id);
        if (existing?.signature === signature) continue;
        if (existing) this.discard(existing);
        const plot = settlement.structurePlots?.find(p => p.id === facility.plotId);
        const development = plot?.development ? { ...plot.development, form: tier.form, material: tier.material, level: Math.min(3, targetTier) } : undefined;
        const style = development?.style ?? state.cultures.find(c => c.id === Object.entries(settlement.cultureShares).sort((a, b) => b[1] - a[1])[0]?.[0])?.style
          ?? { primary: '#72503b', secondary: '#35405c', accent: '#d8ad4f', symbol: 'sun-step' as const, pattern: 'chevron' as const, nameSyllables: ['ka'] };
        this.entries.set(visual.id, this.build(visual, signature, height, {
          seed: facility.id, culture: style, development,
          era: development ? developmentPresentationEra(development) : visual.tier >= 3 ? 'industrial' : 'village',
          archetype: visual.tier >= 3 ? 'factory' : 'workshop', variant: 'workshop#7',
          settlementIdentity: settlement.architecture, prosperity: settlement.prosperity,
        }));
      }
    }
    for (const [id, entry] of this.entries) if (!seen.has(id)) { this.discard(entry); this.entries.delete(id); }
    this.animate(elapsed);
  }

  private discard(entry: Entry): void {
    this.group.remove(entry.root);
    entry.root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.userData['ownedMaterial']) (object.material as THREE.Material).dispose();
      if (object.userData['constructionCue'] === 'future-building-fabric' || object.name === 'Member being seated') object.geometry.dispose();
    });
    for (const target of entry.targets) target.traverse(node => { if (node instanceof THREE.Mesh) node.geometry.dispose(); });
    for (const glow of entry.glows) glow.material.dispose();
  }

  /** Test/diagnostic access to what is currently drawn. */
  get visuals(): readonly FacilityVisual[] { return [...this.entries.values()].map(entry => entry.visual); }
  get meshCount(): number { let n = 0; this.group.traverse(o => { if (o instanceof THREE.Mesh) n++; }); return n; }

  private animate(elapsed: number): void {
    for (const entry of this.entries.values()) {
      const activity = entry.visual.activity;
      for (const motion of entry.motions) {
        const live = motion.needsActivity ? activity : 1;
        const t = elapsed * motion.rate * (motion.needsActivity ? 0.4 + activity : 1);
        const value = motion.kind === 'spin' ? motion.base + t * live
          : motion.kind === 'oscillate' ? motion.base + Math.sin(t) * motion.amount * live
            : motion.kind === 'slide' ? motion.base + Math.sin(t) * motion.amount * live
              : motion.base + Math.abs(Math.sin(t)) * motion.amount * live;
        if (motion.kind === 'spin' || motion.kind === 'oscillate') motion.object.rotation[motion.axis] = value;
        else motion.object.position[motion.axis] = value;
      }
      for (const plume of entry.plumes) {
        plume.group.visible = plume.intensity > 0.04;
        plume.puffs.forEach((puff, i) => {
          const phase = (elapsed * 0.22 * (0.6 + plume.intensity) + i / plume.puffs.length + plume.seed) % 1;
          puff.position.set(phase * plume.drift, phase * plume.height, phase * plume.drift * 0.3);
          puff.scale.setScalar((0.1 + phase * 0.45) * (0.5 + plume.intensity));
        });
      }
      for (const glow of entry.glows) {
        const flicker = glow.flicker ? 0.85 + Math.sin(elapsed * 9 + glow.level * 7) * 0.15 : 1;
        glow.material.emissiveIntensity = glow.level * 2.2 * flicker;
      }
      if (entry.lamp) {
        const spec = LAMP[entry.lamp.status];
        const pulse = entry.lamp.status === 'unpowered' ? 0.5 + 0.5 * Math.sin(elapsed * 4) : 1;
        entry.lamp.material.emissiveIntensity = spec.power * pulse;
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Construction of one facility
  // -------------------------------------------------------------------------------------------

  private build(v: FacilityVisual, signature: string, height: (x: number, z: number) => number, buildingConfig: AssetConfig): Entry {
    const root = new THREE.Group();
    root.name = `Facility ${v.kind}:${v.id}`;
    root.position.set(v.position.x, height(v.position.x, v.position.z), v.position.z);
    root.rotation.y = v.yaw;
    this.group.add(root);
    const entry: Entry = { signature, buildingConfig, targets: [], root, visual: v, motions: [], plumes: [], glows: [] };
    const hw = v.width / 2, hd = v.depth / 2;

    this.pads(root, v, hw, hd);
    {
      this.yards(entry, hw, hd);
      if (v.stage !== 'ruined') {
        if (v.family === 'wood') this.woodCore(entry, hw, hd);
        else if (v.family === 'metallurgy') this.metalCore(entry, hw, hd);
        else this.genericCore(entry, hw, hd);
        this.utilities(entry, hw, hd);
        this.loading(entry, hw, hd);
      }
      if (v.stage === 'construction' || v.stage === 'upgrading') {
        const target = new THREE.Group();
        for (const child of [...root.children]) target.add(child);
        const future = productionConstructionTarget(target);
        entry.targets.push(future);
        const assembly = new ConstructionAssembly(future, 1, v.id, buildingConfig.development?.material ?? 'timber');
        assembly.update(v.build);
        root.add(assembly.group);
        if (v.stage === 'construction') this.worksite(entry, hw, hd);
        else this.scaffold(entry, hw, hd, 0.8 + v.build * 0.9, 'Conversion scaffold');
      }
      if (v.stage === 'ruined') this.rubble(entry, hw, hd);
      if (v.damage > 0.25 && v.stage !== 'ruined') this.damage(entry, hw, hd);
      if (v.monthsSinceUpgrade !== undefined && v.monthsSinceUpgrade < 24 && v.stage === 'operating') this.freshWork(entry, hw, hd);
      this.lantern(entry, hw, hd);
    }
    return entry;
  }

  /** Packed ground under the yards; extends below grade so slopes never leave anything floating. */
  private pads(root: THREE.Group, v: FacilityVisual, hw: number, hd: number): void {
    const colour = v.family === 'metallurgy' ? '#4c4640' : '#6d5b45';
    const span = Math.max(v.radius * 1.55, hw * 2 + 3.2);
    this.slab(root, 0, -0.14, 0, span, 0.3, Math.max(hd * 2 + 2.2, v.radius * 1.25), colour, 'Facility ground pad', 1);
  }

  private pile(parent: THREE.Object3D, pile: FacilityPile, x: number, z: number, width: number, depth: number, seed: number): void {
    const g = this.named(parent, `${pile.kind} pile ${pile.material}`, x, 0, z);
    const fill = pile.fill;
    if (pile.kind === 'log') {
      const count = Math.max(2, Math.round(fill * 14));
      for (let i = 0; i < count; i++) {
        const row = Math.floor((Math.sqrt(8 * i + 1) - 1) / 2);
        const col = i - row * (row + 1) / 2;
        const log = this.add(g, this.cylinder, this.material(i % 3 ? '#7a5638' : '#8a6544', 0.95), [(col - row / 2) * 0.2, 0.09 + row * 0.16, (hash(`${seed}${i}`) - 0.5) * 0.06], [0.09, depth * 0.85, 0.09], 'Stored log', [Math.PI / 2, 0, 0]);
        log.castShadow = true;
      }
    } else if (pile.kind === 'lumber') {
      const layers = Math.max(1, Math.round(fill * 8));
      for (let i = 0; i < layers; i++) {
        this.slab(g, 0, 0.05 + i * 0.095, 0, width * 0.7, 0.06, depth * 0.85, i % 2 ? '#d1aa73' : '#bf9760', 'Lumber layer');
        this.slab(g, 0, 0.1 + i * 0.095, 0, width * 0.7, 0.03, 0.05, '#7a5a3a', 'Lumber sticker');
      }
    } else if (pile.kind === 'ingot') {
      const rows = Math.max(1, Math.round(fill * 5));
      for (let i = 0; i < rows; i++) for (let k = 0; k < 3; k++) {
        this.slab(g, (k - 1) * 0.22, 0.05 + i * 0.09, 0, 0.19, 0.07, depth * 0.5, i % 2 ? '#9aa4a9' : '#b3bcc0', 'Stored ingot', 0.4, 0.7);
      }
    } else {
      const radius = 0.22 + fill * 0.32;
      const mound = this.add(g, this.dome, this.material(PILE_COLOUR[pile.kind], 1), [0, 0, 0], [radius * width * 0.6, radius * 1.1, radius * depth * 0.5], `${pile.kind} heap`);
      mound.castShadow = true;
      if (pile.kind === 'ore') this.add(g, this.dome, this.material('#a9764f', 0.8, 0.2), [0.08, 0.03, 0.04], [radius * 0.5, radius * 0.6, radius * 0.4], 'Ore seam fines');
    }
  }

  private yards(entry: Entry, hw: number, hd: number): void {
    const v = entry.visual;
    const yardX = hw + 0.95;
    const zSpan = Math.min(hd * 1.5, 1.7);
    v.inputs.forEach((pile, i) => this.pile(entry.root, pile, -yardX + (i % 2) * 0.15, (i - (v.inputs.length - 1) / 2) * zSpan * 0.62, 0.9, 0.8, i));
    v.outputs.forEach((pile, i) => this.pile(entry.root, pile, yardX - (i % 2) * 0.15, (i - (v.outputs.length - 1) / 2) * zSpan * 0.62, 0.9, 0.8, i + 7));
    if (v.stage === 'operating' && v.status === 'blocked') this.slab(entry.root, yardX, 0.5, hd + 0.2, 0.05, 0.6, 0.05, '#c0392b', 'Output yard full marker');
    if (v.stage === 'operating' && v.status === 'starved') this.slab(entry.root, -yardX, 0.26, hd + 0.2, 0.32, 0.03, 0.22, '#6b7f96', 'Empty yard tarp');
  }

  // --- wood ----------------------------------------------------------------------------------

  private woodCore(entry: Entry, hw: number, hd: number): void {
    const v = entry.visual, root = entry.root, active = v.activity > 0.05;
    const front = hd + 1.05;
    if (v.tier === 1) {
      this.slab(root, 0, 0.035, front, 2.1, 0.02, 0.62, '#241d16', 'Saw pit trench');
      for (const x of [-0.8, 0.8]) for (const s of [-1, 1]) {
        this.add(root, this.box, this.material('#6b4a2f'), [x, 0.27, front + s * 0.16], [0.06, 0.6, 0.06], 'Pit trestle', [s * 0.32, 0, 0]);
      }
      if (v.inputs.some(p => p.kind === 'log') || active) this.add(root, this.cylinder, this.material('#86603f', 0.95), [0, 0.6, front], [0.13, 2.0, 0.13], 'Log on trestles', [0, 0, Math.PI / 2]);
      const saw = this.named(root, 'Pit saw', 0, 0.6, front);
      this.slab(saw, 0, 0, 0, 0.03, 0.62, 0.01, '#9aa2a6', 'Pit saw blade', 0.4, 0.8);
      this.slab(saw, 0, 0.34, 0, 0.03, 0.05, 0.3, '#5a3f28', 'Pit saw handle');
      entry.motions.push({ object: saw, kind: 'bob', axis: 'y', rate: 5, amount: 0.16, base: 0.6, needsActivity: true });
      const clamp = this.add(root, this.dome, this.material('#3a3028', 1), [hw + 0.9, 0, -hd - 0.8], [0.6, 0.42, 0.6], 'Charcoal clamp');
      clamp.castShadow = true;
      this.plume(entry, hw + 0.9, 0.4, -hd - 0.8, v.smoke, 1.6, 0.4, 'smoke');
    } else if (v.tier === 2) {
      for (const x of [-0.42, 0.42]) this.slab(root, x, 0.06, front + 0.2, 0.09, 0.09, 2.6, '#5b5147', 'Carriage rail', 0.6, 0.4);
      const carriage = this.named(root, 'Log carriage', 0, 0.16, front + 0.2);
      this.slab(carriage, 0, 0, 0, 1.0, 0.1, 0.7, '#4d4a45', 'Carriage bed', 0.5, 0.5);
      if (v.inputs.some(p => p.kind === 'log') || active) this.add(carriage, this.cylinder, this.material('#86603f', 0.95), [0, 0.2, 0], [0.16, 1.2, 0.16], 'Log on carriage', [Math.PI / 2, 0, 0]);
      entry.motions.push({ object: carriage, kind: 'slide', axis: 'z', rate: 1.6, amount: 0.9, base: front + 0.2, needsActivity: true });
      const gate = this.named(root, 'Saw gate', 0, 0, front + 0.2);
      for (const x of [-0.28, 0.28]) this.slab(gate, x, 0.6, 0, 0.06, 1.2, 0.06, '#5a3f28', 'Saw gate post');
      this.slab(gate, 0, 1.2, 0, 0.62, 0.07, 0.07, '#5a3f28', 'Saw gate head');
      const blade = this.slab(gate, 0, 0.62, 0, 0.02, 0.85, 0.24, '#aab2b6', 'Frame saw blade', 0.35, 0.85);
      entry.motions.push({ object: blade, kind: 'bob', axis: 'y', rate: 9, amount: 0.22, base: 0.55, needsActivity: true });
      this.slab(root, -hw - 0.35, 0.3, front + 0.6, 0.9, 0.05, 0.5, '#6b4a2f', 'Log deck', 0.95).rotation.z = 0.24;
      this.add(root, this.dome, this.material('#cbb188', 1), [hw + 0.7, 0, -hd - 0.35], [0.5, 0.3, 0.45], 'Sawdust heap');
    } else {
      const belt = this.named(root, 'Log conveyor', -0.2, 0.28, front + 0.4);
      this.slab(belt, 0, 0, 0, 0.36, 0.06, 2.8, '#2d3033', 'Conveyor bed', 0.5, 0.4);
      for (let i = 0; i < 5; i++) {
        const cargo = this.add(belt, this.cylinder, this.material('#86603f', 0.95), [0, 0.11, -1.1 + i * 0.55], [0.1, 0.3, 0.1], 'Conveyed log', [0, 0, Math.PI / 2]);
        entry.motions.push({ object: cargo, kind: 'slide', axis: 'z', rate: 1.1, amount: 0.25, base: -1.1 + i * 0.55, needsActivity: true });
      }
      const crane = this.named(root, 'Log gantry', -hw - 0.95, 0, front - 0.2);
      for (const z of [-0.6, 0.6]) this.post(crane, 0, 0.75, z, 0.05, 1.5, '#7c8a92', 'Gantry leg', 0.5);
      this.slab(crane, 0, 1.5, 0, 0.1, 0.1, 1.5, '#7c8a92', 'Gantry beam', 0.5, 0.5);
      const hook = this.slab(crane, 0, 1.2, 0, 0.05, 0.5, 0.05, '#3a3f42', 'Crane hook', 0.5, 0.6);
      entry.motions.push({ object: hook, kind: 'slide', axis: 'z', rate: 0.8, amount: 0.5, base: 0, needsActivity: true });
      for (const x of [-0.3, 0.3]) {
        this.slab(root, x + hw * 0.3, 1.0, -hd - 0.5, 0.42, 1.8, 0.42, '#9b9a90', 'Drying kiln tower', 0.9);
        this.plume(entry, x + hw * 0.3, 1.95, -hd - 0.5, v.steam, 1.4, 0.3, 'steam');
      }
      const shed = this.named(root, 'Lumber shed', hw + 1.0, 0, 0);
      this.shell(entry, shed, 'Lumber storage shell', 1.3, 1.5, 'warehouse');
    }
  }

  // --- metallurgy ----------------------------------------------------------------------------

  private furnaceGlow(entry: Entry, parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number): void {
    const v = entry.visual;
    const material = new THREE.MeshStandardMaterial({ color: '#2a1408', emissive: new THREE.Color('#ff7a2b'), emissiveIntensity: 0 });
    const mesh = this.add(parent, this.box, material, [x, y, z], [w, h, 0.04], 'Furnace glow');
    mesh.userData['ownedMaterial'] = true;
    entry.glows.push({ material, level: Math.min(1, v.heat), flicker: true });
  }

  private metalCore(entry: Entry, hw: number, hd: number): void {
    const v = entry.visual, root = entry.root, active = v.activity > 0.05;
    const front = hd + 0.95;
    if (v.tier === 1) {
      const furnace = this.named(root, 'Bloomery furnace', 0.0, 0, front);
      this.add(furnace, this.cone, this.material('#a87c59', 1), [0, 0.55, 0], [0.42, 1.1, 0.42], 'Clay stack furnace');
      this.furnaceGlow(entry, furnace, 0, 0.32, 0.36, 0.2, 0.18);
      const throat = new THREE.MeshStandardMaterial({ color: '#241005', emissive: new THREE.Color('#ff5b14'), emissiveIntensity: 0 });
      const throatMesh = this.add(furnace, this.cylinder, throat, [0, 1.11, 0], [0.16, 0.03, 0.16], 'Furnace throat');
      throatMesh.userData['ownedMaterial'] = true;
      entry.glows.push({ material: throat, level: v.heat, flicker: true });
      this.plume(entry, 0, 1.2, front, v.smoke, 2.4, 0.5, 'smoke');
      const bellows = this.named(root, 'Bellows', -0.62, 0.22, front + 0.1);
      this.slab(bellows, 0, 0, 0, 0.5, 0.16, 0.34, '#7a5638', 'Bellows body');
      const lever = this.slab(bellows, 0.32, 0.18, 0, 0.5, 0.04, 0.05, '#4a3524', 'Bellows lever');
      entry.motions.push({ object: lever, kind: 'oscillate', axis: 'z', rate: 3.2, amount: 0.3, base: 0, needsActivity: true });
      this.slab(root, 0.75, 0.16, front + 0.15, 0.32, 0.18, 0.2, '#454b50', 'Anvil block', 0.45, 0.7);
      this.slab(root, 0.75, 0.29, front + 0.15, 0.24, 0.07, 0.12, '#565d62', 'Anvil face', 0.4, 0.75);
    } else if (v.tier === 2) {
      const stack = this.named(root, 'Furnace and stack', hw * 0.35, 0, -hd - 0.6);
      this.slab(stack, 0, 0.6, 0, 0.95, 1.2, 0.85, '#8c5b4a', 'Brick furnace body', 0.95);
      this.add(stack, this.cone, this.material('#8c5b4a', 0.95), [0, 1.9, 0], [0.34, 1.4, 0.34], 'Chimney stack');
      this.plume(entry, hw * 0.35, 2.7, -hd - 0.6, v.smoke, 2.8, 0.6, 'smoke');
      const tap = this.named(root, 'Tapping arch', 0, 0, front);
      this.slab(tap, 0, 0.35, 0, 0.9, 0.7, 0.5, '#7a4d3f', 'Furnace front', 0.95);
      this.furnaceGlow(entry, tap, 0, 0.26, 0.27, 0.32, 0.26);
      this.slab(root, 0.0, 0.03, front + 0.85, 1.3, 0.05, 0.7, '#8a7a5e', 'Casting bed sand', 1);
      for (let i = 0; i < 4; i++) this.slab(root, -0.45 + i * 0.3, 0.06, front + 0.85, 0.2, 0.03, 0.5, '#241d16', 'Casting mould');
      const hammer = this.named(root, 'Trip hammer', -hw * 0.6, 0, front + 0.75);
      this.post(hammer, 0, 0.45, 0, 0.05, 0.9, '#5a3f28', 'Hammer frame');
      const arm = this.named(hammer, 'Hammer helve', 0, 0.85, 0);
      this.slab(arm, 0.35, 0, 0, 0.8, 0.06, 0.08, '#6b4a2f', 'Hammer arm');
      this.slab(arm, 0.72, -0.08, 0, 0.16, 0.14, 0.14, '#3a3f42', 'Hammer head', 0.4, 0.8);
      entry.motions.push({ object: arm, kind: 'oscillate', axis: 'z', rate: 4.5, amount: 0.25, base: -0.05, needsActivity: true });
      this.slab(root, -hw * 0.6, 0.12, front + 0.75, 0.42, 0.24, 0.3, '#3d4246', 'Anvil block', 0.45, 0.7);
    } else {
      const bf = this.named(root, 'Blast furnace', -hw * 0.3, 0, -hd - 0.85);
      this.post(bf, 0, 1.4, 0, 0.5, 2.8, '#4d5459', 'Blast furnace shaft', 0.6);
      for (const y of [0.6, 1.4, 2.2]) this.add(bf, this.torus, this.material('#2f3437', 0.5, 0.7), [0, y, 0], [0.55, 0.55, 0.55], 'Furnace band', [Math.PI / 2, 0, 0]);
      this.plume(entry, -hw * 0.3, 2.9, -hd - 0.85, v.smoke, 3.2, 0.7, 'smoke');
      for (const dx of [0.95, 1.55]) this.post(root, -hw * 0.3 + dx, 1.0, -hd - 0.85, 0.3, 2.0, '#7f6a5a', 'Hot blast stove', 0.3);
      const converter = this.named(root, 'Converter', hw * 0.5, 0.5, -hd - 0.7);
      this.post(converter, 0, 0.4, 0, 0.32, 0.8, '#5a5e60', 'Converter vessel', 0.6);
      const mouth = new THREE.MeshStandardMaterial({ color: '#2a1408', emissive: new THREE.Color('#ff8a2b'), emissiveIntensity: 0 });
      const mouthMesh = this.add(converter, this.cylinder, mouth, [0, 0.82, 0], [0.22, 0.03, 0.22], 'Converter mouth');
      mouthMesh.userData['ownedMaterial'] = true;
      entry.glows.push({ material: mouth, level: v.heat, flicker: true });
      entry.motions.push({ object: converter, kind: 'oscillate', axis: 'z', rate: 0.7, amount: 0.5, base: 0, needsActivity: true });
      const mill = this.named(root, 'Rolling mill', 0, 0, front + 0.2);
      this.shell(entry, mill, 'Rolling shed', 2.6, 0.9);
      for (let i = 0; i < 4; i++) {
        const roller = this.add(mill, this.cylinder, this.material('#c2c8cc', 0.3, 0.9), [-0.9 + i * 0.6, 0.68, 0], [0.09, 0.8, 0.09], 'Mill roller', [Math.PI / 2, 0, 0]);
        entry.motions.push({ object: roller, kind: 'spin', axis: 'x', rate: 6, amount: 0, base: 0, needsActivity: true });
      }
      const crane = this.named(root, 'Overhead crane', 0, 0, front + 0.2);
      for (const x of [-1.3, 1.3]) this.post(crane, x, 0.85, 0.55, 0.045, 1.7, '#d3a127', 'Crane leg', 0.4);
      this.slab(crane, 0, 1.7, 0.55, 2.7, 0.08, 0.1, '#d3a127', 'Crane bridge', 0.4, 0.5);
      const trolley = this.slab(crane, 0, 1.6, 0.55, 0.22, 0.16, 0.16, '#3a3f42', 'Crane trolley', 0.4, 0.6);
      entry.motions.push({ object: trolley, kind: 'slide', axis: 'x', rate: 0.6, amount: 0.95, base: 0, needsActivity: true });
      this.post(root, hw * 0.9, 0.7, -hd - 1.3, 0.42, 1.4, '#a09f97', 'Cooling tower', 0.1);
      this.plume(entry, hw * 0.9, 1.4, -hd - 1.3, v.steam, 2.6, 0.5, 'steam');
    }
    void active;
  }

  private genericCore(entry: Entry, hw: number, hd: number): void {
    // Reserved families draw a plain works until their own geometry exists; state cues still apply.
    this.slab(entry.root, 0, 0.3, hd + 0.8, hw * 1.2, 0.6, 0.6, '#77716a', 'Process equipment', 0.6, 0.3);
  }

  // --- shared elements ------------------------------------------------------------------------

  private plume(entry: Entry, x: number, y: number, z: number, intensity: number, height: number, drift: number, kind: 'smoke' | 'steam'): void {
    const group = this.named(entry.root, `${kind} plume`, x, y, z);
    const puffs: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) puffs.push(this.add(group, this.sphere, kind === 'smoke' ? this.smoke : this.steam, [0, 0, 0], [0.1, 0.1, 0.1], `${kind} puff`));
    entry.plumes.push({ group, intensity, puffs, height, drift, seed: hash(`${entry.visual.id}${x}${z}`) });
  }

  /** Motive power: shaft and flywheel when mechanical, transformer and pole when electric. */
  private utilities(entry: Entry, hw: number, hd: number): void {
    const v = entry.visual, root = entry.root;
    if (v.carrier === 'mechanical') {
      const shaft = this.named(root, 'Line shaft', 0, 0.75, -hd - 0.12);
      this.add(shaft, this.cylinder, this.material('#3f4549', 0.4, 0.8), [0, 0, 0], [0.05, hw * 2 + 0.4, 0.05], 'Line shaft', [0, 0, Math.PI / 2]);
      const wheel = this.add(root, this.torus, this.material('#3a3f42', 0.4, 0.8), [hw + 0.25, 0.75, -hd - 0.12], [0.34, 0.34, 0.34], 'Drive flywheel', [0, Math.PI / 2, 0]);
      entry.motions.push({ object: wheel, kind: 'spin', axis: 'x', rate: 3, amount: 0, base: 0, needsActivity: true });
    } else if (v.carrier === 'electric') {
      const yard = this.named(root, 'Power yard', -hw - 0.5, 0, -hd - 0.5);
      this.slab(yard, 0, 0.32, 0, 0.5, 0.64, 0.4, '#5f6f66', 'Transformer', 0.5, 0.5);
      this.post(yard, 0.55, 0.9, 0, 0.03, 1.8, '#4b3a2a', 'Service pole');
      this.slab(yard, 0.55, 1.75, 0, 0.5, 0.04, 0.04, '#4b3a2a', 'Pole crossarm');
      const lit = new THREE.MeshStandardMaterial({ color: '#332a1c', emissive: new THREE.Color('#ffd27a'), emissiveIntensity: v.energised ? 1.6 : 0 });
      const lamp = this.add(yard, this.sphere, lit, [0.55, 1.62, 0.1], [0.06, 0.06, 0.06], 'Works lamp');
      lamp.userData['ownedMaterial'] = true;
      // Windows are lit only while electricity is actually delivered.
      const window = new THREE.MeshStandardMaterial({ color: '#2a2f33', emissive: new THREE.Color('#ffd27a'), emissiveIntensity: v.energised ? 1.2 : 0 });
      const windows = this.add(root, this.box, window, [0, 0.55, hd + 0.03], [Math.min(1.2, hw * 1.2), 0.16, 0.03], 'Works windows');
      windows.userData['ownedMaterial'] = true;
    }
  }

  private loading(entry: Entry, hw: number, hd: number): void {
    const v = entry.visual, root = entry.root;
    const bay = this.named(root, 'Loading bay', hw + 0.9, 0, hd + 0.9);
    this.slab(bay, 0, 0.08, 0, 0.9, 0.16, 0.5, '#7b6f5b', 'Loading dock', 0.95);
    const moving = v.hauling.inbound || v.hauling.outbound;
    const vehicle = v.hauling.vehicle;
    if (vehicle === 'cart' || vehicle === 'caravan' || vehicle === 'pack-animal') {
      const cart = this.named(bay, 'Freight cart', 0, 0.25, 0.42);
      this.slab(cart, 0, 0.08, 0, 0.6, 0.12, 0.34, '#7a5638', 'Cart bed');
      for (const s of [-1, 1]) this.add(cart, this.torus, this.material('#4a3524'), [0, 0.02, s * 0.2], [0.11, 0.11, 0.11], 'Cart wheel');
      if (moving) this.slab(cart, 0, 0.2, 0, 0.45, 0.14, 0.26, PILE_COLOUR[v.outputs[0]?.kind ?? 'generic'], 'Cart load');
      if (vehicle === 'pack-animal') this.slab(bay, -0.65, 0.3, 0.42, 0.42, 0.26, 0.16, '#8a6f52', 'Pack animal');
    } else if (vehicle === 'truck') {
      const truck = this.named(bay, 'Freight truck', 0, 0.2, 0.5);
      this.slab(truck, 0, 0.12, 0, 0.95, 0.2, 0.4, '#5d6a52', 'Truck bed', 0.6, 0.3);
      this.slab(truck, 0.55, 0.22, 0, 0.3, 0.3, 0.4, '#6f7d62', 'Truck cab', 0.6, 0.3);
      if (moving) this.slab(truck, -0.08, 0.3, 0, 0.6, 0.16, 0.34, PILE_COLOUR[v.outputs[0]?.kind ?? 'generic'], 'Truck load');
    } else if (vehicle === 'train') {
      for (const z of [0.3, 0.55]) this.slab(bay, 0, 0.02, z, 1.6, 0.03, 0.05, '#4a4a4a', 'Spur rail', 0.4, 0.7);
      this.slab(bay, 0, 0.16, 0.42, 1.1, 0.2, 0.34, '#5a4a4a', 'Rail wagon', 0.6, 0.4);
      if (moving) this.slab(bay, 0, 0.32, 0.42, 0.9, 0.12, 0.26, PILE_COLOUR[v.outputs[0]?.kind ?? 'generic'], 'Wagon load');
    } else if (moving) {
      // Porters carrying baskets by hand.
      this.slab(bay, 0, 0.32, 0.35, 0.16, 0.16, 0.16, '#b39b62', 'Carried basket');
    }
  }

  private lantern(entry: Entry, hw: number, hd: number): void {
    const v = entry.visual;
    const spec = LAMP[v.status];
    if (spec.power <= 0) return;
    this.post(entry.root, -hw - 0.2, 0.55, hd + 0.5, 0.02, 1.1, '#3a2f25', 'Status pole');
    const material = new THREE.MeshStandardMaterial({ color: '#221f1a', emissive: new THREE.Color(spec.colour), emissiveIntensity: spec.power });
    const lamp = this.add(entry.root, this.sphere, material, [-hw - 0.2, 1.14, hd + 0.5], [0.07, 0.07, 0.07], `Status lantern ${v.status}`);
    lamp.userData['ownedMaterial'] = true;
    entry.lamp = { material, status: v.status };
  }

  // --- states ------------------------------------------------------------------------------

  private scaffold(entry: Entry, hw: number, hd: number, height: number, name: string): void {
    const group = this.named(entry.root, name);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.post(group, sx * (hw + 0.15), height / 2, sz * (hd + 0.15), 0.03, height, '#8a6a44', 'Scaffold pole');
    for (let level = 1; level <= Math.floor(height / 0.45); level++) {
      const y = level * 0.45;
      this.slab(group, 0, y, hd + 0.15, hw * 2 + 0.3, 0.035, 0.035, '#a07a4d', 'Scaffold ledger');
      this.slab(group, 0, y, -hd - 0.15, hw * 2 + 0.3, 0.035, 0.035, '#a07a4d', 'Scaffold ledger');
      this.slab(group, hw + 0.15, y, 0, 0.035, 0.035, hd * 2 + 0.3, '#a07a4d', 'Scaffold ledger');
      this.slab(group, -hw - 0.15, y, 0, 0.035, 0.035, hd * 2 + 0.3, '#a07a4d', 'Scaffold ledger');
    }
  }

  private worksite(entry: Entry, hw: number, hd: number): void {
    const v = entry.visual;
    const height = 0.3 + v.build * (v.family === 'metallurgy' ? 1.1 : 0.85);
    this.scaffold(entry, hw, hd, Math.max(0.5, height + 0.4), 'Construction scaffold');
    this.pile(entry.root, { material: 'timber', kind: v.family === 'metallurgy' ? 'ore' : 'log', fill: 0.4 }, -hw - 0.95, 0, 0.9, 0.8, 3);
    this.pile(entry.root, { material: 'stone', kind: 'generic', fill: 0.3 }, hw + 0.95, 0.2, 0.9, 0.8, 4);
    if (v.status === 'under-construction') {
      // Tools and materials left at the site; the people who work it are real represented residents.
      this.slab(entry.root, hw + 0.45, 0.07, hd + 0.5, 0.5, 0.14, 0.34, '#6b5a42', 'Site tool chest', 0.9);
      this.add(entry.root, this.cylinder, this.material('#8a7a5e', 1), [hw + 0.95, 0.12, hd + 0.5], [0.16, 0.24, 0.16], 'Mortar tub');
    }
  }

  private freshWork(entry: Entry, hw: number, hd: number): void {
    this.slab(entry.root, hw + 0.25, 1.05, hd + 0.3, 0.05, 0.9, 0.05, '#d8c49a', 'Fresh timber pennant post');
    this.slab(entry.root, hw + 0.42, 1.36, hd + 0.3, 0.32, 0.18, 0.02, '#d9a441', 'Commissioning pennant');
  }

  private damage(entry: Entry, hw: number, hd: number): void {
    const v = entry.visual;
    const severity = v.damage;
    this.slab(entry.root, 0, 0.045, 0, hw * 2.2, 0.01, hd * 2.2, '#171412', 'Scorched ground', 1).scale.y = 0.01 + severity * 0.02;
    for (let i = 0; i < Math.ceil(severity * 5); i++) {
      const angle = hash(`${v.id}${i}`) * 6.28;
      this.add(entry.root, this.box, this.material('#5b4632'), [Math.cos(angle) * (hw + 0.4), 0.22, Math.sin(angle) * (hd + 0.4)], [0.05, 0.5, 0.05], 'Broken beam', [severity, angle, severity * 0.9]);
    }
    if (severity > 0.55) this.slab(entry.root, hw * 0.5, 0.9, hd * 0.4, 0.9, 0.06, 0.9, '#3b3129', 'Fallen roof section').rotation.z = 0.5;
  }

  private rubble(entry: Entry, hw: number, hd: number): void {
    for (let i = 0; i < 7; i++) {
      const angle = hash(`${entry.visual.id}r${i}`) * 6.28;
      const r = 0.2 + hash(`${entry.visual.id}q${i}`) * hw;
      this.add(entry.root, this.box, this.material(i % 2 ? '#5d5750' : '#3a332c', 1), [Math.cos(angle) * r, 0.08, Math.sin(angle) * r * (hd / hw)], [0.3, 0.16, 0.3], 'Works ruin debris', [0.2, angle, 0.15]);
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.discard(entry);
    this.entries.clear();
    for (const material of this.materials.values()) material.dispose();
    for (const geometry of [this.box, this.cylinder, this.cone, this.sphere, this.dome, this.torus]) geometry.dispose();
    this.smoke.dispose(); this.steam.dispose();
    if (this.ownsAssets) this.assets.dispose();
  }
}
