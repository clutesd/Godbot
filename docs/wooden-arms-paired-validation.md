# Fresh paired wooden-arms validation

Six seeds; 360 starting people; 130 years (1,560 monthly steps); unchanged default configuration. Only these fresh baseline/repaired runs are compared. Both cohorts use the same filter within their own trajectory: all settlements, or peak population >=60. Cohort membership and downstream histories may diverge after the repair.

Source boundary: these are fresh runs of the working tree at launch. Two navigation files were edited elsewhere later (`StructureNavigation.ts`, `WalkabilityLayer.ts`); the workers had already statically loaded their modules and did not run in watch mode. Results do not validate those later edits. The complete baseline and repaired launch snapshots are preserved under `output/arms/baseline-worktree` and `output/arms/repaired-worktree`; the repaired snapshot matches all 113 launch hashes.

All amounts are model units. Arms are quality-weighted usable equipment equivalents. Months are settlement-months. Coverage is equipment-demand-weighted and capped at 100%. Stock counts include wood plus metal when evaluating coverage. Production-with-coverage counts use stock after losses but before production. Filling a partially drawn-down reserve is intentional. Demand sums are arms�months of outstanding demand, not quantities manufactured. The old producer has no causal replacement backlog; its diagnostic replacement and expansion quantities describe the old population-target deficit.

**Calibration flag:** the retained **1% monthly wear rate on issued wooden equipment requires later calibration**. It was left unchanged during validation. Legacy 1% peace/8% war attrition is shown separately because its physical cause was unspecified. In baseline conservation accounting, this is the legacy wear/attrition bucket; it is not mislabeled as casualty loss.

## alpha-river

| Metric | All before | All after | Established before | Established after |
|---|---:|---:|---:|---:|
| Settlements ever observed | 19 | 21 | 9 | 9 |
| Settlement-month observations | 17,664 | 16,836 | 11,472 | 10,788 |
| Arms timber consumed | 1,175.46 | 714.3 | 1,019.976 | 644.599 |
| Usable wooden arms produced | 579.341 | 346.176 | 504.056 | 311.74 |
| Artisan labour spent | 3,918.201 | 2,381 | 3,399.919 | 2,148.662 |
| Production months | 6,897 | 3,721 | 6,110 | 3,304 |
| Production with active force already satisfied (post-loss) | 3,340 | 1,265 | 2,816 | 1,148 |
| Production with full reserve already satisfied (post-loss) | 3,014 | 0 | 2,535 | 0 |
| Production with active force satisfied at opening, before wear | 3,362 | 1,415 | 2,831 | 1,272 |
| Production with full reserve satisfied at opening, before wear | 3,043 | 4 | 2,561 | 3 |
| Unnecessary peacetime production months | 3,014 | 0 | 2,535 | 0 |
| Unnecessary peacetime timber | 599.021 | 0 | 503.408 | 0 |
| Ordinary issued-equipment wear | not separately modelled | 295.47 | not separately modelled | 271.712 |
| Legacy undifferentiated peace attrition | 304.058 | 0 | 260.084 | 0 |
| Legacy undifferentiated war attrition | 263.497 | 0 | 238.276 | 0 |
| Actual combat equipment losses, including final pending losses | 0 | 24.681 | 0 | 21.735 |
| Replacement demand (arms�months of outstanding demand) | 510.742 | 9,678.356 | 472.32 | 9,364.018 |
| Production assigned to replacement | 317.218 | 242.42 | 294.111 | 230.435 |
| Expansion/hostility/war demand (arms�months) | 75,859.21 | 30,933.353 | 72,475.379 | 28,057.352 |
| Expansion demand during war (arms�months) | 16,576.406 | 11,732.261 | 15,970.985 | 10,615.829 |
| Expansion demand during hostile peace (arms�months) | 39,593.48 | 17,214.346 | 37,850.357 | 16,403.869 |
| Other peaceful expansion demand (arms�months) | 19,689.324 | 1,986.747 | 18,654.037 | 1,037.653 |
| Peace production fully deferred by critical timber shortage (months) | 2,953 | 2,458 | 2,817 | 2,147 |
| All attempted output unfilled (units) | 469.897 | 296.981 | 454.828 | 262.288 |
| Production below critical timber needs (months) | 2,644 | 261 | 2,476 | 245 |
| Timber spent below critical needs | 326.867 | 51.834 | 293.434 | 48.634 |
| Active-force coverage, demand-weighted | 30.0% | 49.7% | 28.2% | 49.7% |
| Full-reserve coverage, demand-weighted | 27.4% | 43.7% | 25.6% | 43.5% |
| Peace active-force coverage | 37.9% | 54.0% | 36.0% | 54.3% |
| War active-force coverage | 14.3% | 38.9% | 13.5% | 38.2% |
| Months active force fully covered | 7,030 | 6,856 | 4,090 | 4,566 |
| Months full reserve covered | 6,541 | 2,997 | 3,738 | 1,441 |
| Months old/new policy target covered | 3,126 | 2,997 | 1,107 | 1,441 |
| War settlement-months | 3,165 | 3,146 | 2,252 | 2,238 |
| Under-equipped war months | 2,737 | 2,392 | 2,096 | 1,818 |
| Under-equipped peace months | 7,897 | 7,588 | 5,286 | 4,404 |
| Months stock exceeds twice desired reserve | 3,948 | 552 | 2,320 | 229 |
| Metal demand substitution (arms�months) | 0 | 0 | 0 | 0 |
| Metal share of desired equipment | 0.0% | 0.0% | 0.0% | 0.0% |
| Final metal arms in living settlements | 0 | 0 | 0 | 0 |
| Final wooden arms per person (living settlements) | 0.018 | 0.041 | 0.01 | 0.042 |
| Final settlement timber, including retained dead-settlement stores | 88.958 | 184.825 | 9.288 | 79.814 |
| Final settlement timber in living settlements | 72.318 | 175.139 | 9.288 | 79.815 |
| Mean monthly timber per living settlement | 7.216 | 13.01 | 7.027 | 15.127 |
| Final facility timber in input/output inventories | 17.068 | 30.865 | 17.068 | 28.389 |
| Charcoal produced, settlement + facility | 143.135 | 97.249 | 143.135 | 95.658 |
| Construction/infrastructure timber consumed | 483.675 | 681.395 | 451.012 | 598.194 |
| Processing/workshop timber consumed (includes charcoal inputs) | 1,000.977 | 920.918 | 1,000.977 | 839.279 |
| Standing timber remaining in known deposits | 335,217.637 | 409,069.578 | 180,406.957 | 220,875.196 |
| Timber in facility transit | 0 | 0 | 0 | 0 |
| Timber extracted | 2,790.876 | 2,580.879 | 2,510.587 | 2,237.373 |
| Timber delivered | 2,785.47 | 2,573.406 | 2,505.595 | 2,230.261 |
| Fuel/heat timber consumed | 12.659 | 12.854 | 12.489 | 12.58 |
| Storage saturated settlement-months | 1,959 | 1,954 | 1,959 | 1,954 |
| Storage sample count | 17,671 | 16,843 | 11,472 | 10,787 |
| Mean storage utilization | 55.3% | 51.8% | 78.2% | 72.4% |
| Standing-forest storage rejection events | 27,680 | 18,884 | 27,680 | 18,884 |
| Standing-forest labour rejection events | 45,436 | 47,877 | 19,967 | 30,390 |
| Metallurgy discoveries | 0 | 0 | 0 | 0 |
| Earliest metallurgy year | not reached | not reached | not reached | not reached |
| Evaluations blocked only by wood | 0 | 0 | 0 | 0 |
| Living settlements at year 130 | 13 | 13 | 6 | 5 |
| Final population in living cohort settlements | 665 | 586 | 578 | 427 |
| Wars involving cohort | 107 | 109 | 102 | 102 |
| Battles in those wars | 38 | 55 | 37 | 53 |
| Combat casualties from cohort | 28 | 48 | 26 | 40 |

