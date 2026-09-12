from pathlib import Path

path = Path('src/render/GodboxRenderer.ts')
text = path.read_text()

fields_anchor = "  private lastSettlementSignature = '';\n  private structuralAccumulator = 0;"
fields_new = "  private lastSettlementSignature = '';\n  private bannerHistoryIndexLength = -1;\n  private readonly bannerHistoryByEntity = new Map<string, SimulationState['history']>();\n  private structuralAccumulator = 0;"
if fields_new not in text:
    if fields_anchor not in text:
        raise SystemExit('renderer cache field anchor not found')
    text = text.replace(fields_anchor, fields_new, 1)

sync_old = '''  private syncSettlements(force = false): void {
    const signature = this.state.settlements.map((settlement) => {
      const routeCount = this.state.tradeRoutes.filter((route) => route.active && (route.a === settlement.id || route.b === settlement.id)).length;
      const politySize = this.state.polities.find((polity) => polity.id === settlement.polityId)?.settlementIds.length ?? 1;
      return `${settlement.id}:${settlement.alive ? settlement.buildings : 0}:${settlement.institutionIds.length}:${routeCount}:${politySize}:${this.bannerSignatureForSettlement(settlement)}:${this.developmentSignature(settlement)}:${this.constructionSignature(settlement.id)}`;
    }).join('|');'''
sync_new = '''  private syncSettlements(force = false): void {
    const bannerSignatures = new Map<string, string>();
    const signature = this.state.settlements.map((settlement) => {
      const routeCount = this.state.tradeRoutes.filter((route) => route.active && (route.a === settlement.id || route.b === settlement.id)).length;
      const politySize = this.state.polities.find((polity) => polity.id === settlement.polityId)?.settlementIds.length ?? 1;
      const bannerSignature = this.bannerSignatureForSettlement(settlement);
      bannerSignatures.set(settlement.id, bannerSignature);
      return `${settlement.id}:${settlement.alive ? settlement.buildings : 0}:${settlement.institutionIds.length}:${routeCount}:${politySize}:${bannerSignature}:${this.developmentSignature(settlement)}:${this.constructionSignature(settlement.id)}`;
    }).join('|');'''
if sync_new not in text:
    if sync_old not in text:
        raise SystemExit('sync signature block not found')
    text = text.replace(sync_old, sync_new, 1)

compare_old = "      const bannerSignature = this.bannerSignatureForSettlement(settlement);"
compare_new = "      const bannerSignature = bannerSignatures.get(settlement.id) ?? this.bannerSignatureForSettlement(settlement);"
# replace only second occurrence: first occurrence is inside map block after prior replacement.
first = text.find(compare_old)
if compare_new not in text:
    second = text.find(compare_old, first + 1) if first >= 0 else -1
    if second < 0:
        raise SystemExit('second banner signature comparison anchor not found')
    text = text[:second] + compare_new + text[second + len(compare_old):]

legacy_anchor = "  /** Historical layer: the same people keep a recognizable standard, but history leaves marks. */\n  private bannerLegacyForSettlement("
cache_method = r'''  /**
   * Index history once per history-length revision. Long GODBOX runs can contain enormous
   * chronicles; scanning the entire archive once per settlement would make decorative flags an
   * accidental O(settlements × history) hot path.
   */
  private bannerHistoryForSettlement(settlement: Settlement, culture?: Culture): SimulationState['history'] {
    if (this.bannerHistoryIndexLength !== this.state.history.length) {
      this.bannerHistoryByEntity.clear();
      for (const event of this.state.history) {
        const keys = new Set<string>();
        if (event.locationId) keys.add(event.locationId);
        for (const actor of event.actors) keys.add(actor);
        for (const key of keys) {
          const bucket = this.bannerHistoryByEntity.get(key) ?? [];
          bucket.push(event);
          this.bannerHistoryByEntity.set(key, bucket);
        }
      }
      this.bannerHistoryIndexLength = this.state.history.length;
    }

    const ids = [settlement.id, settlement.polityId, culture?.id].filter((id): id is string => Boolean(id));
    const merged = new Map<string, SimulationState['history'][number]>();
    for (const id of ids) {
      for (const event of this.bannerHistoryByEntity.get(id) ?? []) merged.set(event.id, event);
    }
    return [...merged.values()];
  }

'''
if cache_method.strip() not in text:
    if legacy_anchor not in text:
        raise SystemExit('banner legacy method anchor not found')
    text = text.replace(legacy_anchor, cache_method + legacy_anchor, 1)

history_old = "      history: this.state.history,"
history_new = "      history: this.bannerHistoryForSettlement(settlement, culture),"
if history_new not in text:
    if history_old not in text:
        raise SystemExit('banner history input anchor not found')
    text = text.replace(history_old, history_new, 1)

path.write_text(text)
