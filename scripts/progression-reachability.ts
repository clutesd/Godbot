import { auditProgressionReachability, progressionDependencyGraph } from '../src/sim/knowledge/ReachabilityAudit';

const nodes = progressionDependencyGraph();
const result = auditProgressionReachability(nodes);
console.log(JSON.stringify({ nodes: nodes.length, graph: nodes, ...result }, null, 2));
if (result.unresolved.length || result.missingReferences.length) process.exitCode = 1;