Metallurgy discoveries (all settlements):

- before: none. Not reached: Akitala, basai, mesakawa, saiba, Orukawa, hanembe, mesambe, Akitala, saitala, Akisai, Akitala, Yaratala, adesai, namori, hanekawa, kawambe, nambe, nadara, tomimori.
- after: none. Not reached: Akitala, basai, mesakawa, saiba, Orukawa, hanembe, talahara, kawasai, tomidara, morisai, mesamori, tomidara, nadara, naba, talambe, rinkawa, Akihara, Akimori, moriba, dokawa, saihara.

World demography (not restricted to the established cohort): births 1,926 ? 1,761; deaths 1,621 ? 1,535; peak population 887 ? 887.

## basalt-coast

| Metric | All before | All after | Established before | Established after |
|---|---:|---:|---:|---:|
| Settlements ever observed | 20 | 23 | 8 | 7 |
| Settlement-month observations | 16,968 | 17,148 | 11,820 | 9,900 |
| Arms timber consumed | 1,044.818 | 643.969 | 1,013.941 | 581.48 |
| Usable wooden arms produced | 524.187 | 319.979 | 509.07 | 290.348 |
| Artisan labour spent | 3,482.726 | 2,146.563 | 3,379.802 | 1,938.266 |
| Production months | 6,576 | 3,583 | 6,407 | 3,163 |
| Production with active force already satisfied (post-loss) | 3,216 | 616 | 3,114 | 582 |
| Production with full reserve already satisfied (post-loss) | 3,028 | 0 | 2,929 | 0 |
| Production with active force satisfied at opening, before wear | 3,223 | 698 | 3,121 | 660 |
| Production with full reserve satisfied at opening, before wear | 3,036 | 1 | 2,936 | 1 |
| Unnecessary peacetime production months | 3,028 | 0 | 2,929 | 0 |
| Unnecessary peacetime timber | 595.533 | 0 | 576.753 | 0 |
| Ordinary issued-equipment wear | not separately modelled | 295.101 | not separately modelled | 270.592 |
| Legacy undifferentiated peace attrition | 303.357 | 0 | 294.831 | 0 |
| Legacy undifferentiated war attrition | 212.298 | 0 | 206.761 | 0 |
| Actual combat equipment losses, including final pending losses | 0 | 9.656 | 0 | 6.301 |
| Replacement demand (arms�months of outstanding demand) | 486.186 | 18,759.396 | 476.884 | 17,262.409 |
| Production assigned to replacement | 303.426 | 243.214 | 299.196 | 228.668 |
| Expansion/hostility/war demand (arms�months) | 74,084.199 | 44,466.099 | 71,352.765 | 41,406.547 |
| Expansion demand during war (arms�months) | 19,319.269 | 17,339.683 | 18,786.877 | 16,419.574 |
| Expansion demand during hostile peace (arms�months) | 34,832.47 | 24,831.593 | 34,159.647 | 23,617.078 |
| Other peaceful expansion demand (arms�months) | 19,932.46 | 2,294.823 | 18,406.242 | 1,369.894 |
| Peace production fully deferred by critical timber shortage (months) | 2,265 | 4,169 | 2,169 | 3,256 |
| All attempted output unfilled (units) | 468.81 | 497.62 | 459.15 | 401.773 |
| Production below critical timber needs (months) | 3,121 | 424 | 3,027 | 290 |
| Timber spent below critical needs | 354.463 | 83.239 | 338.203 | 56.599 |
| Active-force coverage, demand-weighted | 25.1% | 38.0% | 25.1% | 37.7% |
| Full-reserve coverage, demand-weighted | 23.0% | 32.6% | 23.0% | 32.3% |
| Peace active-force coverage | 34.9% | 42.3% | 35.0% | 42.5% |
| War active-force coverage | 9.0% | 27.5% | 9.0% | 26.1% |
| Months active force fully covered | 5,916 | 4,658 | 4,236 | 3,028 |
| Months full reserve covered | 5,554 | 2,070 | 3,953 | 692 |
| Months old/new policy target covered | 1,687 | 2,070 | 817 | 692 |
| War settlement-months | 3,676 | 2,905 | 2,676 | 1,710 |
| Under-equipped war months | 3,317 | 2,366 | 2,578 | 1,521 |
| Under-equipped peace months | 7,735 | 10,124 | 5,006 | 5,351 |
| Months stock exceeds twice desired reserve | 2,457 | 248 | 2,117 | 59 |
| Metal demand substitution (arms�months) | 0 | 0 | 0 | 0 |
| Metal share of desired equipment | 0.0% | 0.0% | 0.0% | 0.0% |
| Final metal arms in living settlements | 0 | 0 | 0 | 0 |
| Final wooden arms per person (living settlements) | 0.015 | 0.012 | 0.014 | 0.013 |
| Final settlement timber, including retained dead-settlement stores | 37.623 | 61.845 | 3.283 | 35.24 |
| Final settlement timber in living settlements | 9.565 | 19.942 | 3.283 | 4.592 |
| Mean monthly timber per living settlement | 4.959 | 7.351 | 5.549 | 11.408 |
| Final facility timber in input/output inventories | 14.905 | 39.391 | 14.905 | 35.098 |
| Charcoal produced, settlement + facility | 116.75 | 118.739 | 116.75 | 118.739 |
| Construction/infrastructure timber consumed | 276.435 | 345.836 | 246.932 | 267.587 |
| Processing/workshop timber consumed (includes charcoal inputs) | 761.373 | 862.644 | 761.373 | 785.475 |
| Standing timber remaining in known deposits | 440,190.598 | 494,620.378 | 232,032.348 | 165,742.635 |
| Timber in facility transit | 0.353 | 0 | 0.353 | 0 |
| Timber extracted | 2,135.072 | 1,957.516 | 2,038.25 | 1,710.796 |
| Timber delivered | 2,125.367 | 1,942.708 | 2,028.576 | 1,696.301 |
| Fuel/heat timber consumed | 6.88 | 15.26 | 6.766 | 13.002 |
| Storage saturated settlement-months | 1,691 | 894 | 1,691 | 894 |
| Storage sample count | 16,971 | 17,155 | 11,820 | 9,898 |
| Mean storage utilization | 50.3% | 46.6% | 67.8% | 71.0% |
| Standing-forest storage rejection events | 10,327 | 5,015 | 10,327 | 5,015 |
| Standing-forest labour rejection events | 22,973 | 22,389 | 9,548 | 9,261 |
| Metallurgy discoveries | 0 | 0 | 0 | 0 |
| Earliest metallurgy year | not reached | not reached | not reached | not reached |
| Evaluations blocked only by wood | 0 | 0 | 0 | 0 |
| Living settlements at year 130 | 10 | 14 | 7 | 5 |
| Final population in living cohort settlements | 586 | 725 | 552 | 620 |
| Wars involving cohort | 130 | 104 | 118 | 83 |
| Battles in those wars | 60 | 36 | 60 | 31 |
| Combat casualties from cohort | 54 | 30 | 47 | 18 |

