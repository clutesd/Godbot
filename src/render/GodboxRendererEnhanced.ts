import * as THREE from 'three';
import { GodboxRenderer } from './GodboxRenderer';
import { transportRibbon } from './transport/TransportGeometry';
import { gradeViolations } from '../sim/transport/TransportNetwork';
import { eraRank } from './assets/BuildingGrammar';
import type { Settlement, SimulationState } from '../sim/types';
import type { TransportSegment } from '../sim/transport/types';
import type { Era, MaterialPalette } from './materials/MaterialPalette';
import type { SettlementLayoutPlan } from './placement/SettlementLayoutPlan';
import type { TerrainQueries } from './placement/TerrainQueries';
import type { TerrainSurface } from './terrain/TerrainSurface';
import type { WeatherRenderer } from './atmosphere/WeatherRenderer';
import { createBridgeStructure, createDockStructure } from './transport/TransportStructures';

interface RoutePlacementReportLike {
  routeId: string;
  mode: 'land' | 'water';
  railSupported: boolean;
  samples: number;
  waterSamples: number;
  bridgeSegments: number;
  maxTerrainError: number;
  gradeViolations: number;
}

interface RendererInternals {
  state: SimulationState;
  terrainQueries: TerrainQueries;
  terrainSurface: TerrainSurface;
  routeGroup: THREE.Group;
  routePlacementReports: Map<string, RoutePlacementReportLike>;
  lastRouteSignature: string;
  weatherRenderer: WeatherRenderer;
  scene: THREE.Scene;
  elevationAt: (x: number, z: number) => number;
  clearGroup: (group: THREE.Group) => void;
}

/**
 * Rich transport presentation is installed onto the established renderer at module load. The
 * simulation remains authoritative: these functions only turn commissioned ports and completed
 * bridge segments into structures with believable physical grammar.
 */
function enhancedAddRoutePortals(
  this: GodboxRenderer,
  group: THREE.Group,
  settlement: Settlement,
  layout: SettlementLayoutPlan,
  era: Era,
  palette: MaterialPalette,
): void {
  const self = this as unknown as RendererInternals;
  const rank = eraRank(era);
  const settlementY = self.elevationAt(settlement.position.x, settlement.position.z);
  for (const portal of layout.portals.slice(0, 5)) {
    const worldX = settlement.position.x + portal.localX;
    const worldZ = settlement.position.z + portal.localZ;
    const terrain = self.terrainQueries.queryTerrainAt(worldX, worldZ);
    if (!terrain || (portal.kind !== 'dock' && (terrain.water || terrain.maxSlope > 18))) continue;
    const waterY = terrain.water ? self.terrainSurface.waterYAt(worldX, worldZ) : Number.NEGATIVE_INFINITY;
    const localY = terrain.water && Number.isFinite(waterY)
      ? waterY - settlementY + 0.06
      : self.elevationAt(worldX, worldZ) - settlementY + 0.04;

    if (portal.kind === 'dock') {
      if (!portal.bank || !terrain.water || !Number.isFinite(waterY)) continue;
      const bankTerrain = self.terrainQueries.queryTerrainAt(portal.bank.x, portal.bank.z);
      if (!bankTerrain || bankTerrain.water || bankTerrain.maxSlope > 32) continue;
      const bankX = portal.bank.x - settlement.position.x;
      const bankZ = portal.bank.z - settlement.position.z;
      const bankY = self.elevationAt(portal.bank.x, portal.bank.z) - settlementY + 0.06;
      const dock = createDockStructure({
        bank: new THREE.Vector3(bankX, bankY, bankZ),
        water: new THREE.Vector3(portal.localX, localY, portal.localZ),
        eraRank: rank,
        materials: {
          timber: palette.getSurfaceMaterial('timber'),
          stone: palette.getSurfaceMaterial('stone'),
          metal: palette.getSurfaceMaterial('metal'),
        },
        groundAt: (x, z) => self.elevationAt(settlement.position.x + x, settlement.position.z + z) - settlementY,
      });
      dock.userData['routeId'] = portal.routeId;
      group.add(dock);
      continue;
    }

    if (portal.kind === 'station') {
      const station = new THREE.Group();
      const platform = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.12, 0.55), palette.getSurfaceMaterial('ground'));
      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.12, 0.38), new THREE.MeshStandardMaterial({ color: '#596167', roughness: 0.58, metalness: 0.2 }));
      roof.position.y = 0.55;
      station.add(platform, roof);
      station.position.set(portal.localX, localY, portal.localZ);
      station.rotation.y = portal.angle + Math.PI / 2;
      station.userData['portalKind'] = portal.kind;
      group.add(station);
      continue;
    }

    if (rank < 2) continue;
    const gate = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: '#746757', roughness: 0.86 });
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.65, 0.18), material);
    const right = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.65, 0.18), material);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.14, 0.16), material);
    left.position.set(-0.36, 0.34, 0);
    right.position.set(0.36, 0.34, 0);
    lintel.position.set(0, 0.72, 0);
    gate.add(left, right, lintel);
    gate.position.set(portal.localX, localY, portal.localZ);
    gate.rotation.y = portal.angle + Math.PI / 2;
    gate.userData['portalKind'] = portal.kind;
    group.add(gate);
  }
}

