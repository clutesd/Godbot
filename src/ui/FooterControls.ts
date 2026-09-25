export function footerMarkup(): string {
  return `
    <footer class="runline">
      <button class="audio-toggle" id="restart" type="button">RESTART</button>
      <span id="observation">OBSERVATION 01</span>
      <button class="audio-toggle pulse" id="camera-mode-toggle" type="button" aria-pressed="true" aria-label="Switch to manual camera control" title="Switch to manual camera control"><i></i> AUTONOMOUS</button>
      <span id="seed">SEED &middot; -</span>
      <button class="audio-toggle" id="audio-toggle" type="button" aria-pressed="false" aria-label="Mute ambient music" title="Mute ambient music">AUDIO ON</button>
      <span class="commandhint">/ &middot; COMMANDS</span>
    </footer>
  `;
}

export function syncAudioToggle(button: HTMLButtonElement, muted: boolean): void {
  button.textContent = muted ? 'AUDIO OFF' : 'AUDIO ON';
  button.setAttribute('aria-pressed', String(!muted));
  button.setAttribute('aria-label', muted ? 'Unmute ambient music' : 'Mute ambient music');
  button.title = muted ? 'Unmute ambient music' : 'Mute ambient music';
}

export function syncCameraToggle(button: HTMLButtonElement, world: HTMLElement, autonomous: boolean): void {
  button.disabled = false;
  button.removeAttribute('aria-disabled');
  button.setAttribute('aria-pressed', String(autonomous));
  button.innerHTML = autonomous ? '<i></i> AUTONOMOUS' : '<i></i> MANUAL · WASD + MOUSE';
  const actionLabel = autonomous ? 'Switch to manual camera control' : 'Switch to autonomous camera control';
  button.setAttribute('aria-label', actionLabel);
  button.title = autonomous
    ? actionLabel
    : 'Switch to autonomous camera · WASD move · mouse look · Q/E down/up · Shift faster';
  world.classList.toggle('manual-camera', !autonomous);
}

export function syncRestartToggle(button: HTMLButtonElement, restarting: boolean): void {
  button.disabled = restarting;
  button.textContent = restarting ? 'RESTARTING…' : 'RESTART';
  if (restarting) {
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-label', 'Restarting observation');
  } else {
    button.removeAttribute('aria-busy');
    button.setAttribute('aria-label', 'Restart observation');
  }
  button.title = restarting ? 'Restarting observation' : 'Restart observation';
}

export function showCameraArchived(button: HTMLButtonElement, world: HTMLElement): void {
  button.disabled = true;
  button.setAttribute('aria-disabled', 'true');
  button.removeAttribute('aria-pressed');
  button.setAttribute('aria-label', 'Observation archived');
  button.title = 'Observation archived';
  button.innerHTML = '<i></i> ARCHIVED';
  world.classList.remove('manual-camera');
}

/**
 * Installs the two activation paths the camera control needs:
 * - capture-phase pointer hit testing so temporary cinematic overlays cannot steal a primary click;
 * - native/synthetic keyboard button activation for Enter/Space and assistive technology.
 *
 * Pointer-originated click events are ignored because pointerdown has already handled them.
 */
export function installCameraToggleInput(
  button: HTMLButtonElement,
  toggle: () => void,
  pointerTarget: EventTarget = window,
): () => void {
  const onPointerDown = (event: Event): void => {
    if (button.disabled) return;
    const pointer = event as PointerEvent;
    if (pointer.button !== 0) return;
    const rect = button.getBoundingClientRect();
    const inside = pointer.clientX >= rect.left && pointer.clientX <= rect.right
      && pointer.clientY >= rect.top && pointer.clientY <= rect.bottom;
    if (!inside) return;
    event.preventDefault();
    event.stopPropagation();
    toggle();
  };

  const onClick = (event: Event): void => {
    if (button.disabled) return;
    if ((event as MouseEvent).detail === 0) toggle();
  };

  pointerTarget.addEventListener('pointerdown', onPointerDown, { capture: true });
  button.addEventListener('click', onClick);

  return () => {
    pointerTarget.removeEventListener('pointerdown', onPointerDown, { capture: true });
    button.removeEventListener('click', onClick);
  };
}
