import * as THREE from 'three';
import type { SimulationState, Vec2 } from '../../sim/types';
import type { TerrainSurface } from '../terrain/TerrainSurface';
import type { ResourceWorkScene } from './ResourceWorkScene';
import { resourceBundleGeometry, resourceLogGeometry } from './ResourceWorkGeometry';
import { resourceProcessingPresentation, resourceStoragePresentation, storedMaterialColour } from './ResourceFlowPresentation';
import { isMinedMaterial, mineralVisualProfile } from './MineralPresentation';

export const MAX_RESOURCE_SETTLEMENTS = 32;
const CAPACITY = MAX_RESOURCE_SETTLEMENTS * (8 * 6 + 3 * 4);

/** Stock and process evidence at existing settlement plots. All geometry is pooled and disposable. */
export class ResourceFlowRenderer {
  readonly group = new THREE.Group();
  private readonly marker = new THREE.Object3D();
  private readonly colour = new THREE.Color();
  private readonly logs: THREE.InstancedMesh;
  private readonly bundles: THREE.InstancedMesh;
  private readonly blocks: THREE.InstancedMesh;
  private readonly rocks: THREE.InstancedMesh;
  private readonly clods: THREE.InstancedMesh;
  private readonly coal: THREE.InstancedMesh;
  private readonly shards: THREE.InstancedMesh;
  private readonly crystals: THREE.InstancedMesh;
  private readonly mineralAccents: THREE.InstancedMesh;
  private readonly heat: THREE.InstancedMesh;
  private signature = '';