Metallurgy discoveries (all settlements):

- before: none. Not reached: saimbe, sunumori, mesaba, Nurudara, saiba, Orusai, Yaradara, kawadara, sunuhara, talambe, Yaradara, toba, Nurusai, zalasai, Orusai, tokawa, sunutala, saitala, ikombe, zalakawa.
- after: none. Not reached: saimbe, sunumori, mesaba, Nurudara, saiba, Orusai, Yaradara, adedara, kawakawa, rinkawa, kawambe, Nurukawa, Nurutala, dombe, Akihara, Nurukawa, wenahara, tombe, emisai, kaitala, ikosai, Yarahara, tomimbe.

World demography (not restricted to the established cohort): births 1,885 ? 1,990; deaths 1,659 ? 1,623; peak population 858 ? 852.

## delta-hill

| Metric | All before | All after | Established before | Established after |
|---|---:|---:|---:|---:|
| Settlements ever observed | 21 | 27 | 9 | 10 |
| Settlement-month observations | 17,760 | 18,900 | 10,884 | 12,120 |
| Arms timber consumed | 1,559.16 | 766.188 | 1,471.969 | 760.337 |
| Usable wooden arms produced | 737.268 | 363.263 | 695.361 | 360.504 |
| Artisan labour spent | 5,197.2 | 2,553.959 | 4,906.564 | 2,534.458 |
| Production months | 8,562 | 4,389 | 8,124 | 4,355 |
| Production with active force already satisfied (post-loss) | 3,768 | 839 | 3,503 | 835 |
| Production with full reserve already satisfied (post-loss) | 3,182 | 0 | 2,928 | 0 |
| Production with active force satisfied at opening, before wear | 3,804 | 965 | 3,538 | 960 |
| Production with full reserve satisfied at opening, before wear | 3,217 | 2 | 2,962 | 2 |
| Unnecessary peacetime production months | 3,179 | 0 | 2,926 | 0 |
| Unnecessary peacetime timber | 634.447 | 0 | 584.015 | 0 |
| Ordinary issued-equipment wear | not separately modelled | 340.321 | not separately modelled | 338.805 |
| Legacy undifferentiated peace attrition | 359.63 | 0 | 338.343 | 0 |
| Legacy undifferentiated war attrition | 363.31 | 0 | 343.436 | 0 |
| Actual combat equipment losses, including final pending losses | 0 | 3.537 | 0 | 3.534 |
| Replacement demand (arms�months of outstanding demand) | 685.419 | 21,780.362 | 661.174 | 21,421.319 |
| Production assigned to replacement | 434.525 | 279.296 | 422.251 | 278.832 |
| Expansion/hostility/war demand (arms�months) | 65,299.656 | 59,539.963 | 58,485.497 | 55,206.396 |
| Expansion demand during war (arms�months) | 14,606.876 | 23,352.928 | 12,932.891 | 21,595.897 |
| Expansion demand during hostile peace (arms�months) | 38,973.833 | 34,652.007 | 35,353.52 | 32,559.117 |
| Other peaceful expansion demand (arms�months) | 11,718.947 | 1,535.028 | 10,199.086 | 1,051.382 |
| Peace production fully deferred by critical timber shortage (months) | 307 | 2,727 | 307 | 2,584 |
| All attempted output unfilled (units) | 119.999 | 389.928 | 119.851 | 376.292 |
| Production below critical timber needs (months) | 2,570 | 653 | 2,264 | 653 |
| Timber spent below critical needs | 362.218 | 122.203 | 301.427 | 122.203 |
| Active-force coverage, demand-weighted | 38.3% | 35.2% | 40.5% | 36.6% |
| Full-reserve coverage, demand-weighted | 34.4% | 30.3% | 36.3% | 31.5% |
| Peace active-force coverage | 47.2% | 40.9% | 49.8% | 42.3% |
| War active-force coverage | 18.8% | 22.9% | 19.7% | 24.1% |
| Months active force fully covered | 7,082 | 6,021 | 4,645 | 4,074 |
| Months full reserve covered | 6,341 | 3,172 | 3,982 | 1,286 |
| Months old/new policy target covered | 2,665 | 3,172 | 971 | 1,286 |
| War settlement-months | 3,360 | 3,760 | 2,125 | 2,584 |
| Under-equipped war months | 3,048 | 3,237 | 2,018 | 2,376 |
| Under-equipped peace months | 7,630 | 9,642 | 4,221 | 5,670 |
| Months stock exceeds twice desired reserve | 3,043 | 269 | 1,876 | 217 |
| Metal demand substitution (arms�months) | 0 | 0 | 0 | 0 |
| Metal share of desired equipment | 0.0% | 0.0% | 0.0% | 0.0% |
| Final metal arms in living settlements | 0 | 0 | 0 | 0 |
| Final wooden arms per person (living settlements) | 0.023 | 0.019 | 0.024 | 0.019 |
| Final settlement timber, including retained dead-settlement stores | 98.526 | 114.94 | 68.352 | 51.669 |
| Final settlement timber in living settlements | 21.225 | 68.914 | 7.739 | 10.829 |
| Mean monthly timber per living settlement | 7.965 | 10.515 | 11.774 | 13.106 |
| Final facility timber in input/output inventories | 35.537 | 19.045 | 35.537 | 19.045 |
| Charcoal produced, settlement + facility | 100.281 | 126.461 | 100.281 | 126.461 |
| Construction/infrastructure timber consumed | 524.425 | 608.442 | 503.031 | 583.619 |
| Processing/workshop timber consumed (includes charcoal inputs) | 856.678 | 963.286 | 856.678 | 963.286 |
| Standing timber remaining in known deposits | 406,904.443 | 370,860.907 | 191,642.62 | 161,535.181 |
| Timber in facility transit | 0 | 0.01 | 0 | 0.01 |
| Timber extracted | 3,145.707 | 2,584.072 | 3,012.376 | 2,484.994 |
| Timber delivered | 3,143.969 | 2,581.499 | 3,010.701 | 2,482.564 |
| Fuel/heat timber consumed | 24.909 | 37.476 | 21.977 | 34.485 |
| Storage saturated settlement-months | 1,208 | 2,082 | 1,208 | 2,082 |
| Storage sample count | 17,765 | 18,909 | 10,883 | 12,122 |
| Mean storage utilization | 40.8% | 49.3% | 62.9% | 71.4% |
| Standing-forest storage rejection events | 10,324 | 19,495 | 10,324 | 19,495 |
| Standing-forest labour rejection events | 39,295 | 26,061 | 24,256 | 18,534 |
| Metallurgy discoveries | 0 | 1 | 0 | 1 |
| Earliest metallurgy year | not reached | 67 | not reached | 67 |
| Evaluations blocked only by wood | 0 | 0 | 0 | 0 |
| Living settlements at year 130 | 12 | 16 | 6 | 9 |
| Final population in living cohort settlements | 634 | 830 | 556 | 766 |
| Wars involving cohort | 126 | 152 | 111 | 135 |
| Battles in those wars | 39 | 31 | 35 | 25 |
| Combat casualties from cohort | 31 | 23 | 18 | 17 |

