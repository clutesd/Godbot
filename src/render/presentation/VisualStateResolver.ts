/**
 * VisualStateResolver.ts
 * 
 * Interprets simulation state changes into visual presentation events.
 * Acts as the bridge between SimulationState and RenderedState, solving the continuity problem.
 * 
 * When the simulation says "building exists at month 140", this layer decides that the visual
 * system will render the building's construction over the next several seconds: foundation,
 * frame, partial walls, completed structure.
 */

export type VisualEventKind =
  | 'building-founded'
  | 'building-upgraded'
  | 'building-damaged'
  | 'building-ruined'
  | 'building-reclaimed'
  | 'route-opened'
  | 'route-closed'
  | 'route-damaged'
  | 'settlement-conquered'
  | 'settlement-recovered'
  | 'infrastructure-added'
  | 'disaster-struck';

export interface VisualEvent {
  kind: VisualEventKind;
  entityId: string; // building ID, route ID, settlement ID, etc.
  timestamp: number; // Simulation month when event occurred
  associatedData: Record<string, unknown>;
}

export interface VisualEntity {
  id: string;
  kind: 'building' | 'route' | 'settlement';
  simState: Record<string, unknown>; // Current simulation state
  visualState: Record<string, unknown>; // Rendered/visual state
  lastUpdateMonth: number;
  transitionInProgress: boolean;
}

/**
 * Tracks visual entities and detects state changes
 */
export class VisualStateResolver {
  private readonly entities: Map<string, VisualEntity>;
  private readonly recentEvents: VisualEvent[];
  private maxEventHistory: number = 1000;

  constructor() {
    this.entities = new Map();
    this.recentEvents = [];
  }

  /**
   * Register or update a visual entity from simulation state
   */
  trackEntity(
    id: string,
    kind: 'building' | 'route' | 'settlement',
    simState: Record<string, unknown>,
    currentMonth: number,
  ): VisualEvent | null {
    const existing = this.entities.get(id);

    if (!existing) {
      // New entity: emit "founded" event
      const newEntity: VisualEntity = {
        id,
        kind,
        simState: { ...simState },
        visualState: {},
        lastUpdateMonth: currentMonth,
        transitionInProgress: true,
      };
      this.entities.set(id, newEntity);

      const event: VisualEvent = {
        kind: kind === 'building' ? 'building-founded' : kind === 'route' ? 'route-opened' : 'settlement-recovered',
        entityId: id,
        timestamp: currentMonth,
        associatedData: simState,
      };

      this.recordEvent(event);
      return event;
    }

    // Check for state changes
    const event = this.detectStateChange(existing, simState, kind, currentMonth);
    if (event) {
      this.recordEvent(event);
    }

    // Update sim state
    existing.simState = { ...simState };
    existing.lastUpdateMonth = currentMonth;

    return event || null;
  }

  /**
   * Detect changes in entity state and emit appropriate events
   */
  private detectStateChange(
    entity: VisualEntity,
    newSimState: Record<string, unknown>,
    kind: 'building' | 'route' | 'settlement',
    currentMonth: number,
  ): VisualEvent | null {
    // Check for damage
    if (newSimState.damaged && !entity.simState.damaged) {
      return {
        kind: 'building-damaged',
        entityId: entity.id,
        timestamp: currentMonth,
        associatedData: { damageLevel: newSimState.damageLevel || 0.5 },
      };
    }

    // Check for destruction/ruin
    if (newSimState.ruined && !entity.simState.ruined) {
      return {
        kind: 'building-ruined',
        entityId: entity.id,
        timestamp: currentMonth,
        associatedData: { ruinType: newSimState.ruinType || 'generic' },
      };
    }

    // Check for reclamation/rebuilding
    if (newSimState.reclaimed && !entity.simState.reclaimed) {
      return {
        kind: 'building-reclaimed',
        entityId: entity.id,
        timestamp: currentMonth,
        associatedData: {},
      };
    }

    // Check for upgrades
    if (
      kind === 'building' &&
      newSimState.stage &&
      entity.simState.stage &&
      newSimState.stage > entity.simState.stage
    ) {
      return {
        kind: 'building-upgraded',
        entityId: entity.id,
        timestamp: currentMonth,
        associatedData: { fromStage: entity.simState.stage, toStage: newSimState.stage },
      };
    }

    // Check for infrastructure additions
    if (kind === 'settlement' && newSimState.infrastructure) {
      const oldInfra = (entity.simState.infrastructure ?? {}) as Record<string, unknown>;
      const newInfra = newSimState.infrastructure as Record<string, unknown>;
      for (const [infraType, count] of Object.entries(newInfra)) {
        const nextValue = typeof count === 'number' ? count : 0;
        const previousValue = typeof oldInfra[infraType] === 'number' ? oldInfra[infraType] : 0;
        if (nextValue > previousValue) {
          return {
            kind: 'infrastructure-added',
            entityId: entity.id,
            timestamp: currentMonth,
            associatedData: { infraType, newCount: nextValue },
          };
        }
      }
    }

    return null;
  }

  /**
   * Record a visual event and maintain history
   */
  private recordEvent(event: VisualEvent): void {
    this.recentEvents.push(event);

    // Trim old events
    if (this.recentEvents.length > this.maxEventHistory) {
      this.recentEvents.splice(0, this.recentEvents.length - this.maxEventHistory);
    }
  }

  /**
   * Get all unprocessed visual events since a given timestamp
   */
  getUnprocessedEvents(sinceMonth: number): VisualEvent[] {
    return this.recentEvents.filter(e => e.timestamp > sinceMonth);
  }

  /**
   * Get entity for direct inspection
   */
  getEntity(id: string): VisualEntity | undefined {
    return this.entities.get(id);
  }

  /**
   * Mark entity as no longer transitioning
   */
  setTransitionComplete(id: string): void {
    const entity = this.entities.get(id);
    if (entity) {
      entity.transitionInProgress = false;
    }
  }

  /**
   * Clean up entity (on deletion)
   */
  removeEntity(id: string): void {
    this.entities.delete(id);
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.entities.clear();
    this.recentEvents.length = 0;
  }
}