function enhancedSyncRoutes(this: GodboxRenderer, force = false): void {
  const self = this as unknown as RendererInternals;
  const network = self.state.transportation;
  const signature = String(network.revision);
  if (!force && signature === self.lastRouteSignature) return;
  self.lastRouteSignature = signature;
  self.clearGroup(self.routeGroup);
  self.routePlacementReports.clear();

  for (const segment of Object.values(network.segments) as TransportSegment[]) {
    if (segment.mode === 'water' || segment.status === 'planned') continue;
    if (segment.status === 'under-construction') {
      const point = segment.points[0];
      if (!point) continue;
      const marker = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), new THREE.MeshStandardMaterial({ color: '#c79958' }));
      marker.position.set(point.x, point.y + 0.2, point.z);
      marker.userData['constructionSegmentId'] = segment.id;
      self.routeGroup.add(marker);
      if (segment.damagedMonth !== undefined) {
        const scar = new THREE.Mesh(
          transportRibbon(self.state.world, segment, segment.mode === 'rail' ? 0.85 : 0.62),
          new THREE.MeshStandardMaterial({ color: '#615044', roughness: 1, side: THREE.DoubleSide }),
        );
        scar.userData['weatherSurface'] = true;
        scar.userData['damagedSegmentId'] = segment.id;
        scar.receiveShadow = true;
        self.routeGroup.add(scar);
      }
      continue;
    }

    const rail = segment.mode === 'rail';
    const bridge = segment.kind === 'bridge';
    const width = rail ? 0.85 : 0.62;
    const bed = new THREE.Mesh(
      transportRibbon(self.state.world, segment, width),
      new THREE.MeshStandardMaterial({ color: rail ? '#625f58' : bridge ? '#8c8170' : '#987b57', roughness: 0.94, side: THREE.DoubleSide }),
    );
    bed.userData['segmentId'] = segment.id;
    bed.receiveShadow = true;
    bed.userData['weatherSurface'] = true;
    self.routeGroup.add(bed);

    if (rail || bridge) {
      for (const side of [-1, 1]) {
        const line = new THREE.Mesh(
          transportRibbon(self.state.world, segment, rail ? 0.055 : 0.04, side * (rail ? 0.25 : width * 0.48), rail ? 0.045 : 0.25),
          new THREE.MeshStandardMaterial({ color: rail ? '#9a9ea0' : '#776958', metalness: rail ? 0.65 : 0.05, roughness: 0.6, side: THREE.DoubleSide }),
        );
        self.routeGroup.add(line);
      }
    }

    if (bridge) {
      const timber = new THREE.MeshStandardMaterial({ color: '#6d4f3d', roughness: 0.96 });
      const stone = new THREE.MeshStandardMaterial({ color: '#817768', roughness: 0.92 });
      const metal = new THREE.MeshStandardMaterial({ color: '#666e72', roughness: 0.55, metalness: 0.48 });
      const structure = createBridgeStructure({
        segment,
        width,
        groundAt: (x, z) => self.elevationAt(x, z),
        timber,
        stone,
        metal,
      });
      structure.userData['weatherSurface'] = true;
      self.routeGroup.add(structure);
    }

    self.routePlacementReports.set(segment.id, {
      routeId: segment.id,
      mode: 'land',
      railSupported: rail,
      samples: segment.points.length,
      waterSamples: bridge ? Math.max(0, segment.points.length - 2) : 0,
      bridgeSegments: bridge ? 1 : 0,
      maxTerrainError: bridge ? 0 : segment.points.reduce((error, point) => Math.max(error, Math.abs(point.y - self.elevationAt(point.x, point.z) - 0.04)), 0),
      gradeViolations: gradeViolations(segment),
    });
  }
  self.weatherRenderer.bindScene(self.scene);
}

const rendererPrototype = GodboxRenderer.prototype as unknown as Record<string, unknown>;
rendererPrototype['addRoutePortals'] = enhancedAddRoutePortals;
rendererPrototype['syncRoutes'] = enhancedSyncRoutes;

export {};
