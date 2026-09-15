/** DEV-only review harness. Runs the production UI with an isolated in-memory archive. */
const frame = document.querySelector('iframe')!;
const status = document.querySelector('output')!;
const moment = document.querySelector('select')!;
let paused = true;
let busy = false;
const child = () => frame.contentWindow as Window;
async function seek(seconds: number): Promise<void> {
  if (busy || !child().__godboxArrival) return;
  busy = true;
  try {
    if (seconds < (child().__godboxArrival!.state.arrival?.elapsedSeconds ?? 0)) await child().__godboxRestart?.('arrival-day-preview');
    const api = child().__godboxArrival!;
    paused = true; api.pause(true);
    api.advance(seconds - (api.state.arrival?.elapsedSeconds ?? 0));
  } finally { busy = false; }
}
document.querySelector('#seek')!.addEventListener('click', () => { void seek(Number(moment.value)); });
document.querySelector('#restart')!.addEventListener('click', () => { void seek(0); });
document.querySelector('#play')!.addEventListener('click', () => { paused = !paused; child().__godboxArrival?.pause(paused); });
document.querySelector('#step')!.addEventListener('click', () => { paused = true; child().__godboxArrival?.pause(true); child().__godboxArrival?.advance(0.25); });
function update(): void {
  const state = child().__godboxArrival?.state;
  if (state?.arrival) status.textContent = `${state.arrival.elapsedSeconds.toFixed(2)}s · ${state.arrival.phase} · ${state.people.length} people · ${state.settlements.reduce((n, s) => n + s.buildings, 0)} buildings · month ${state.month}${busy ? ' · rebuilding' : ''}`;
  requestAnimationFrame(update);
}
requestAnimationFrame(update);