Metallurgy discoveries (all settlements):

- before: none. Not reached: Akiba, kemidara, ikokawa, wenasai, saitala, sunumori, dohara, dotala, ikombe, adehara, hanemori, rinba, tomimori, morimori, Akitala, nambe, talatala, dotala, ikomori, tomidara, kawadara.
- after: dohara (year 67). Not reached: Akiba, kemidara, ikokawa, wenasai, saitala, sunumori, rintala, ikokawa, Akisai, kawakawa, moridara, dosai, hanemori, tomitala, kawamori, kawahara, saikawa, nadara, mesamori, rinmbe, morisai, rindara, saihara, Yaraba, hanemori, Yaraba.

World demography (not restricted to the established cohort): births 1,817 ? 1,974; deaths 1,543 ? 1,504; peak population 892 ? 978.

## east-marsh

| Metric | All before | All after | Established before | Established after |
|---|---:|---:|---:|---:|
| Settlements ever observed | 23 | 16 | 10 | 9 |
| Settlement-month observations | 18,768 | 17,772 | 13,440 | 12,384 |
| Arms timber consumed | 1,349.401 | 530.395 | 1,299.817 | 491.119 |
| Usable wooden arms produced | 716.306 | 284.505 | 691.401 | 264.045 |
| Artisan labour spent | 4,498.004 | 1,767.984 | 4,332.724 | 1,637.062 |
| Production months | 7,546 | 2,815 | 7,276 | 2,597 |
| Production with active force already satisfied (post-loss) | 4,690 | 1,355 | 4,514 | 1,314 |
| Production with full reserve already satisfied (post-loss) | 4,396 | 0 | 4,233 | 0 |
| Production with active force satisfied at opening, before wear | 4,709 | 1,553 | 4,530 | 1,477 |
| Production with full reserve satisfied at opening, before wear | 4,428 | 11 | 4,264 | 11 |
| Unnecessary peacetime production months | 4,393 | 0 | 4,230 | 0 |
| Unnecessary peacetime timber | 875.329 | 0 | 844.931 | 0 |
| Ordinary issued-equipment wear | not separately modelled | 251.439 | not separately modelled | 238.656 |
| Legacy undifferentiated peace attrition | 456.979 | 0 | 446.827 | 0 |
| Legacy undifferentiated war attrition | 247.989 | 0 | 233.666 | 0 |
| Actual combat equipment losses, including final pending losses | 0 | 5.992 | 0 | 1.279 |
| Replacement demand (arms�months of outstanding demand) | 640.74 | 10,137.924 | 621.143 | 9,950.406 |
| Production assigned to replacement | 417.129 | 195.493 | 410.257 | 186.781 |
| Expansion/hostility/war demand (arms�months) | 83,739.069 | 23,777.745 | 80,053.923 | 22,457.65 |
| Expansion demand during war (arms�months) | 14,799.915 | 14,169.376 | 14,235.522 | 13,717.091 |
| Expansion demand during hostile peace (arms�months) | 50,110.518 | 1,621.915 | 49,819.275 | 1,439.02 |
| Other peaceful expansion demand (arms�months) | 18,828.635 | 7,986.454 | 15,999.126 | 7,301.539 |
| Peace production fully deferred by critical timber shortage (months) | 3,583 | 4,547 | 3,286 | 4,355 |
| All attempted output unfilled (units) | 533.484 | 514.002 | 503.544 | 494.269 |
| Production below critical timber needs (months) | 2,726 | 167 | 2,518 | 161 |
| Timber spent below critical needs | 385.755 | 31.725 | 348.55 | 30.549 |
| Active-force coverage, demand-weighted | 30.5% | 49.6% | 30.6% | 49.5% |
| Full-reserve coverage, demand-weighted | 28.3% | 44.8% | 28.3% | 44.6% |
| Peace active-force coverage | 36.9% | 61.7% | 37.0% | 62.1% |
| War active-force coverage | 13.6% | 21.8% | 13.3% | 20.7% |
| Months active force fully covered | 7,666 | 8,248 | 6,085 | 5,858 |
| Months full reserve covered | 7,274 | 2,504 | 5,768 | 1,097 |
| Months old/new policy target covered | 2,654 | 2,504 | 1,639 | 1,097 |
| War settlement-months | 2,447 | 1,532 | 1,752 | 1,048 |
| Under-equipped war months | 2,293 | 1,393 | 1,744 | 1,048 |
| Under-equipped peace months | 8,809 | 8,131 | 5,611 | 5,478 |
| Months stock exceeds twice desired reserve | 4,702 | 670 | 4,297 | 22 |
| Metal demand substitution (arms�months) | 0 | 0 | 0 | 0 |
| Metal share of desired equipment | 0.0% | 0.0% | 0.0% | 0.0% |
| Final metal arms in living settlements | 0 | 0 | 0 | 0 |
| Final wooden arms per person (living settlements) | 0.01 | 0.022 | 0.01 | 0.022 |
| Final settlement timber, including retained dead-settlement stores | 101.894 | 123.685 | 49 | 40.025 |
| Final settlement timber in living settlements | 66.512 | 93.793 | 49 | 40.026 |
| Mean monthly timber per living settlement | 8.834 | 13.731 | 10.518 | 15.279 |
| Final facility timber in input/output inventories | 18.284 | 83.612 | 18.284 | 80.464 |
| Charcoal produced, settlement + facility | 145.274 | 222.326 | 145.274 | 222.326 |
| Construction/infrastructure timber consumed | 912.67 | 976.771 | 877.042 | 940.256 |
| Processing/workshop timber consumed (includes charcoal inputs) | 1,462.911 | 1,697.524 | 1,462.911 | 1,658.683 |
| Standing timber remaining in known deposits | 796,755.259 | 728,216.96 | 394,697.741 | 406,397.174 |
| Timber in facility transit | 0 | 0 | 0 | 0 |
| Timber extracted | 3,964.125 | 3,531.072 | 3,823.256 | 3,309.385 |
| Timber delivered | 3,960.582 | 3,527.009 | 3,819.862 | 3,305.423 |
| Fuel/heat timber consumed | 46.36 | 83.274 | 46.207 | 83.144 |
| Storage saturated settlement-months | 2,870 | 1,139 | 2,870 | 1,139 |
| Storage sample count | 18,777 | 17,779 | 13,443 | 12,386 |
| Mean storage utilization | 53.0% | 55.1% | 70.6% | 70.9% |
| Standing-forest storage rejection events | 17,431 | 17,271 | 17,431 | 17,271 |
| Standing-forest labour rejection events | 28,756 | 26,700 | 18,706 | 16,262 |
| Metallurgy discoveries | 2 | 4 | 2 | 4 |
| Earliest metallurgy year | 63 | 76 | 63 | 76 |
| Evaluations blocked only by wood | 0 | 0 | 0 | 0 |
| Living settlements at year 130 | 16 | 14 | 10 | 9 |
| Final population in living cohort settlements | 1,133 | 1,214 | 1,056 | 1,118 |
| Wars involving cohort | 83 | 54 | 78 | 46 |
| Battles in those wars | 37 | 18 | 35 | 12 |
| Combat casualties from cohort | 29 | 14 | 20 | 6 |

