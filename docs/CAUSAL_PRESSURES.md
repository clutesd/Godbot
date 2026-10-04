# Causal pressures

Pressure ownership remains distributed across the simulation. `PressureObservation` is the common evidence contract, not a threat controller. The causal sequence is **cause → perception → response → cost → consequence → adaptation**. Observations describe authoritative conditions; each existing subsystem continues to own its decisions and budgets.

## Review and connections

| Pressure | Cause and perception | Response and real cost | Consequence and adaptation |
| --- | --- | --- | --- |
| Famine | Actual intake, reserves, balance, accumulated deprivation | Existing forage/cultivate/ration/wait decisions; civilian work reassigned or nutrition reduced | Health, fertility, mortality, migration; learned response preferences, food specialists and remembered storage demand |
| Cold/exposure | Weather, physical shelter, consumed fuel, accumulated exposure | Existing shelter construction and heating; materials and worker time | Health and mortality, preparation/migration decisions; persistent winter memory and built shelter |
| Material scarcity | Catalog demand minus local physical inventory | Existing extraction, substitution, trade and delayed construction | Production bottlenecks, contested deposits and territorial competition; resource discovery, infrastructure and recipe development |
| Infectious disease | Persistent carriers, actual contact, water quality, sanitation, density, weather and nutrition | Locally selected wait/care/containment; shared civilian labour, goods and delayed freight departures | Incubation, spread, loss of work and fertility, deaths and recovery; immunity, practical care experience, cultural memory, medical research and healthcare/water demand |
| Migration | Survival hardship, conflict, local feasibility and observed disease at source/destination | Existing whole-household path planning and travel; loss of available work while travelling | Population and expertise move together; infected migrants retain infection and immunity; destination exposure starts after arrival |
| Political instability/unrest | Existing legitimacy/stability plus observed deprivation, exposure, disease, scarcity and conflict | Existing institutional development, succession, transitions and secession | Sustained unrest erodes legitimacy; existing fragmentation/reintegration machinery remains authoritative |
| War | Existing grievances, scarcity, contested deposits, territorial tension and ambition | Existing mobilization, provisioning, combat, retreat and negotiation | Casualties, reserved labour, displacement and infrastructure damage; battle/occupation adds infectious contact, hardship increases severity; existing institutional and military learning remains intact |

`SocialPressures.ts` exposes common observations for resource, migration, political, unrest and war evidence. It does not choose their responses. Political transitions, fragmentation and crisis migration retain pressure-event parents. Disease contributes to conflict pressure and unrest; those feed the existing political model rather than adding a separate rebellion or collapse system.

## Disease authority and monthly ordering

1. Plan from the previous month's observed illness. Local trust, cooperation, food security, contagion knowledge and retained experience influence wait/care/containment. Choices last a quarter unless illness ends.
2. Freeze the existing shared labour budget. Illness reduces work availability at its source. Care reserves 10% and containment 18% of remaining civilian economy time, after military/industry reservations. These are worker-month costs, not extra workers. Read-only labour queries never spend resources.
3. Run production, water, transport and food/cold resolution. Containment delays new freight dispatches; loaded cargo keeps its existing transport ledger.
4. Resolve disease once per month from a simultaneous contact snapshot. Treatment consumes available goods and uses the labour actually reserved. Functioning, accessible healthcare buildings improve funded care. No workers means no protective response. Infections acquired this month cannot transmit until a later month.
5. Existing demography, migration, politics, research and construction consume the resulting state.

Three bounded archetypes model waterborne enteric infection, respiratory viral infection and a more severe zoonotic/plague-like infection. They are gameplay models, not calibrated models of named real pathogens. Respiratory transmission needs existing carriers: a small, deterministic fraction of the initial population can arrive incubating infection. It does not spontaneously appear in newborns or at era boundaries. Enteric reservoirs require contaminated water and population concentration. Zoonotic introduction requires actual pack-animal/cart/caravan freight contact; there is no invented livestock census. Subsequent person-to-person transmission can continue after the initiating exposure ends.

Explicit people hold one active infection and at most three immunity expiries. Infection travels with the person, including displaced households. Monthly fatality reflects the archetype, severity, age, nutrition, exposure, conflict and paid protection. Deaths use `killPeople`, retaining family, expert-loss, historical and demographic consequences. Infection reduces labour and conception directly and contributes a small health injury in the ordinary monthly health update.

Statistical cities use exposed/infectious/immune fractions of authoritative represented citizens. They retain the fractions captured from explicit people when scale changes. They use expected compartment flows and pathogen-specific waning instead of named-person random draws. Mortality subtracts from the city and represented total once; documentary sample size cannot change it. Growth dilutes compartments with susceptible entrants; fractional infections below a quarter-person extinguish. Aggregate archetypes can overlap; explicit people have one concurrent infection. The advanced risk panel reads disease burden and no longer rolls a second random pandemic mortality shock.

## Adaptation, history and safety

Paid care with recovering patients builds bounded practical experience; it improves later care without granting a knowledge capability. Health crises persist in cultural memory and settlement memory, influence later response selection, medical research pressure, and healthcare/water construction demand. Existing knowledge gates and construction costs remain required. Institutional protection therefore takes resources and time, and can fail under scarcity or conflict.

Outbreak detection, response selection, periodic measured outcomes, adaptation and deaths carry causal event IDs. Outcome events report current cases, deaths, recovery, protection, labour and goods spent, plus cumulative case, death and cost counters so intervening months remain accountable; decreasing prevalence is labelled an observation, not proof that an intervention alone caused recovery. The existing archive observer retains these events and settlement state after hot-history eviction. Existing historical `pandemic` events/counters represent threshold-crossing local epidemics; geographic extent can be reconstructed from linked settlement episodes.

Random draws are keyed by seed, month and person or settlement; they do not consume the main simulation stream. Monthly guards prevent repeated spending/deaths. Disease resolution is linear in explicit people, settlements, active routes and wars with three fixed pathogen slots. Snapshots prevent same-month transmission cascades and settlement iteration order from changing infection risks. No unbounded contact graph, hidden global threat clock, or scripted era disaster is introduced.

## Verification

`tests/disease.test.ts` covers waterborne emergence, contact-gated viral spread, migration/arrival, real intervention budgets, ignored crises, fertility/labour loss, mortality conservation, recovery and immunity, retained adaptation, cultural/infrastructure consequences, archive retention, JSON trajectory replay, aggregate sample independence and removal of duplicate advanced pandemic shocks. Existing pressure tests cover famine/exposure propagation, conservation and deterministic world replay.
