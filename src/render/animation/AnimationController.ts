/**
 * AnimationController.ts
 * 
 * Manages animation states for humanoid characters.
 * Supports blending between compatible states for smooth transitions.
 */

import type { Activity, Occupation } from '../../sim/types';
import { SeededRandom } from '../../sim/prng';

export type AnimationState = 
  | 'idle'
  | 'walk'
  | 'run'
  | 'carry'
  | 'work'
  | 'gather'
  | 'build'
  | 'farm'
  | 'converse'
  | 'rest'
  | 'ritual'
  | 'alert'
  | 'combat';

/**
 * Describes a pose (key frame) for a character
 */
export interface AnimationPose {
  name: string;
  duration: number; // Seconds to play this frame
  pelvisRotation: number; // Rotation Y in radians
  spineRotation: number; // Curve along spine
  headRotation: number; // Head look direction
  leftShoulderRotation: number; // Upper arm rotation
  leftElbowRotation: number; // Elbow bend (0-1)
  rightShoulderRotation: number;
  rightElbowRotation: number;
  leftHipRotation: number;
  leftKneeRotation: number; // 0 = straight, 1 = bent
  rightHipRotation: number;
  rightKneeRotation: number;
  positionOffset: { x: number; y: number; z: number };
}

/**
 * Describes an animation state with multiple poses that can be cycled
 */
export interface AnimationClip {
  state: AnimationState;
  poses: AnimationPose[];
  isLooping: boolean;
  canInterruptFrom: Set<AnimationState>;
  blendDuration: number; // Seconds to blend when entering this state
}

/**
 * Per-character animation instance
 */
export interface CharacterAnimationState {
  personId: string;
  occupation: Occupation;
  currentState: AnimationState;
  elapsedTime: number;
  currentPoseIndex: number;
  blendFactor: number; // 0 (old pose) to 1 (new pose)
  playbackSpeed: number; // 0.8 to 1.2, slight variation per character
  phaseOffset: number; // 0 to 1, prevents synchronized crowds
}

/**
 * Manages all animation clips and character animation states
 */
export class AnimationController {
  private readonly clips: Map<AnimationState, AnimationClip>;
  private readonly characterStates: Map<string, CharacterAnimationState>;
  private readonly random: SeededRandom;

  constructor(seed: string = 'animations') {
    this.random = new SeededRandom(seed);
    this.clips = new Map();
    this.characterStates = new Map();
    this.buildAnimationLibrary();
  }

  /**
   * Build the complete animation library
   */
  private buildAnimationLibrary(): void {
    this.createIdleClips();
    this.createWalkRunClips();
    this.createActivityClips();
    this.createSpecialStateClips();
  }

  private createIdleClips(): void {
    // Idle: standing still, gentle breathing
    const idlePoses: AnimationPose[] = [
      {
        name: 'idle-neutral',
        duration: 2.0,
        pelvisRotation: 0,
        spineRotation: 0,
        headRotation: 0,
        leftShoulderRotation: 0,
        leftElbowRotation: 0,
        rightShoulderRotation: 0,
        rightElbowRotation: 0,
        leftHipRotation: 0,
        leftKneeRotation: 0.05,
        rightHipRotation: 0,
        rightKneeRotation: 0.05,
        positionOffset: { x: 0, y: 0, z: 0 },
      },
      {
        name: 'idle-breathe-in',
        duration: 0.5,
        pelvisRotation: 0,
        spineRotation: 0.1,
        headRotation: 0,
        leftShoulderRotation: 0,
        leftElbowRotation: 0,
        rightShoulderRotation: 0,
        rightElbowRotation: 0,
        leftHipRotation: 0,
        leftKneeRotation: 0.05,
        rightHipRotation: 0,
        rightKneeRotation: 0.05,
        positionOffset: { x: 0, y: 0.02, z: 0 },
      },
    ];

    this.clips.set('idle', {
      state: 'idle',
      poses: idlePoses,
      isLooping: true,
      canInterruptFrom: new Set(['walk', 'run', 'work', 'gather', 'carry']),
      blendDuration: 0.3,
    });
  }

