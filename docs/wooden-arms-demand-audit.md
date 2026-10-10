# Wooden-arms demand audit

Scope: wooden equipment only. Existing uncommitted timber/metallurgy work was retained. No storage capacity, timber extraction rule, labour scheduler, metallurgy gate, knowledge threshold, or recipe capacity was changed in this pass.

## Root cause and original semantics

`economy.timberArms` was a finished, quality-weighted equipment stock in the producer, but an orphaned counter in military consumers. `Consumption.ts` converted timber to arms and depleted them monthly. Repository-wide references showed no military consumer of this field. It was neither production capacity nor a literal spear count. Military profiles inferred primitive capability from knowledge, raw timber and institutions instead. Metal arms did have a military profile consumer.

The old chain was population -> 10% target -> blanket stock drain -> capped artisan production -> timber consumption -> unused equipment counter. Organization, eligibility, threat, metal substitution, deployed equipment and actual casualties were absent from this demand chain. War only changed the blanket drain from 1% to 8%.

For stock S, population P, quality q, available artisan labour L and available timber T:

- D_old = 0.1 P.
- S_decayed = (1-d) S, with d=0.01 in peace and 0.08 at war.
- If stone-composites practice >= 0.18 and S_decayed < D_old, timber draw = min(T, 0.2, 0.3 L).
- New stock = S_decayed + q * timber draw; labour = timber draw / 0.3.

With enough inputs, the continuously producing recurrence has equilibrium S*=0.2q/d. At q=0.5 this is 10 in peace, 1.25 at war; at q=0.55 it is 11 and 1.375. Thus the earlier approximately 110-person ceiling was quality-dependent, not a universal population constant. Exactly at equilibrium, a stock starting below it approaches it asymptotically. The pre-production decay gate makes stopping harder still: a post-production stock must be at least D_old/(1-d) for the next month to skip production. Artisan shortages and missing timber lower the ceiling further. A growing population also moves the target away.

There was no code evidence that the old drain meant retirement, obsolescence, physical breakage, or casualty loss. It was undifferentiated percentage attrition. It applied even to unused reserves, and the producer ignored metal arms that could satisfy the same need. It also failed to cap a batch at the remaining deficit.

## Intended stock and repaired authority chain

The retained unit is **usable finished equipment equivalents**, including issued wooden arms and stored reserves. Timber quality determines usable output per material input; stock is not production capacity or a literal count of individual weapons. No stock is granted on initialization or load.

1. Eligibility uses the existing military-strength age interval (older than 16, younger than 60). Statistical cities use represented population times working-age share.
2. Potential muster M = eligible * (0.11 + 0.08 * military political power + 0.06 * dominant-culture militarism), matching the existing manpower coefficients. The food modifier is deliberately excluded: food shortages should not erase equipment requirements.
3. Credible threat H = maximum clamp((hostility - 0.5)/0.5) among contacted, non-allied relations. There is no warrior occupation or separately maintained active military roster in this model.
4. Active equipment requirement A = M at war; otherwise M * (0.25 + 0.75 H). Desired total stock D = 1.2 A. The peace duty fraction, hostility threshold and reserve fraction are explicit model assumptions, not fitted metallurgy accelerators.
5. Metal equipment is allocated first. Desired wooden stock W = max(0, D - metal arms). Issued wooden stock I = min(S, max(0, A - metal arms)).
6. Ordinary wear = 0.01 I. The existing 1% rate is retained, now attached to use. Reserves do not undergo invented monthly use. The material catalog does not define wooden-weapon storage spoilage; no new rot or obsolescence model is invented here.
7. The actual casualty resolver removes min(I, casualties * I / max(1,A)) wooden equipment. It removes stock immediately, including on a war-ending battle, and queues the cause for the next resource diagnostic. No blanket 8% drain applies to mobilization, marching, negotiation or idle reserves.
8. Deficit = max(0, W - S_after_loss). Replacement backlog carries forward unfilled wear/casualty demand and is capped by the current deficit; the remainder is new force/reserve demand. Falling demand or additional metal equipment cancels unnecessary backlog.
9. Replenishment starts when combined stock falls below A and continues until D is restored. This reserve buffer avoids constant tiny crafting while adequately supplied. Every batch is capped at the actual remaining deficit.
10. Attempted output = min(deficit, q * min(0.2, 0.3 L)); achieved output = q * actual timber consumed. Ordinary peace production preserves max(2, buildings*0.3, existing establishment timber demand). War can draw below this threshold. Actual artisan labour is timber/0.3. Shared scheduling, production quota and skill threshold are unchanged.
11. Primitive melee capability now reads finished-stock coverage through `armsReadiness`; improvised fighting remains possible. Existing campaign capability snapshots remain frozen at mobilization, as before. This change does not redesign ongoing campaign capability refresh.

