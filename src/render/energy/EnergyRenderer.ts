import type { MillRotorInfo } from '../architecture/MillMotion';
import { AssetBuilder, type AssetConfig } from '../assets/AssetBuilder';
import { productionBuildingShell, productionConstructionTarget } from '../assets/ProductionBuildingShell';
import { developmentPresentationEra } from '../assets/BuildingGrammar';
import { ConstructionAssembly } from '../construction/ConstructionAssembly';
import * as THREE from 'three';
import type { SimulationState } from '../../sim/types';
import type { EnergyPlant, PowerLine, GridNode } from '../../sim/energy/types';
import { generatorDefinition } from '../../sim/energy/Generation';
import { hydraulicRotationY, planHydraulicVisualSite, type HydraulicVisualSite } from './HydraulicPresentation';

interface EnergyMachineVisual {
  plant: EnergyPlant;
  parts?: { object: THREE.Object3D; info: MillRotorInfo; base: THREE.Vector3 }[];
  angle?: number;
  rotor?: THREE.Group;
  rotorAxis?: 'z' | 'y';
  piston?: THREE.Mesh;
  plumes: THREE.Group[];
  lamp: THREE.Mesh;
}

/** Presentation reads dispatch; animation never creates fuel, generation or connectivity. */
export class EnergyRenderer {
  readonly group = new THREE.Group();
  private readonly assets: AssetBuilder;
  private readonly ownsAssets: boolean;
  private buildingConfig?: AssetConfig;
  private constructionTargets: THREE.Group[] = [];

  constructor(assets?: AssetBuilder) {
    this.assets = assets ?? new AssetBuilder('energy-buildings');
    this.ownsAssets = !assets;
  }

  private building(parent: THREE.Group, name: string, width: number, depth: number, x = 0, z = 0): void {
    if (!this.buildingConfig) throw new Error('Energy building requires authoritative plant context');
    const shell = productionBuildingShell(this.assets, { ...this.buildingConfig, seed: `${this.buildingConfig.seed}:${name}` }, width, depth, name);
    shell.position.set(x, 0, z);
    parent.add(shell);
  }
  private signature = '';
  private lastElapsed?: number;
  private machines: EnergyMachineVisual[] = [];
  private equipmentMaterials: THREE.Material[] = [];
  private terminals = new Map<string, number>();
  private supports = new Set<string>();

  private readonly metal = new THREE.MeshStandardMaterial({ color: '#627078', metalness: 0.65, roughness: 0.4 });
  private readonly darkMetal = new THREE.MeshStandardMaterial({ color: '#343d42', metalness: 0.72, roughness: 0.38 });
  private readonly wood = new THREE.MeshStandardMaterial({ color: '#725038', roughness: 0.95 });
  private readonly concrete = new THREE.MeshStandardMaterial({ color: '#b8b5a3', roughness: 0.9 });
  private readonly brick = new THREE.MeshStandardMaterial({ color: '#755247', roughness: 0.92 });
  private readonly copper = new THREE.MeshStandardMaterial({ color: '#a96843', metalness: 0.72, roughness: 0.34 });
  private readonly coal = new THREE.MeshStandardMaterial({ color: '#272928', roughness: 1 });
  private readonly panel = new THREE.MeshStandardMaterial({ color: '#123756', metalness: 0.55, roughness: 0.25 });
  private readonly wire = new THREE.LineBasicMaterial({ color: '#303a40' });
  private readonly steam = new THREE.MeshBasicMaterial({ color: '#e5e6df', transparent: true, opacity: 0.22, depthWrite: false });
  private readonly smoke = new THREE.MeshBasicMaterial({ color: '#57544d', transparent: true, opacity: 0.25, depthWrite: false });
  private readonly exhaust = new THREE.MeshBasicMaterial({ color: '#c9d0ce', transparent: true, opacity: 0.11, depthWrite: false });

