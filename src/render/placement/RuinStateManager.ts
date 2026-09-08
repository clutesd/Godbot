/**
 * RuinStateManager.ts
 * 
 * Manages persistent damage and ruin lifecycle.
 * 
 * Buildings don't disappear; they transition through stages:
 * - Active: Full function, no damage
 * - Damaged: Cracks visible, reduced function
 * - Ruined: Collapsed/abandoned, archaeological interest
 * - Overgrown: Nature reclaiming (vines, trees)
 * - Reclaimed: Mostly archaeological layer, minimal structure
 * 
 * This system prevents ruins from fading away and ensures civilizations
 * leave permanent marks on the landscape.
 */

export type RuinStage = 'active' | 'damaged' | 'ruined' | 'overgrown' | 'reclaimed' | 'archaeological';

export interface RuinState {
  id: string;
  entityId: string; // Building, settlement, or route ID
  stage: RuinStage;
  damageLevel: number; // 0 (pristine) to 1 (completely destroyed)
  ruinedSinceMonth: number; // Month when building transitioned to ruined
  overgrowthLevel: number; // 0 (bare stone) to 1 (completely overgrown)
  decayLevel: number; // 0 (intact) to 1 (completely degraded)
  culturalValue: number; // How much civilization values preserving this ruin (0-1)
  discoveryProbability: number; // Archaeological interest
}

/**
 * Persistent ruin state tracker
 */
export class RuinStateManager {
  private readonly ruins: Map<string, RuinState>;

  constructor() {
    this.ruins = new Map();
  }

  private createRuinState(entityId: string): RuinState {
    return {
      id: `ruin-${entityId}`,
      entityId,
      stage: 'active',
      damageLevel: 0,
      ruinedSinceMonth: 0,
      overgrowthLevel: 0,
      decayLevel: 0,
      culturalValue: 0.5,
      discoveryProbability: 0,
    };
  }

  /**
   * Mark a building as damaged
   */
  recordDamage(entityId: string, damageLevel: number): void {
    let ruin = this.getRuinState(entityId);

    if (!ruin) {
      ruin = this.createRuinState(entityId);
      this.ruins.set(entityId, ruin);
    }

    if (damageLevel > 0) {
      ruin.stage = 'damaged';
      ruin.damageLevel = Math.max(ruin.damageLevel, damageLevel);
    }
  }

  /**
   * Mark a building as ruined (collapsed/abandoned)
   */
  recordRuin(entityId: string, currentMonth: number): void {
    let ruin = this.getRuinState(entityId);

    if (!ruin) {
      ruin = this.createRuinState(entityId);
      this.ruins.set(entityId, ruin);
    }

    ruin.stage = 'ruined';
    ruin.ruinedSinceMonth = currentMonth;
    ruin.damageLevel = 1.0; // Fully destroyed
  }

  /**
   * Update ruin decay over time (call each sim month)
   */
  updateDecay(currentMonth: number): void {
    for (const ruin of this.ruins.values()) {
      if (ruin.stage === 'ruined' || ruin.stage === 'overgrown' || ruin.stage === 'reclaimed') {
        const monthsSinceRuin = currentMonth - ruin.ruinedSinceMonth;

        // Progression timeline (in months)
        if (monthsSinceRuin < 6) {
          ruin.stage = 'ruined';
          ruin.overgrowthLevel = monthsSinceRuin / 6 * 0.2; // Slow initial overgrowth
        } else if (monthsSinceRuin < 12) {
          ruin.stage = 'overgrown';
          ruin.overgrowthLevel = 0.2 + ((monthsSinceRuin - 6) / 6) * 0.3; // 0.2-0.5
        } else if (monthsSinceRuin < 24) {
          ruin.stage = 'reclaimed';
          ruin.overgrowthLevel = 0.5 + ((monthsSinceRuin - 12) / 12) * 0.4; // 0.5-0.9
        } else {
          ruin.stage = 'archaeological';
          ruin.overgrowthLevel = Math.min(1.0, 0.9 + (monthsSinceRuin - 24) / 120); // Asymptotic to 1.0
        }

        // Decay accelerates with time
        ruin.decayLevel = Math.min(1.0, ruin.decayLevel + 0.005 * (1 + monthsSinceRuin / 100));
      }
    }
  }

