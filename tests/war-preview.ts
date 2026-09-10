import '../src/style.css';
import { warFixture } from './fixtures/war';
import { Historian } from '../src/historian/Historian';
import { GodboxRenderer } from '../src/render/GodboxRenderer';
import { WarChronicle } from '../src/render/war/WarChronicle';

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
  const stage = query.get('stage') ?? 'battle';
  if (stage === 'march') fixture.tick(5);
  else if (stage === 'battle') { while (war.campaign.battleCount < 1 && war.resolvedMonth === undefined) fixture.tick(); }
  else if (stage === 'aftermath') { while (war.resolvedMonth === undefined) fixture.tick(); }
  const historian = new Historian(fixture.sim.config);
  const choose = historian.chooseScene.bind(historian);
  const event = [...fixture.state.history].reverse().find(e => e.actors.includes(war.id))!;
  historian.chooseScene = state => choose(state, event.id);
  app.innerHTML = `<main class="world"><div class="viewport" id="viewport"></div><div class="grain"></div>
    <header class="identity"><div class="sigil"><i></i><b></b></div><div><h1>GODBOX</h1><p>You do not play GODBOX. You witness it.</p></div></header>
    <section class="chronicle"><div class="date">YEAR ${Math.floor(fixture.state.month / 12)} · SETTLEMENT ERA</div><div class="population"><span>${fixture.state.people.filter(p => p.alive).length}</span><small>represented people</small></div><div class="rule"></div><p class="place"></p><p class="activity"></p><p class="evidence">RECORDED FACT</p></section>
    <footer class="runline"><span>CAMPAIGN STUDY</span><span>DEVELOPMENT PREVIEW</span><span>SEED · WATCHER-CAMPAIGN</span></footer></main>`;
  const view = new GodboxRenderer(document.querySelector('#viewport')!, fixture.sim.config, fixture.state, historian);
  const note = new WarChronicle(document.querySelector('.world')!);
  const activity = document.querySelector('.activity')!;
  const place = document.querySelector('.place')!;
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