Metallurgy discoveries (all settlements):

- before: tohara (year 63); hanemori (year 76). Not reached: Akiba, kemiba, mesahara, moriba, kemikawa, Nurukawa, bambe, Nuruba, Akitala, ikodara, saitala, wenatala, tokawa, bahara, dotala, talasai, dombe, hanesai, mesaba, kaidara, hanedara.
- after: Akiba (year 90); mesahara (year 80); kemikawa (year 76); hanemori (year 97). Not reached: kemiba, tohara, moriba, Orumbe, hanesai, ikomori, kawadara, doba, emihara, hanemori, sunutala, talaba.

World demography (not restricted to the established cohort): births 2,490 ? 2,538; deaths 1,717 ? 1,684; peak population 1,158 ? 1,244.

## north-steppe

| Metric | All before | All after | Established before | Established after |
|---|---:|---:|---:|---:|
| Settlements ever observed | 20 | 19 | 8 | 11 |
| Settlement-month observations | 15,276 | 17,160 | 10,932 | 13,620 |
| Arms timber consumed | 1,117.635 | 738.091 | 1,102.247 | 685.871 |
| Usable wooden arms produced | 559.378 | 372.666 | 551.411 | 345.296 |
| Artisan labour spent | 3,725.449 | 2,460.303 | 3,674.157 | 2,286.237 |
| Production months | 6,517 | 4,126 | 6,438 | 3,848 |
| Production with active force already satisfied (post-loss) | 3,909 | 1,314 | 3,881 | 1,273 |
| Production with full reserve already satisfied (post-loss) | 3,587 | 0 | 3,571 | 0 |
| Production with active force satisfied at opening, before wear | 3,920 | 1,492 | 3,892 | 1,436 |
| Production with full reserve satisfied at opening, before wear | 3,604 | 7 | 3,587 | 7 |
| Unnecessary peacetime production months | 3,587 | 0 | 3,571 | 0 |
| Unnecessary peacetime timber | 700.946 | 0 | 698.067 | 0 |
| Ordinary issued-equipment wear | not separately modelled | 322.624 | not separately modelled | 306.318 |
| Legacy undifferentiated peace attrition | 317.816 | 0 | 315.698 | 0 |
| Legacy undifferentiated war attrition | 235.243 | 0 | 231.722 | 0 |
| Actual combat equipment losses, including final pending losses | 0 | 23.314 | 0 | 17.505 |
| Replacement demand (arms�months of outstanding demand) | 530.165 | 11,580.679 | 525.842 | 11,422.034 |
| Production assigned to replacement | 321.902 | 260.289 | 319.59 | 248.141 |
| Expansion/hostility/war demand (arms�months) | 62,123.652 | 40,703.275 | 58,833.359 | 38,456.504 |
| Expansion demand during war (arms�months) | 17,670.117 | 22,130.253 | 16,310.876 | 21,148.96 |
| Expansion demand during hostile peace (arms�months) | 22,371.267 | 15,894.855 | 21,678.913 | 15,341.935 |
| Other peaceful expansion demand (arms�months) | 22,082.269 | 2,678.167 | 20,843.57 | 1,965.609 |
| Peace production fully deferred by critical timber shortage (months) | 1,223 | 3,209 | 1,216 | 3,045 |
| All attempted output unfilled (units) | 290.551 | 398.655 | 289.728 | 374.23 |
| Production below critical timber needs (months) | 3,057 | 752 | 3,030 | 643 |
| Timber spent below critical needs | 430.941 | 123.272 | 425.954 | 101.721 |
| Active-force coverage, demand-weighted | 28.3% | 45.0% | 29.2% | 44.9% |
| Full-reserve coverage, demand-weighted | 26.2% | 39.8% | 27.0% | 39.6% |
| Peace active-force coverage | 39.8% | 54.0% | 40.5% | 54.6% |
| War active-force coverage | 10.4% | 31.0% | 11.0% | 29.3% |
| Months active force fully covered | 6,346 | 7,387 | 5,419 | 6,026 |
| Months full reserve covered | 5,875 | 2,645 | 4,973 | 1,695 |
| Months old/new policy target covered | 1,679 | 2,645 | 1,070 | 1,695 |
| War settlement-months | 3,834 | 3,672 | 2,424 | 2,854 |
| Under-equipped war months | 3,268 | 2,849 | 2,138 | 2,353 |
| Under-equipped peace months | 5,662 | 6,924 | 3,375 | 5,241 |
| Months stock exceeds twice desired reserve | 2,612 | 812 | 2,583 | 434 |
| Metal demand substitution (arms�months) | 0 | 0 | 0 | 0 |
| Metal share of desired equipment | 0.0% | 0.0% | 0.0% | 0.0% |
| Final metal arms in living settlements | 0 | 0 | 0 | 0 |
| Final wooden arms per person (living settlements) | 0.018 | 0.028 | 0.012 | 0.031 |
| Final settlement timber, including retained dead-settlement stores | 41.827 | 87.684 | 4.4 | 67.031 |
| Final settlement timber in living settlements | 15.746 | 35.948 | 0 | 24.922 |
| Mean monthly timber per living settlement | 4.387 | 13.128 | 5.304 | 15.611 |
| Final facility timber in input/output inventories | 5.091 | 32.965 | 5.091 | 32.965 |
| Charcoal produced, settlement + facility | 124.59 | 187.642 | 124.59 | 187.642 |
| Construction/infrastructure timber consumed | 606.994 | 739.973 | 568.002 | 703.668 |
| Processing/workshop timber consumed (includes charcoal inputs) | 1,012.715 | 1,474.306 | 1,012.715 | 1,474.306 |
| Standing timber remaining in known deposits | 1,191,616.359 | 982,374.483 | 516,621.627 | 666,490.987 |
| Timber in facility transit | 19.285 | 16.128 | 19.285 | 16.128 |
| Timber extracted | 2,835.153 | 3,166.459 | 2,736.53 | 3,054.254 |
| Timber delivered | 2,833.371 | 3,161.616 | 2,735.176 | 3,049.682 |
| Fuel/heat timber consumed | 26.665 | 52.896 | 26.425 | 51.313 |
| Storage saturated settlement-months | 2,962 | 2,831 | 2,962 | 2,831 |
| Storage sample count | 15,279 | 17,168 | 10,930 | 13,622 |
| Mean storage utilization | 59.4% | 63.6% | 79.9% | 77.2% |
| Standing-forest storage rejection events | 22,439 | 19,245 | 22,439 | 19,245 |
| Standing-forest labour rejection events | 30,688 | 36,273 | 19,457 | 25,960 |
| Metallurgy discoveries | 1 | 1 | 1 | 1 |
| Earliest metallurgy year | 55 | 128 | 55 | 128 |
| Evaluations blocked only by wood | 0 | 0 | 0 | 0 |
| Living settlements at year 130 | 10 | 15 | 5 | 9 |
| Final population in living cohort settlements | 359 | 707 | 322 | 603 |
| Wars involving cohort | 118 | 110 | 104 | 104 |
| Battles in those wars | 93 | 69 | 72 | 61 |
| Combat casualties from cohort | 59 | 55 | 34 | 44 |

