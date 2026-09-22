# Resource progression presentation

The live `GodboxRenderer` supplies settlement authority to `ResourceWorkScene` and simulation state to `ResourceSiteRenderer`. The latter owns pooled storage and processing detail through `ResourceFlowRenderer`. No preview-only implementation is needed in the game.

| Visible evidence | Authoritative source |
| --- | --- |
| Surveyed ore glints | Discovered, non-depleted deposits; undiscovered ore is not revealed |
| Work, contact, sorting and small site piles | Current ResourceWorkAssignments and real routed contributing people |
| Established worksite | Deposit extraction, cell reserve loss, land modifications, or recorded plant-harvesting experience |
| Organized worksite | Relevant practical knowledge and workshops |
| Advanced frame/hoist | Above conditions plus wheel-and-axle practice and workshop capacity |
| Stone, copper or iron tool finish | Living practical metallurgy, including dormancy |
| Carried freight | Existing FreightTrip material and quantity; existing vehicle and route own movement |
| Settlement stock | Settlement.localMaterials, never gross extraction or the compatibility stock alias |
| Idle processing equipment | Learned recipes or lifetime production at an existing active workshop/works plot |
| Active processing heat | Current typed recipe flow or observed generic recipe cycles after labour and inputs were spent |
| Stumps, excavation remnants and recovery | Persisted land modifications and abandonment state |

Site piles and worker sorting are illustrative evidence of work already recorded, not physical inventory. They never add, subtract, reserve or deliver material. Generic processing observations share the existing transient monthly ledger; they do not enter saves or affect recipe outcomes, random streams, labour or inventories. A restored game waits for actual processing before lighting a generic furnace again. Typed processing can show the saved current-month flow.

Resource work retains the 64-site/four-worker budgets. Active sites use ten instance pools; surveyed glints cap at 128, persistent stump/face pools at 768 each. Storage/processing uses five shared pools and at most 32 settlements, eight material types and three processing stations per settlement. Freight adds at most six material instances per existing vehicle. Geometry updates follow visual facts, not animation time; contact fragments use the existing bounded analytic effects. No dynamic lights or new particles are allocated.

`tests/resource-work-preview.html` uses production geometry and now offers primitive, established, organized and advanced fixtures by changing fixture extraction/knowledge state. Inspect both close and medium views. The live game was also opened and rendered during verification.

Validation: resource/material authority, transport, paths, physical work and construction suites; typecheck/build; ESLint; diff checks. The full suite was attempted but stopped after long simulation timeouts. The resource-economy framing fixture now supplies timber and bindings during its construction-only experiment, since shared processing otherwise exhausts its initial stock; its original frame-payment and built-material assertions are retained.
