/**
 * TransitionTimeline.ts
 * 
 * Manages multi-frame visual transitions decoupled from simulation tick frequency.
 * 
 * Example: Building founded at sim month 140. The renderer displays:
 *   - Month 140.0-140.2: Foundation meshes appear and settle
 *   - Month 140.2-140.4: Frame/structure rises
 *   - Month 140.4-140.6: Partial walls visible
 *   - Month 140.6+: Building complete
 * 
 * This happens smoothly over presentation time, even if the next sim tick is month 142+.
 */

export type TransitionKind =
  | 'building-construction'
  | 'building-upgrade'
  | 'building-damage'
  | 'building-ruin'
  | 'building-reclaim'
  | 'route-appear'
  | 'route-fade'
  | 'settlement-expand';

export interface TransitionFrame {
  timestamp: number; // Presentation seconds into the transition
  progress: number; // 0 (start) to 1 (complete)
  visualState: Record<string, unknown>; // What to render at this frame
}

export interface Transition {
  id: string;
  kind: TransitionKind;
  entityId: string;
  startTime: number; // Presentation time when transition began (seconds)
  duration: number; // How long the transition plays (seconds)
  frames: TransitionFrame[];
  associatedData: Record<string, unknown>;
  isComplete: boolean;
}

/**
 * Manages all active transitions
 */
export class TransitionTimeline {
  private readonly activeTransitions: Map<string, Transition>;
  private transitionIdCounter: number = 0;
  private currentPresentationTime: number = 0;

  constructor() {
    this.activeTransitions = new Map();
  }

  /**
   * Update presentation time (call once per render frame)
   */
  updateTime(presentationDeltaSeconds: number): void {
    this.currentPresentationTime += presentationDeltaSeconds;

    // Mark completed transitions
    for (const transition of this.activeTransitions.values()) {
      if (this.currentPresentationTime >= transition.startTime + transition.duration) {
        transition.isComplete = true;
      }
    }
  }

  /**
   * Create a building construction transition
   */
  createBuildingConstruction(
    entityId: string,
    buildingData: Record<string, unknown>,
  ): Transition {
    const transitionId = `building-construct-${this.transitionIdCounter++}`;

    // Standard construction takes 6 months of presentation time at default pacing
    // (assuming ~3 seconds per presentation month)
    const constructionDuration = 6.0; // seconds

    const frames: TransitionFrame[] = [
      {
        timestamp: 0,
        progress: 0,
        visualState: {
          stage: 'foundation',
          visibility: 0.3,
          opacityScale: 0.5,
        },
      },
      {
        timestamp: 1.5,
        progress: 0.25,
        visualState: {
          stage: 'frame',
          visibility: 0.6,
          opacityScale: 0.7,
        },
      },
      {
        timestamp: 3.0,
        progress: 0.5,
        visualState: {
          stage: 'partial-walls',
          visibility: 0.85,
          opacityScale: 0.9,
        },
      },
      {
        timestamp: 4.5,
        progress: 0.75,
        visualState: {
          stage: 'roof',
          visibility: 0.95,
          opacityScale: 0.95,
        },
      },
      {
        timestamp: 6.0,
        progress: 1.0,
        visualState: {
          stage: 'complete',
          visibility: 1.0,
          opacityScale: 1.0,
        },
      },
    ];

    const transition: Transition = {
      id: transitionId,
      kind: 'building-construction',
      entityId,
      startTime: this.currentPresentationTime,
      duration: constructionDuration,
      frames,
      associatedData: buildingData,
      isComplete: false,
    };

    this.activeTransitions.set(transitionId, transition);
    return transition;
  }

  /**
   * Create a building upgrade transition
   */
  createBuildingUpgrade(
    entityId: string,
    fromStage: number,
    toStage: number,
    buildingData: Record<string, unknown>,
  ): Transition {
    const transitionId = `building-upgrade-${this.transitionIdCounter++}`;

    // Upgrade takes about 3 months presentation time
    const upgradeDuration = 3.0;

    const frames: TransitionFrame[] = [
      {
        timestamp: 0,
        progress: 0,
        visualState: {
          stage: 'old',
          blendFactor: 1.0,
          visibility: 1.0,
        },
      },
      {
        timestamp: 1.5,
        progress: 0.5,
        visualState: {
          stage: 'transitioning',
          blendFactor: 0.5,
          visibility: 0.95,
        },
      },
      {
        timestamp: 3.0,
        progress: 1.0,
        visualState: {
          stage: 'new',
          blendFactor: 0,
          visibility: 1.0,
        },
      },
    ];

    const transition: Transition = {
      id: transitionId,
      kind: 'building-upgrade',
      entityId,
      startTime: this.currentPresentationTime,
      duration: upgradeDuration,
      frames,
      associatedData: { ...buildingData, fromStage, toStage },
      isComplete: false,
    };

    this.activeTransitions.set(transitionId, transition);
    return transition;
  }

  /**
   * Create a building damage transition
   */
  createBuildingDamage(
    entityId: string,
    damageLevel: number, // 0 to 1
  ): Transition {
    const transitionId = `building-damage-${this.transitionIdCounter++}`;

    // Damage is sudden (catastrophe), so faster transition
    const damageDuration = 0.5;

    const frames: TransitionFrame[] = [
      {
        timestamp: 0,
        progress: 0,
        visualState: { damage: 0, crackVisibility: 0 },
      },
      {
        timestamp: 0.25,
        progress: 0.5,
        visualState: { damage: damageLevel * 0.5, crackVisibility: 0.5 },
      },
      {
        timestamp: 0.5,
        progress: 1.0,
        visualState: { damage: damageLevel, crackVisibility: 1.0 },
      },
    ];

    const transition: Transition = {
      id: transitionId,
      kind: 'building-damage',
      entityId,
      startTime: this.currentPresentationTime,
      duration: damageDuration,
      frames,
      associatedData: { damageLevel },
      isComplete: false,
    };

    this.activeTransitions.set(transitionId, transition);
    return transition;
  }

