import { describe, expect, it, vi } from 'vitest';
import { setAutonomousCameraMode } from '../src/render/CameraControlMode';

describe('camera authority handoff', () => {
  it('enters manual authority without re-anchoring autonomous presentation', () => {
    let active = false;
    const manual = {
      get active() { return active; },
      setEnabled: vi.fn((enabled: boolean) => { active = enabled; }),
    };
    const autonomous = { resumeFromExternalPose: vi.fn() };

    expect(setAutonomousCameraMode(manual, autonomous, false)).toBe(true);
    expect(manual.setEnabled).toHaveBeenCalledWith(true);
    expect(autonomous.resumeFromExternalPose).not.toHaveBeenCalled();
    expect(manual.active).toBe(true);
  });

  it('disables manual authority before re-anchoring the autonomous director', () => {
    let active = true;
    const order: string[] = [];
    const manual = {
      get active() { return active; },
      setEnabled: vi.fn((enabled: boolean) => {
        order.push(`manual:${enabled}`);
        active = enabled;
      }),
    };
    const autonomous = {
      resumeFromExternalPose: vi.fn(() => { order.push('autonomous:resume'); }),
    };

    expect(setAutonomousCameraMode(manual, autonomous, true)).toBe(true);
    expect(order).toEqual(['manual:false', 'autonomous:resume']);
    expect(manual.active).toBe(false);
  });

  it('is idempotent when the requested authority already owns the camera', () => {
    for (const active of [false, true]) {
      let manualActive = active;
      const manual = {
        get active() { return manualActive; },
        setEnabled: vi.fn((enabled: boolean) => { manualActive = enabled; }),
      };
      const autonomous = { resumeFromExternalPose: vi.fn() };
      const requestedAutonomous = !active;

      expect(setAutonomousCameraMode(manual, autonomous, requestedAutonomous)).toBe(false);
      expect(manual.setEnabled).not.toHaveBeenCalled();
      expect(autonomous.resumeFromExternalPose).not.toHaveBeenCalled();
    }
  });
});
