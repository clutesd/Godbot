# Development decision diagnostics — Step 2A

Step 2A makes the annual settlement project-start decision inspectable without changing construction behavior.

## Scope

`SettlementDevelopment.lastAttempt` records the most recent annual attempt to begin a structure project. It is observational state only. The construction gates, ordering of needs, response selection, placement contract, resource costs and material thresholds remain authoritative in `SettlementDevelopmentSystem`.

An attempt records one of three outcomes:

- `started` — one candidate passed the existing gates and became `development.project`.
- `blocked` — at least one unmet need was considered, but every candidate failed an existing gate.
- `no-pressure` — no need exceeded the existing `0.65` unmet-pressure threshold.

Each candidate preserves its need, desired level, selected response/level/action when available, plot id when one exists, and a list of blockers.

## Blocker vocabulary

Step 2A distinguishes:

- unavailable responses caused by the existing knowledge, institution, route or specialist prerequisites;
- no effective builders;
- shortages in food, wood, minerals, goods or wealth;
- the protected wood/fuel reserve used by energy and advanced food/manufacturing projects;
- insufficient canonical structural material, including the exact requirement and acceptable substitutions;
- insufficient processed components such as timber frames, dressed stone or iron tools;
- an existing site that no longer passes the placement contract;
- failure to reserve any valid new site.

When quantity is meaningful, diagnostics store `available` and `required` values. These values come from the same state read by the construction gate; they are not a second planning model.

## Deliberate boundary

Step 2A covers **project initiation only**. It does not explain why an already-created project is paused or progressing slowly. Sponsor loss, flooding, fire, work-rate starvation, later material depletion and completion-site invalidation belong to the separate active-project stall pass (Step 2B).

Keeping these phases separate prevents one overloaded status field from conflating “we could not decide to build” with “we decided to build and circumstances later stopped us.”

## Quality contract

The diagnostics must remain deterministic and replay-safe. Adding a diagnostic must never introduce a new gate, reserve a plot early, consume a resource, spend labour, or change candidate ordering. Tests assert both blocked explanations and that a successful diagnostic points to the exact project the existing system actually started.
