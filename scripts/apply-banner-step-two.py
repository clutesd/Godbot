from pathlib import Path

path = Path('src/render/GodboxRenderer.ts')
text = path.read_text()

import_anchor = "import { CultureStyleProfileFactory } from './style/CultureStyleProfile';\n"
import_line = "import { generateBannerIdentity, type BannerIdentity } from './style/BannerIdentity';\n"
if import_line not in text:
    if import_anchor not in text:
        raise SystemExit('culture style import anchor not found')
    text = text.replace(import_anchor, import_anchor + import_line, 1)

interface_anchor = "  powerLevel: number;\n  lights: SettlementLightEntry[];"
interface_replacement = "  powerLevel: number;\n  bannerSignature: string;\n  lights: SettlementLightEntry[];"
if interface_replacement not in text:
    if interface_anchor not in text:
        raise SystemExit('settlement visual interface anchor not found')
    text = text.replace(interface_anchor, interface_replacement, 1)

signature_old = "      return `${settlement.id}:${settlement.alive ? settlement.buildings : 0}:${settlement.institutionIds.length}:${routeCount}:${politySize}:${this.developmentSignature(settlement)}:${this.constructionSignature(settlement.id)}`;"
signature_new = "      return `${settlement.id}:${settlement.alive ? settlement.buildings : 0}:${settlement.institutionIds.length}:${routeCount}:${politySize}:${this.bannerIdentityForSettlement(settlement).id}:${this.developmentSignature(settlement)}:${this.constructionSignature(settlement.id)}`;"
if signature_new not in text:
    if signature_old not in text:
        raise SystemExit('settlement signature anchor not found')
    text = text.replace(signature_old, signature_new, 1)

compare_old = "      const constructionSignature = this.constructionSignature(settlement.id);\n      const event = this.visualStateResolver.trackEntity(settlement.id, 'settlement', { infrastructure: settlement.infrastructure, buildings: settlement.buildings, alive: settlement.alive }, this.state.month);\n      if (event?.kind === 'infrastructure-added') this.transitionTimeline.createBuildingUpgrade(settlement.id, 0, 1, event.associatedData);\n      if (existing && existing.buildingCount === settlement.buildings && existing.institutionCount === settlement.institutionIds.length && existing.routeCount === routeCount && existing.politySize === politySize && existing.developmentSignature === developmentSignature && existing.constructionSignature === constructionSignature) continue;"
compare_new = "      const constructionSignature = this.constructionSignature(settlement.id);\n      const bannerSignature = this.bannerIdentityForSettlement(settlement).id;\n      const event = this.visualStateResolver.trackEntity(settlement.id, 'settlement', { infrastructure: settlement.infrastructure, buildings: settlement.buildings, alive: settlement.alive }, this.state.month);\n      if (event?.kind === 'infrastructure-added') this.transitionTimeline.createBuildingUpgrade(settlement.id, 0, 1, event.associatedData);\n      if (existing && existing.buildingCount === settlement.buildings && existing.institutionCount === settlement.institutionIds.length && existing.routeCount === routeCount && existing.politySize === politySize && existing.bannerSignature === bannerSignature && existing.developmentSignature === developmentSignature && existing.constructionSignature === constructionSignature) continue;"
if compare_new not in text:
    if compare_old not in text:
        raise SystemExit('settlement comparison anchor not found')
    text = text.replace(compare_old, compare_new, 1)

culture_old = "    const culture = this.dominantCulture(settlement);\n    const era = this.eraForSettlement(settlement);"
culture_new = "    const culture = this.dominantCulture(settlement);\n    const bannerIdentity = this.bannerIdentityForSettlement(settlement, culture);\n    const era = this.eraForSettlement(settlement);"
if culture_new not in text:
    if culture_old not in text:
        raise SystemExit('create settlement culture anchor not found')
    text = text.replace(culture_old, culture_new, 1)

banner_call_old = "    if (settlement.alive) this.addBanner(group, culture, settlement.institutionIds.length);"
banner_call_new = "    if (settlement.alive) this.addBanner(group, bannerIdentity, settlement.institutionIds.length);"
if banner_call_new not in text:
    if banner_call_old not in text:
        raise SystemExit('banner call anchor not found')
    text = text.replace(banner_call_old, banner_call_new, 1)