The repair does not make every target reachable. With no metal, sustaining A issued equivalents still costs approximately 0.01*A/q timber per month, before combat losses. If this exceeds the unchanged 0.2 timber/month craft ceiling (or available artisan labour/material), readiness can decline and the reserve cannot be filled. Unlike the former equilibrium, that unmet need belongs to a force actually designated for service.

Quality is already embodied in usable stock. Low-quality production supplies fewer usable equivalents and leaves more demand unfilled; higher-quality replacements satisfy that gap more efficiently. There are no individual weapon cohorts, so automatic retirement of otherwise usable weapons simply because a higher quality appears would require a new subsystem. This repair deliberately does not manufacture an obsolescence sink or double-charge quality through a second wear multiplier.

## Instrumentation and reproducibility

`ArmsDemand.ts` exposes a read-only observer. Every resource pass reports desired total/wooden stock, opening and closing stock, metal substitution, wear, combat loss, old arbitrary loss, replacement and expansion demand, attempted/achieved production, labour, timber, war state, adequate opening stock, and critical competing timber needs. The baseline was instrumented and started before behavioral edits. Its producer is archived at `output/arms/Consumption.baseline.ts.txt`.

`arms-demand-audit.ts` extends the existing timber-reachability harness: same six seeds, 360 initial people, 130 years, unchanged default configuration. It retains timber movement attribution, facilities, annual metallurgy blocker observations, and extraction rejection evidence, and adds monthly arms and storage/population records. Observers do not draw randomness. `run-arms-audit.mjs` runs the requested seeds; `summarize-arms-audit.mjs` writes `output/arms/comparison.json`.

Commands:

```text
node scripts/run-arms-audit.mjs after alpha-river basalt-coast delta-hill east-marsh north-steppe stone-basin
node scripts/summarize-arms-audit.mjs
```

To reproduce the baseline, use a disposable copy of this working tree and replace only `Consumption.ts` with the archived baseline producer. The new casualty/readiness helpers have no effect without the service state initialized by the repaired producer. Use phase `before` in a separate output directory. Do not revert the pre-existing timber/knowledge changes to Git HEAD: that would be a different baseline.

Both all-settlement and established-settlement (peak population >=60, matching the preceding audit) summaries are retained. Settlement-months are observations, not elapsed world months. The common military target is evaluated on both trajectories, using each trajectory's actual population, institutions, and relations. The old 0.1P target is also recorded separately. After behavioral divergence, matching seed names do not imply identical downstream populations or random-event paths.

Unnecessary production means production when post-loss stock already covers the full desired military stock, including reserve. Opening-reserve coverage before wear is also counted separately. Deliberate replenishment of a drawn-down reserve is not called unnecessary. Critical-needs production uses the existing shortage/building/establishment thresholds, not a new priority scheduler. Monthly loss diagnostics attribute combat losses on the following resource pass; an immediately extinct settlement or final-month casualty can leave queued losses without a subsequent record. Actual stock is removed at the casualty event regardless.

## Validation results

Pending completion of the paired 130-year runs. Numerical tables are generated from the retained JSON, not estimated.

Checks completed while the long runs execute:

- TypeScript project type check passed.
- Seven focused test files initially had 61 passing assertions and one existing 5-second replay timeout under concurrent audit load. The replay suite passed unchanged with a 30-second timeout; its assertions were not weakened.
- The final arms test file contains ten scenarios: supplied peace idling, replenishment cycles/conservation, organization/eligibility/threat/war, metal substitution, material/labour/quality scarcity, critical timber priority, bounded real losses and replacement, military capability and serialization, real casualty-resolver integration, and represented city cohorts. All ten passed.
- Scoped lint passed for production changes, tests and the audit runners. Simulation/type files also contain pre-existing edits and were checked by the project type check.

Interpretation limits: saved campaign capability snapshots remain fixed; war stock losses still happen immediately. Reserve stock has no separately simulated ageing. Ordinary wear and the 20% reserve are aggregate abstractions. The new policy intentionally permits lower stocks than the former population-proportional target and does not promise full readiness under scarcity. Neither a demographic improvement nor faster metallurgy is guaranteed.
