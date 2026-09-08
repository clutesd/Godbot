/**
 * ProceduralGeometry.ts
 * 
 * Reusable procedural geometry generators for all asset types.
 * All generators are deterministic given the same seed.
 * Enables parametric creation of trees, buildings, humanoids, and decorative elements.
 */

import * as THREE from 'three';
import type { SeededRandom } from '../../sim/prng';

export interface GeometryConfig {
  seed?: string;
  scale?: number;
}

/**
 * Basic geometric primitives with procedural variants
 */
export class ProceduralGeometry {
  /**
   * Create a parametric tree trunk
   */
  static createTreeTrunk(
    height: number,
    baseRadius: number,
    topRadius: number,
    segmentCount: number = 8,
    verticalSegments: number = 4,
  ): THREE.BufferGeometry {
    const geometry = new THREE.ConeGeometry(baseRadius, height, segmentCount, verticalSegments, true);
    
    // Taper the cone naturally toward the top
    const positionAttribute = geometry.getAttribute('position');
    const positions = positionAttribute.array as Float32Array;
    
    for (let i = 0; i < positions.length; i += 3) {
      const y = positions[i + 1] ?? 0;
      const yNorm = (y + height / 2) / height; // 0 to 1 from bottom to top
      const radiusScale = THREE.MathUtils.lerp(1, topRadius / baseRadius, yNorm);
      positions[i] = (positions[i] ?? 0) * radiusScale;
      positions[i + 2] = (positions[i + 2] ?? 0) * radiusScale;
    }
    
    positionAttribute.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }

  /**
   * Create a parametric tree canopy (rounded crown)
   */
  static createTreeCanopy(
    radius: number,
    height: number,
    widthSegments: number = 12,
    heightSegments: number = 6,
  ): THREE.BufferGeometry {
    const detail = Math.max(1, Math.min(4, Math.round((widthSegments + heightSegments) / 8)));
    const geometry = new THREE.IcosahedronGeometry(radius, detail);
    
    // Compress vertically for a crown-like shape
    const positionAttribute = geometry.getAttribute('position');
    const positions = positionAttribute.array as Float32Array;
    
    for (let i = 0; i < positions.length; i += 3) {
      // Keep x, z; scale y to be slightly flatter
      positions[i + 1] = (positions[i + 1] ?? 0) * (height / Math.max(radius, 0.001));
    }
    
    positionAttribute.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }

  /**
   * Create a humanoid head
   */
  static createHead(radius: number = 0.3): THREE.BufferGeometry {
    return new THREE.IcosahedronGeometry(radius, 2);
  }

  /**
   * Create a humanoid body segment (torso, pelvis, etc.)
   */
  static createBodySegment(
    width: number,
    height: number,
    depth: number,
  ): THREE.BufferGeometry {
    return new THREE.BoxGeometry(width, height, depth);
  }

  /**
   * Create a humanoid limb (arm, leg, etc.)
   */
  static createLimb(radius: number, length: number, segments: number = 4): THREE.BufferGeometry {
    return new THREE.CylinderGeometry(radius, radius, length, segments, 2);
  }

  /**
   * Create a simple hand/foot
   */
  static createExtremity(scale: number = 0.2): THREE.BufferGeometry {
    return new THREE.BoxGeometry(scale * 0.8, scale, scale * 0.6);
  }

