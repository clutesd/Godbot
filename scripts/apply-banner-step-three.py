from pathlib import Path

path = Path('src/render/GodboxRenderer.ts')
text = path.read_text()

import_anchor = "import { generateBannerIdentity, type BannerIdentity } from './style/BannerIdentity';\n"
import_line = "import { deriveBannerLegacy, type BannerLegacy } from './style/BannerLegacy';\n"
if import_line not in text:
    if import_anchor not in text:
        raise SystemExit('banner identity import anchor not found')
    text = text.replace(import_anchor, import_anchor + import_line, 1)

signature_old = "      return `${settlement.id}:${settlement.alive ? settlement.buildings : 0}:${settlement.institutionIds.length}:${routeCount}:${politySize}:${this.bannerIdentityForSettlement(settlement).id}:${this.developmentSignature(settlement)}:${this.constructionSignature(settlement.id)}`;"
signature_new = "      return `${settlement.id}:${settlement.alive ? settlement.buildings : 0}:${settlement.institutionIds.length}:${routeCount}:${politySize}:${this.bannerSignatureForSettlement(settlement)}:${this.developmentSignature(settlement)}:${this.constructionSignature(settlement.id)}`;"
if signature_new not in text:
    if signature_old not in text:
        raise SystemExit('settlement signature anchor not found')
    text = text.replace(signature_old, signature_new, 1)

compare_old = "      const bannerSignature = this.bannerIdentityForSettlement(settlement).id;"
compare_new = "      const bannerSignature = this.bannerSignatureForSettlement(settlement);"
if compare_new not in text:
    if compare_old not in text:
        raise SystemExit('banner comparison signature anchor not found')
    text = text.replace(compare_old, compare_new, 1)

create_old = "    const culture = this.dominantCulture(settlement);\n    const bannerIdentity = this.bannerIdentityForSettlement(settlement, culture);\n    const era = this.eraForSettlement(settlement);"
create_new = "    const culture = this.dominantCulture(settlement);\n    const era = this.eraForSettlement(settlement);\n    const bannerIdentity = this.bannerIdentityForSettlement(settlement, culture);"
if create_new not in text:
    if create_old not in text:
        raise SystemExit('settlement visual culture anchor not found')
    text = text.replace(create_old, create_new, 1)

layout_old = "    const layout = this.layoutForSettlement(settlement, era);\n    const hasActiveConstruction"
layout_new = "    const layout = this.layoutForSettlement(settlement, era);\n    const bannerLegacy = this.bannerLegacyForSettlement(settlement, bannerIdentity, culture, era, layout);\n    const hasActiveConstruction"
if layout_new not in text:
    if layout_old not in text:
        raise SystemExit('settlement visual layout anchor not found')
    text = text.replace(layout_old, layout_new, 1)

call_old = "    if (settlement.alive) this.addBanner(group, bannerIdentity, settlement.institutionIds.length);"
call_new = "    if (settlement.alive) this.addBanner(group, settlement, layout, bannerIdentity, bannerLegacy, settlement.institutionIds.length);"
if call_new not in text:
    if call_old not in text:
        raise SystemExit('banner render call anchor not found')
    text = text.replace(call_old, call_new, 1)

return_old = "    return { group, buildingCount: settlement.buildings, institutionCount: settlement.institutionIds.length, routeCount, politySize, bannerSignature: bannerIdentity.id, developmentSignature: this.developmentSignature(settlement), constructionSignature: this.constructionSignature(settlement.id), powerLevel: settlement.infrastructure.power, lights, smokeSources };"
return_new = "    return { group, buildingCount: settlement.buildings, institutionCount: settlement.institutionIds.length, routeCount, politySize, bannerSignature: `${bannerIdentity.id}:${bannerLegacy.id}`, developmentSignature: this.developmentSignature(settlement), constructionSignature: this.constructionSignature(settlement.id), powerLevel: settlement.infrastructure.power, lights, smokeSources };"
if return_new not in text:
    if return_old not in text:
        raise SystemExit('settlement visual return anchor not found')
    text = text.replace(return_old, return_new, 1)

