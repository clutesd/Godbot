import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('people instance colour material contract', () => {
  it('does not combine missing vertex colours with InstancedMesh instance colours', () => {
    const source = readFileSync(new URL('../src/render/GodboxRenderer.ts', import.meta.url), 'utf8');
    const start = source.indexOf('const visiblePersonBudget');
    const end = source.indexOf('this.syncSettlements(true);', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const peopleMaterialSection = source.slice(start, end);

    expect(peopleMaterialSection).toContain('new THREE.InstancedMesh');
    expect(peopleMaterialSection).not.toContain('vertexColors: true');
  });
});