  /**
   * Create a procedural roof geometry
   * @param width - base width
   * @param depth - base depth
   * @param height - peak height
   * @param style - 'pyramid' | 'gable' | 'dome' | 'layered'
   */
  static createRoof(
    width: number,
    depth: number,
    height: number,
    style: 'pyramid' | 'gable' | 'dome' | 'layered' = 'pyramid',
  ): THREE.BufferGeometry {
    switch (style) {
      case 'pyramid': {
        // Pyramid roof (apex at center)
        const geometry = new THREE.ConeGeometry(Math.max(width, depth) / 2, height, 4);
        return geometry;
      }
      case 'gable': {
        // Gable roof (ridge along one axis)
        const geometry = new THREE.BufferGeometry();
        const vertices = new Float32Array([
          -width / 2, 0, -depth / 2,
          width / 2, 0, -depth / 2,
          width / 2, 0, depth / 2,
          -width / 2, 0, depth / 2,
          0, height, -depth / 2,
          0, height, depth / 2,
        ]);
        const indices = new Uint16Array([
          0, 1, 4,
          1, 5, 4,
          1, 2, 5,
          2, 5, 3,
          3, 5, 4,
          3, 4, 0,
          0, 2, 1,
          0, 3, 2,
        ]);
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        geometry.computeVertexNormals();
        return geometry;
      }
      case 'dome': {
        // Dome roof (hemispherical)
        const geometry = new THREE.IcosahedronGeometry(Math.max(width, depth) / 2, 2);
        const positionAttribute = geometry.getAttribute('position');
        const positions = positionAttribute.array as Float32Array;
        
        for (let i = 0; i < positions.length; i += 3) {
          // Keep positive y only
          if ((positions[i + 1] ?? 0) < 0) positions[i + 1] = 0;
        }
        
        positionAttribute.needsUpdate = true;
        geometry.computeVertexNormals();
        return geometry;
      }
      case 'layered': {
        const geometry = new THREE.ConeGeometry(Math.max(width, depth) / 2, height, 8);
        geometry.scale(1.08, 0.82, 0.82);
        return geometry;
      }
    }
  }

  /**
   * Create a procedural door frame
   */
  static createDoorFrame(width: number = 0.6, height: number = 1.2): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    const thickness = 0.05;
    const vertices = new Float32Array([
      -width / 2, 0, 0,
      width / 2, 0, 0,
      width / 2, height, 0,
      -width / 2, height, 0,
      -width / 2 - thickness, -thickness, -thickness,
      width / 2 + thickness, -thickness, -thickness,
      width / 2 + thickness, height + thickness, -thickness,
      -width / 2 - thickness, height + thickness, -thickness,
    ]);
    const indices = new Uint16Array([
      0, 1, 2, 0, 2, 3, // front face
      4, 6, 5, 4, 7, 6, // back frame
      0, 4, 5, 0, 5, 1, // bottom
      2, 6, 7, 2, 7, 3, // top
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    return geometry;
  }

  /**
   * Create a procedural window frame
   */
  static createWindowFrame(width: number = 0.4, height: number = 0.4): THREE.BufferGeometry {
    return this.createDoorFrame(width, height); // Same basic shape, different scale
  }

  /**
   * Create a decorative tile/ornament element
   */
  static createTile(size: number = 0.2, thickness: number = 0.02): THREE.BufferGeometry {
    return new THREE.BoxGeometry(size, thickness, size);
  }

  /**
   * Create a decorative post/pillar
   */
  static createPost(
    radius: number = 0.1,
    height: number = 2,
    segments: number = 8,
  ): THREE.BufferGeometry {
    return new THREE.CylinderGeometry(radius, radius, height, segments);
  }

  /**
   * Create a banner pole and attachment points
   */
  static createBannerPole(
    radius: number = 0.08,
    height: number = 3,
    attachmentPoints: number = 2,
  ): THREE.Group {
    const group = new THREE.Group();
    const pole = new THREE.CylinderGeometry(radius, radius, height, 6);
    
    const material = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.7 });
    const poleMesh = new THREE.Mesh(pole, material);
    group.add(poleMesh);
    
    // Add cross-pieces for banner attachment
    for (let i = 0; i < attachmentPoints; i++) {
      const yPos = height * (0.3 + i * 0.4);
      const crossbar = new THREE.CylinderGeometry(radius * 0.6, radius * 0.6, radius * 4, 6);
      crossbar.rotateZ(Math.PI / 2);
      const crossMesh = new THREE.Mesh(crossbar, material);
      crossMesh.position.y = yPos;
      group.add(crossMesh);
    }
    