  private createWalkRunClips(): void {
    // Walk: steady pace
    const walkPoses: AnimationPose[] = [
      {
        name: 'walk-left-forward',
        duration: 0.5,
        pelvisRotation: 0,
        spineRotation: 0.05,
        headRotation: 0,
        leftShoulderRotation: 0.3,
        leftElbowRotation: 0.2,
        rightShoulderRotation: -0.3,
        rightElbowRotation: 0.2,
        leftHipRotation: 0.2,
        leftKneeRotation: 0.3,
        rightHipRotation: -0.2,
        rightKneeRotation: 0.1,
        positionOffset: { x: 0.1, y: 0, z: 0.15 },
      },
      {
        name: 'walk-neutral',
        duration: 0.3,
        pelvisRotation: 0,
        spineRotation: 0,
        headRotation: 0,
        leftShoulderRotation: 0.1,
        leftElbowRotation: 0.15,
        rightShoulderRotation: -0.1,
        rightElbowRotation: 0.15,
        leftHipRotation: 0.1,
        leftKneeRotation: 0.15,
        rightHipRotation: -0.1,
        rightKneeRotation: 0.15,
        positionOffset: { x: 0, y: 0, z: 0.1 },
      },
      {
        name: 'walk-right-forward',
        duration: 0.5,
        pelvisRotation: 0,
        spineRotation: 0.05,
        headRotation: 0,
        leftShoulderRotation: -0.3,
        leftElbowRotation: 0.2,
        rightShoulderRotation: 0.3,
        rightElbowRotation: 0.2,
        leftHipRotation: -0.2,
        leftKneeRotation: 0.1,
        rightHipRotation: 0.2,
        rightKneeRotation: 0.3,
        positionOffset: { x: -0.1, y: 0, z: 0.15 },
      },
    ];

    this.clips.set('walk', {
      state: 'walk',
      poses: walkPoses,
      isLooping: true,
      canInterruptFrom: new Set(['idle', 'run']),
      blendDuration: 0.4,
    });

    // Run: faster pace, more exaggerated motion
    const runPoses: AnimationPose[] = [
      {
        name: 'run-stride-left',
        duration: 0.3,
        pelvisRotation: 0.1,
        spineRotation: 0.1,
        headRotation: 0.05,
        leftShoulderRotation: 0.5,
        leftElbowRotation: 0.4,
        rightShoulderRotation: -0.5,
        rightElbowRotation: 0.4,
        leftHipRotation: 0.3,
        leftKneeRotation: 0.5,
        rightHipRotation: -0.2,
        rightKneeRotation: 0.1,
        positionOffset: { x: 0.15, y: 0.05, z: 0.3 },
      },
      {
        name: 'run-stride-right',
        duration: 0.3,
        pelvisRotation: -0.1,
        spineRotation: 0.1,
        headRotation: -0.05,
        leftShoulderRotation: -0.5,
        leftElbowRotation: 0.4,
        rightShoulderRotation: 0.5,
        rightElbowRotation: 0.4,
        leftHipRotation: -0.2,
        leftKneeRotation: 0.1,
        rightHipRotation: 0.3,
        rightKneeRotation: 0.5,
        positionOffset: { x: -0.15, y: 0.05, z: 0.3 },
      },
    ];

    this.clips.set('run', {
      state: 'run',
      poses: runPoses,
      isLooping: true,
      canInterruptFrom: new Set(['walk', 'idle']),
      blendDuration: 0.3,
    });
  }

