import '../src/style.css';
import './war-preview.css';
import { warFixture } from './fixtures/war';
import { Historian } from '../src/historian/Historian';
import { GodboxRenderer } from '../src/render/GodboxRenderer';
import { WarChronicle } from '../src/render/war/WarChronicle';
import { applyWarPreviewMethod, prepareStrategicWarPreview, prepareWarPreviewBattlefield, WAR_PREVIEW_METHODS, warPreviewEscalation, warPreviewMethod } from '../src/dev/warPreviewModel';

// Development-only visual fixture. It never reads or writes an observation archive.
const query = new URLSearchParams(location.search);
const app = document.querySelector<HTMLElement>('#app')!;
if (query.has('mobile')) {
  const frame = document.createElement('iframe');
  query.delete('mobile');
  frame.src = `${location.pathname}?${query}`;
  frame.style.cssText = 'width:390px;height:844px;max-height:100vh;border:0;display:block;margin:auto';
  frame.title = 'Mobile campaign preview';
  app.append(frame);
} else {
  const fixture = warFixture();
  const war = fixture.declare();
  const method = warPreviewMethod(query.get('equipment'));
  applyWarPreviewMethod(war, method);
  const battlefield = query.get('battlefield') === 'field' ? 'field' : 'settlement';
  prepareWarPreviewBattlefield(fixture.state, war, method, battlefield);
  const requestedStage = query.get('stage');
  const stage = ['mobilize', 'march', 'battle', 'aftermath'].includes(requestedStage ?? '') ? requestedStage! : 'battle';
  if (stage === 'march') { for (let i = 0; i < 120 && war.phase === 'mobilizing' && war.resolvedMonth === undefined; i++) fixture.tick(); }
  else if (stage === 'battle') { for (let i = 0; i < 120 && war.campaign.battleCount < 1 && war.resolvedMonth === undefined; i++) fixture.tick(); }
  else if (stage === 'aftermath') { for (let i = 0; i < 180 && war.resolvedMonth === undefined; i++) fixture.tick(); }
  const escalation = warPreviewEscalation(method, query.get('escalation'));
  if (stage === 'battle' || stage === 'aftermath') prepareStrategicWarPreview(fixture.state, war, method, escalation);
  // The equipment study takes place on an open field; retain woodland beyond the route.
  // The flattened grassland fixture otherwise inherits dense woodland from its generated map.
  for (const cell of fixture.state.world.cells) {
    if (Math.abs(cell.worldZ) < 12 && Math.abs(cell.worldX) < 28) cell.wood = 0;
  }
  const historian = new Historian(fixture.sim.config);
  const choose = historian.chooseScene.bind(historian);
  const event = [...fixture.state.history].reverse().find(e => e.actors.includes(war.id))!;
  historian.chooseScene = state => choose(state, event.id);
  const nuclear = method.strategic && method.strategic !== 'biological';
  app.innerHTML = `<main class="world campaign-preview"><div class="viewport" id="viewport"><div class="preview-loading">Preparing campaign...</div></div><div class="grain"></div>
    <header class="identity"><div class="sigil"><i></i><b></b></div><div><h1>GODBOX</h1><p>You do not play GODBOX. You witness it.</p></div></header>
    <section class="campaign-controls" aria-label="Campaign preview controls">
      <h2>Campaign methods</h2>
      <div class="campaign-options">
        <label>Era &amp; weapon<select id="campaign-method">${WAR_PREVIEW_METHODS.map(item => `<option value="${item.id}">${item.era} &middot; ${item.label}</option>`).join('')}</select></label>
        <label>Campaign stage<select id="campaign-stage"><option value="mobilize">Mobilization</option><option value="march">March</option><option value="battle">Battle</option><option value="aftermath">Aftermath</option></select></label>
        <label>Battlefield<select id="campaign-battlefield"><option value="settlement">Built-up approach</option><option value="field">Open field</option></select></label>
      </div>
      ${nuclear ? '<label class="campaign-escalation">Nuclear escalation<select id="campaign-escalation"><option value="deterrence">Deterrence &middot; arsenals held</option><option value="limited">Limited use &middot; single detonation</option><option value="exchange">MAD failure &middot; retaliatory exchange</option></select></label>' : ''}
      <p>${method.description}</p>
      <div class="campaign-actions"><button type="button" id="campaign-previous" aria-label="Previous combat method">&larr; Previous</button><button type="button" id="campaign-next" aria-label="Next combat method">Next &rarr;</button><button type="button" id="campaign-replay">Replay</button></div>
    </section>
    <section class="chronicle"><div class="date">YEAR ${Math.floor(fixture.state.month / 12)} · SETTLEMENT ERA</div><div class="population"><span>${fixture.state.people.filter(p => p.alive).length}</span><small>represented people</small></div><div class="rule"></div><p class="place"></p><p class="activity"></p><p class="evidence">RECORDED FACT</p></section>
    <footer class="runline"><span>CAMPAIGN STUDY</span><span>DEVELOPMENT PREVIEW</span><span>SEED · WATCHER-CAMPAIGN</span></footer></main>`;
  const methodSelect = document.querySelector<HTMLSelectElement>('#campaign-method')!;
  const stageSelect = document.querySelector<HTMLSelectElement>('#campaign-stage')!;
  const escalationSelect = document.querySelector<HTMLSelectElement>('#campaign-escalation');
  const battlefieldSelect = document.querySelector<HTMLSelectElement>('#campaign-battlefield')!;
  battlefieldSelect.value = battlefield;
  if (escalationSelect) escalationSelect.value = escalation;
  methodSelect.value = method.id;
  stageSelect.value = stage;
  const navigate = (equipment = methodSelect.value) => {
    const url = new URL(location.href);
    url.searchParams.set('equipment', equipment);
    url.searchParams.set('stage', stageSelect.value);
    url.searchParams.set('battlefield', battlefieldSelect.value);
    if (escalationSelect) url.searchParams.set('escalation', escalationSelect.value);
    else url.searchParams.delete('escalation');
    location.assign(url.href);
  };
  methodSelect.addEventListener('change', () => navigate());
  stageSelect.addEventListener('change', () => navigate());
  battlefieldSelect.addEventListener('change', () => navigate());
  escalationSelect?.addEventListener('change', () => navigate());
  const cycle = (direction: number) => {
    const index = WAR_PREVIEW_METHODS.findIndex(item => item.id === method.id);
    navigate(WAR_PREVIEW_METHODS[(index + direction + WAR_PREVIEW_METHODS.length) % WAR_PREVIEW_METHODS.length]!.id);
  };
  document.querySelector('#campaign-previous')!.addEventListener('click', () => cycle(-1));
  document.querySelector('#campaign-next')!.addEventListener('click', () => cycle(1));
  document.querySelector('#campaign-replay')!.addEventListener('click', () => navigate());
  const view = new GodboxRenderer(document.querySelector('#viewport')!, fixture.sim.config, fixture.state, historian);
  view.update(0, 8);
  await view.warmUpOpening();
  document.querySelector('.preview-loading')?.remove();
  // Browser QA uses the real renderer, camera and fixture; this page is never shipped to users.
  Object.assign(window, { __warPreview: { view, state: fixture.state, war, method: method.id, escalation } });
  const note = new WarChronicle(document.querySelector('.world')!);
  const activity = document.querySelector('.activity')!;
  const place = document.querySelector('.place')!;
  if (event.context.previewScenario === true) document.querySelector('.evidence')!.textContent = 'PREVIEW SCENARIO';
  const start = performance.now();
  let previous = start;
  const animate = (now: number) => {
    view.update(Math.min(0.1, (now - previous) / 1000), (now - start) / 1000 + 8);
    previous = now;
    note.update(fixture.state, war.id);
    activity.textContent = view.observation.detail;
    place.textContent = view.observation.label;
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}
