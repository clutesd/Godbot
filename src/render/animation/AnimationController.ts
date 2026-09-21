/**
 * AnimationController.ts
 * 
 * Manages animation states for humanoid characters.
 * Supports blending between compatible states for smooth transitions.
 */

import type { Activity, Occupation } from '../../sim/types';
import { SeededRandom } from '../../sim/prng';
import type { ResourceWorkMotion } from './ResourceWorkMotion';

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
export interface PresentationBodyTilt {
  pitch: number;
  roll: number;
}

/**
 * Persistent appearance posture is a subtle forward cue, not a permanent sideways tilt.
 * Ambient people stay nearly upright; explicit articulated work may lean more deeply.
 */
export function presentationBodyTilt(spineRotation = 0, appearancePosture = 0, allowDeepLean = false): PresentationBodyTilt {
  const inheritedPitch = Math.max(-0.035, Math.min(0.075, appearancePosture * 0.32));
  const maximumPitch = allowDeepLean ? 0.62 : 0.22;
  return {
    pitch: Math.max(-0.12, Math.min(maximumPitch, spineRotation + inheritedPitch)),
    roll: Math.max(-0.018, Math.min(0.018, appearancePosture * 0.075)),
  };
}

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
  /** 0..1 through the current keyframe, used to interpolate toward the next one. */
  poseFraction: number;
  /** Pose held when the state changed, blended out over the new clip's blendDuration. */
  previousPose: AnimationPose;
  blendFactor: number; // 0 (old pose) to 1 (new pose)
  playbackSpeed: number; // 0.8 to 1.2, slight variation per character
  phaseOffset: number; // 0 to 1, prevents synchronized crowds
  humanSeconds: number;
  stridePhase: number;
  visualSpeed?: number;
  ageMonths: number;
  carrying: boolean;
}

/**
 * Manages all animation clips and character animation states
 */
export class AnimationController {
  private readonly clips: Map<AnimationState, AnimationClip>;
  private readonly characterStates: Map<string, CharacterAnimationState>;
  private readonly seed: string;
  /** Reused so per-frame pose interpolation for hundreds of characters allocates nothing. */
  private readonly poseBuffer: AnimationPose = emptyPose();
  private readonly blendBuffer: AnimationPose = emptyPose();
  private readonly resourceBuffer: AnimationPose = emptyPose();
  private readonly humanBuffer: AnimationPose = emptyPose();

  /** Resource articulation is layered onto presentation, never mapped back into Activity. */
  resourcePose(base: AnimationPose | null, motion: ResourceWorkMotion, blend: number): AnimationPose {
    const out = this.resourceBuffer;
    if (base) copyPose(base, out);
    out.pelvisRotation = motion.twist * blend;
    out.spineRotation = motion.lean * blend;
    out.positionOffset.y = -motion.crouch * blend;
    out.headRotation = motion.basket * 0.3 * blend;
    return out;
  }

  constructor(seed: string = 'animations') {
    this.seed = seed;
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
      {
        name: 'converse-listen',
        duration: 1.15,
        pelvisRotation: -0.025,
        spineRotation: 0.025,
        headRotation: -0.09,
        leftShoulderRotation: 0.08,
        leftElbowRotation: 0.18,
        rightShoulderRotation: 0.03,
        rightElbowRotation: 0.12,
        leftHipRotation: 0,
        leftKneeRotation: 0.06,
        rightHipRotation: 0,
        rightKneeRotation: 0.06,
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
      const existing = this.characterStates.get(personId)!;
      existing.occupation = occupation;
      return existing;
    }

    const random = new SeededRandom(`${this.seed}:${personId}`);
    const state: CharacterAnimationState = {
      personId,
      occupation,
      currentState: initialState,
      elapsedTime: 0,
      currentPoseIndex: 0,
      poseFraction: 0,
      previousPose: emptyPose(),
      blendFactor: 1.0,
      playbackSpeed: 0.9 + random.float() * 0.2,
      phaseOffset: random.float(),
      humanSeconds: 0, stridePhase: random.float() * Math.PI * 2, ageMonths: 360, carrying: false,
    };

    this.characterStates.set(personId, state);
    return state;
  }