  private createActivityClips(): void {
    // Carry: slight hunching, hands occupied
    const carryPoses: AnimationPose[] = [
      {
        name: 'carry-neutral',
        duration: 1.0,
        pelvisRotation: 0,
        spineRotation: 0.15,
        headRotation: 0,
        leftShoulderRotation: 0.4,
        leftElbowRotation: 0.6,
        rightShoulderRotation: 0.4,
        rightElbowRotation: 0.6,
        leftHipRotation: 0,
        leftKneeRotation: 0.1,
        rightHipRotation: 0,
        rightKneeRotation: 0.1,
        positionOffset: { x: 0, y: -0.05, z: 0 },
      },
    ];

    this.clips.set('carry', {
      state: 'carry',
      poses: carryPoses,
      isLooping: true,
      canInterruptFrom: new Set(['idle', 'walk', 'gather']),
      blendDuration: 0.3,
    });

    // Work: repetitive motion (generic, can be specialized by occupation)
    const workPoses: AnimationPose[] = [
      {
        name: 'work-reach-up',
        duration: 0.4,
        pelvisRotation: 0,
        spineRotation: 0.2,
        headRotation: 0,
        leftShoulderRotation: 0.8,
        leftElbowRotation: 0.3,
        rightShoulderRotation: 0.8,
        rightElbowRotation: 0.3,
        leftHipRotation: 0,
        leftKneeRotation: 0.15,
        rightHipRotation: 0,
        rightKneeRotation: 0.15,
        positionOffset: { x: 0, y: 0.1, z: 0 },
      },
      {
        name: 'work-place',
        duration: 0.4,
        pelvisRotation: 0,
        spineRotation: 0.1,
        headRotation: 0,
        leftShoulderRotation: 0.3,
        leftElbowRotation: 0.5,
        rightShoulderRotation: 0.3,
        rightElbowRotation: 0.5,
        leftHipRotation: 0,
        leftKneeRotation: 0.2,
        rightHipRotation: 0,
        rightKneeRotation: 0.2,
        positionOffset: { x: 0, y: 0, z: 0 },
      },
    ];

    this.clips.set('work', {
      state: 'work',
      poses: workPoses,
      isLooping: true,
      canInterruptFrom: new Set(['idle', 'gather']),
      blendDuration: 0.4,
    });

    // Gather: bending/crouching motion
    const gatherPoses: AnimationPose[] = [
      {
        name: 'gather-bend',
        duration: 0.6,
        pelvisRotation: 0,
        spineRotation: 0.3,
        headRotation: 0.2,
        leftShoulderRotation: 0.2,
        leftElbowRotation: 0.4,
        rightShoulderRotation: 0.2,
        rightElbowRotation: 0.4,
        leftHipRotation: 0,
        leftKneeRotation: 0.6,
        rightHipRotation: 0,
        rightKneeRotation: 0.6,
        positionOffset: { x: 0, y: -0.2, z: 0 },
      },
    ];

    this.clips.set('gather', {
      state: 'gather',
      poses: gatherPoses,
      isLooping: true,
      canInterruptFrom: new Set(['idle', 'work']),
      blendDuration: 0.5,
    });

    // Build: reaching upward, placing objects
    const buildPoses: AnimationPose[] = [
      {
        name: 'build-reach-high',
        duration: 0.5,
        pelvisRotation: 0,
        spineRotation: 0.2,
        headRotation: 0,
        leftShoulderRotation: 1.2,
        leftElbowRotation: 0.2,
        rightShoulderRotation: 1.2,
        rightElbowRotation: 0.2,
        leftHipRotation: 0,
        leftKneeRotation: 0.1,
        rightHipRotation: 0,
        rightKneeRotation: 0.1,
        positionOffset: { x: 0, y: 0.15, z: 0 },
      },
      {
        name: 'build-place',
        duration: 0.5,
        pelvisRotation: 0,
        spineRotation: 0.1,
        headRotation: 0,
        leftShoulderRotation: 0.4,
        leftElbowRotation: 0.5,
        rightShoulderRotation: 0.4,
        rightElbowRotation: 0.5,
        leftHipRotation: 0,
        leftKneeRotation: 0.15,
        rightHipRotation: 0,
        rightKneeRotation: 0.15,
        positionOffset: { x: 0, y: 0, z: 0 },
      },
    ];

    this.clips.set('build', {
      state: 'build',
      poses: buildPoses,
      isLooping: true,
      canInterruptFrom: new Set(['idle', 'work', 'carry']),
      blendDuration: 0.4,
    });

    // Farm: tending/hoeing motion
    const farmPoses: AnimationPose[] = [
      {
        name: 'farm-stoop',
        duration: 0.7,
        pelvisRotation: 0,
        spineRotation: 0.25,
        headRotation: 0,
        leftShoulderRotation: 0.3,
        leftElbowRotation: 0.3,
        rightShoulderRotation: 0.3,
        rightElbowRotation: 0.3,
        leftHipRotation: 0,
        leftKneeRotation: 0.4,
        rightHipRotation: 0,
        rightKneeRotation: 0.4,
        positionOffset: { x: 0, y: -0.15, z: 0 },
      },
    ];

    this.clips.set('farm', {
      state: 'farm',
      poses: farmPoses,
      isLooping: true,
      canInterruptFrom: new Set(['idle', 'gather', 'work']),
      blendDuration: 0.4,
    });

    // Converse: facing another person, gesturing
    const conversePoses: AnimationPose[] = [
      {
        name: 'converse-neutral',
        duration: 1.0,
        pelvisRotation: 0,
        spineRotation: 0.05,
        headRotation: 0,
        leftShoulderRotation: 0.2,
        leftElbowRotation: 0.3,
        rightShoulderRotation: 0.2,
        rightElbowRotation: 0.3,
        leftHipRotation: 0,
        leftKneeRotation: 0.08,
        rightHipRotation: 0,
        rightKneeRotation: 0.08,
        positionOffset: { x: 0, y: 0, z: 0 },
      },
      {
        name: 'converse-gesture',
        duration: 0.5,
        pelvisRotation: 0.05,
        spineRotation: 0.1,
        headRotation: 0.1,
        leftShoulderRotation: 0.4,
        leftElbowRotation: 0.2,
        rightShoulderRotation: 0.4,
        rightElbowRotation: 0.2,
        leftHipRotation: 0,
        leftKneeRotation: 0.08,
        rightHipRotation: 0,
        rightKneeRotation: 0.08,
        positionOffset: { x: 0, y: 0, z: 0 },
      },
    ];

    this.clips.set('converse', {
      state: 'converse',
      poses: conversePoses,
      isLooping: true,
      canInterruptFrom: new Set(['idle']),
      blendDuration: 0.4,
    });
  }

