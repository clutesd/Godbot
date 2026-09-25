import { describe, expect, it, vi } from 'vitest';
import {
  installCameraToggleInput,
  showCameraArchived,
  syncAudioToggle,
  syncCameraToggle,
} from '../src/ui/FooterControls';

class FakeClassList {
  private readonly values = new Set<string>();

  contains(name: string): boolean { return this.values.has(name); }
  toggle(name: string, force?: boolean): boolean {
    const enabled = force ?? !this.values.has(name);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }
  remove(name: string): void { this.values.delete(name); }
}

class FakeButton extends EventTarget {
  textContent: string | null = '';
  innerHTML = '';
  title = '';
  disabled = false;
  readonly attributes = new Map<string, string>();
  rect = { left: 100, right: 260, top: 500, bottom: 540 };

  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  getBoundingClientRect(): DOMRect {
    return {
      ...this.rect,
      x: this.rect.left,
      y: this.rect.top,
      width: this.rect.right - this.rect.left,
      height: this.rect.bottom - this.rect.top,
      toJSON: () => ({}),
    } as DOMRect;
  }
}

class FakeWorld {
  readonly classList = new FakeClassList();
}

function pointerEvent(button: number, clientX: number, clientY: number): Event {
  const event = new Event('pointerdown', { cancelable: true });
  Object.defineProperties(event, {
    button: { value: button },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  return event;
}

function clickEvent(detail: number): Event {
  const event = new Event('click', { cancelable: true });
  Object.defineProperty(event, 'detail', { value: detail });
  return event;
}

describe('footer control contracts', () => {
  it('exposes audio mute state through visible text and accessible button state', () => {
    const button = new FakeButton() as unknown as HTMLButtonElement;

    syncAudioToggle(button, false);
    expect(button.textContent).toBe('AUDIO ON');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Mute ambient music');
    expect(button.title).toBe('Mute ambient music');

    syncAudioToggle(button, true);
    expect(button.textContent).toBe('AUDIO OFF');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Unmute ambient music');
    expect(button.title).toBe('Unmute ambient music');
  });

  it('keeps camera label, ARIA state and world cursor mode synchronized', () => {
    const button = new FakeButton() as unknown as HTMLButtonElement;
    const world = new FakeWorld() as unknown as HTMLElement;

    syncCameraToggle(button, world, true);
    expect(button.innerHTML).toContain('AUTONOMOUS');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Switch to manual camera control');
    expect(world.classList.contains('manual-camera')).toBe(false);

    syncCameraToggle(button, world, false);
    expect(button.innerHTML).toContain('MANUAL · WASD + MOUSE');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Switch to autonomous camera control');
    expect(world.classList.contains('manual-camera')).toBe(true);
  });

  it('captures a primary pointer inside the visible camera button before overlays can steal it', () => {
    const pointerTarget = new EventTarget();
    const button = new FakeButton();
    const toggle = vi.fn();
    const cleanup = installCameraToggleInput(button as unknown as HTMLButtonElement, toggle, pointerTarget);
    const event = pointerEvent(0, 180, 520);

    pointerTarget.dispatchEvent(event);

    expect(toggle).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    cleanup();
  });

  it('ignores pointer input outside the button and non-primary pointer buttons', () => {
    const pointerTarget = new EventTarget();
    const button = new FakeButton();
    const toggle = vi.fn();
    const cleanup = installCameraToggleInput(button as unknown as HTMLButtonElement, toggle, pointerTarget);

    pointerTarget.dispatchEvent(pointerEvent(0, 20, 20));
    pointerTarget.dispatchEvent(pointerEvent(1, 180, 520));
    pointerTarget.dispatchEvent(pointerEvent(2, 180, 520));

    expect(toggle).not.toHaveBeenCalled();
    cleanup();
  });

  it('accepts keyboard/assistive button activation without double-firing pointer clicks', () => {
    const pointerTarget = new EventTarget();
    const button = new FakeButton();
    const toggle = vi.fn();
    const cleanup = installCameraToggleInput(button as unknown as HTMLButtonElement, toggle, pointerTarget);

    button.dispatchEvent(clickEvent(0));
    expect(toggle).toHaveBeenCalledTimes(1);

    button.dispatchEvent(clickEvent(1));
    expect(toggle).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('makes archived camera state explicitly non-interactive and restores it cleanly for a new run', () => {
    const pointerTarget = new EventTarget();
    const button = new FakeButton();
    const world = new FakeWorld();
    const toggle = vi.fn();
    const cleanup = installCameraToggleInput(button as unknown as HTMLButtonElement, toggle, pointerTarget);

    syncCameraToggle(button as unknown as HTMLButtonElement, world as unknown as HTMLElement, false);
    showCameraArchived(button as unknown as HTMLButtonElement, world as unknown as HTMLElement);

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-pressed')).toBeNull();
    expect(button.innerHTML).toContain('ARCHIVED');
    expect(world.classList.contains('manual-camera')).toBe(false);

    pointerTarget.dispatchEvent(pointerEvent(0, 180, 520));
    button.dispatchEvent(clickEvent(0));
    expect(toggle).not.toHaveBeenCalled();

    syncCameraToggle(button as unknown as HTMLButtonElement, world as unknown as HTMLElement, true);
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBeNull();
    expect(button.getAttribute('aria-pressed')).toBe('true');

    cleanup();
  });

  it('removes both camera activation paths during teardown', () => {
    const pointerTarget = new EventTarget();
    const button = new FakeButton();
    const toggle = vi.fn();
    const cleanup = installCameraToggleInput(button as unknown as HTMLButtonElement, toggle, pointerTarget);

    cleanup();
    pointerTarget.dispatchEvent(pointerEvent(0, 180, 520));
    button.dispatchEvent(clickEvent(0));

    expect(toggle).not.toHaveBeenCalled();
  });
});
