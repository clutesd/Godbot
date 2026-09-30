import { describe, expect, it } from 'vitest';
import { societyFixture, learn } from './fixtures/settlementDevelopment';
import { SeededRandom } from '../src/sim/prng';
import { ResourceSystem } from '../src/sim/resources/ResourceSystem';
import { addMaterial, publishBulkStocks } from '../src/sim/resources/Inventory';
import { ensureProcessingAuthority } from '../src/sim/processing/FacilitySystem';
import { facilityConservationError } from '../src/sim/processing/FacilityInventory';

describe('scratch', () => {
  it('runs metallurgy then upgrades', () => {
    const { state, settlements } = societyFixture();
    const s = settlements[0]!;
    state.world.resourceDeposits = [];
    for (const town of settlements) { town.alive = town === s; town.localMaterials = {}; town.materialEconomy = undefined; town.discoveredDeposits = []; town.workedDeposits = []; town.knownRecipes = []; publishBulkStocks(town); }
    s.buildings = 30;
    learn(s, 'material-testing', 'metal-smelting', 'iron-working', 'high-temperature-ceramics', 'combustion-dynamics', 'rotary-machinery');
    for (const [id, n] of Object.entries({ timber: 60, stone: 40, 'copper-ore': 60, 'tin-ore': 30, 'iron-ore': 80, charcoal: 60, brick: 20, iron: 10 })) addMaterial(s, id, n);
    const system = new ResourceSystem(new SeededRandom('x'));
    const last: Record<string, string> = {};
    for (let m = 1; m <= 96; m++) {
      state.month = m;
      ensureProcessingAuthority(state);
      if (m % 6 === 0) for (const [id, n] of Object.entries({ 'copper-ore': 20, 'tin-ore': 10, 'iron-ore': 30, charcoal: 20, timber: 20 })) addMaterial(s, id, n);
      system.advanceMonth(state);
      for (const f of s.processing?.facilities ?? []) {
        const line = `${f.family}/${f.kind} ${f.progress < 1 ? 'p=' + f.progress.toFixed(1) : ''} ${f.status}${f.upgrade ? '>' + f.upgrade.toTier : ''} lim=${f.limiter}`;
        if (last[f.id] !== line) { console.log(m, line, 'thr=' + f.throughput.toFixed(2)); last[f.id] = line; }
        expect(facilityConservationError(f)).toBeLessThan(1e-4);
      }
      if (m === 3) console.log(JSON.stringify(s.processing?.foundingBlockers), s.alive, s.processing?.governed);
      if (m % 12 === 0) console.log('   stock', JSON.stringify(Object.fromEntries(Object.entries(s.localMaterials).filter(([, v]) => v > 0.5).map(([k, v]) => [k, +v.toFixed(0)]))));
    }
  });
});