  constructor(private readonly state: SimulationState, private readonly surface: TerrainSurface, private readonly scene: ResourceWorkScene) {
    this.group.name = 'Authoritative resource storage and processing';
    this.logs = this.pool('Stored timber', resourceLogGeometry(), true);
    this.bundles = this.pool('Stored plant materials', resourceBundleGeometry());
    this.blocks = this.pool('Storage and processing fabric', new THREE.BoxGeometry(1, 1, 1));
    this.rocks = this.pool('Stored stone rubble', new THREE.DodecahedronGeometry(1, 0));
    this.clods = this.pool('Stored clay clods', new THREE.IcosahedronGeometry(1, 1));
    this.coal = this.pool('Stored coal fragments', new THREE.TetrahedronGeometry(1, 0));
    this.shards = this.pool('Stored ore shards', new THREE.OctahedronGeometry(1, 0));
    this.crystals = this.pool('Stored crystal ore', new THREE.ConeGeometry(0.72, 1.7, 5));
    this.mineralAccents = this.pool('Stored ore mineral accents', new THREE.OctahedronGeometry(1, 0));
    (this.clods.material as THREE.MeshStandardMaterial).roughness = 1;
    (this.coal.material as THREE.MeshStandardMaterial).roughness = 0.9;
    (this.coal.material as THREE.MeshStandardMaterial).metalness = 0.04;
    (this.crystals.material as THREE.MeshStandardMaterial).roughness = 0.54;
    (this.crystals.material as THREE.MeshStandardMaterial).metalness = 0.2;
    (this.shards.material as THREE.MeshStandardMaterial).roughness = 0.7;
    (this.shards.material as THREE.MeshStandardMaterial).metalness = 0.22;
    (this.mineralAccents.material as THREE.MeshStandardMaterial).roughness = 0.42;
    (this.mineralAccents.material as THREE.MeshStandardMaterial).metalness = 0.48;
    this.heat = this.pool('Paid processing heat', new THREE.SphereGeometry(1, 6, 4));
    (this.heat.material as THREE.MeshStandardMaterial).emissive.set('#d8783c');
    (this.heat.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.85;
  }

  update(): void {
    const settlements = this.state.settlements.filter(s => s.alive).sort((a, b) => a.id.localeCompare(b.id)).slice(0, MAX_RESOURCE_SETTLEMENTS);
    const plans = settlements.map(s => ({ s, stock: resourceStoragePresentation(s),
      processes: resourceProcessingPresentation(this.state.world, s, this.state.month) }));
    const signature = JSON.stringify([this.state.world.environmentRevision, plans.map(({ s, stock, processes }) =>
      [s.id, s.position, s.structurePlots?.map(p => [p.id, p.worldX, p.worldZ, p.radius, p.width, p.depth,
        p.condition > 0.2, p.accessRestricted, p.development?.form, p.development?.status]),
      stock.map(p => [p.id, p.pieces]), processes, s.infrastructure.factories >= 0.25])]);
    if (signature === this.signature) return;
    this.signature = signature;
    for (const mesh of [this.logs, this.bundles, this.blocks, this.rocks, this.clods, this.coal, this.shards, this.crystals, this.mineralAccents, this.heat]) mesh.count = 0;
    for (const { s, stock, processes } of plans) {
      const plots = (s.structurePlots ?? []).filter(p => p.condition > 0.2 && !p.accessRestricted
        && (!p.development || p.development.status === 'active'));
      const store = plots.find(p => p.development?.form === 'store');
      const source = store ? { x: store.worldX, z: store.worldZ } : s.position;
      const radius = store ? Math.max(store.radius, store.width / 2, store.depth / 2) + 0.35 : 0.9;
      for (let i = 0; i < stock.length; i++) {
        const item = stock[i]!;
        const angle = i * Math.PI / 4;
        const anchor = { x: source.x + Math.cos(angle) * radius, z: source.z + Math.sin(angle) * radius };
        if (!this.scene.safeSegment(anchor, anchor)) continue;
        for (let n = 0; n < item.pieces; n++) {
          const point = { x: anchor.x + (n % 3 - 1) * 0.075, z: anchor.z };
          if (!this.scene.safeSegment(anchor, point)) continue;
          const y = 0.035 + Math.floor(n / 3) * 0.065;
          if (item.id === 'timber') this.emit(this.logs, point, y, 0.3, 0.4, 0.3, '#ffffff', Math.PI / 2);
          else if (/fiber|flora|herb/.test(item.id)) this.emit(this.bundles, point, y + 0.03, 1.4, 1.4, 1.4, storedMaterialColour(item.id));
          else if (isMinedMaterial(item.id)) {
            const profile = mineralVisualProfile(item.id);
            const mineralMesh = profile.geometry === 'clod' ? this.clods
              : profile.geometry === 'coal' ? this.coal
                : profile.geometry === 'shard' ? this.shards
                : profile.geometry === 'crystal' ? this.crystals : this.rocks;
            const base = 0.048;
            this.emit(mineralMesh, point, y,
              base * profile.scale[0], base * profile.scale[1], base * profile.scale[2],
              n % 2 ? profile.secondaryColour : profile.baseColour, (n % 2 ? 1 : -1) * profile.tilt);
            if (profile.accentStrength > 0.2 && n < 3) {
              this.emit(this.mineralAccents, { x: point.x + 0.018, z: point.z - 0.008 }, y + 0.028,
                0.01 + profile.accentStrength * 0.007, 0.014 + profile.accentStrength * 0.01, 0.009,
                profile.accentColour, n * 0.4);
            }
          } else this.emit(this.blocks, point, y, item.id === 'lumber' ? 0.3 : 0.09, 0.035, 0.065, storedMaterialColour(item.id));
        }
      }
      const workshop = plots.find(p => p.development?.form === 'workshop' || p.development?.form === 'works');
      if (!workshop) continue;
      for (let i = 0; i < processes.length; i++) {
        const process = processes[i]!;
        const anchor = { x: workshop.worldX + (i - 1) * 0.38,
          z: workshop.worldZ + Math.max(workshop.radius, workshop.depth / 2) + 0.3 };
        if (!this.scene.safeSegment(anchor, anchor)) continue;
        if (process.hot) {
          this.emit(this.rocks, anchor, 0.13, 0.16, 0.18, 0.16, '#776252');
          this.emit(this.blocks, { x: anchor.x, z: anchor.z - 0.06 }, 0.29, 0.09,
            s.infrastructure.factories >= 0.25 ? 0.55 : 0.23, 0.09, '#625e57');
          if (process.active) this.emit(this.heat, { x: anchor.x, z: anchor.z + 0.14 }, 0.11, 0.07, 0.045, 0.02, '#e6a056');
        } else {
          this.emit(this.blocks, anchor, 0.14, 0.28, 0.04, 0.19, '#ae895e');
          for (const dx of [-0.11, 0.11]) this.emit(this.blocks, { x: anchor.x + dx, z: anchor.z }, 0.07, 0.03, 0.14, 0.13, '#71583f');
          if (process.textile) this.emit(this.blocks, anchor, 0.28, 0.22, 0.25, 0.018, '#c4b68a');
          if (process.active) {
            const input = process.inputs[0] ?? '';
            if (input === 'timber') this.emit(this.logs, anchor, 0.21, 0.3, 0.35, 0.3, '#ffffff', Math.PI / 2);
            else this.emit(this.bundles, anchor, 0.21, 1.5, 1.1, 1.5, storedMaterialColour(input));
          }
        }
      }
    }
    for (const mesh of [this.logs, this.bundles, this.blocks, this.rocks, this.clods, this.coal, this.shards, this.crystals, this.mineralAccents, this.heat]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private pool(name: string, geometry: THREE.BufferGeometry, vertexColors = false): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, vertexColors }), CAPACITY);
    mesh.name = name; mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  private emit(mesh: THREE.InstancedMesh, p: Vec2, y: number, sx: number, sy: number, sz: number, colour: string, rz = 0): void {
    if (mesh.count >= CAPACITY || !this.scene.safeSegment(p, p)) return;
    this.marker.position.set(p.x, this.surface.heightAt(p.x, p.z) + y, p.z);
    this.marker.rotation.set(0, 0, rz); this.marker.scale.set(sx, sy, sz); this.marker.updateMatrix();
    mesh.setMatrixAt(mesh.count, this.marker.matrix);
    mesh.setColorAt(mesh.count++, this.colour.set(colour));
  }
}