return_old = "    return { group, buildingCount: settlement.buildings, institutionCount: settlement.institutionIds.length, routeCount, politySize, developmentSignature: this.developmentSignature(settlement), constructionSignature: this.constructionSignature(settlement.id), powerLevel: settlement.infrastructure.power, lights, smokeSources };"
return_new = "    return { group, buildingCount: settlement.buildings, institutionCount: settlement.institutionIds.length, routeCount, politySize, bannerSignature: bannerIdentity.id, developmentSignature: this.developmentSignature(settlement), constructionSignature: this.constructionSignature(settlement.id), powerLevel: settlement.infrastructure.power, lights, smokeSources };"
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

  /** Derive a readable heraldic identity from the settlement's actual cultural context. */
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

  /**
   * Step two gives every standard actual heraldry. The cloth still follows the restrained visual
   * language from step one, but its field, emblem, silhouette and house marks now come from the
   * settlement's generated identity rather than a generic culture symbol.
   */
  private addBanner(group: THREE.Group, identity: BannerIdentity, institutionCount: number): void {
    const shapeSeed = stableUnit(`${identity.id}:standard-shape`);
    const standard = new THREE.Group();
    standard.name = 'settlement-standard';
    standard.position.set(-0.8, 0, 0.15);
    standard.userData['bannerIdentity'] = identity;

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

    const clothColor = mute(identity.primary, 0.42, 0.18, 0.46, 0.8);
    const secondaryColor = mute(identity.secondary, 0.34, 0.18, 0.44, 0.9);
    const accentColor = mute(identity.accent, 0.38, 0.46, 0.7);
    accentColor.lerp(new THREE.Color('#d6ccb5'), 0.16);

    const wood = new THREE.MeshStandardMaterial({ color: '#3c2d27', roughness: 0.98, metalness: 0 });
    const poleHeight = 3.35;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.055, poleHeight, 7), wood);
    pole.position.y = poleHeight / 2;
    pole.castShadow = true;

    const width = 0.64;
    const height = 1.68;
    const topY = 2.9;
    const crossbarLength = width + 0.14;
    const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, crossbarLength, 7), wood);
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.set(crossbarLength / 2 - 0.015, topY + 0.015, 0);
    crossbar.castShadow = true;
    const finial = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.18, 6), wood);
    finial.position.y = poleHeight + 0.09;
    finial.castShadow = true;
    standard.add(pole, crossbar, finial);

    const clothGeometry = new THREE.PlaneGeometry(width, height, 6, 10);
    const positions = clothGeometry.attributes.position as THREE.BufferAttribute;
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const across = THREE.MathUtils.clamp((x + width / 2) / width, 0, 1);
      const down = THREE.MathUtils.clamp((height / 2 - y) / height, 0, 1);
      let shapedY = y;
      if (down > 0.995) {
        if (identity.shape === 'pointed') {
          shapedY += Math.abs(across - 0.5) * 0.34;
        } else if (identity.shape === 'swallowtail') {
          shapedY += (1 - Math.abs(across - 0.5) * 2) * 0.24;
        } else if (identity.shape === 'stepped') {
          shapedY += across < 0.25 || across > 0.75 ? 0.17 : across < 0.42 || across > 0.58 ? 0.08 : 0;
        } else if (identity.shape === 'ragged') {
          const tooth = stableUnit(`${identity.id}:rag:${Math.round(across * 6)}`);
          shapedY += 0.03 + tooth * 0.14;
        }
      }
      shapedY -= 0.035 * across * across * (0.35 + down * 0.65);
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
    clothRig.userData['windStrength'] = 0.035 + stableUnit(`${identity.id}:wind`) * 0.035;

    const cloth = new THREE.Mesh(clothGeometry, new THREE.MeshStandardMaterial({
      color: clothColor,
      side: THREE.DoubleSide,
      roughness: 0.96,
      metalness: 0,
    }));
    cloth.position.set(width / 2 + 0.045, -height / 2, 0.018);
    cloth.castShadow = true;
    clothRig.add(cloth);

    this.addBannerFieldPattern(clothRig, identity, width, height, secondaryColor);
    const emblemMaterial = new THREE.MeshStandardMaterial({ color: accentColor, side: THREE.DoubleSide, roughness: 0.92, metalness: 0 });
    const emblem = this.createBannerEmblem(identity, emblemMaterial);
    emblem.position.set(width * (0.47 + identity.emblemVariant * 0.025) + 0.045, -height * 0.48, 0.095);
    emblem.scale.setScalar(0.92 - identity.emblemVariant * 0.035);
    clothRig.add(emblem);

    const houseMaterial = new THREE.MeshStandardMaterial({ color: accentColor, side: THREE.DoubleSide, roughness: 0.96 });
    for (let index = 0; index < identity.lineageMarks; index += 1) {
      const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.17 + index * 0.015), houseMaterial);
      mark.position.set(0.11 + index * 0.055, -0.16, 0.105);
      mark.rotation.z = index % 2 === 0 ? -0.08 : 0.08;
      clothRig.add(mark);
    }

    for (let index = 0; index < Math.min(2, institutionCount); index += 1) {
      const tassel = new THREE.Mesh(
        new THREE.PlaneGeometry(0.055, 0.34 + index * 0.06),
        new THREE.MeshStandardMaterial({ color: index === 0 ? accentColor : secondaryColor, side: THREE.DoubleSide, roughness: 0.98 }),
      );
      tassel.position.set(0.105 + index * 0.085, -0.22 - index * 0.025, -0.005);
      tassel.rotation.z = -0.04 - index * 0.035;
      clothRig.add(tassel);
    }

    standard.add(clothRig);
    group.add(standard);
    group.userData['bannerClothRig'] = clothRig;
    group.userData['bannerIdentity'] = identity;
  }

  /** Heraldic field geometry kept deliberately low-poly and dye-like. */
  private addBannerFieldPattern(group: THREE.Group, identity: BannerIdentity, width: number, height: number, color: THREE.Color): void {
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
    if (identity.fieldPattern === 'stripe') {
      if (identity.fieldVariant % 2 === 0) {
        const stripeWidth = width * (identity.fieldVariant >= 2 ? 0.18 : 0.24);
        addPanel(stripeWidth, height * 0.92, centerX + (identity.fieldVariant === 2 ? width * 0.16 : 0), -height * 0.5);
      } else {
        const bandHeight = height * (identity.fieldVariant === 3 ? 0.14 : 0.2);
        addPanel(width * 0.92, bandHeight, centerX, -height * (identity.fieldVariant === 3 ? 0.66 : 0.5));
      }
      return;
    }
    if (identity.fieldPattern === 'split') {
      if (identity.fieldVariant % 2 === 0) addPanel(width * 0.47, height * 0.92, left + width * 0.74, -height * 0.5);
      else addPanel(width * 0.92, height * 0.46, centerX, -height * 0.73);
      return;
    }
    if (identity.fieldPattern === 'top-band') {
      addPanel(width * 0.94, height * (0.18 + identity.fieldVariant * 0.018), centerX, -height * 0.14);
      return;
    }
    const border = 0.045 + identity.fieldVariant * 0.006;
    addPanel(border, height * 0.88, left + border * 0.65, -height * 0.5);
    addPanel(border, height * 0.88, left + width - border * 0.65, -height * 0.5);
    addPanel(width * 0.9, border, centerX, -height * 0.05);
  }

  /** Nine deliberately simple emblem families that remain legible at documentary-camera scale. */
  private createBannerEmblem(identity: BannerIdentity, material: THREE.MeshStandardMaterial): THREE.Group {
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
        moon.rotation.z = identity.emblemVariant * 0.18;
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
        addBar(0.04, 0.22, identity.emblemVariant % 2 === 0 ? 0.08 : -0.08, 0.06, identity.emblemVariant % 2 === 0 ? -0.72 : 0.72);
        addBar(0.04, 0.18, identity.emblemVariant >= 2 ? -0.075 : 0.075, -0.08, identity.emblemVariant >= 2 ? 0.68 : -0.68);
        break;
    }
    return emblem;
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

start = text.index('  /**\n   * A settlement standard, not a modern rectangular flag.')
end = text.index('\n  private addMarket(', start)
text = text[:start] + replacement + text[end:]
path.write_text(text)
