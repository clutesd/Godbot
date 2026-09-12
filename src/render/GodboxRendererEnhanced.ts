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
import { resolveHarbourFootprint, transportPresentationWidth } from './transport/TransportPresentation';
import {
  collectTransportDebugRecords,
  createPortalDebugOverlay,
  createSegmentDebugOverlay,
  setTransportDebugVisibility,
  type TransportDebugRecord,
} from './transport/TransportDebug';

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

let transportDebugEnabled = false;

export function setTransportDebugMode(renderer: GodboxRenderer, enabled?: boolean): boolean {
  const self = renderer as unknown as RendererInternals;
  transportDebugEnabled = enabled ?? !transportDebugEnabled;
  setTransportDebugVisibility(self.scene, transportDebugEnabled);
  return transportDebugEnabled;
}

export function transportDebugReport(renderer: GodboxRenderer): TransportDebugRecord[] {
  const self = renderer as unknown as RendererInternals;
  return collectTransportDebugRecords(self.scene);
}

function markWeatherSurface(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) child.userData['weatherSurface'] = true;
  });
}

function constructionMarker(segment: TransportSegment): THREE.Group | undefined {
  const point = segment.points[0];
  if (!point) return undefined;
  const site = new THREE.Group();
  site.name = 'transport-construction-site';
  site.userData['constructionSegmentId'] = segment.id;
  const timber = new THREE.MeshStandardMaterial({ color: '#76583d', roughness: 0.96 });
  const stone = new THREE.MeshStandardMaterial({ color: '#847b6e', roughness: 0.94 });
  const metal = new THREE.MeshStandardMaterial({ color: '#6f777b', roughness: 0.58, metalness: 0.42 });
  const structural = segment.mode === 'rail' ? metal : timber;

  for (let index = 0; index < 3; index += 1) {
    const angle = index / 3 * Math.PI * 2;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.54, 0.055), timber);
    post.position.set(point.x + Math.cos(angle) * 0.34, point.y + 0.27, point.z + Math.sin(angle) * 0.34);
    post.castShadow = true;
    site.add(post);
  }
  const crossbar = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.045, 0.045), structural);
  crossbar.position.set(point.x, point.y + 0.5, point.z);
  crossbar.rotation.y = Math.PI / 5;
  crossbar.castShadow = true;
  site.add(crossbar);

  for (let index = 0; index < 3; index += 1) {
    const material = index === 2 && segment.mode === 'rail' ? metal : index === 0 ? stone : timber;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.22 + index * 0.04, 0.12, 0.16), material);
    stock.position.set(point.x - 0.36 + index * 0.26, point.y + 0.07, point.z + 0.34);
    stock.rotation.y = (index - 1) * 0.18;
    stock.castShadow = true;
    site.add(stock);
  }
  markWeatherSurface(site);
  return site;
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
  const activeRouteCount = self.state.tradeRoutes.filter(route => route.active && (route.a === settlement.id || route.b === settlement.id)).length;
  const harbourActivity = Math.min(1, activeRouteCount / 4 + settlement.infrastructure.ports * 0.45);

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
      const bankPoint = new THREE.Vector3(bankX, bankY, bankZ);
      const logicalWaterPoint = new THREE.Vector3(portal.localX, localY, portal.localZ);
      const footprint = resolveHarbourFootprint(bankPoint, logicalWaterPoint, rank);
      const dock = createDockStructure({
        bank: bankPoint,
        water: footprint.visibleWater,
        eraRank: rank,
        identity: `${settlement.id}:${portal.routeId}`,
        activity: harbourActivity,
        materials: {
          timber: palette.getSurfaceMaterial('timber'),
          stone: palette.getSurfaceMaterial('stone'),
          metal: palette.getSurfaceMaterial('metal'),
          accent: palette.getSurfaceMaterial('motif'),
          glow: palette.getSurfaceMaterial('glow'),
          cloth: palette.getSurfaceMaterial('cloth'),
          shadow: palette.getSurfaceMaterial('shadow'),
        },
        groundAt: (x, z) => self.elevationAt(settlement.position.x + x, settlement.position.z + z) - settlementY,
      });
      dock.userData['routeId'] = portal.routeId;
      dock.userData['logicalHarbourLength'] = footprint.logicalLength;
      dock.userData['visibleHarbourLength'] = footprint.visibleLength;
      dock.userData['harbourFootprintCapped'] = footprint.capped;
      group.add(dock);

      // Debug deliberately shows the full logical bank -> navigation-anchor span so a long
      // shipping connection remains diagnosable even though ordinary presentation is compact.
      const debug = createPortalDebugOverlay({
        kind: 'dock',
        id: `dock:${settlement.id}`,
        settlementId: settlement.id,
        routeId: portal.routeId,
        from: bankPoint,
        to: logicalWaterPoint,
      });
      debug.visible = transportDebugEnabled;
      group.add(debug);
      continue;
    }

    if (portal.kind === 'station') {
      const station = new THREE.Group();
      station.name = 'transport-station';
      const platform = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.12, 0.62), palette.getSurfaceMaterial('ground'));
      platform.receiveShadow = true;
      const roofMaterial = palette.getSurfaceMaterial(rank >= 4 ? 'roof-metal' : 'roof-tile');
      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.09, 0.54), roofMaterial);
      roof.position.y = 0.72;
      roof.castShadow = true;
      station.add(platform, roof);
      for (const sideX of [-0.58, 0.58]) {
        for (const sideZ of [-0.18, 0.18]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.66, 0.04), rank >= 4 ? palette.getSurfaceMaterial('metal') : palette.getSurfaceMaterial('timber'));
          post.position.set(sideX, 0.36, sideZ);
          post.castShadow = true;
          station.add(post);
        }
      }
      const bench = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.1, 0.18), palette.getSurfaceMaterial('timber'));
      bench.position.set(0, 0.22, -0.14);
      bench.castShadow = true;
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.035), palette.getSurfaceMaterial('motif'));
      sign.position.set(-0.52, 0.58, 0.21);
      sign.castShadow = true;
      station.add(bench, sign);
      if (rank >= 4) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), palette.getSurfaceMaterial('glow'));
        lamp.position.set(0.52, 0.62, 0.21);
        station.add(lamp);
      }
      station.position.set(portal.localX, localY, portal.localZ);
      station.rotation.y = portal.angle + Math.PI / 2;
      station.userData['portalKind'] = portal.kind;
      group.add(station);
      const stationDebug = createPortalDebugOverlay({
        kind: 'station',
        id: `station:${settlement.id}:${portal.routeId}`,
        settlementId: settlement.id,
        routeId: portal.routeId,
        from: new THREE.Vector3(portal.localX, localY, portal.localZ),
      });
      stationDebug.visible = transportDebugEnabled;
      group.add(stationDebug);
      continue;
    }

    if (rank < 2) continue;
    const gate = new THREE.Group();
    gate.name = 'transport-gate';
    const postMaterial = rank >= 3 ? palette.getSurfaceMaterial('stone') : palette.getSurfaceMaterial('timber');
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.78, 0.2), postMaterial);
    const right = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.78, 0.2), postMaterial);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.14, 0.18), palette.getSurfaceMaterial('motif'));
    left.position.set(-0.4, 0.39, 0);
    right.position.set(0.4, 0.39, 0);
    lintel.position.set(0, 0.82, 0);
    left.castShadow = true;
    right.castShadow = true;
    lintel.castShadow = true;
    gate.add(left, right, lintel);
    if (rank >= 4) {
      for (const side of [-1, 1]) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.09), palette.getSurfaceMaterial('glow'));
        lamp.position.set(side * 0.4, 0.68, 0.13);
        gate.add(lamp);
      }
    }
    gate.position.set(portal.localX, localY, portal.localZ);
    gate.rotation.y = portal.angle + Math.PI / 2;
    gate.userData['portalKind'] = portal.kind;
    group.add(gate);
    const gateDebug = createPortalDebugOverlay({
      kind: 'gate',
      id: `gate:${settlement.id}:${portal.routeId}`,
      settlementId: settlement.id,
      routeId: portal.routeId,
      from: new THREE.Vector3(portal.localX, localY, portal.localZ),
    });
    gateDebug.visible = transportDebugEnabled;
    group.add(gateDebug);
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
    if (segment.mode !== 'water') {
      const debug = createSegmentDebugOverlay(self.state.world, segment);
      debug.visible = transportDebugEnabled;
      self.routeGroup.add(debug);
    }
    if (segment.mode === 'water' || segment.status === 'planned') continue;
    if (segment.status === 'under-construction') {
      const marker = constructionMarker(segment);
      if (marker) self.routeGroup.add(marker);
      if (segment.damagedMonth !== undefined) {
        const scar = new THREE.Mesh(
          transportRibbon(self.state.world, segment, transportPresentationWidth(segment)),
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
    const width = transportPresentationWidth(segment);
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
          transportRibbon(self.state.world, segment, rail ? 0.045 : 0.035, side * width * (rail ? 0.44 : 0.48), rail ? 0.04 : 0.18),
          new THREE.MeshStandardMaterial({ color: rail ? '#9a9ea0' : '#776958', metalness: rail ? 0.65 : 0.05, roughness: 0.6, side: THREE.DoubleSide }),
        );
        line.userData['weatherSurface'] = true;
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
      markWeatherSurface(structure);
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

export type { TransportDebugRecord };