Metallurgy discoveries (all settlements):

- before: emiba (year 55). Not reached: Akikawa, kemimbe, rinmori, nambe, kemimori, rindara, Yaramori, mesasai, morisai, hanemori, Yarakawa, tomidara, Yaramori, ikoba, ikokawa, Yaratala, ikomori, ikokawa, ikomori.
- after: emiba (year 128). Not reached: Akikawa, kemimbe, rinmori, nambe, kemimori, rindara, ikokawa, rinhara, Orukawa, talambe, bamori, wenadara, ikokawa, kemiba, mesambe, ikomori, mesahara, rindara.

World demography (not restricted to the established cohort): births 1,699 ? 2,154; deaths 1,700 ? 1,807; peak population 878 ? 925.

## stone-basin

| Metric | All before | All after | Established before | Established after |
|---|---:|---:|---:|---:|
| Settlements ever observed | 20 | 22 | 8 | 10 |
| Settlement-month observations | 17,964 | 17,892 | 10,056 | 12,012 |
| Arms timber consumed | 1,311.27 | 766.518 | 1,132.601 | 672.349 |
| Usable wooden arms produced | 664.811 | 384.797 | 579.362 | 335.758 |
| Artisan labour spent | 4,370.898 | 2,555.061 | 3,775.337 | 2,241.162 |
| Production months | 6,984 | 4,040 | 6,072 | 3,495 |
| Production with active force already satisfied (post-loss) | 4,074 | 1,490 | 3,666 | 1,348 |
| Production with full reserve already satisfied (post-loss) | 3,865 | 0 | 3,505 | 0 |
| Production with active force satisfied at opening, before wear | 4,102 | 1,690 | 3,689 | 1,510 |
| Production with full reserve satisfied at opening, before wear | 3,877 | 6 | 3,512 | 6 |
| Unnecessary peacetime production months | 3,865 | 0 | 3,505 | 0 |
| Unnecessary peacetime timber | 771.447 | 0 | 700.639 | 0 |
| Ordinary issued-equipment wear | not separately modelled | 328.397 | not separately modelled | 297.743 |
| Legacy undifferentiated peace attrition | 393.67 | 0 | 359.956 | 0 |
| Legacy undifferentiated war attrition | 267.522 | 0 | 216.952 | 0 |
| Actual combat equipment losses, including final pending losses | 0 | 11.305 | 0 | 3.786 |
| Replacement demand (arms�months of outstanding demand) | 622.188 | 13,822.193 | 560.367 | 12,379.855 |
| Production assigned to replacement | 414.606 | 276.077 | 377.182 | 253.619 |
| Expansion/hostility/war demand (arms�months) | 68,510.741 | 49,784.042 | 61,349.71 | 46,126.241 |
| Expansion demand during war (arms�months) | 19,550.144 | 25,001.152 | 17,456.577 | 23,153.164 |
| Expansion demand during hostile peace (arms�months) | 35,745.339 | 22,562.035 | 32,638.658 | 21,233.381 |
| Other peaceful expansion demand (arms�months) | 13,215.259 | 2,220.855 | 11,254.476 | 1,739.696 |
| Peace production fully deferred by critical timber shortage (months) | 1,685 | 2,695 | 1,660 | 2,317 |
| All attempted output unfilled (units) | 298.835 | 384.332 | 296.335 | 341.841 |
| Production below critical timber needs (months) | 2,096 | 299 | 1,730 | 244 |
| Timber spent below critical needs | 336.641 | 59.363 | 264.503 | 48.363 |
| Active-force coverage, demand-weighted | 26.5% | 40.3% | 26.0% | 40.0% |
| Full-reserve coverage, demand-weighted | 24.3% | 35.4% | 23.8% | 35.0% |
| Peace active-force coverage | 34.9% | 51.8% | 34.3% | 52.1% |
| War active-force coverage | 10.8% | 21.7% | 9.8% | 20.0% |
| Months active force fully covered | 7,173 | 7,727 | 4,615 | 5,609 |
| Months full reserve covered | 6,810 | 2,197 | 4,354 | 1,160 |
| Months old/new policy target covered | 2,632 | 2,197 | 737 | 1,160 |
| War settlement-months | 3,750 | 3,681 | 2,139 | 2,511 |
| Under-equipped war months | 3,440 | 3,110 | 1,995 | 2,154 |
| Under-equipped peace months | 7,351 | 7,055 | 3,446 | 4,249 |
| Months stock exceeds twice desired reserve | 3,907 | 391 | 3,000 | 194 |
| Metal demand substitution (arms�months) | 0 | 0 | 0 | 0 |
| Metal share of desired equipment | 0.0% | 0.0% | 0.0% | 0.0% |
| Final metal arms in living settlements | 0 | 0 | 0 | 0 |
| Final wooden arms per person (living settlements) | 0.006 | 0.045 | 0.005 | 0.037 |
| Final settlement timber, including retained dead-settlement stores | 96.558 | 271.296 | 1.876 | 161.378 |
| Final settlement timber in living settlements | 49.266 | 204.34 | 1.876 | 113.845 |
| Mean monthly timber per living settlement | 11.319 | 15.513 | 15.236 | 18.571 |
| Final facility timber in input/output inventories | 25.886 | 25.457 | 25.886 | 24.776 |
| Charcoal produced, settlement + facility | 140.79 | 138.559 | 140.79 | 116.482 |
| Construction/infrastructure timber consumed | 515.428 | 692.336 | 448.746 | 637.565 |
| Processing/workshop timber consumed (includes charcoal inputs) | 935.253 | 1,007.757 | 913.325 | 874.145 |
| Standing timber remaining in known deposits | 439,791.228 | 442,665.046 | 183,857.4 | 230,072.307 |
| Timber in facility transit | 0 | 0 | 0 | 0 |
| Timber extracted | 2,914.169 | 2,821.442 | 2,554.082 | 2,435.225 |
| Timber delivered | 2,910.226 | 2,817.263 | 2,550.252 | 2,431.165 |
| Fuel/heat timber consumed | 14.609 | 31.049 | 13.778 | 23.405 |
| Storage saturated settlement-months | 2,673 | 2,098 | 2,673 | 2,098 |
| Storage sample count | 17,972 | 17,901 | 10,056 | 12,013 |
| Mean storage utilization | 51.1% | 52.3% | 80.4% | 70.3% |
| Standing-forest storage rejection events | 17,321 | 15,350 | 17,321 | 15,350 |
| Standing-forest labour rejection events | 31,253 | 29,913 | 13,312 | 16,089 |
| Metallurgy discoveries | 1 | 0 | 1 | 0 |
| Earliest metallurgy year | 92 | not reached | 92 | not reached |
| Evaluations blocked only by wood | 0 | 0 | 0 | 0 |
| Living settlements at year 130 | 14 | 15 | 6 | 7 |
| Final population in living cohort settlements | 608 | 744 | 516 | 605 |
| Wars involving cohort | 143 | 134 | 125 | 123 |
| Battles in those wars | 39 | 45 | 25 | 37 |
| Combat casualties from cohort | 40 | 32 | 11 | 19 |

