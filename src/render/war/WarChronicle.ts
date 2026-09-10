import type { SimulationState, War } from '../../sim/types';
import { WAR_CAUSES, WAR_CHAPTERS } from '../../historian/WarStory';

/** A field note for the witnessed campaign, grounded in current authoritative state. */
export class WarChronicle {
  private readonly root = document.createElement('aside');
  private readonly fields = new Map<string, HTMLElement>();
  private lastSignature = '';

  constructor(host: HTMLElement) {
    this.root.className = 'war-chronicle';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Witnessed campaign record');
    this.root.innerHTML = `
      <div class="war-eyebrow"><span>THE WATCHER'S FIELDNOTES</span><span data-field="record"></span></div>
      <div class="war-heading"><span class="war-chapter" data-field="chapter"></span><h2 data-field="title"></h2></div>
      <p class="war-cause" data-field="cause"></p>
      <div class="war-thread" aria-hidden="true">
        <svg viewBox="0 0 300 44" fill="none">
          <path class="war-thread-base" d="M10 22H290" />
          <path class="war-thread-a" d="M10 22H148" />
          <path class="war-thread-b" d="M290 22H152" />
          <circle class="war-origin" cx="10" cy="22" r="3"/><circle class="war-destination" cx="290" cy="22" r="3"/>
          <path class="war-knot" d="M150 10L162 22L150 34L138 22Z"/>
          <path class="war-knot-inner" d="M150 18L154 22L150 26L146 22Z"/>
        </svg>
      </div>
      <div class="war-sides"><div><span class="war-side-role">MARCHING FROM</span><h3 data-field="attacker"></h3><p data-field="supply-a"></p></div><div><span class="war-side-role">DEFENDING</span><h3 data-field="defender"></h3><p data-field="supply-b"></p></div></div>
      <ol class="war-chapters" aria-label="Campaign chapters"><li>Gathering</li><li>March</li><li>Clashes</li><li>Aftermath</li></ol>
      <p class="war-condition" data-field="condition"></p>
      <div class="war-ledger"><span><b data-field="months"></b><small>months</small></span><span><b data-field="clashes"></b><small>clashes</small></span><span><b data-field="losses"></b><small>lives lost</small></span></div>
      <p class="war-source" data-field="source"></p>`;
    this.root.querySelectorAll<HTMLElement>('[data-field]').forEach(element => this.fields.set(element.dataset['field']!, element));
    host.append(this.root);
  }

  update(state: SimulationState, warId?: string): void {
    const war = warId ? state.wars.find(w => w.id === warId) : undefined;
    const a = war ? state.settlements.find(s => s.id === war.attacker) : undefined;
    const b = war ? state.settlements.find(s => s.id === war.defender) : undefined;
    const visible = Boolean(war && a && b && (war.active || (war.resolvedMonth !== undefined && state.month - war.resolvedMonth <= 24)));
    this.root.hidden = !visible;
    this.root.parentElement?.classList.toggle('witnessing-war', visible);
    if (!visible || !war || !a || !b) { this.lastSignature = ''; return; }
    const signature = `${war.id}:${state.month}:${war.phase}`;
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    const chapter = WAR_CHAPTERS[war.phase];
    const resolved = war.resolvedMonth !== undefined;
    this.root.dataset['phase'] = war.phase;
    this.root.dataset['blocked'] = String(war.campaign.blockedMonths > 0);
    this.set('record', war.id.replace('war-', '').padStart(2, '0'));
    this.set('chapter', chapter.number);
    this.set('title', chapter.title);
    this.set('cause', WAR_CAUSES[war.cause]);
    this.set('attacker', a.name);
    this.set('defender', b.name);
    this.set('supply-a', resolved ? 'Campaign concluded' : this.supply(war.campaign.supplyA));
    this.set('supply-b', resolved ? 'Campaign concluded' : this.supply(war.campaign.supplyB));
    const cultureColor = (shares: Record<string, number>, fallback: string): string => {
      const id = Object.entries(shares).sort((x, y) => y[1] - x[1])[0]?.[0];
      return state.cultures.find(c => c.id === id)?.style.primary ?? fallback;
    };
    this.root.style.setProperty('--banner-a', cultureColor(a.cultureShares, '#ca886b'));
    this.root.style.setProperty('--banner-b', cultureColor(b.cultureShares, '#83b5b3'));
    const reached = [true, war.marchProgress > 0, war.campaign.battleCount > 0, resolved];
    const current = resolved ? 3 : war.phase === 'battle' ? 2 : war.phase === 'marching' ? 1 : 0;
    this.root.querySelectorAll<HTMLElement>('.war-chapters li').forEach((el, index) => {
      el.classList.toggle('reached', reached[index]!);
      el.classList.toggle('current', current === index);
      if (current === index) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
    });
    this.set('condition', this.condition(war, a.name, b.name));
    this.set('months', String((war.resolvedMonth ?? state.month) - war.startMonth));
    this.set('clashes', String(war.campaign.battleCount));
    this.set('losses', (war.casualtiesA + war.casualtiesB).toLocaleString());
    this.set('source', resolved ? 'CLOSED RECORD · FIVE-YEAR TRUCE' : `OBSERVED STATE · YEAR ${Math.floor(state.month / 12).toLocaleString()}`);
  }

  private condition(war: War, a: string, b: string): string {
    if (war.resolutionReason === 'impassable') return 'The land stopped the campaign. The banners turn home.';
    if (war.resolutionReason === 'settlement-lost') return 'A settlement ceased to function. The campaign is over.';
    if (war.phase === 'occupation') return `${a} imposed tribute. The cost remains in the record.`;
    if (war.phase === 'retreat') return `${b} forced a retreat. The road now leads home.`;
    if (war.phase === 'negotiation') return 'Exhaustion brought a negotiated peace.';
    if (war.campaign.blockedMonths > 0) return 'An impassable approach holds the campaign in place.';
    if (war.phase === 'mobilizing') return 'The banners gather. No outcome is yet written.';
    if (war.phase === 'marching') return `${Math.round(war.marchProgress * 100)}% of the march completed. Provisions set the pace.`;
    if (Math.min(war.campaign.supplyA, war.campaign.supplyB) < 0.25) return 'Provisions are failing. The front carries the strain.';
    if (Math.max(war.campaign.exhaustionA, war.campaign.exhaustionB) > 0.65) return 'Exhaustion is deepening on the contested ground.';
    return war.progress > 0.22 ? `${a} has the initiative. The outcome remains open.` : war.progress < -0.22 ? `${b} is holding the approaches.` : 'The ground remains contested. Neither side has a clear advantage.';
  }

  private supply(value: number): string { return value < 0.25 ? 'Provisions · critical' : value < 0.5 ? 'Provisions · strained' : 'Provisions · holding'; }
  private set(key: string, text: string): void { this.fields.get(key)!.textContent = text; }
}
