export interface ManualCameraAuthority {
  readonly active: boolean;
  setEnabled(enabled: boolean): void;
}

export interface AutonomousCameraAuthority {
  resumeFromExternalPose(): void;
}

/**
 * Transfers camera authority without WebGL concerns.
 * Returns true only when authority actually changed.
 */
export function setAutonomousCameraMode(
  manual: ManualCameraAuthority,
  autonomous: AutonomousCameraAuthority,
  enabled: boolean,
): boolean {
  const wasAutonomous = !manual.active;
  if (enabled === wasAutonomous) return false;

  manual.setEnabled(!enabled);
  if (enabled) autonomous.resumeFromExternalPose();
  return true;
}
