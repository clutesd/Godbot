"""Compact inspectable results from the committed headless audit. No simulation mutations."""
import argparse
import json
from collections import Counter
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--before', nargs='*', default=[])
parser.add_argument('--after', nargs='*', default=[])
parser.add_argument('--out', default='docs/progression-results.json')
args = parser.parse_args()


def frame_summary(frame):
    towns = frame['settlements']
    return {
        'year': frame['month'] / 12,
        'population_in_living_settlements': frame.get('populationInLivingSettlements', frame['population']),
        'represented_population': frame['population'] if 'populationMode' in frame else None,
        'recorded_population_mode': frame.get('populationMode', 'not-recorded'),
        'population_from_explicit_vital_statistics': 360 + frame['stats']['births'] - frame['stats']['deaths'],
        'settlement_sizes': sorted((s['population'] for s in towns), reverse=True),
        'statistics': frame['stats'],
        'active_routes': frame['activeRoutes'],
        'completed_roads': frame['roads'], 'completed_bridges': frame['bridges'], 'completed_docks': frame['docks'],
        'active_grid_lines': frame['activeGridLines'], 'grid_flow': frame['gridFlow'],
        'era_counts': dict(Counter(s['visualEra'] for s in towns)),
        'physical_stock': {key: sum(s['physicalMaterials'].get(key, 0) for s in towns)
                           for key in sorted({k for s in towns for k in s['physicalMaterials']})},
        'food_stock': sum(s['resources']['food'] for s in towns),
        'goods_stock': sum(s['resources']['goods'] for s in towns),
        'working_facilities': sum(f['throughput'] > 0 for s in towns for f in s['facilities']),
        'operating_plants': dict(Counter(p['kind'] for s in towns if s['energy']
                                        for p in s['energy']['plants'] if p['progress'] >= 1 and p['output'] > 0)),
        'industrial_towns': sum(s['industry']['active'] for s in towns),
    }


results = []
for phase, files in [('before', args.before), ('after', args.after)]:
    for filename in files:
        data = json.loads(Path(filename).read_text(encoding='utf-8-sig'))
        metrics = data['metrics']
        first = {}
        for milestones in metrics['milestones'].values():
            for key, month in milestones.items():
                first[key] = min(first.get(key, month), month)
        frames = metrics['frames']
        common = next((f for f in frames if f['month'] == 180 * 12), None)
        end = frames[-1]
        results.append({
            'phase': phase, 'seed': data['seed'], 'completed_years': end['month'] / 12,
            'source': filename, 'provenance': data.get('provenance'),
            'initial_population': 360,
            'first_years': {k: v / 12 for k, v in sorted(first.items())},
            'first_years_through_180': {k: v / 12 for k, v in sorted(first.items()) if v <= 180 * 12},
            'at_180': frame_summary(common) if common else None,
            'end': frame_summary(end),
            'peak_population_in_living_settlements': max(f.get('populationInLivingSettlements', f['population']) for f in frames),
            'largest_settlement_observed': max(s['population'] for f in frames for s in f['settlements']),
            'largest_annual_declines': sorted(metrics['declines'], key=lambda x: x['after'] / x['before'])[:12],
            'blocked_prerequisite_observations': metrics['blockers'],
            'reachability': {k: metrics['graph'].get(k) for k in ['missingReferences', 'unresolved', 'cycles', 'unresolvedCycles']},
        })
output = Path(args.out)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({'units': {'first_years': 'simulation months / 12',
                                      'stock': 'physical model units',
                                      'blocked_observations': 'annual settlement observations; multiple reasons may occur together'},
                              'population_note': 'Living-settlement totals can omit displaced people. Vital-statistics totals are valid in explicit population mode; use represented population for statistical cities.',
                              'runs': results}, indent=2) + '\n', encoding='utf-8')
print(output)