  /**
   * Update animation state based on elapsed delta time. `override` lets the renderer assert a
   * locomotion state derived from visual travel, which is authoritative over the logical activity
   * whenever the character is actually seen to move.
   */
  updateCharacterAnimation(personId: string, deltaTime: number, newActivity: Activity, override?: AnimationState,
    visualSpeed?: number, ageMonths = 360, carrying = false): void {
    const charState = this.characterStates.get(personId);
    if (!charState) return;

    // Map activity to animation state
    let newAnimState = override ?? this.activityToAnimationState(newActivity, charState.occupation);
    charState.visualSpeed = visualSpeed;
    charState.ageMonths = ageMonths;
    charState.carrying = carrying || newAnimState === 'carry';
    charState.humanSeconds += Math.max(0, deltaTime);
    if (visualSpeed !== undefined) {
      if (visualSpeed < 0.05 && (newAnimState === 'walk' || newAnimState === 'run')) newAnimState = 'idle';
      const ageStride = ageMonths < 168 ? 0.75 : ageMonths > 816 ? 0.85 : 1;
      charState.stridePhase += Math.max(0, visualSpeed) * Math.max(0, deltaTime) / (0.18 * ageStride * charState.playbackSpeed) * Math.PI * 2;
    }

    // Update animation time
    charState.elapsedTime += deltaTime;

    // Handle state transitions with blending
    if (newAnimState !== charState.currentState) {
      const currentClip = this.clips.get(charState.currentState);
      const newClip = this.clips.get(newAnimState);

      if (newClip && currentClip) {
        const held = this.samplePose(charState);
        if (held) copyPose(held, charState.previousPose);
        charState.currentState = newAnimState;
        charState.blendFactor = held ? 0 : 1;
        charState.elapsedTime = 0;
        charState.currentPoseIndex = 0;
        charState.poseFraction = 0;
      }
    }

    // Advance blend factor
    const clip = this.clips.get(charState.currentState);
    if (clip) {
      charState.blendFactor = Math.min(1.0, charState.blendFactor + deltaTime / clip.blendDuration);

      // Cycle through poses
      const totalDuration = clip.poses.reduce((sum, p) => sum + p.duration, 0);
      const cycleTime = (charState.elapsedTime * charState.playbackSpeed + charState.phaseOffset * totalDuration) % totalDuration;

      let accum = 0;
      for (let i = 0; i < clip.poses.length; i++) {
        const pose = clip.poses[i];
        if (!pose) continue;
        const start = accum;
        accum += pose.duration;
        if (cycleTime < accum) {
          charState.currentPoseIndex = i;
          charState.poseFraction = pose.duration > 0 ? (cycleTime - start) / pose.duration : 0;
          break;
        }
      }
    }
  }

  /**
   * Current pose, interpolated between keyframes and across a state change. Returns a shared
   * buffer: read it before the next call. Keyframes alone read as three discrete snapshots, which
   * is what made walk cycles look like stuttering rather than motion.
   */
  getCurrentPose(personId: string): AnimationPose | null {
    const charState = this.characterStates.get(personId);
    if (!charState) return null;
    const sampled = this.samplePose(charState);
    if (!sampled) return null;
    const blended = charState.blendFactor >= 1 ? sampled
      : lerpPose(charState.previousPose, sampled, charState.blendFactor, this.blendBuffer);
    return charState.visualSpeed === undefined ? blended : this.humanPose(charState, blended);
  }