    return group;
  }

  /**
   * Create a bridge geometry spanning between two points
   */
  static createBridge(
    spanLength: number,
    bridgeWidth: number = 1.2,
    style: 'stone' | 'wood' | 'causeway' = 'stone',
  ): THREE.BufferGeometry {
    const thickness = 0.3;
    
    const geometry = new THREE.BoxGeometry(spanLength, thickness, bridgeWidth);
    
    if (style === 'stone') {
      // Add support pillars (visual indication, not actual geometry)
      // These would be added separately
    }
    
    return geometry;
  }

  /**
   * Create fire/campfire visual (particles will animate this)
   */
  static createFireBase(radius: number = 0.5): THREE.BufferGeometry {
    return new THREE.CylinderGeometry(radius, radius * 1.2, radius * 0.5, 8);
  }

  /**
   * Apply slight procedural variation to geometry based on seed
   */
  static applyVariation(
    geometry: THREE.BufferGeometry,
    random: SeededRandom,
    variationAmount: number = 0.05,
  ): void {
    const positionAttribute = geometry.getAttribute('position');
    const positions = positionAttribute.array as Float32Array;
    
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = (positions[i] ?? 0) + (random.float() - 0.5) * variationAmount;
      positions[i + 1] = (positions[i + 1] ?? 0) + (random.float() - 0.5) * variationAmount;
      positions[i + 2] = (positions[i + 2] ?? 0) + (random.float() - 0.5) * variationAmount;
    }
    
    positionAttribute.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  /**
   * Create a shrub/bush geometry (low-poly vegetation)
   */
  static createShrub(radius: number = 0.3, segments: number = 2): THREE.BufferGeometry {
    return new THREE.IcosahedronGeometry(radius, segments);
  }

  /**
   * Create a simple skeletal bone structure for humanoids
   */
  static createBoneStructure(): { bones: THREE.Bone[]; skeleton: THREE.Skeleton } {
    // Build a simple humanoid skeleton
    const bones: THREE.Bone[] = [];
    
    // Root (pelvis)
    const root = new THREE.Bone();
    bones.push(root);
    
    // Spine -> Chest
    const spine = new THREE.Bone();
    spine.position.y = 0.3;
    root.add(spine);
    bones.push(spine);
    
    const chest = new THREE.Bone();
    chest.position.y = 0.4;
    spine.add(chest);
    bones.push(chest);
    
    // Head
    const head = new THREE.Bone();
    head.position.y = 0.35;
    chest.add(head);
    bones.push(head);
    
    // Left arm
    const leftShoulder = new THREE.Bone();
    leftShoulder.position.set(-0.35, 0.3, 0);
    chest.add(leftShoulder);
    bones.push(leftShoulder);
    
    const leftElbow = new THREE.Bone();
    leftElbow.position.y = -0.3;
    leftShoulder.add(leftElbow);
    bones.push(leftElbow);
    
    const leftHand = new THREE.Bone();
    leftHand.position.y = -0.3;
    leftElbow.add(leftHand);
    bones.push(leftHand);
    
    // Right arm
    const rightShoulder = new THREE.Bone();
    rightShoulder.position.set(0.35, 0.3, 0);
    chest.add(rightShoulder);
    bones.push(rightShoulder);
    
    const rightElbow = new THREE.Bone();
    rightElbow.position.y = -0.3;
    rightShoulder.add(rightElbow);
    bones.push(rightElbow);
    
    const rightHand = new THREE.Bone();
    rightHand.position.y = -0.3;
    rightElbow.add(rightHand);
    bones.push(rightHand);
    
    // Left leg
    const leftHip = new THREE.Bone();
    leftHip.position.set(-0.15, -0.05, 0);
    root.add(leftHip);
    bones.push(leftHip);
    
    const leftKnee = new THREE.Bone();
    leftKnee.position.y = -0.4;
    leftHip.add(leftKnee);
    bones.push(leftKnee);
    
    const leftFoot = new THREE.Bone();
    leftFoot.position.y = -0.4;
    leftKnee.add(leftFoot);
    bones.push(leftFoot);
    
    // Right leg
    const rightHip = new THREE.Bone();
    rightHip.position.set(0.15, -0.05, 0);
    root.add(rightHip);
    bones.push(rightHip);
    
    const rightKnee = new THREE.Bone();
    rightKnee.position.y = -0.4;
    rightHip.add(rightKnee);
    bones.push(rightKnee);
    
    const rightFoot = new THREE.Bone();
    rightFoot.position.y = -0.4;
    rightKnee.add(rightFoot);
    bones.push(rightFoot);
    
    const skeleton = new THREE.Skeleton(bones);
    
    return { bones, skeleton };
  }
}