  private createSpecialStateClips(): void {
    // Rest: sitting or lying down
    const restPoses: AnimationPose[] = [
      {
        name: 'rest-sit',
        duration: 2.0,
        pelvisRotation: 0,
        spineRotation: 0.3,
        headRotation: 0.1,
        leftShoulderRotation: 0,
        leftElbowRotation: 0.4,
        rightShoulderRotation: 0,
        rightElbowRotation: 0.4,
        leftHipRotation: 0.5,
        leftKneeRotation: 0.8,
        rightHipRotation: 0.5,
        rightKneeRotation: 0.8,
        positionOffset: { x: 0, y: -0.4, z: 0 },
      },
    ];

    this.clips.set('rest', {
      state: 'rest',
      poses: restPoses,
      isLooping: true,
      canInterruptFrom: new Set(['idle']),
      blendDuration: 0.6,
    });

    // Ritual: standing with hands raised or together
    const ritualPoses: AnimationPose[] = [
      {
        name: 'ritual-hands-up',
        duration: 1.0,
        pelvisRotation: 0,
        spineRotation: 0.1,
        headRotation: 0.2,
        leftShoulderRotation: 1.2,
        leftElbowRotation: 0.1,
        rightShoulderRotation: 1.2,
        rightElbowRotation: 0.1,
        leftHipRotation: 0,
        leftKneeRotation: 0.05,
        rightHipRotation: 0,
        rightKneeRotation: 0.05,
        positionOffset: { x: 0, y: 0, z: 0 },
      },
    ];

    this.clips.set('ritual', {
      state: 'ritual',
      poses: ritualPoses,
      isLooping: true,
      canInterruptFrom: new Set(['idle']),
      blendDuration: 0.5,
    });

    // Alert: tense, ready stance
    const alertPoses: AnimationPose[] = [
      {
        name: 'alert-ready',
        duration: 1.0,
        pelvisRotation: 0,
        spineRotation: 0.15,
        headRotation: 0.3,
        leftShoulderRotation: 0.6,
        leftElbowRotation: 0.7,
        rightShoulderRotation: 0.6,
        rightElbowRotation: 0.7,
        leftHipRotation: 0,
        leftKneeRotation: 0.2,
        rightHipRotation: 0,
        rightKneeRotation: 0.2,
        positionOffset: { x: 0, y: 0, z: 0 },
      },
    ];

    this.clips.set('alert', {
      state: 'alert',
      poses: alertPoses,
      isLooping: true,
      canInterruptFrom: new Set(['idle', 'walk', 'run']),
      blendDuration: 0.2,
    });

    // Combat: attacking stance
    const combatPoses: AnimationPose[] = [
      {
        name: 'combat-strike',
        duration: 0.6,
        pelvisRotation: 0.2,
        spineRotation: 0.3,
        headRotation: 0.2,
        leftShoulderRotation: 0.8,
        leftElbowRotation: 0.2,
        rightShoulderRotation: 1.0,
        rightElbowRotation: 0.1,
        leftHipRotation: -0.2,
        leftKneeRotation: 0.15,
        rightHipRotation: 0.2,
        rightKneeRotation: 0.15,
        positionOffset: { x: 0.1, y: 0, z: 0.05 },
      },
    ];

    this.clips.set('combat', {
      state: 'combat',
      poses: combatPoses,
      isLooping: true,
      canInterruptFrom: new Set(['alert', 'idle']),
      blendDuration: 0.2,
    });
  }