replacement = r'''  /**
   * Estimate the visual tradition present when a settlement was founded. Structure origins are
   * retained by the development model, so old communities keep old banner silhouettes even when
   * the surrounding city industrialises. Legacy/custom fixtures fall back to their current era.
   */
  private bannerFoundingEra(settlement: Settlement): Era {
    const advancedTransition = this.state.advanced.transitionMonth;
    if (advancedTransition !== undefined && settlement.foundedMonth >= advancedTransition) return 'advanced';
    const earliest = [...(settlement.structurePlots ?? [])]
      .filter(plot => plot.development?.origin)
      .sort((a, b) => a.foundedMonth - b.foundedMonth || a.id.localeCompare(b.id))[0];
    const origin = earliest?.development?.origin;
    if (!origin?.material) return this.eraForSettlement(settlement);
    const level = origin.level ?? 1;
    switch (origin.material) {
      case 'earth': return level >= 2 ? 'early' : 'primitive';
      case 'timber': return level >= 2 ? 'village' : 'early';
      case 'masonry': return level >= 2 ? 'preIndustrial' : 'village';
      case 'ceramic': return 'preIndustrial';
      case 'metal': return 'industrial';
      default: return this.eraForSettlement(settlement);
    }
  }

  /** Derive the founding heraldry from geography, institutions, culture and lineage. */
  private bannerIdentityForSettlement(settlement: Settlement, culture = this.dominantCulture(settlement)): BannerIdentity {
    const cell = this.state.world.cells[settlement.cellIndex];
    const institutionIds = new Set(settlement.institutionIds);
    const institutions = this.state.institutions
      .filter(institution => institutionIds.has(institution.id))
      .map(institution => ({ kind: institution.kind, support: institution.support, prestige: institution.prestige }));
    const polity = this.state.polities.find(candidate => candidate.id === settlement.polityId);
    const activeTradeRoutes = this.state.tradeRoutes.filter(route => route.active && (route.a === settlement.id || route.b === settlement.id)).length;
    return generateBannerIdentity({
      seed: this.config.seed,
      settlementId: settlement.id,
      specialization: settlement.specialization,
      biome: cell?.biome ?? 'grassland',
      river: cell?.river ?? false,
      lake: cell?.lake ?? false,
      coast: cell?.coast ?? false,
      foundingEra: this.bannerFoundingEra(settlement),
      culture,
      institutions,
      polity: polity ? {
        id: polity.id,
        arrangement: polity.arrangement,
        dynastyName: polity.dynastyName,
        dynastyHouseholdId: polity.dynastyHouseholdId,
      } : undefined,
      activeTradeRoutes,
    });
  }

  /** Historical layer: the same people keep a recognizable standard, but history leaves marks. */
  private bannerLegacyForSettlement(
    settlement: Settlement,
    identity: BannerIdentity,
    culture = this.dominantCulture(settlement),
    era = this.eraForSettlement(settlement),
    layout = this.layoutForSettlement(settlement, era),
  ): BannerLegacy {
    const institutionIds = new Set(settlement.institutionIds);
    const institutions = this.state.institutions
      .filter(institution => institutionIds.has(institution.id))
      .map(institution => ({ kind: institution.kind, support: institution.support, prestige: institution.prestige }));
    const polity = this.state.polities.find(candidate => candidate.id === settlement.polityId);
    return deriveBannerLegacy({
      currentMonth: this.state.month,
      foundedMonth: settlement.foundedMonth,
      settlementId: settlement.id,
      polityId: settlement.polityId,
      cultureId: culture?.id,
      currentEra: era,
      specialization: settlement.specialization,
      prosperity: settlement.prosperity,
      crisisMonths: settlement.crisisMonths,
      conflictPressure: settlement.conflictPressure,
      successionCount: polity?.successionCount ?? 0,
      isCapital: polity?.capitalId === settlement.id,
      institutions,
      identity,
      history: this.state.history,
      hasLandGate: layout.portals.some(portal => portal.kind === 'gate'),
      hasAnyPortal: layout.portals.length > 0,
    });
  }

  private bannerSignatureForSettlement(settlement: Settlement): string {
    const culture = this.dominantCulture(settlement);
    const era = this.eraForSettlement(settlement);
    const layout = this.layoutForSettlement(settlement, era);
    const identity = this.bannerIdentityForSettlement(settlement, culture);
    const legacy = this.bannerLegacyForSettlement(settlement, identity, culture, era, layout);
    // Bucket slow wear/prestige values so settlements do not rebuild for meaningless tiny changes.
    const wearBucket = Math.round(legacy.wear * 20) / 20;
    const prestigeBucket = Math.round(legacy.prestigeTrim * 10) / 10;
    return `${identity.id}:${legacy.site}:${legacy.mount}:${legacy.generation}:${legacy.politicalBands}:${legacy.culturalMarks}:${legacy.successionMarks}:${legacy.allianceKnots}:${wearBucket}:${legacy.repairPatches}:${Number(legacy.mourning)}:${prestigeBucket}:${legacy.fieldVariant}:${legacy.emblemVariant}:${legacy.latestChangeMonth ?? -1}`;
  }

  /**
   * A standard belongs somewhere. Camps put it near the hearth; mature societies put it where
   * authority actually lives — civic court, temple precinct, market approach or defended gate.
   */
  private bannerPlacementForSettlement(settlement: Settlement, layout: SettlementLayoutPlan, legacy: BannerLegacy): { localX: number; localY: number; localZ: number; rotationY: number } {
    const phase = stableUnit(`${this.config.seed}:${settlement.id}:banner:${legacy.site}`) * Math.PI * 2;
    let localX = Math.cos(phase) * 1.05;
    let localZ = Math.sin(phase) * 1.05;

    const offsetAnchor = (anchor: SettlementLayoutPlan['anchors']['civic'], scale: number, lateral: number): void => {
      const angle = Math.abs(anchor.localX) + Math.abs(anchor.localZ) > 0.01 ? Math.atan2(anchor.localZ, anchor.localX) : phase;
      localX = anchor.localX * scale + Math.cos(angle + Math.PI / 2) * lateral;
      localZ = anchor.localZ * scale + Math.sin(angle + Math.PI / 2) * lateral;
    };

    if (legacy.site === 'civic') {
      const anchor = layout.anchors.civic;
      localX = anchor.localX + Math.cos(phase) * Math.min(1.35, anchor.radius * 0.7);
      localZ = anchor.localZ + Math.sin(phase) * Math.min(1.35, anchor.radius * 0.7);
    } else if (legacy.site === 'sacred') {
      offsetAnchor(layout.anchors.sacred, 0.84, 0.5);
    } else if (legacy.site === 'market') {
      offsetAnchor(layout.anchors.market, 0.82, 0.55);
    } else if (legacy.site === 'gate') {
      const portal = [...layout.portals].filter(candidate => candidate.kind === 'gate').sort((a, b) => a.routeId.localeCompare(b.routeId))[0];
      if (portal) {
        const angle = Math.atan2(portal.localZ, portal.localX);
        localX = portal.localX * 0.86 + Math.cos(angle + Math.PI / 2) * 0.42;
        localZ = portal.localZ * 0.86 + Math.sin(angle + Math.PI / 2) * 0.42;
      }
    }

    const settlementY = this.elevationAt(settlement.position.x, settlement.position.z);
    const resolve = (x: number, z: number): { localX: number; localY: number; localZ: number; rotationY: number } | undefined => {
      const worldX = settlement.position.x + x;
      const worldZ = settlement.position.z + z;
      const terrain = this.terrainQueries.queryTerrainAt(worldX, worldZ);
      if (!terrain || terrain.water || terrain.maxSlope > 28) return undefined;
      return {
        localX: x,
        localY: this.elevationAt(worldX, worldZ) - settlementY,
        localZ: z,
        rotationY: Math.atan2(-x, -z),
      };
    };

    return resolve(localX, localZ)
      ?? resolve(Math.cos(phase) * 1.15, Math.sin(phase) * 1.15)
      ?? { localX: -0.8, localY: 0, localZ: 0.15, rotationY: 0 };
  }

  private bannerMountDimensions(legacy: BannerLegacy): { width: number; height: number; poleHeight: number; topY: number; crossbar: boolean } {
    switch (legacy.mount) {
      case 'processional': return { width: 0.48, height: 1.82, poleHeight: 3.2, topY: 2.82, crossbar: true };
      case 'gonfalon': return { width: 0.78, height: 1.88, poleHeight: 3.65, topY: 3.12, crossbar: true };
      case 'market-standard': return { width: 0.62, height: 1.5, poleHeight: 3.25, topY: 2.82, crossbar: true };
      case 'pennon': return { width: 1.02, height: 0.92, poleHeight: 3.45, topY: 3.02, crossbar: false };
      case 'civic-standard':
      default: return { width: 0.72, height: 1.74, poleHeight: 3.72, topY: 3.18, crossbar: true };
    }
  }

  /**
   * Final banner presentation. Settlements no longer share one pole/shape/location: mount style,
   * site, field revisions, wear, repairs and ceremonial finish all carry simulation meaning.
   */
  private addBanner(
    group: THREE.Group,
    settlement: Settlement,
    layout: SettlementLayoutPlan,
    identity: BannerIdentity,
    legacy: BannerLegacy,
    institutionCount: number,
  ): void {
    const shapeSeed = stableUnit(`${identity.id}:${legacy.id}:standard-shape`);
    const standard = new THREE.Group();
    standard.name = 'settlement-standard';
    const placement = this.bannerPlacementForSettlement(settlement, layout, legacy);
    standard.position.set(placement.localX, placement.localY, placement.localZ);
    standard.rotation.y = placement.rotationY;
    standard.userData['bannerIdentity'] = identity;
    standard.userData['bannerLegacy'] = legacy;
    standard.userData['bannerSite'] = legacy.site;

    const mute = (value: THREE.ColorRepresentation, saturation: number, minimumLightness: number, maximumLightness: number, lightnessScale = 1): THREE.Color => {
      const color = new THREE.Color(value);
      const hsl = { h: 0, s: 0, l: 0 };
      color.getHSL(hsl);
      color.setHSL(
        hsl.h,
        Math.min(hsl.s, saturation),
        THREE.MathUtils.clamp(hsl.l * lightnessScale, minimumLightness, maximumLightness),
      );
      return color;
    };

    const clothColor = mute(identity.primary, 0.42, 0.18, 0.46, 0.8).lerp(new THREE.Color('#756c61'), legacy.wear * 0.22);
    const secondaryColor = mute(identity.secondary, 0.34, 0.18, 0.44, 0.9).lerp(new THREE.Color('#6f685f'), legacy.wear * 0.16);
    const accentColor = mute(identity.accent, 0.38, 0.46, 0.7);
    accentColor.lerp(new THREE.Color('#d6ccb5'), 0.16 + legacy.wear * 0.08);

    const dimensions = this.bannerMountDimensions(legacy);
    const { width, height, poleHeight, topY } = dimensions;
    const wood = new THREE.MeshStandardMaterial({ color: '#3c2d27', roughness: 0.98, metalness: 0 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.055, poleHeight, 7), wood);
    pole.position.y = poleHeight / 2;
    pole.castShadow = true;
    standard.add(pole);

    if (dimensions.crossbar) {
      const crossbarLength = width + 0.14;
      const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, crossbarLength, 7), wood);
      crossbar.rotation.z = Math.PI / 2;
      crossbar.position.set(crossbarLength / 2 - 0.015, topY + 0.015, 0);
      crossbar.castShadow = true;
      standard.add(crossbar);
    } else {
      // Gate pennons are lashed to the pole instead of hanging from a civic crossbar.
      for (const y of [topY - 0.08, topY - height * 0.72]) {
        const tie = new THREE.Mesh(new THREE.TorusGeometry(0.047, 0.012, 5, 8), new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.95 }));
        tie.rotation.x = Math.PI / 2;
        tie.position.set(0.015, y, 0);
        standard.add(tie);
      }
    }

    const finialMaterial = legacy.prestigeTrim >= 0.62
      ? new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.72, metalness: 0.12 })
      : wood;
    const finial = legacy.site === 'sacred'
      ? new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), finialMaterial)
      : new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.18, 6), finialMaterial);
    finial.position.y = poleHeight + 0.09;
    finial.castShadow = true;
    standard.add(finial);

    const clothGeometry = new THREE.PlaneGeometry(width, height, 7, 11);
    const positions = clothGeometry.attributes.position as THREE.BufferAttribute;
    const silhouette = legacy.mount === 'pennon' && identity.shape === 'straight' ? 'pointed' : identity.shape;
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const across = THREE.MathUtils.clamp((x + width / 2) / width, 0, 1);
      const down = THREE.MathUtils.clamp((height / 2 - y) / height, 0, 1);
      let shapedY = y;
      let shapedX = x;

      if (legacy.mount === 'pennon') {
        const taper = 1 - across * 0.72;
        shapedY = y * taper - height * across * 0.08;
        shapedX += across * width * 0.035;
      } else if (down > 0.995) {
        if (silhouette === 'pointed') {
          shapedY += Math.abs(across - 0.5) * 0.34;
        } else if (silhouette === 'swallowtail') {
          shapedY += (1 - Math.abs(across - 0.5) * 2) * 0.24;
        } else if (silhouette === 'stepped') {
          shapedY += across < 0.25 || across > 0.75 ? 0.17 : across < 0.42 || across > 0.58 ? 0.08 : 0;
        } else if (silhouette === 'ragged') {
          const tooth = stableUnit(`${identity.id}:rag:${Math.round(across * 7)}`);
          shapedY += 0.03 + tooth * 0.14;
        }
      }

      if (down > 0.82 && legacy.wear > 0.08) {
        const wearNoise = stableUnit(`${identity.id}:${legacy.generation}:wear:${Math.round(across * 9)}`);
        shapedY += wearNoise * legacy.wear * 0.15 * (down - 0.82) / 0.18;
      }
      if (across > 0.92 && legacy.wear > 0.18) {
        shapedX -= stableUnit(`${identity.id}:edge:${Math.round(down * 10)}`) * legacy.wear * 0.045;
      }

      shapedY -= 0.035 * across * across * (0.35 + down * 0.65);
      positions.setX(index, shapedX);
      positions.setY(index, shapedY);
      positions.setZ(index,
        0.044 * across * Math.sin(down * Math.PI * 2.2 + shapeSeed * Math.PI * 2)
        + 0.015 * across * Math.sin(down * Math.PI * 5.1 + shapeSeed * Math.PI),
      );
    }
    positions.needsUpdate = true;
    clothGeometry.computeVertexNormals();

    const clothRig = new THREE.Group();
    clothRig.position.y = topY;
    clothRig.userData['windPhase'] = shapeSeed * Math.PI * 2;
    clothRig.userData['windStrength'] = 0.03 + stableUnit(`${identity.id}:${legacy.mount}:wind`) * 0.04;

    const cloth = new THREE.Mesh(clothGeometry, new THREE.MeshStandardMaterial({
      color: clothColor,
      side: THREE.DoubleSide,
      roughness: 0.97,
      metalness: 0,
    }));
    cloth.position.set(width / 2 + 0.045, -height / 2, 0.018);
    cloth.castShadow = true;
    clothRig.add(cloth);

    this.addBannerFieldPattern(clothRig, identity, legacy, width, height, secondaryColor);
    const emblemMaterial = new THREE.MeshStandardMaterial({ color: accentColor, side: THREE.DoubleSide, roughness: 0.92, metalness: 0 });
    const emblem = this.createBannerEmblem(identity, legacy.emblemVariant, emblemMaterial);
    const emblemX = legacy.mount === 'pennon' ? width * 0.32 + 0.045 : width * (0.47 + legacy.emblemVariant * 0.02) + 0.045;
    const emblemY = legacy.mount === 'pennon' ? -height * 0.42 : -height * 0.48;
    emblem.position.set(emblemX, emblemY, 0.095);
    emblem.scale.setScalar(legacy.mount === 'pennon' ? 0.72 : 0.92 - legacy.emblemVariant * 0.035);
    clothRig.add(emblem);

    const houseMaterial = new THREE.MeshStandardMaterial({ color: accentColor, side: THREE.DoubleSide, roughness: 0.96 });
    const houseMarks = Math.min(4, identity.lineageMarks + Math.ceil(legacy.successionMarks / 2));
    for (let index = 0; index < houseMarks; index += 1) {
      const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.032, 0.15 + index * 0.012), houseMaterial);
      mark.position.set(0.105 + index * 0.047, -0.15, 0.105);
      mark.rotation.z = index % 2 === 0 ? -0.08 : 0.08;
      clothRig.add(mark);
    }

    this.addBannerLegacyDetails(clothRig, identity, legacy, width, height, clothColor, secondaryColor, accentColor);

    for (let index = 0; index < Math.min(2, institutionCount); index += 1) {
      const tassel = new THREE.Mesh(
        new THREE.PlaneGeometry(0.05, 0.3 + index * 0.055),
        new THREE.MeshStandardMaterial({ color: index === 0 ? accentColor : secondaryColor, side: THREE.DoubleSide, roughness: 0.98 }),
      );
      tassel.position.set(0.1 + index * 0.075, -0.2 - index * 0.025, -0.005);
      tassel.rotation.z = -0.04 - index * 0.035;
      clothRig.add(tassel);
    }

    standard.add(clothRig);
    group.add(standard);
    group.userData['bannerClothRig'] = clothRig;
    group.userData['bannerIdentity'] = identity;
    group.userData['bannerLegacy'] = legacy;
    group.userData['bannerSite'] = legacy.site;
    group.userData['bannerMeaning'] = [...identity.rationale, ...legacy.rationale];
  }

  /** Heraldic field geometry kept deliberately low-poly and inside the chosen mount silhouette. */
  private addBannerFieldPattern(group: THREE.Group, identity: BannerIdentity, legacy: BannerLegacy, width: number, height: number, color: THREE.Color): void {
    if (identity.fieldPattern === 'solid') return;
    const material = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.98, metalness: 0 });
    const addPanel = (panelWidth: number, panelHeight: number, x: number, y: number, rotation = 0): void => {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(panelWidth, panelHeight), material);
      panel.position.set(x, y, 0.07);
      panel.rotation.z = rotation;
      group.add(panel);
    };
    const left = 0.045;
    const centerX = left + width / 2;
    const variant = legacy.fieldVariant;

    if (legacy.mount === 'pennon') {
      const bandWidth = width * (0.2 + variant * 0.025);
      addPanel(bandWidth, height * 0.72, left + bandWidth * 0.62, -height * 0.48);
      return;
    }
    if (identity.fieldPattern === 'stripe') {
      if (variant % 2 === 0) {
        const stripeWidth = width * (variant >= 2 ? 0.18 : 0.24);
        addPanel(stripeWidth, height * 0.92, centerX + (variant === 2 ? width * 0.16 : 0), -height * 0.5);
      } else {
        const bandHeight = height * (variant === 3 ? 0.14 : 0.2);
        addPanel(width * 0.92, bandHeight, centerX, -height * (variant === 3 ? 0.66 : 0.5));
      }
      return;
    }
    if (identity.fieldPattern === 'split') {
      if (variant % 2 === 0) addPanel(width * 0.47, height * 0.92, left + width * 0.74, -height * 0.5);
      else addPanel(width * 0.92, height * 0.46, centerX, -height * 0.73);
      return;
    }
    if (identity.fieldPattern === 'top-band') {
      addPanel(width * 0.94, height * (0.18 + variant * 0.018), centerX, -height * 0.14);
      return;
    }
    const border = 0.045 + variant * 0.006;
    addPanel(border, height * 0.88, left + border * 0.65, -height * 0.5);
    addPanel(border, height * 0.88, left + width - border * 0.65, -height * 0.5);
    addPanel(width * 0.9, border, centerX, -height * 0.05);
  }

  /** Nine deliberately simple emblem families that remain legible at documentary-camera scale. */
  private createBannerEmblem(identity: BannerIdentity, variant: number, material: THREE.MeshStandardMaterial): THREE.Group {
    const emblem = new THREE.Group();
    const addBar = (width: number, height: number, x: number, y: number, rotation = 0): THREE.Mesh => {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
      bar.position.set(x, y, 0);
      bar.rotation.z = rotation;
      emblem.add(bar);
      return bar;
    };
    const addCircle = (radius: number, x = 0, y = 0, segments = 12): THREE.Mesh => {
      const circle = new THREE.Mesh(new THREE.CircleGeometry(radius, segments), material);
      circle.position.set(x, y, 0);
      emblem.add(circle);
      return circle;
    };

    switch (identity.emblem) {
      case 'sun': {
        addCircle(0.105);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.145, 0.19, 12), material);
        emblem.add(ring);
        for (let index = 0; index < 4; index += 1) addBar(0.035, 0.12, 0, 0, index * Math.PI / 4);
        break;
      }
      case 'tree':
        addBar(0.065, 0.25, 0, -0.07);
        addCircle(0.13, 0, 0.09, 9);
        addCircle(0.09, -0.1, 0.04, 8);
        addCircle(0.09, 0.1, 0.04, 8);
        break;
      case 'river-wave': {
        for (let index = 0; index < 3; index += 1) {
          const wave = new THREE.Mesh(new THREE.TorusGeometry(0.11 + index * 0.025, 0.022, 5, 12, Math.PI * 1.18), material);
          wave.scale.y = 0.48;
          wave.position.set(-0.08 + index * 0.08, -0.08 + index * 0.08, 0);
          wave.rotation.z = index % 2 === 0 ? 0.18 : Math.PI + 0.18;
          emblem.add(wave);
        }
        break;
      }
      case 'mountain': {
        const left = new THREE.Mesh(new THREE.CircleGeometry(0.18, 3), material);
        left.position.set(-0.08, -0.02, 0);
        const right = new THREE.Mesh(new THREE.CircleGeometry(0.145, 3), material);
        right.position.set(0.1, -0.05, 0);
        emblem.add(left, right);
        break;
      }
      case 'antlers':
        addBar(0.045, 0.34, 0, -0.02);
        for (const side of [-1, 1]) {
          addBar(0.035, 0.2, side * 0.08, 0.06, side * 0.58);
          addBar(0.03, 0.15, side * 0.15, 0.13, side * 0.9);
        }
        break;
      case 'eye': {
        const eye = new THREE.Mesh(new THREE.RingGeometry(0.105, 0.19, 16), material);
        eye.scale.y = 0.5;
        emblem.add(eye);
        addCircle(0.055);
        break;
      }
      case 'moon': {
        const moon = new THREE.Mesh(new THREE.RingGeometry(0.11, 0.2, 14, 1, 0.45, Math.PI * 1.45), material);
        moon.rotation.z = variant * 0.18;
        emblem.add(moon);
        break;
      }
      case 'beast': {
        const head = addCircle(0.13, 0, -0.02, 5);
        head.rotation.z = Math.PI / 5;
        const hornLeft = new THREE.Mesh(new THREE.CircleGeometry(0.085, 3), material);
        hornLeft.position.set(-0.12, 0.12, 0);
        hornLeft.rotation.z = -0.35;
        const hornRight = hornLeft.clone();
        hornRight.position.x = 0.12;
        hornRight.rotation.z = 0.35;
        emblem.add(hornLeft, hornRight);
        break;
      }
      case 'rune':
      default:
        addBar(0.045, 0.34, 0, 0);
        addBar(0.04, 0.22, variant % 2 === 0 ? 0.08 : -0.08, 0.06, variant % 2 === 0 ? -0.72 : 0.72);
        addBar(0.04, 0.18, variant >= 2 ? -0.075 : 0.075, -0.08, variant >= 2 ? 0.68 : -0.68);
        break;
    }
    return emblem;
  }

  /** The details are history, not decoration: regime bands, repairs, alliance ties and mourning. */
  private addBannerLegacyDetails(
    group: THREE.Group,
    identity: BannerIdentity,
    legacy: BannerLegacy,
    width: number,
    height: number,
    clothColor: THREE.Color,
    secondaryColor: THREE.Color,
    accentColor: THREE.Color,
  ): void {
    const accent = new THREE.MeshStandardMaterial({ color: accentColor, side: THREE.DoubleSide, roughness: 0.96 });
    const secondary = new THREE.MeshStandardMaterial({ color: secondaryColor, side: THREE.DoubleSide, roughness: 0.98 });
    const dark = new THREE.MeshStandardMaterial({ color: '#211d1b', side: THREE.DoubleSide, roughness: 1, transparent: true, opacity: 0.48 });
    const z = 0.112;

    // Regime changes add restrained revision bands rather than replacing the founding field.
    for (let index = 0; index < legacy.politicalBands; index += 1) {
      const band = new THREE.Mesh(new THREE.PlaneGeometry(width * (0.58 - index * 0.06), 0.025), index % 2 === 0 ? accent : secondary);
      band.position.set(0.045 + width * 0.52, -height * (0.76 - index * 0.07), z);
      group.add(band);
    }

    // Long cultural shifts add small geometric seals around the inherited emblem.
    for (let index = 0; index < legacy.culturalMarks; index += 1) {
      const seal = new THREE.Mesh(new THREE.CircleGeometry(0.035 + index * 0.006, 4), accent);
      seal.rotation.z = Math.PI / 4;
      seal.position.set(0.045 + width * (0.2 + index * 0.1), -height * 0.28, z + 0.003);
      group.add(seal);
    }

    // Alliance ties remain close to the hoist, like cords acquired through diplomacy.
    for (let index = 0; index < legacy.allianceKnots; index += 1) {
      const tie = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.22 + index * 0.035), index % 2 === 0 ? secondary : accent);
      tie.position.set(0.07 + index * 0.045, -0.12 - index * 0.02, z + 0.004);
      tie.rotation.z = -0.14 + index * 0.11;
      group.add(tie);
    }

    // Recovery stays visible as repair cloth; it does not magically restore a pristine flag.
    for (let index = 0; index < legacy.repairPatches; index += 1) {
      const patchColor = clothColor.clone().lerp(secondaryColor, 0.35 + index * 0.12);
      const patchMaterial = new THREE.MeshStandardMaterial({ color: patchColor, side: THREE.DoubleSide, roughness: 1 });
      const patchWidth = width * (0.13 + index * 0.018);
      const patchHeight = height * 0.09;
      const patch = new THREE.Mesh(new THREE.PlaneGeometry(patchWidth, patchHeight), patchMaterial);
      const px = 0.045 + width * (0.68 - index * 0.16);
      const py = -height * (0.62 + index * 0.085);
      patch.position.set(px, py, z + 0.006);
      patch.rotation.z = (index - 1) * 0.09;
      group.add(patch);
      for (const stitchSide of [-1, 1]) {
        const stitch = new THREE.Mesh(new THREE.PlaneGeometry(0.012, patchHeight * 0.82), accent);
        stitch.position.set(px + stitchSide * patchWidth * 0.42, py, z + 0.009);
        group.add(stitch);
      }
    }

    if (legacy.scorch > 0.08) {
      const scorch = new THREE.Mesh(new THREE.CircleGeometry(Math.min(width, height) * (0.09 + legacy.scorch * 0.1), 9), dark);
      scorch.scale.set(1.35, 0.72, 1);
      scorch.position.set(0.045 + width * 0.74, -height * 0.72, z + 0.008);
      group.add(scorch);
    }

    if (legacy.mourning) {
      const streamer = new THREE.Mesh(new THREE.PlaneGeometry(0.045, Math.min(0.68, height * 0.46)), dark);
      streamer.position.set(0.075, -height * 0.28, z + 0.012);
      streamer.rotation.z = -0.08;
      group.add(streamer);
    }

    if (legacy.prestigeTrim >= 0.62 && legacy.mount !== 'pennon') {
      const trimWidth = 0.018 + Math.min(0.012, legacy.prestigeTrim * 0.012);
      const top = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.92, trimWidth), accent);
      top.position.set(0.045 + width / 2, -height * 0.055, z + 0.012);
      const hoist = new THREE.Mesh(new THREE.PlaneGeometry(trimWidth, height * 0.86), accent);
      hoist.position.set(0.065, -height * 0.48, z + 0.012);
      group.add(top, hoist);
    }

    // Keep the meaning inspectable for documentary/camera work without inventing UI labels.
    group.userData['bannerMeaning'] = [...identity.rationale, ...legacy.rationale];
  }

  /** Cheap, restrained wind motion; reduced-motion users get the sculpted resting shape only. */
  private updateSettlementBanners(elapsedSeconds: number): void {
    for (const visual of this.settlementVisuals.values()) {
      const rig = visual.group.userData['bannerClothRig'];
      if (!(rig instanceof THREE.Group)) continue;
      if (this.reducedMotion.matches) {
        rig.rotation.y = 0;
        rig.rotation.z = 0;
        continue;
      }
      const phase = Number(rig.userData['windPhase'] ?? 0);
      const strength = Number(rig.userData['windStrength'] ?? 0.045);
      rig.rotation.y = Math.sin(elapsedSeconds * 0.72 + phase) * strength
        + Math.sin(elapsedSeconds * 0.31 + phase * 1.7) * strength * 0.42;
      rig.rotation.z = Math.sin(elapsedSeconds * 0.49 + phase * 0.6) * strength * 0.12;
    }
  }
'''

start = text.index('  /**\n   * Estimate the visual tradition present when a settlement was founded.')
end = text.index('\n  private addMarket(', start)
text = text[:start] + replacement + text[end:]
path.write_text(text)