Metallurgy discoveries (all settlements):

- before: adehara (year 92). Not reached: kawadara, kemidara, rinkawa, nasai, mesahara, Akiba, saikawa, rintala, rinsai, saiba, kemidara, namori, mesakawa, tomisai, dosai, Orusai, kawadara, ikotala, dosai.
- after: none. Not reached: kawadara, kemidara, rinkawa, nasai, adehara, mesahara, mesamori, Orumori, hanembe, kawadara, Yaradara, nahara, hanemori, adetala, ikoba, ikohara, mesambe, mesakawa, natala, kemiba, ikombe, mesahara.

World demography (not restricted to the established cohort): births 1,915 ? 2,095; deaths 1,667 ? 1,711; peak population 879 ? 1,124.

## Accounting verification

Combat losses occur after the resource pass. Each next pass's opening observation is therefore adjusted by its queued combat-loss amount to reconstruct the pre-combat opening. Consecutive-pass stock is independently reconciled; final pending losses and retained inventory of dead settlements are included in whole-run totals. The baseline equation includes its separately identified legacy attrition.

| Seed / cohort / phase | Whole-run stock residual | Between-pass max residual | Timber payment residual | Output above policy deficit | Negative stock |
|---|---:|---:|---:|---:|---:|
| alpha-river / all / before | 2.74e-13 | 0.00e+0 | 1.15e-10 | 719 | 0 |
| alpha-river / all / after | 3.94e-13 | 4.44e-16 | 2.00e-11 | 0 | 0 |
| alpha-river / established / before | 1.78e-15 | 0.00e+0 | 8.27e-11 | 326 | 0 |
| alpha-river / established / after | 2.81e-13 | 4.44e-16 | 4.43e-12 | 0 | 0 |
| basalt-coast / all / before | 1.46e-13 | 0.00e+0 | 7.84e-11 | 500 | 0 |
| basalt-coast / all / after | 6.47e-13 | 5.55e-16 | 1.36e-12 | 0 | 0 |
| basalt-coast / established / before | 1.63e-13 | 0.00e+0 | 7.13e-11 | 444 | 0 |
| basalt-coast / established / after | 3.23e-13 | 5.55e-16 | 1.10e-11 | 0 | 0 |
| delta-hill / all / before | 2.47e-13 | 0.00e+0 | 2.24e-10 | 498 | 0 |
| delta-hill / all / after | 7.82e-14 | 2.78e-16 | 2.61e-11 | 0 | 0 |
| delta-hill / established / before | 2.10e-13 | 0.00e+0 | 2.05e-10 | 287 | 0 |
| delta-hill / established / after | 5.33e-14 | 2.78e-16 | 2.55e-11 | 0 | 0 |
| east-marsh / all / before | 4.81e-13 | 0.00e+0 | 1.51e-10 | 860 | 0 |
| east-marsh / all / after | 3.48e-13 | 1.67e-16 | 1.77e-11 | 0 | 0 |
| east-marsh / established / before | 3.16e-13 | 0.00e+0 | 1.41e-10 | 790 | 0 |
| east-marsh / established / after | 2.06e-13 | 1.67e-16 | 2.10e-11 | 0 | 0 |
| north-steppe / all / before | 1.84e-13 | 0.00e+0 | 9.89e-11 | 344 | 0 |
| north-steppe / all / after | 2.24e-13 | 4.44e-16 | 2.24e-11 | 0 | 0 |
| north-steppe / established / before | 1.38e-13 | 0.00e+0 | 9.55e-11 | 327 | 0 |
| north-steppe / established / after | 4.16e-13 | 4.44e-16 | 1.09e-11 | 0 | 0 |
| stone-basin / all / before | 6.52e-13 | 0.00e+0 | 1.59e-10 | 575 | 0 |
| stone-basin / all / after | 5.83e-13 | 4.44e-16 | 3.12e-11 | 0 | 0 |
| stone-basin / established / before | 6.82e-13 | 0.00e+0 | 1.20e-10 | 282 | 0 |
| stone-basin / established / after | 2.13e-14 | 4.44e-16 | 1.02e-11 | 0 | 0 |

Timber payment is independently checked against the canonical inventory proxy, not merely equated to the diagnostic field. Output is checked against both quality � paid timber and the pre-production policy deficit. The baseline did not cap batches at its deficit, so baseline excess-output events may occur; the repaired producer must have zero such events.
