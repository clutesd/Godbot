import { KNOWLEDGE_CATALOG } from './catalog';
import { MATERIAL_BY_ID, RECIPE_CATALOG, RESOURCE_CATALOG } from '../resources/catalog';
import { MATERIAL_RECIPES, RAW_MATERIAL_KINDS } from '../resources/MaterialEconomy';
import { GENERATORS } from '../energy/Generation';
import { facilityFamilies } from '../processing/FacilityCatalog';

export interface DependencyNode { id: string; paths: string[][] }

/** OR paths of AND prerequisites. A least fixed point distinguishes a harmless alternative
 * cycle from a hard deadlock. This is structural possibility, not a promise that a particular
 * landscape has deposits, crews, reserves, institutions, or enough experiment time. */
export function progressionDependencyGraph(): DependencyNode[] {
  const nodes = new Map<string, DependencyNode>();
  const add = (id: string, path: string[]) => {
    const node = nodes.get(id) ?? { id, paths: [] };
    node.paths.push([...new Set(path)]); nodes.set(id, node);
  };
  const k = (id: string) => `knowledge:${id}`;
  const m = (id: string) => `material:${id}`;
  add('population', []); add('institutions', ['population']); add('wealth', ['population']);
  add('food', ['population']); add('infrastructure:roads', ['population', m('timber')]);
  for (const resource of RESOURCE_CATALOG) {
    const needs = [resource.understandingKnowledge, (resource.surfaceShare ?? 1) <= 0 ? resource.extractionKnowledge : undefined]
      .filter((id): id is string => !!id).map(k);
    add(m(resource.id), needs);
  }
  for (const id of RAW_MATERIAL_KINDS) if (!nodes.has(m(id))) add(m(id), ['population']);
  add('fuel', [m('timber')]);
  for (const recipe of RECIPE_CATALOG) {
    const path = [...recipe.requiredKnowledge.map(n => k(n.id)), ...Object.keys(recipe.inputs).map(m)];
    if (recipe.energy) path.push(m(recipe.energy.fuel));
    path.push(...Object.keys(recipe.requiredInfrastructure ?? {}).map(id => `infrastructure:${id}`));
    for (const id of [...Object.keys(recipe.outputs), ...Object.keys(recipe.byproducts ?? {})]) add(m(id), path);
    add('goods', path);
  }
  for (const recipe of MATERIAL_RECIPES) {
    const path = [...recipe.knowledge.map(n => k(n.id)), ...Object.keys(recipe.inputs).map(m)];
    for (const id of Object.keys(recipe.outputs)) add(m(id), path);
    add('goods', path);
  }
  add('infrastructure:workshops', [k('pottery-firing'), m('timber'), m('stone'), 'goods', 'wealth']);
  add('infrastructure:workshops', [k('metal-smelting'), m('timber'), m('stone'), 'goods', 'wealth']);
  add('infrastructure:archives', [k('durable-records'), 'infrastructure:workshops']);
  add('infrastructure:ports', [k('buoyancy-currents'), m('timber'), 'goods', 'wealth']);
  add('infrastructure:bridges', [k('improved-roads'), m('stone'), m('timber')]);
  add('infrastructure:rail', [k('rail-transport'), m('iron'), m('timber')]);
  add('productive-power', ['power:mechanical']); add('productive-power', ['power:electric']);
  add('industry', [k('mechanical-power'), k('precision-manufacturing'), k('iron-working'), 'infrastructure:workshops', 'infrastructure:roads', 'productive-power', 'productive-facility']);
  add('industry', [k('mechanical-power'), k('industrial-chemistry'), 'infrastructure:workshops', 'infrastructure:roads', 'productive-power', 'productive-facility']);
  add('industry', [k('electrical-generation'), k('precision-manufacturing'), 'infrastructure:workshops', 'infrastructure:roads', 'productive-power', 'productive-facility']);
  add('infrastructure:factories', ['industry', m('stone'), 'goods', 'wealth']);
  for (const g of GENERATORS) {
    const path = [...g.knowledge.map(k), ...Object.keys(g.cost).map(m), 'population'];
    if (g.fuel) path.push(g.fuel === 'food' ? 'food' : m(g.fuel));
    add(`generator:${g.kind}`, path); add(`power:${g.carrier}`, [`generator:${g.kind}`]);
  }
  add('infrastructure:power', ['power:electric']);
  add(m('spent-nuclear-fuel'), ['generator:nuclear', m('nuclear-fuel')]);
  for (const family of facilityFamilies()) for (const tier of family.tiers) {
    const foundations = tier.knowledge.map(n => k(n.id));
    let paths = tier.knowledgeAny?.length ? tier.knowledgeAny.map(path => [...foundations, ...path.map(n => k(n.id))]) : [foundations];
    for (const line of tier.build.lines) paths = paths.flatMap(path => line.options.map(id => [...path, m(id)]));
    if (tier.power.fallback <= 0) paths = paths.map(path => [...path, `power:${tier.power.mode === 'either' ? 'mechanical' : tier.power.mode}`]);
    const facility = `facility:${family.id}:${tier.tier}`;
    for (const path of paths) add(facility, path);
    add('productive-facility', [facility]);
  }
  for (const definition of KNOWLEDGE_CATALOG) {
    const c = definition.conditions;
    const shared = (c.foundations ?? []).map(n => k(n.id));
    shared.push(...Object.keys(c.materials ?? {}).map(m));
    for (const id of Object.keys(c.resources ?? {})) shared.push(id === 'wood' ? m('timber') : id === 'minerals' ? m('stone') : id);
    if (c.minFuel) shared.push('fuel');
    if (c.minIndustrialIntensity) shared.push('industry');
    shared.push(...Object.keys(c.minInfrastructure ?? {}).map(id => `infrastructure:${id}`));
    let paths = (c.alternatives?.length ? c.alternatives : [[]]).map(path => [...shared, ...path.map(n => k(n.id))]);
    if (c.materialsAny) paths = paths.flatMap(path => Object.keys(c.materialsAny!).map(id => [...path, m(id)]));
    for (const path of paths) add(k(definition.id), path);
  }
  // Detect typos and declared outputs that have no source instead of quietly seeding them.
  for (const id of MATERIAL_BY_ID.keys()) if (!nodes.has(m(id))) nodes.set(m(id), { id: m(id), paths: [] });
  return [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function auditProgressionReachability(nodes = progressionDependencyGraph()) {
  const reachable = new Set<string>();
  for (;;) {
    const before = reachable.size;
    for (const node of nodes) if (node.paths.some(path => path.every(id => reachable.has(id)))) reachable.add(node.id);
    if (reachable.size === before) break;
  }
  const unresolved = nodes.filter(n => !reachable.has(n.id));
  const missingReferences = [...new Set(nodes.flatMap(n => n.paths.flat()).filter(id => !nodes.some(n => n.id === id)))].sort();
  // Report strongly connected components even when an alternative path breaks their cycle.
  // Reachability, rather than the mere presence of a cycle, determines a hard deadlock.
  const byId = new Map(nodes.map(n => [n.id, n]));
  const index = new Map<string, number>(), low = new Map<string, number>();
  const stack: string[] = [], pending = new Set<string>(), cycles: string[][] = [];
  let cursor = 0;
  const visit = (id: string): void => {
    index.set(id, cursor); low.set(id, cursor++); stack.push(id); pending.add(id);
    const edges = [...new Set(byId.get(id)!.paths.flat())].filter(next => byId.has(next));
    for (const next of edges) {
      if (!index.has(next)) { visit(next); low.set(id, Math.min(low.get(id)!, low.get(next)!)); }
      else if (pending.has(next)) low.set(id, Math.min(low.get(id)!, index.get(next)!));
    }
    if (low.get(id) !== index.get(id)) return;
    const component: string[] = [];
    for (;;) { const next = stack.pop()!; pending.delete(next); component.push(next); if (next === id) break; }
    if (component.length > 1 || edges.includes(id)) cycles.push(component.sort());
  };
  for (const node of nodes) if (!index.has(node.id)) visit(node.id);
  return { reachable: [...reachable].sort(), unresolved, missingReferences, cycles,
    unresolvedCycles: cycles.filter(component => component.some(id => !reachable.has(id))) };
}