  private humanPose(state: CharacterAnimationState, base: AnimationPose): AnimationPose {
    const out = copyPose(base, this.humanBuffer);
    const speed = state.visualSpeed ?? 0;
    const elderly = state.ageMonths > 816;
    if (speed >= 0.05) {
      const amplitude = Math.min(1, speed / 0.24) * (elderly ? 0.27 : 0.36);
      const stride = Math.sin(state.stridePhase) * amplitude;
      out.leftHipRotation = stride; out.rightHipRotation = -stride;
      out.leftKneeRotation = Math.max(0, -stride) * 1.2;
      out.rightKneeRotation = Math.max(0, stride) * 1.2;
      out.leftShoulderRotation = state.carrying ? 0.42 : -stride * 0.8;
      out.rightShoulderRotation = state.carrying ? 0.42 : stride * 0.8;
      out.spineRotation = state.carrying ? 0.12 : elderly ? 0.06 : 0.025;
      out.positionOffset.y = Math.abs(Math.cos(state.stridePhase)) * 0.018;
    } else {
      // Stop residual gait immediately, including the old pose in a transition blend.
      if (state.currentState !== 'rest') {
        out.leftHipRotation = 0; out.rightHipRotation = 0;
      }
      if (state.currentState === 'idle' || state.currentState === 'rest' || state.currentState === 'alert') {
        const t = state.humanSeconds * state.playbackSpeed + state.phaseOffset * 29;
        // A slow, smooth gesture window with long quiet intervals, not constant fidgeting.
        const p = (t % 13) / 13;
        const gesture = p < 0.32 ? Math.sin(p / 0.32 * Math.PI) ** 2 : 0;
        out.headRotation += gesture * (elderly ? 0.2 : 0.38) * Math.sin(t * 0.43);
        out.pelvisRotation += gesture * 0.075;
        out.spineRotation += gesture * 0.04;
        out.rightShoulderRotation += gesture * (state.carrying ? 0.06 : 0.23);
        out.positionOffset.y -= gesture * 0.015;
      }
    }
    return out;
  }

  private samplePose(charState: CharacterAnimationState): AnimationPose | null {
    const clip = this.clips.get(charState.currentState);
    if (!clip || clip.poses.length === 0) return null;
    const current = clip.poses[charState.currentPoseIndex];
    if (!current) return null;
    const next = clip.poses[(charState.currentPoseIndex + 1) % clip.poses.length];
    if (!next || next === current) return current;
    return lerpPose(current, next, smoothstep(charState.poseFraction), this.poseBuffer);
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
        return 'idle';
      case 'shelter':
        return 'rest';
      case 'flee':
        return 'idle';
      case 'travel':
        return 'idle';
      case 'migrate':
        return 'idle';
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

  /** Drops per-character state for people who are dead or no longer represented. */
  release(personId: string): void {
    this.characterStates.delete(personId);
  }

  get trackedCharacters(): number {
    return this.characterStates.size;
  }
}

function emptyPose(): AnimationPose {
  return {
    name: 'blend',
    duration: 0,
    pelvisRotation: 0,
    spineRotation: 0,
    headRotation: 0,
    leftShoulderRotation: 0,
    leftElbowRotation: 0,
    rightShoulderRotation: 0,
    rightElbowRotation: 0,
    leftHipRotation: 0,
    leftKneeRotation: 0,
    rightHipRotation: 0,
    rightKneeRotation: 0,
    positionOffset: { x: 0, y: 0, z: 0 },
  };
}

function copyPose(from: AnimationPose, out: AnimationPose): AnimationPose {
  return lerpPose(from, from, 0, out);
}

function lerpPose(from: AnimationPose, to: AnimationPose, t: number, out: AnimationPose): AnimationPose {
  const mix = (a: number, b: number): number => a + (b - a) * t;
  out.name = to.name;
  out.duration = to.duration;
  out.pelvisRotation = mix(from.pelvisRotation, to.pelvisRotation);
  out.spineRotation = mix(from.spineRotation, to.spineRotation);
  out.headRotation = mix(from.headRotation, to.headRotation);
  out.leftShoulderRotation = mix(from.leftShoulderRotation, to.leftShoulderRotation);
  out.leftElbowRotation = mix(from.leftElbowRotation, to.leftElbowRotation);
  out.rightShoulderRotation = mix(from.rightShoulderRotation, to.rightShoulderRotation);
  out.rightElbowRotation = mix(from.rightElbowRotation, to.rightElbowRotation);
  out.leftHipRotation = mix(from.leftHipRotation, to.leftHipRotation);
  out.leftKneeRotation = mix(from.leftKneeRotation, to.leftKneeRotation);
  out.rightHipRotation = mix(from.rightHipRotation, to.rightHipRotation);
  out.rightKneeRotation = mix(from.rightKneeRotation, to.rightKneeRotation);
  out.positionOffset.x = mix(from.positionOffset.x, to.positionOffset.x);
  out.positionOffset.y = mix(from.positionOffset.y, to.positionOffset.y);
  out.positionOffset.z = mix(from.positionOffset.z, to.positionOffset.z);
  return out;
}

function smoothstep(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}
