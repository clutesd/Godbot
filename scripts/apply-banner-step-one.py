from pathlib import Path

path = Path('src/render/GodboxRenderer.ts')
text = path.read_text()

update_old = "    this.updateDayNight(elapsedSeconds);\n    this.updateAdvancedAtmosphere(elapsedSeconds);"
update_new = "    this.updateDayNight(elapsedSeconds);\n    this.updateSettlementBanners(elapsedSeconds);\n    this.updateAdvancedAtmosphere(elapsedSeconds);"
if update_old not in text:
    raise SystemExit('update loop anchor not found')
text = text.replace(update_old, update_new, 1)

replacement = r'''  /**
   * A settlement standard, not a modern rectangular flag. Step one is deliberately visual:
   * long cloth, restrained natural dyes, hand-made silhouettes and quiet movement. Cultural
   * heraldry still comes from the existing symbol; deeper identity/history belongs to later steps.
   */
  private addBanner(group: THREE.Group, culture: Culture | undefined, institutionCount: number): void {
    const identity = `${culture?.id ?? 'fallback'}:${culture?.style.pattern ?? 'chevron'}:${culture?.style.symbol ?? 'sun-step'}`;
    const shapeSeed = stableUnit(`${identity}:standard-shape`);
    const standard = new THREE.Group();
    standard.name = 'settlement-standard';
    standard.position.set(-0.8, 0, 0.15);

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

    // Culture colours survive, but read as cloth dyes rather than luminous UI swatches.
    const clothColor = mute(culture?.style.primary ?? '#9b5d50', 0.42, 0.18, 0.46, 0.8);
    const secondaryColor = mute(culture?.style.secondary ?? '#3f4044', 0.32, 0.18, 0.42, 0.9);
    const accentColor = mute(culture?.style.accent ?? '#c6aa72', 0.36, 0.48, 0.68);
    accentColor.lerp(new THREE.Color('#d6ccb5'), 0.22);

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

    // Subdivisions let the banner hold a gentle sag/fold profile without a cloth physics cost.
    const clothGeometry = new THREE.PlaneGeometry(width, height, 6, 10);
    const positions = clothGeometry.attributes.position as THREE.BufferAttribute;
    const shapeVariant = Math.min(3, Math.floor(shapeSeed * 4));
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const across = THREE.MathUtils.clamp((x + width / 2) / width, 0, 1);
      const down = THREE.MathUtils.clamp((height / 2 - y) / height, 0, 1);
      let shapedY = y;
      if (down > 0.995) {
        if (shapeVariant === 1) {
          shapedY += Math.abs(across - 0.5) * 0.34; // pointed centre
        } else if (shapeVariant === 2) {
          shapedY += (1 - Math.abs(across - 0.5) * 2) * 0.22; // forked centre notch
        } else if (shapeVariant === 3) {
          const tooth = stableUnit(`${identity}:rag:${Math.round(across * 6)}`);
          shapedY += 0.03 + tooth * 0.14; // irregular hand-cut / worn hem
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
    clothRig.userData['windStrength'] = 0.035 + stableUnit(`${identity}:wind`) * 0.035;

    const cloth = new THREE.Mesh(clothGeometry, new THREE.MeshStandardMaterial({
      color: clothColor,
      side: THREE.DoubleSide,
      roughness: 0.96,
      metalness: 0,
    }));
    cloth.position.set(width / 2 + 0.045, -height / 2, 0.018);
    cloth.castShadow = true;
    clothRig.add(cloth);

    // Keep one readable culture mark. The old three-ring row read as a face at phone distance.
    const symbol = culture?.style.symbol ?? 'sun-step';
    const markGeometry = symbol === 'river-eye' ? new THREE.RingGeometry(0.09, 0.19, 12, 1, 0, Math.PI)
      : symbol === 'woven-moon' ? new THREE.RingGeometry(0.1, 0.2, 10, 1, 0.4, Math.PI * 1.45)
        : symbol === 'mountain-knot' ? new THREE.CircleGeometry(0.19, 3)
          : symbol === 'seed-spiral' ? new THREE.TorusGeometry(0.13, 0.038, 5, 10)
            : new THREE.RingGeometry(0.085, 0.19, 8);
    const mark = new THREE.Mesh(markGeometry, new THREE.MeshStandardMaterial({
      color: accentColor,
      side: THREE.DoubleSide,
      roughness: 0.9,
      metalness: 0,
    }));
    mark.position.set(width * 0.53 + 0.045, -height * 0.34, 0.09);
    mark.castShadow = true;
    clothRig.add(mark);

    const hoistTrim = new THREE.Mesh(
      new THREE.PlaneGeometry(0.045, height * 0.9),
      new THREE.MeshStandardMaterial({ color: secondaryColor, side: THREE.DoubleSide, roughness: 0.98 }),
    );
    hoistTrim.position.set(0.075, -height * 0.48, 0.065);
    clothRig.add(hoistTrim);

    // Institutions now add restrained ties rather than bright floating party ribbons.
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

start = text.index('  private addBanner(')
end = text.index('\n  private addMarket(', start)
text = text[:start] + replacement + text[end:]
path.write_text(text)