  /**
   * Create a building ruin transition (decay over time)
   */
  createBuildingRuin(entityId: string): Transition {
    const transitionId = `building-ruin-${this.transitionIdCounter++}`;

    // Ruins decay over many months
    const ruinDuration = 24.0; // 24 presentation seconds = ~24 sim months

    const frames: TransitionFrame[] = [
      {
        timestamp: 0,
        progress: 0,
        visualState: { stage: 'damaged', overgrowth: 0, decay: 0 },
      },
      {
        timestamp: 6,
        progress: 0.25,
        visualState: { stage: 'ruined', overgrowth: 0.2, decay: 0.3 },
      },
      {
        timestamp: 12,
        progress: 0.5,
        visualState: { stage: 'overgrown', overgrowth: 0.5, decay: 0.6 },
      },
      {
        timestamp: 18,
        progress: 0.75,
        visualState: { stage: 'reclaimed', overgrowth: 0.8, decay: 0.8 },
      },
      {
        timestamp: 24,
        progress: 1.0,
        visualState: { stage: 'archaeological', overgrowth: 1.0, decay: 1.0 },
      },
    ];

    const transition: Transition = {
      id: transitionId,
      kind: 'building-ruin',
      entityId,
      startTime: this.currentPresentationTime,
      duration: ruinDuration,
      frames,
      associatedData: {},
      isComplete: false,
    };

    this.activeTransitions.set(transitionId, transition);
    return transition;
  }

  /**
   * Create a route appearance transition
   */
  createRouteAppear(routeId: string, routeData: Record<string, unknown>): Transition {
    const transitionId = `route-appear-${this.transitionIdCounter++}`;

    const appearDuration = 2.0;

    const frames: TransitionFrame[] = [
      {
        timestamp: 0,
        progress: 0,
        visualState: { opacity: 0, segmentVisibility: 0 },
      },
      {
        timestamp: 1.0,
        progress: 0.5,
        visualState: { opacity: 0.5, segmentVisibility: 0.5 },
      },
      {
        timestamp: 2.0,
        progress: 1.0,
        visualState: { opacity: 1.0, segmentVisibility: 1.0 },
      },
    ];

    const transition: Transition = {
      id: transitionId,
      kind: 'route-appear',
      entityId: routeId,
      startTime: this.currentPresentationTime,
      duration: appearDuration,
      frames,
      associatedData: routeData,
      isComplete: false,
    };

    this.activeTransitions.set(transitionId, transition);
    return transition;
  }

  /**
   * Get current visual state for a transition
   */
  getCurrentFrameForTransition(transitionId: string): TransitionFrame | null {
    const transition = this.activeTransitions.get(transitionId);
    if (!transition) return null;

    const elapsedTime = Math.min(
      this.currentPresentationTime - transition.startTime,
      transition.duration,
    );

    // Optionally interpolate between frames for smoother motion
    return this.interpolateFrame(transition, elapsedTime);
  }

  /**
   * Interpolate between two frames for smooth animation
   */
  private interpolateFrame(transition: Transition, elapsedTime: number): TransitionFrame {
    let frameA = transition.frames[0] ?? { timestamp: 0, progress: 0, visualState: {} };
    let frameB = transition.frames[transition.frames.length - 1] ?? frameA;

    for (let i = 0; i < transition.frames.length - 1; i++) {
      const current = transition.frames[i];
      const next = transition.frames[i + 1];
      if (!current || !next) continue;
      if (
        current.timestamp <= elapsedTime &&
        elapsedTime < next.timestamp
      ) {
        frameA = current;
        frameB = next;
        break;
      }
    }

    const timeDiff = frameB.timestamp - frameA.timestamp;
    const t = timeDiff > 0 ? (elapsedTime - frameA.timestamp) / timeDiff : 1;

    // Linear interpolation of progress
    const interpolatedProgress = frameA.progress + (frameB.progress - frameA.progress) * t;

    // Merge visual states (simple lerp for numeric values)
    const interpolatedState: Record<string, unknown> = {};
    const allKeys = new Set([
      ...Object.keys(frameA.visualState),
      ...Object.keys(frameB.visualState),
    ]);

    for (const key of allKeys) {
      const valueA = frameA.visualState[key];
      const valueB = frameB.visualState[key];

      if (typeof valueA === 'number' && typeof valueB === 'number') {
        interpolatedState[key] = valueA + (valueB - valueA) * t;
      } else {
        // For non-numeric values, use frameA until halfway through
        interpolatedState[key] = t < 0.5 ? valueA : valueB;
      }
    }

    return {
      timestamp: elapsedTime,
      progress: interpolatedProgress,
      visualState: interpolatedState,
    };
  }

  /**
   * Get all active transitions for a specific entity
   */
  getTransitionsForEntity(entityId: string): Transition[] {
    return Array.from(this.activeTransitions.values()).filter(
      t => t.entityId === entityId && !t.isComplete,
    );
  }

  /**
   * Get all active transitions
   */
  getActiveTransitions(): Transition[] {
    return Array.from(this.activeTransitions.values()).filter(t => !t.isComplete);
  }

  /**
   * Remove completed transitions
   */
  pruneCompleted(): void {
    for (const [id, transition] of this.activeTransitions) {
      if (transition.isComplete) {
        this.activeTransitions.delete(id);
      }
    }
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.activeTransitions.clear();
  }
}
