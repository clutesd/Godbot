# Persistent field agriculture

Agriculture is now a bounded monthly ecology model on built physical fields. It does not
simulate individual plants. `Settlement.fields` is serialized alongside the existing world;
`Settlement.agriculture` remains the current-month compatibility summary.

## Authority and order

WeatherSystem / dynamic hydrology / WorldCell soil → current water-civilization service →
AgricultureSystem → field harvests → settlement summary → beginFoodMonth → existing survival,
storage and trade → read-only field presentation.

Only active, safe field plots are enrolled. Basic earth fields use the existing reserved-site
construction path and farmer preparation labour, without requiring advanced crop selection.
Unused field labour gathers through the existing food economy while fields establish or recover.
The existing gathering rate is calibrated to support small pre-field communities across
seasonal gaps; it previously depended on continuous fictitious farm output.
This is reported separately as gatheringLabour and never counted as agricultural production. Reserved construction sites do not grow crops.
An empty enrolled field list suppresses synthetic legacy beds. Old renderer-only snapshots
without `fields` retain their compatibility presentation until the simulation enrolls them.
Fields keep their history after abandonment or loss of their plot, but receive no labour.

## Crop and soil model

Field geometry is documentary scale: its area represents a larger cultivated holding; the
960-unit harvest coefficient is game-scale annual carrying capacity, not a square-metre yield.
Cereal, roots, legumes and dryland grain differ in thermal requirements, water demand,
frost/heat tolerance and drought/waterlogging sensitivity. Thermal accumulation, available
labour, fertility and health determine growth. Fields pass through preparation, sowing,
emergence, vegetative growth, flowering, filling, maturity, stubble and fallow. Maturity creates
a finite harvest stock. Collection spends field-assigned labour; only collected output enters
the food ledger. Uncollected mature crops deteriorate; failed crops return to fallow.

Root-zone moisture responds to WeatherSystem's already infiltrated and evaporated WorldCell
moisture. Rain and melt are not independently added again. Soil retention/drainage and existing
cell/plot flood depths affect root-zone exposure. Snow inhibits growth and work. Drought at
flowering permanently reduces reproductive yield potential, even if rain subsequently returns.
Storm lodging requires actual severe wind with a storm descriptor; frost/heat require measured
normalized temperature. Legacy `weather.cropDamage` is not an additional agricultural penalty.

Fertility is read from and written to existing `WorldCell.fertility`, with bounded, area-weighted
nutrient cycling. A field's fertility property is a synchronized observation, not another soil
simulation. Legumes and rest restore nutrients, cultivation consumes them, and husbandry
recycles modest amounts. Land clearance uses the existing farmland modification/forest
mechanism. Soil depth, parent fertility, retention, drainage and annual erosion continue to be
owned by EnvironmentalModificationSystem and SoilSystem.

## Capabilities and people

Adopted seasonal observation and scientific method delay sowing until temperature trends, moisture
and drainage conditions are suitable. Crop selection chooses dryland/root crops by site and
legumes by soil depletion/rotation. Irrigation uses a single shared settlement water-service
budget, in deterministic field-ID order, bounded by field demand and actual allocated labour.
It does not give every plot a copy of the full water allowance. WaterCivilization still owns
supply, quality, sanitation and health feedback, but never multiplies enrolled field output again.

Agrarian surplus coordinates recovery intervals and reduces collection losses. Husbandry
improves soil recycling and harvest capacity. Mechanical power increases collection capacity
only when the existing energy ledger supplies power. Industrial chemistry purchases modest
nutrient replenishment from existing goods; biotechnology reduces environmental susceptibility.
No additional material inventory or weather/hydrology engine is introduced.

Farmers select a specific workable plot by urgency (harvest, irrigation, sowing, preparation,
tending, recovery), with stable distribution over equally urgent plots. Animation reads that
plot's authoritative stage/action. It cannot create growth, output or harvested material.
Calendar changes do not advance enrolled crop visuals. The existing conforming surface and
row geometry are preserved; emergence is sparse, stress changes density/colour, and lodging
reduces height and tilts remaining stalks.

## Validation and limits

Focused tests cover drought and irrigation, drainage-dependent flooding, stage-sensitive frost
and storms, fallow/legume recovery, knowledge deployment, harvest aggregation/idempotence,
missing physical plots, water double-counting, renderer immutability, exact farmer targets,
seeded multi-year replay and JSON restoration mid-cycle. Existing ground-conformance tests
continue to cover uneven terrain.

Coefficients are deliberately coarse game-scale normalized units, not agronomic forecasts.
Fields in one coarse WorldCell share its soil fertility; they retain distinct crop histories and
root-zone stress. Irrigation units describe bounded service coverage rather than cubic metres.
Crop behaviour and annual food balance should continue to be calibrated across varied seeds.