  /**
   * Get ruin state by entity ID
   */
  getRuinState(entityId: string): RuinState | undefined {
    return this.ruins.get(entityId);
  }

  /**
   * Check if entity is ruined
   */
  isRuined(entityId: string): boolean {
    const ruin = this.ruins.get(entityId);
    return ruin ? ruin.stage !== 'active' && ruin.stage !== 'damaged' : false;
  }

  /**
   * Get all ruins in a specific stage
   */
  getRuinsByStage(stage: RuinStage): RuinState[] {
    return Array.from(this.ruins.values()).filter(r => r.stage === stage);
  }

  /**
   * Calculate visual parameters for rendering
   */
  getVisualRenderParameters(entityId: string): {
    opacity: number; // Fade with overgrowth
    crackVisibility: number; // Show cracks based on damage
    overgrowthScale: number; // Vines, moss scale
    decayColor: number; // Shift toward brown/gray
  } {
    const ruin = this.ruins.get(entityId);

    if (!ruin || ruin.stage === 'active') {
      return {
        opacity: 1.0,
        crackVisibility: 0,
        overgrowthScale: 0,
        decayColor: 0,
      };
    }

    return {
      opacity: Math.max(0.3, 1.0 - ruin.overgrowthLevel * 0.4), // Slight transparency with overgrowth
      crackVisibility: ruin.damageLevel,
      overgrowthScale: ruin.overgrowthLevel,
      decayColor: ruin.decayLevel, // Interpolate color toward ancient brown
    };
  }

  /**
   * Attempt to restore/rebuild a ruin (cultural action)
   */
  attemptRestoration(
    entityId: string,
    restorationEffort: number, // 0-1 (cultural effort to restore)
  ): {
    success: boolean;
    newDamage?: number;
  } {
    const ruin = this.ruins.get(entityId);
    if (!ruin) {
      return { success: false };
    }

    // Restoration cost increases with decay
    const restorationCost = ruin.decayLevel * 0.8 + ruin.damageLevel * 0.2;

    if (restorationEffort > restorationCost) {
      ruin.stage = 'active';
      ruin.damageLevel = Math.max(0, ruin.damageLevel - 0.3);
      ruin.overgrowthLevel = 0;
      return { success: true, newDamage: ruin.damageLevel };
    }

    return { success: false };
  }

  /**
   * Get all ruins (for statistics, archaeology)
   */
  getAllRuins(): RuinState[] {
    return Array.from(this.ruins.values());
  }

  /**
   * Get archaeology value of all ruins (for cultural/scientific interest)
   */
  getArchaeologyValue(): number {
    let total = 0;

    for (const ruin of this.ruins.values()) {
      if (ruin.stage === 'archaeological' || ruin.stage === 'reclaimed') {
        // Older ruins are more valuable archaeologically
        const monthsAncient = Math.max(0, 1000 - (ruin.ruinedSinceMonth - 0)); // Simplified
        total += Math.min(1.0, monthsAncient / 1000) * ruin.culturalValue;
      }
    }

    return total;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalRuins: number;
    byStage: Record<RuinStage, number>;
    averageDamage: number;
    averageDecay: number;
  } {
    const byStage: Record<RuinStage, number> = {
      active: 0,
      damaged: 0,
      ruined: 0,
      overgrown: 0,
      reclaimed: 0,
      archaeological: 0,
    };

    let damageSum = 0;
    let decaySum = 0;

    for (const ruin of this.ruins.values()) {
      byStage[ruin.stage]++;
      damageSum += ruin.damageLevel;
      decaySum += ruin.decayLevel;
    }

    return {
      totalRuins: this.ruins.size,
      byStage,
      averageDamage: this.ruins.size > 0 ? damageSum / this.ruins.size : 0,
      averageDecay: this.ruins.size > 0 ? decaySum / this.ruins.size : 0,
    };
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.ruins.clear();
  }
}
