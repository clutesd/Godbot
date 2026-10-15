/** Controlled source inputs for architectural review; no geometry or material overrides. */
import type { AssetConfig } from '../render/assets/AssetBuilder';
import { PERIOD_DRIVE, type ArchitecturalPeriod } from '../render/architecture/ArchitecturalPeriod';
import type { BuildingArchetype } from '../render/architecture/BuildingArchetype';
import { MATERIAL_SCENARIOS, scenarioEvidence } from './architectureBrowserModel';
import type { CultureStyle } from '../sim/types';
export interface FlagshipCase {
    id: string;
    title: string;
    period: ArchitecturalPeriod;
    config: AssetConfig;
}
const earth: CultureStyle = { primary: '#bd9870', secondary: '#5c6851', accent: '#e6d5a5', symbol: 'river-eye', pattern: 'wave', nameSyllables: ['sa'] };
const wood: CultureStyle = { primary: '#aa7557', secondary: '#3b5349', accent: '#d3ba86', symbol: 'mountain-knot', pattern: 'crossweave', nameSyllables: ['oak'] };
const masonry: CultureStyle = { primary: '#b88369', secondary: '#454b4e', accent: '#d8bf83', symbol: 'sun-step', pattern: 'chevron', nameSyllables: ['ford'] };
function request(id: string, title: string, archetype: BuildingArchetype, period: ArchitecturalPeriod, scenario: string, culture: CultureStyle, arid = false): FlagshipCase {
    const drive = PERIOD_DRIVE[period], evidence = scenarioEvidence(MATERIAL_SCENARIOS.find(s => s.id === scenario)!, period);
    const housing = archetype === 'house';
    return { id, title, period, config: { seed: `flagship:${id}`, archetype, era: drive.era, culture, prosperity: .7,
            grammarContext: { temperature: arid ? .82 : .52, moisture: arid ? .2 : .5 },
            development: { need: housing ? 'housing' : 'food', form: housing ? 'dwelling' : 'store', name: title, level: drive.level, material: evidence.material ?? 'timber',
                cultureId: id, style: culture, services: {}, reasons: ['architectural review'], capabilities: evidence.capabilities, materialCost: evidence.materialCost,
                cost: { food: 0, wood: 12, minerals: 8, goods: 2, wealth: 2 }, labor: 12 } } };
}
export const ARCHITECTURE_FLAGSHIPS: readonly FlagshipCase[] = [
    request('court-house', 'Earth courtyard dwelling', 'house', 'classical', 'earth', earth, true),
    request('town-house', 'Timber framed street house', 'house', 'medieval', 'timber', wood),
    request('threshing-barn', 'Great threshing barn', 'barn', 'medieval', 'timber', wood),
    request('stable-yard', 'Estate stable yard', 'stable', 'earlyModern', 'stone', masonry),
    request('grain-store', 'Brick granary and loading hoist', 'granary', 'industrial', 'brick', masonry),
    request('smock-mill', 'Working smock mill', 'smock-mill', 'earlyModern', 'timber', wood),
];