  /**
   * Create or get animation state for a character
   */
  getOrCreateCharacterState(
    personId: string,
    occupation: Occupation,
    initialState: AnimationState = 'idle',
  ): CharacterAnimationState {
    if (this.characterStates.has(personId)) {
      return this.characterStates.get(personId)!;
    }

    const state: CharacterAnimationState = {
      personId,
      occupation,
      currentState: initialState,
      elapsedTime: 0,
      currentPoseIndex: 0,
      blendFactor: 1.0,
      playbackSpeed: 0.9 + this.random.float() * 0.2, // ±10% variation
      phaseOffset: this.random.float(), // 0 to 1
    };

    this.characterStates.set(personId, state);
    return state;
  }

  /**
   * Update animation state based on elapsed delta time
   */
  updateCharacterAnimation(personId: string, deltaTime: number, newActivity: Activity): void {
    const charState = this.characterStates.get(personId);
    if (!charState) return;

    // Map activity to animation state
    const newAnimState = this.activityToAnimationState(newActivity, charState.occupation);

    // Update animation time
    charState.elapsedTime += deltaTime;

    // Handle state transitions with blending
    if (newAnimState !== charState.currentState) {
      const currentClip = this.clips.get(charState.currentState);
      const newClip = this.clips.get(newAnimState);

      if (newClip && currentClip) {
        charState.currentState = newAnimState;
        charState.blendFactor = 0;
        charState.elapsedTime = 0;
        charState.currentPoseIndex = 0;
      }
    }

    // Advance blend factor
    const clip = this.clips.get(charState.currentState);
    if (clip) {
      charState.blendFactor = Math.min(1.0, charState.blendFactor + deltaTime / clip.blendDuration);

      // Cycle through poses
      const totalDuration = clip.poses.reduce((sum, p) => sum + p.duration, 0);
      const cycleTime = (charState.elapsedTime * charState.playbackSpeed) % totalDuration;

      let accum = 0;
      for (let i = 0; i < clip.poses.length; i++) {
        const pose = clip.poses[i];
        if (!pose) continue;
        accum += pose.duration;
        if (cycleTime < accum) {
          charState.currentPoseIndex = i;
          break;
        }
      }
    }
  }

  /**
   * Get current animation pose for a character
   */
  getCurrentPose(personId: string): AnimationPose | null {
    const charState = this.characterStates.get(personId);
    if (!charState) return null;

    const clip = this.clips.get(charState.currentState);
    if (!clip) return null;

    return clip.poses[charState.currentPoseIndex] || null;
  }

  /**
   * Map activity to animation state
   */
  private activityToAnimationState(activity: Activity, occupation: Occupation): AnimationState {
    if (activity === 'rest' && occupation === 'child') return 'idle';
    switch (activity) {
      case 'gather':
        return 'gather';
      case 'farm':
        return 'farm';
      case 'craft':
        return 'work';
      case 'construct':
        return 'build';
      case 'transport':
        return 'carry';
      case 'trade':
        return 'converse';
      case 'study':
      case 'assist':
        return 'work';
      case 'worship':
        return 'ritual';
      case 'patrol':
        return 'walk';
      case 'shelter':
        return 'rest';
      case 'flee':
        return 'run';
      case 'travel':
        return 'walk';
      case 'migrate':
        return 'run';
      case 'socialize':
        return 'converse';
      case 'rest':
        return 'rest';
      default:
        return 'idle';
    }
  }

  /**
   * Get occupation-specific idle animation
   */
  getOccupationIdleVariant(occupation: Occupation): AnimationState {
    if (occupation === 'builder') return 'work'; // Builders ready to work
    if (occupation === 'carrier' || occupation === 'child') return 'idle';
    return 'idle';
  }

  /**
   * Clear all character states (for scene unload)
   */
  dispose(): void {
    this.characterStates.clear();
  }
}