  private box(group: THREE.Group, x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material, name?: string): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    if (name) mesh.name = name;
    group.add(mesh);
    return mesh;
  }

  private cylinder(
    group: THREE.Group,
    x: number,
    y: number,
    z: number,
    top: number,
    bottom: number,
    h: number,
    material: THREE.Material,
    name?: string,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, h, 12), material);
    mesh.position.set(x, y, z);
    if (name) mesh.name = name;
    group.add(mesh);
    return mesh;
  }

  private namedGroup(parent: THREE.Group, name: string): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    parent.add(group);
    return group;
  }

  private horizontalCylinder(
    group: THREE.Group,
    x: number,
    y: number,
    z: number,
    radius: number,
    length: number,
    material: THREE.Material,
    name?: string,
  ): THREE.Mesh {
    const mesh = this.cylinder(group, x, y, z, radius, radius, length, material, name);
    mesh.rotation.z = Math.PI / 2;
    return mesh;
  }

  update(state: SimulationState, elapsed: number, height: (x: number, z: number) => number): void {
    const signature = `${state.month}:${state.settlements.length}:` + (state.energy?.lines ?? []).map(l => `${l.id}:${l.progress}:${l.condition}:${l.retired}`).join('|')
      + (state.energy?.nodes ?? []).map(n => `${n.id}:${n.progress}:${n.condition}:${n.capacity}:${n.retired}`).join('|');
    if (signature !== this.signature) {
      this.signature = signature;
      this.rebuild(state, height);
    }

    const delta = Math.max(0, elapsed - (this.lastElapsed ?? elapsed));
    this.lastElapsed = elapsed;
    for (const machine of this.machines) {
      const running = machine.plant.status === 'running';
      const factor = machine.plant.output / generatorDefinition(machine.plant.kind).capacity;
      machine.angle = (machine.angle ?? 0) + delta * Math.min(3, factor * 6) * Number(running);
      for (const { object, info, base } of machine.parts ?? []) {
        const angle = machine.angle * (info.ratio ?? 1) + (info.phase ?? 0);
        if (info.motion === 'yaw') continue;
        if (info.motion === 'reciprocate') object.position[info.axis] = base[info.axis] + Math.sin(angle) * (info.stroke ?? 0);
        else object.rotation[info.axis] = angle;
      }
      if (machine.rotor) {
        const rotation = elapsed * Math.min(3, factor * 6) * Number(running);
        if (machine.rotorAxis === 'y') machine.rotor.rotation.y = rotation;
        else machine.rotor.rotation.z = rotation;
      }
      if (machine.piston) machine.piston.position.x = running ? Math.sin(elapsed * 4) * 0.18 : 0;
      for (const plume of machine.plumes) {
        plume.visible = running;
        plume.children.forEach((puff, i) => {
          const phase = (elapsed * 0.3 + i / 5) % 1;
          puff.position.y = phase * 1.6;
          puff.position.x = phase * 0.4;
          puff.scale.setScalar(0.25 + phase * 0.5);
        });
      }
      const material = machine.lamp.material as THREE.MeshStandardMaterial;
      material.emissive.set(running ? '#ffbf59' : machine.plant.status === 'failed' ? '#a12014' : '#111111');
      material.emissiveIntensity = running ? 1.5 : 0.2;
    }
  }

  private clear(): void {
    this.group.traverse(o => {
      if ((o instanceof THREE.Mesh || o instanceof THREE.Line) && !o.userData['sharedAsset']) o.geometry.dispose();
    });
    for (const machine of this.machines) (machine.lamp.material as THREE.Material).dispose();
    for (const material of this.equipmentMaterials) material.dispose();
    this.equipmentMaterials = [];
    for (const target of this.constructionTargets) target.traverse(node => { if (node instanceof THREE.Mesh && !node.userData['sharedAsset']) node.geometry.dispose(); });
    this.constructionTargets = [];
    this.group.clear();
    this.machines = [];
  }

  private rebuild(state: SimulationState, height: (x: number, z: number) => number): void {
    this.clear();
    this.supports.clear(); this.terminals.clear();
    for (const node of state.energy?.nodes ?? []) {
      const regional = state.energy?.lines.some(l => !l.retired && l.class === 'transmission' && (l.from === node.id || l.to === node.id));
      this.terminals.set(node.id, regional ? 2.8 : node.kind === 'junction' || node.kind === 'transformer' ? 1.8
        : node.kind === 'service' ? 1.2 : node.kind === 'storage' ? 0.7
          : node.kind === 'substation' || node.kind === 'switchyard' ? node.capacity < 100 ? 1.1 : 0.94 : 0.95);
    }
    for (const settlement of state.settlements.filter(s => s.alive)) {
      for (const plant of settlement.energy?.plants ?? []) {
        const plot = settlement.structurePlots?.find(p => p.id === plant.plotId);
        if (!plot || plot.development?.status !== 'active') continue;

        this.buildingConfig = {
          seed: `${settlement.id}:energy:${plant.id}`, culture: plot.development.style,
          era: developmentPresentationEra(plot.development), development: plot.development,
          energyKind: plant.kind, archetype: 'factory', variant: 'energy#7',
          settlementIdentity: settlement.architecture, prosperity: settlement.prosperity,
        };
        const root = new THREE.Group();
        root.name = `Energy plant ${plant.kind}:${plant.id}`;
        const scale = Math.min(1, Math.max(0.25, plot.radius / 2));
        const hydraulic = plant.kind === 'waterwheel' || plant.kind === 'hydro'
          ? planHydraulicVisualSite(state.world, { x: plot.worldX, z: plot.worldZ })
          : undefined;
        const defaultX = plot.worldX + plot.radius * 0.6;
        const defaultZ = plot.worldZ;
        const x = plant.kind === 'waterwheel' && hydraulic ? hydraulic.bankX
          : plant.kind === 'hydro' && hydraulic ? hydraulic.riverX
            : defaultX;
        const z = plant.kind === 'waterwheel' && hydraulic ? hydraulic.bankZ
          : plant.kind === 'hydro' && hydraulic ? hydraulic.riverZ
            : defaultZ;
        // Hydraulic structures sit on rendered terrain. Their water-facing machinery is positioned
        // relative to the authoritative river surface so steep banks do not leave wheels/dams floating.
        const y = height(x, z);
        root.position.set(x, y, z);
        if (hydraulic) root.rotation.y = hydraulicRotationY(hydraulic);
        root.scale.setScalar(scale);
        this.group.add(root);

        const baseWidth = plant.kind === 'coal' ? 2.3 : plant.kind === 'gas' ? 2 : plant.kind === 'steam' ? 1.8 : 1.3;
        const baseDepth = plant.kind === 'coal' ? 1.45 : plant.kind === 'gas' ? 1.25 : 1;
        if (plant.kind !== 'waterwheel' && plant.kind !== 'hydro') {
          this.box(root, 0, 0.1, 0, baseWidth, 0.2, baseDepth, this.concrete, 'Energy plant foundation');
        }

        const lamp = this.box(root, baseWidth * 0.38, 0.4, baseDepth * 0.38, 0.1, 0.12, 0.1,
          new THREE.MeshStandardMaterial({ color: '#e4b26b' }), 'Energy plant status lamp');
        const machine: EnergyMachineVisual = { plant, lamp, plumes: [] };
        this.machines.push(machine);

        if (plant.kind === 'animal') {
          this.drawAnimalPower(root, machine);
        } else if (plant.kind === 'waterwheel') {
          this.drawCanonicalMill(root, machine, 'Riverside watermill');
        } else if (plant.kind === 'windmill') {
          this.drawCanonicalMill(root, machine, 'Windmill');
        } else if (plant.kind === 'wind') {
          this.drawRotaryPrimitive(root, machine);
        } else if (plant.kind === 'solar') {
          this.drawSolar(root);
        } else if (plant.kind === 'hydro') {
          this.drawHydro(root, hydraulic);
        } else if (plant.kind === 'nuclear') {
          this.drawNuclear(root, machine);
        } else if (plant.kind === 'steam') {
          this.drawSteamEngine(root, machine);
        } else if (plant.kind === 'generator') {
          this.drawEarlyGenerator(root, machine);
        } else if (plant.kind === 'coal') {
          this.drawCoalStation(root, machine);
        } else if (plant.kind === 'gas') {
          this.drawGasPlant(root, machine);
        }
        if (plant.progress < 1) {
          const target = new THREE.Group();
          for (const child of [...root.children]) target.add(child);
          const future = productionConstructionTarget(target);
          const assembly = new ConstructionAssembly(future, 1, plant.id, plot.development.material);
          this.constructionTargets.push(future);
          assembly.update(Math.max(0, Math.min(1, plant.progress)));
          root.add(assembly.group);
          this.constructionTargets.push(target);
        }

      }

      if ((settlement.energy?.storageCapacity ?? 0) > 0) this.drawBatteryBank(settlement, height, state.energy?.nodes?.find(n => n.settlementId === settlement.id && n.kind === 'storage'), !!state.energy?.topologyVersion);
    }

    for (const node of state.energy?.nodes ?? []) this.drawGridNode(node, state, height);
    for (const line of state.energy?.lines ?? []) if (!line.retired) this.drawLine(line, height);
  }

  private drawCanonicalMill(root: THREE.Group, machine: EnergyMachineVisual, name: string): void {
    if (!this.buildingConfig) throw new Error('Mill requires plant context');
    const mill = productionBuildingShell(this.assets, this.buildingConfig, 1.8, 1.6, name);
    root.add(mill);
    machine.parts = [];
    mill.traverse(object => {
      const info = object.userData['millRotor'] as MillRotorInfo | undefined;
      if (info) machine.parts!.push({ object, info, base: object.position.clone() });
    });
  }

  private drawRotaryPrimitive(root: THREE.Group, machine: EnergyMachineVisual): void {
    const tall = 4.2;
    this.cylinder(root, 0, tall / 2, 0, 0.07, 0.12, tall, this.concrete, 'wind tower');
    const rotor = this.namedGroup(root, 'wind rotor');
    rotor.position.set(0, tall, 0.25);
    machine.rotor = rotor;
    for (let i = 0; i < 3; i++) {
      const arm = new THREE.Group();
      arm.rotation.z = i * Math.PI * 2 / 3;
      rotor.add(arm);
      this.box(arm, 0, 1.25 * 0.5, 0, 0.1, 1.25, 0.08, this.concrete);
    }
  }

  private drawSolar(root: THREE.Group): void {
    const array = this.namedGroup(root, 'Solar array');
    for (let i = 0; i < 3; i++) {
      const panel = this.box(array, (i - 1) * 0.42, 0.55, 0, 0.38, 0.05, 0.9, this.panel, 'Solar panel');
      panel.rotation.x = -0.45;
      this.box(array, (i - 1) * 0.42, 0.25, 0, 0.05, 0.5, 0.05, this.metal, 'Solar panel support');
    }
  }

  private drawAnimalPower(root: THREE.Group, machine: EnergyMachineVisual): void {
    const works = this.namedGroup(root, 'Animal power works');
    this.box(works, 0, 0.08, 0, 1.75, 0.14, 1.75, this.wood, 'Animal power threshing floor');
    this.cylinder(works, 0, 0.58, 0, 0.14, 0.18, 1.05, this.wood, 'Animal capstan post');
    const drum = this.cylinder(works, 0, 0.34, 0, 0.28, 0.28, 0.4, this.darkMetal, 'Animal capstan drum');
    drum.rotation.y = Math.PI / 8;

    const sweep = this.namedGroup(works, 'Animal capstan sweep');
    for (const angle of [0, Math.PI / 2]) {
      const beam = this.box(sweep, 0, 0.72, 0, 2.2, 0.09, 0.09, this.wood, 'Animal sweep beam');
      beam.rotation.y = angle;
    }
    machine.rotor = sweep;
    machine.rotorAxis = 'y';

    const harness = this.namedGroup(sweep, 'Animal harness traces');
    for (const side of [-1, 1]) {
      const animal = this.namedGroup(harness, `Draft animal ${side < 0 ? 'A' : 'B'}`);
      animal.position.set(side * 0.92, 0.45, 0.18 * side);
      this.box(animal, 0, 0, 0, 0.42, 0.24, 0.2, this.wood, 'Draft animal body');
      this.box(animal, side * 0.22, 0.08, 0, 0.15, 0.16, 0.14, this.wood, 'Draft animal head');
      for (const z of [-0.07, 0.07]) {
        this.box(animal, -0.12, -0.2, z, 0.05, 0.32, 0.05, this.darkMetal, 'Draft animal leg');
        this.box(animal, 0.12, -0.2, z, 0.05, 0.32, 0.05, this.darkMetal, 'Draft animal leg');
      }
    }

    const drive = this.namedGroup(works, 'Animal belt drive');
    this.horizontalCylinder(drive, 0, 0.3, -0.58, 0.11, 0.55, this.darkMetal, 'Animal drive shaft');
    const pulley = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 6, 18), this.darkMetal);
    pulley.name = 'Animal drive pulley';
    pulley.position.set(0.32, 0.3, -0.58);
    pulley.rotation.y = Math.PI / 2;
    drive.add(pulley);
  }

  private drawHydro(root: THREE.Group, site?: HydraulicVisualSite): void {
    const hydro = this.namedGroup(root, 'Hydroelectric dam complex');
    const span = 2.5 + Math.min(1.2, (site?.flow ?? 0) * 1.4);
    const bankSide = site?.bankSide ?? 1;
    this.box(hydro, 0, 0.72, 0, span, 1.42, 0.42, this.concrete, 'Hydro dam wall');

    const spillway = this.namedGroup(hydro, 'Hydro spillway');
    for (const x of [-0.72, -0.24, 0.24, 0.72]) {
      this.box(spillway, x, 0.68, 0.24, 0.32, 0.82, 0.08, this.darkMetal, 'Hydro spillway gate');
      this.box(spillway, x, 1.18, 0.22, 0.38, 0.08, 0.12, this.metal, 'Hydro spillway gantry');
    }

    const intake = this.namedGroup(hydro, 'Hydro intake');
    this.box(intake, -span * 0.32 * bankSide, 0.55, -0.31, 0.5, 0.72, 0.18, this.darkMetal, 'Hydro intake rack');
    for (let i = -2; i <= 2; i++) this.box(intake, -span * 0.32 * bankSide + i * 0.08, 0.55, -0.42, 0.025, 0.66, 0.03, this.metal, 'Hydro intake bar');

    const powerhouse = this.namedGroup(hydro, 'Hydroelectric powerhouse');
    powerhouse.position.set(span * 0.46 * bankSide, 0, 0.6);
    this.building(powerhouse, 'Hydro powerhouse building', 0.9, 0.72);
    for (let i = -1; i <= 1; i++) this.cylinder(powerhouse, i * 0.24, 0.38, 0.39, 0.11, 0.11, 0.34, this.metal, 'Hydro turbine housing');

    const penstocks = this.namedGroup(hydro, 'Hydro penstocks');
    for (const x of [span * 0.25 * bankSide, span * 0.42 * bankSide]) {
      const pipe = this.cylinder(penstocks, x, 0.42, 0.32, 0.08, 0.08, 0.9, this.metal, 'Hydro penstock');
      pipe.rotation.x = Math.PI / 2.35;
    }

    const tailrace = this.namedGroup(hydro, 'Hydro tailrace');
    this.box(tailrace, span * 0.46 * bankSide, 0.16, 1.02, 0.74, 0.22, 0.78, this.concrete, 'Hydro tailrace apron');
    for (const x of [span * 0.32 * bankSide, span * 0.46 * bankSide, span * 0.6 * bankSide]) {
      this.box(tailrace, x, 0.22, 1.34, 0.12, 0.28, 0.08, this.panel, 'Hydro tailrace outlet');
    }
  }

  private drawNuclear(root: THREE.Group, machine: EnergyMachineVisual): void {
    const nuclear = this.namedGroup(root, 'Nuclear station');
    this.cylinder(nuclear, -0.35, 0.65, 0, 0.35, 0.35, 1.3, this.concrete, 'Nuclear containment');
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), this.concrete);
    dome.name = 'Nuclear containment dome';
    dome.position.set(-0.35, 1.3, 0);
    nuclear.add(dome);
    const points = [new THREE.Vector2(0.45, 0), new THREE.Vector2(0.3, 0.7), new THREE.Vector2(0.22, 1.2), new THREE.Vector2(0.32, 1.7)];
    const tower = new THREE.Mesh(new THREE.LatheGeometry(points, 16), this.concrete);
    tower.name = 'Nuclear cooling tower';
    tower.position.x = 0.65;
    nuclear.add(tower);
    machine.plumes.push(this.plume(nuclear, 0.65, 1.7, this.steam, 'Nuclear cooling steam'));
  }

  private drawSteamEngine(root: THREE.Group, machine: EnergyMachineVisual): void {
    const steam = this.namedGroup(root, 'Steam engine works');

    const boiler = this.namedGroup(steam, 'Steam boiler');
    this.horizontalCylinder(boiler, -0.15, 0.72, -0.15, 0.34, 1.15, this.darkMetal, 'Steam boiler shell');
    this.box(boiler, -0.72, 0.55, -0.15, 0.28, 0.52, 0.58, this.brick, 'Steam firebox');
    this.cylinder(boiler, 0.42, 1.2, -0.15, 0.09, 0.13, 1.35, this.brick, 'Steam chimney');
    machine.plumes.push(this.plume(boiler, 0.42, 1.88, this.smoke, 'Steam boiler exhaust'));

    const flywheel = this.namedGroup(steam, 'Steam flywheel');
    flywheel.position.set(0.28, 0.58, 0.43);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 6, 22), this.darkMetal);
    rim.name = 'Steam flywheel rim';
    flywheel.add(rim);
    for (let i = 0; i < 6; i++) {
      const spoke = this.box(flywheel, 0, 0.2, 0, 0.045, 0.4, 0.045, this.metal);
      spoke.rotation.z = i * Math.PI / 3;
    }
    machine.rotor = flywheel;

    const cylinder = this.horizontalCylinder(steam, -0.42, 0.38, 0.45, 0.14, 0.42, this.metal, 'Steam piston cylinder');
    cylinder.rotation.z = Math.PI / 2;
    machine.piston = this.box(steam, -0.06, 0.38, 0.45, 0.42, 0.1, 0.1, this.metal, 'Steam piston rod');

    const steamVent = this.cylinder(steam, -0.18, 1.0, 0.18, 0.04, 0.05, 0.48, this.copper, 'Steam safety vent');
    steamVent.rotation.z = -0.18;
    machine.plumes.push(this.plume(steam, -0.18, 1.28, this.steam, 'Steam vent plume'));
  }

  private drawEarlyGenerator(root: THREE.Group, machine: EnergyMachineVisual): void {
    const station = this.namedGroup(root, 'Early generator station');
    this.building(station, 'Generator hall', 1.22, 0.9, -0.08);

    const dynamo = this.namedGroup(station, 'Early generator dynamo');
    dynamo.position.set(0.05, 0.45, 0.48);
    this.horizontalCylinder(dynamo, 0, 0, 0, 0.22, 0.72, this.darkMetal, 'Generator rotor casing');
    for (const x of [-0.24, 0, 0.24]) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.035, 6, 18), this.copper);
      coil.name = 'Generator copper coil';
      coil.position.x = x;
      coil.rotation.y = Math.PI / 2;
      dynamo.add(coil);
    }
    const rotor = this.namedGroup(dynamo, 'Generator flywheel');
    const flywheel = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.055, 6, 20), this.metal);
    flywheel.name = 'Generator flywheel rim';
    rotor.add(flywheel);
    rotor.position.set(0.45, 0, 0);
    machine.rotor = rotor;

    const insulators = this.namedGroup(station, 'Generator switchgear');
    for (let i = 0; i < 3; i++) {
      this.cylinder(insulators, 0.38 + i * 0.14, 0.95, -0.18, 0.025, 0.035, 0.18, this.concrete, 'Generator insulator');
    }
    this.cylinder(station, -0.58, 1.15, -0.22, 0.07, 0.1, 1.45, this.brick, 'Generator boiler stack');
    machine.plumes.push(this.plume(station, -0.58, 1.88, this.smoke, 'Generator exhaust'));
  }

  private drawCoalStation(root: THREE.Group, machine: EnergyMachineVisual): void {
    const station = this.namedGroup(root, 'Coal power station');

    const boilerHouse = this.namedGroup(station, 'Coal boiler house');
    this.building(boilerHouse, 'Coal boiler shell', 1.15, 0.92, 0.18, -0.12);

    const turbineHall = this.namedGroup(station, 'Coal turbine hall');
    this.building(turbineHall, 'Coal turbine hall building', 0.72, 0.64, -0.68, 0.36);
    const turbine = this.namedGroup(turbineHall, 'Coal turbine');
    turbine.position.set(-0.68, 0.54, 0.73);
    const turbineRim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.045, 6, 18), this.metal);
    turbineRim.name = 'Coal turbine rotor';
    turbine.add(turbineRim);
    machine.rotor = turbine;

    const coalYard = this.namedGroup(station, 'Coal yard');
    coalYard.position.set(-0.72, 0, -0.46);
    for (const x of [-0.24, 0.16]) {
      const pile = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.38, 10), this.coal);
      pile.name = 'Coal stockpile';
      pile.position.set(x, 0.19, 0);
      coalYard.add(pile);
    }

    const conveyor = this.namedGroup(station, 'Coal conveyor');
    const belt = this.box(conveyor, -0.32, 0.72, -0.34, 1.0, 0.09, 0.18, this.darkMetal, 'Coal conveyor belt');
    belt.rotation.z = 0.42;
    for (const x of [-0.65, -0.25]) this.box(conveyor, x, 0.38, -0.34, 0.05, 0.68, 0.05, this.metal, 'Coal conveyor support');

    for (const [index, x] of [[0, 0.7], [1, 1.0]] as const) {
      this.cylinder(station, x, 1.35, -0.24, 0.11, 0.18, 2.5, this.brick, `Coal stack ${index === 0 ? 'A' : 'B'}`);
      machine.plumes.push(this.plume(station, x, 2.62, this.smoke, `Coal stack plume ${index === 0 ? 'A' : 'B'}`));
    }
  }

  private drawGasPlant(root: THREE.Group, machine: EnergyMachineVisual): void {
    const station = this.namedGroup(root, 'Gas turbine station');
    this.building(station, 'Gas turbine hall', 1.55, 0.9, -0.22);

    const train = this.namedGroup(station, 'Gas turbine train');
    train.position.set(-0.25, 0.48, 0.48);
    for (let i = 0; i < 3; i++) {
      this.horizontalCylinder(train, (i - 1) * 0.34, 0, 0, 0.18 - i * 0.025, 0.4, this.darkMetal, 'Gas turbine casing');
    }
    const rotor = this.namedGroup(train, 'Gas turbine rotor');
    const rotorRing = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.04, 6, 18), this.metal);
    rotorRing.name = 'Gas turbine rotor ring';
    rotor.add(rotorRing);
    rotor.position.set(0.52, 0, 0);
    machine.rotor = rotor;

    const manifold = this.namedGroup(station, 'Gas pipe manifold');
    for (const z of [-0.34, 0.34]) {
      const pipe = this.horizontalCylinder(manifold, 0.52, 0.36, z, 0.045, 0.78, this.copper, 'Gas supply pipe');
      pipe.rotation.z = Math.PI / 2;
    }
    for (const x of [0.28, 0.55, 0.82]) this.cylinder(manifold, x, 0.45, -0.34, 0.035, 0.035, 0.36, this.copper, 'Gas manifold riser');

    this.cylinder(station, 0.72, 1.25, 0.18, 0.1, 0.14, 2.2, this.metal, 'Gas exhaust stack');
    machine.plumes.push(this.plume(station, 0.72, 2.38, this.exhaust, 'Gas clean exhaust'));
  }

  private drawBatteryBank(
    settlement: SimulationState['settlements'][number],
    height: (x: number, z: number) => number,
    node?: GridNode,
    physical = false,
  ): void {
    if (physical && (!node || node.retired || node.progress <= 0)) return;
    const bank = new THREE.Group();
    bank.name = `Battery bank:${settlement.id}`;
    const position = node?.position ?? settlement.position;
    bank.position.set(position.x, height(position.x, position.z), position.z);
    this.group.add(bank);
    const capacity = settlement.energy!.storageCapacity;
    const condition = settlement.energy!.storageState?.condition ?? 1;
    const usable = Math.max(0.001, capacity * Math.max(0.55, condition));
    const charge = Math.max(0, Math.min(1, settlement.energy!.storage / usable));
    const units = Math.max(1, Math.min(6, Math.ceil(capacity / 32)));
    for (let i = 0; i < units; i++) {
      const x = (i - (units - 1) / 2) * 0.42;
      this.box(bank, x, 0.27, 0, 0.34, 0.54, 0.34, this.metal, 'Battery cabinet');
      const fill = Math.max(0.03, charge * 0.42);
      this.box(bank, x, 0.08 + fill / 2, 0.19, 0.25, fill, 0.035, this.panel, 'Battery charge indicator');
    }
    this.box(bank, 0, 0.12, -0.28, Math.max(0.5, units * 0.3), 0.24, 0.18, this.concrete, 'Battery service cabinet');
  }

  private plume(root: THREE.Group, x: number, y: number, material: THREE.Material, name: string): THREE.Group {
    const plume = new THREE.Group();
    plume.name = name;
    plume.position.set(x, y, 0);
    root.add(plume);
    for (let i = 0; i < 5; i++) plume.add(new THREE.Mesh(new THREE.SphereGeometry(0.4, 6, 4), material));
    return plume;
  }

  private drawGridNode(node: GridNode, state: SimulationState, height: (x: number, z: number) => number): void {
    if (node.retired || node.progress <= 0) return;
    const root = this.namedGroup(this.group, `Grid ${node.kind}:${node.id}`);
    root.userData.gridNodeId = node.id;
    root.userData.condition = node.condition;
    root.position.set(node.position.x, height(node.position.x, node.position.z), node.position.z);
    const large = node.kind === 'substation' || node.kind === 'switchyard';
    const radius = node.radius;
    this.box(root, 0, 0.04, 0, radius * 1.6, 0.08, radius * 1.6, this.brick, 'Grid equipment footing');
    if (node.progress < 1) {
      this.box(root, 0, 0.18, 0, radius, 0.12 + node.progress * 0.35, radius, this.wood, 'Grid equipment under construction');
      for (const side of [-1, 1]) this.box(root, side * radius * 0.7, 0.32, 0, 0.04, 0.64, 0.04, this.wood, 'Survey stake');
      return;
    }
    if (large && node.capacity < 100) {
      this.box(root, 0, 0.45, 0, 0.38, 0.6, 0.3, this.metal, 'Early grid transformer');
      for (const side of [-1, 1]) {
        this.box(root, side * 0.28, 0.55, 0, 0.06, 1.1, 0.06, this.wood, 'Improvised switch frame');
        this.cylinder(root, side * 0.15, 0.85, 0, 0.035, 0.05, 0.22, this.concrete, 'Early grid insulator');
      }
      this.box(root, 0, 1.1, 0, 0.65, 0.04, 0.04, this.copper, 'Early grid bus');
    } else if (large) {
      // Timber fencing, masonry footings and local colours continue the settlement's craft palette.
      for (const side of [-1, 1]) {
        for (const x of [-0.65, 0, 0.65]) this.box(root, x, 0.25, side * 0.65, 0.045, 0.5, 0.045, this.wood, 'Grid fence post');
        this.box(root, 0, 0.3, side * 0.65, 1.35, 0.05, 0.035, this.wood, 'Grid precinct fence');
        this.box(root, side * 0.65, 0.3, 0, 0.035, 0.05, 1.3, this.wood, 'Grid precinct fence');
      }
      this.box(root, -0.22, 0.35, 0, 0.45, 0.55, 0.5, this.metal, 'Grid transformer tank');
      for (let i = 0; i < 5; i++) this.box(root, -0.48, 0.35, -0.2 + i * 0.1, 0.07, 0.4, 0.03, this.darkMetal, 'Transformer cooling fin');
      for (let i = 0; i < 3; i++) {
        this.cylinder(root, -0.36 + i * 0.14, 0.72, 0, 0.04, 0.055, 0.23, this.concrete, 'Grid porcelain insulator');
        this.box(root, 0.28, 0.58, -0.25 + i * 0.25, 0.06, 0.95, 0.06, this.metal, 'Switchyard rack');
        this.box(root, 0.05, 0.94, -0.25 + i * 0.25, 0.7, 0.035, 0.035, this.copper, 'Grid buswork');
      }
      const culture = state.cultures.find(c => c.id === node.cultureId);
      const insignia = new THREE.MeshStandardMaterial({ color: culture?.style.accent ?? '#a96843', roughness: 0.85 });
      this.equipmentMaterials.push(insignia);
      this.box(root, 0, 0.38, 0.68, 0.3, 0.12, 0.025,
        insignia, 'Local craft insignia');
    } else if (node.kind === 'transformer') {
      this.box(root, 0, 0.9, 0, 0.07, 1.8, 0.07, this.wood, 'Transformer pole');
      this.cylinder(root, 0.14, 0.95, 0, 0.13, 0.13, 0.4, this.metal, 'Local transformer');
      for (const x of [0.07, 0.2]) this.cylinder(root, x, 1.22, 0, 0.025, 0.035, 0.14, this.concrete, 'Transformer insulator');
    } else if (node.kind !== 'storage') {
      const terminal = this.terminals.get(node.id) ?? 0.95;
      this.box(root, 0, terminal / 2, 0, 0.065, terminal, 0.065, this.wood, 'Electrical terminal support');
      this.box(root, 0, terminal - 0.15, 0, 0.24, 0.16, 0.12, this.metal, node.kind === 'service' ? 'Service cutout' : 'Connection bus');
      this.cylinder(root, 0, terminal, 0, 0.03, 0.045, 0.15, this.concrete, 'Terminal insulator');
    }
    if ((this.terminals.get(node.id) ?? 0) > 2) {
      for (const side of [-1, 1]) this.box(root, side * 0.5, 1.4, 0, 0.07, 2.8, 0.07, this.metal, 'Transmission entry gantry');
      this.box(root, 0, 2.8, 0, 1.1, 0.06, 0.06, this.metal, 'Transmission entry crossarm');
      this.box(root, 0.25, 1.85, 0, 0.025, 1.9, 0.025, this.copper, 'Switchyard incoming conductor');
    }
    if (node.condition < 0.5) {
      this.box(root, 0, 0.18, radius * 0.55, radius, 0.1, 0.1, this.coal, 'Damaged grid equipment');
    }
    const indicator = new THREE.MeshStandardMaterial({ color: '#594b32',
      emissive: node.flow > 0 && node.condition > 0.25 ? '#ffbf59' : '#000000', emissiveIntensity: 0.7 });
    this.equipmentMaterials.push(indicator);
    this.box(root, radius * 0.4, 0.35, radius * 0.4, 0.05, 0.06, 0.035, indicator, 'Metered grid service indicator');
    if (node.attachment && node.condition > 0.25) {
      const cable = new THREE.Line(new THREE.BufferGeometry().setFromPoints(node.attachment.map(p =>
        new THREE.Vector3(p.x, height(p.x, p.z) + 0.85, p.z))), this.wire);
      cable.name = `${node.kind === 'plant-bus' ? 'Plant grid lead' : 'Building service lead'}:${node.id}`;
      this.group.add(cable);
    }
  }

  private drawLine(line: PowerLine, height: (x: number, z: number) => number): void {
    if (line.progress > 0 && line.progress < 1 && line.points.length >= 2) {
      const work = line.progress * (line.points.length - 1), index = Math.floor(work), fraction = work - index;
      const a = line.points[index]!, b = line.points[index + 1]!;
      const x = a.x + (b.x - a.x) * fraction, z = a.z + (b.z - a.z) * fraction;
      const site = this.namedGroup(this.group, `Grid wire construction:${line.id}`);
      site.position.set(x, height(x, z), z);
      this.box(site, 0, 0.06, 0, 0.3, 0.12, 0.12, this.wood, 'Staged grid timber');
      this.cylinder(site, 0.15, 0.16, 0, 0.09, 0.09, 0.14, this.copper, 'Construction wire reel');
    }
    const count = Math.floor(line.points.length * line.progress);
    const points = line.points.slice(0, count);
    const regional = line.class ? line.class === 'transmission' : line.capacity > 80;
    const poleHeight = regional ? 4.2 : line.class === 'service' ? 1.2 : 1.8;
    const terminalHeight = (i: number): number => i === 0 ? this.terminals.get(line.from) ?? poleHeight
      : i === line.points.length - 1 ? this.terminals.get(line.to) ?? poleHeight : poleHeight;
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      if (i === 0 && this.terminals.has(line.from) || i === line.points.length - 1 && this.terminals.has(line.to)) continue;
      const supportKey = `${p.x.toFixed(4)}:${p.z.toFixed(4)}:${line.class}`;
      if (this.supports.has(supportKey)) continue;
      this.supports.add(supportKey);
      const root = new THREE.Group();
      root.name = `${regional ? 'Transmission tower' : line.class === 'service' ? 'Service support' : 'Distribution pole'}:${line.id}`;
      root.position.set(p.x, height(p.x, p.z), p.z);
      if (line.condition < 0.5) root.rotation.z = (0.5 - line.condition) * 0.35;
      this.group.add(root);
      this.box(root, 0, poleHeight / 2, 0, regional ? 0.14 : 0.07, poleHeight, regional ? 0.14 : 0.07,
        regional ? this.metal : this.wood);
      this.box(root, 0, poleHeight, 0, 0.55, 0.07, 0.07, this.metal);
      if (regional) {
        for (const side of [-1, 1]) {
          const leg = this.box(root, side * 0.2, poleHeight / 2, 0, 0.06, poleHeight, 0.06, this.metal);
          leg.rotation.z = side * 0.12;
        }
      }
    }
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      for (const offset of [-0.22, 0.22]) {
        const vertices: THREE.Vector3[] = [];
        for (let k = 0; k <= 8; k++) {
          const t = k / 8;
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          const y = Math.max(
            height(x, z) + 0.7,
            (height(a.x, a.z) + terminalHeight(i - 1)) * (1 - t) + (height(b.x, b.z) + terminalHeight(i)) * t - Math.sin(t * Math.PI) * 0.15,
          );
          vertices.push(new THREE.Vector3(x + offset, y, z));
        }
        if (line.condition > 0.25) this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(vertices), this.wire));
      }
    }

  }

  dispose(): void {
    this.clear();
    if (this.ownsAssets) this.assets.dispose();
    [
      this.metal, this.darkMetal, this.wood, this.concrete, this.brick, this.copper, this.coal, this.panel,
      this.wire, this.steam, this.smoke, this.exhaust,
    ].forEach(m => m.dispose());
  }
}
