import * as THREE from 'three';
import type { Person } from '../../sim/types';
import type { FirstFireStagingTarget } from '../founding/FoundingFirstFirePresentation';
import type { LocalActivityState } from './LocalActivityPresentation';

export type ReactionGlyph = '🥺' | '❤️' | '🪵' | '🔥' | '😊' | '😡';
export type ReactionGlyphReason =
  | 'support'
  | 'warm-bond'
  | 'shared-laugh'
  | 'tense-exchange'
  | 'timber-work'
  | 'first-fire';

export interface ReactionGlyphCue {
  glyph: ReactionGlyph;
  reason: ReactionGlyphReason;
  priority: number;
  sourceKey: string;
}

export interface ReactionGlyphEvidence {
  person: Pick<Person, 'id' | 'activity' | 'navigation'>;
  local?: Readonly<LocalActivityState>;
  firstFire?: Readonly<FirstFireStagingTarget>;
  resourceKind?: string;
  seriousShot?: boolean;
}

export const REACTION_GLYPH_BUDGET = 4;
export const REACTION_GLYPH_MAX_DISTANCE = 18;

const GLYPHS: readonly ReactionGlyph[] = ['🥺', '❤️', '🪵', '🔥', '😊', '😡'];
const MIN_GLOBAL_GAP_SECONDS = 1.35;
const MIN_PERSON_COOLDOWN_SECONDS = 18;
const PERSON_COOLDOWN_SPAN_SECONDS = 22;

export function reactionGlyphCueFor(evidence: ReactionGlyphEvidence): ReactionGlyphCue | undefined {
  const { person, local, firstFire } = evidence;
  if (evidence.seriousShot || !person.navigation || person.navigation.schedulePhase === 'emergency'
    || person.activity === 'flee' || person.activity === 'migrate') return undefined;

  if (firstFire?.role === 'tender') {
    return { glyph: '🔥', reason: 'first-fire', priority: 1, sourceKey: `first-fire:${firstFire.eventId}` };
  }

  const encounter = local?.encounter;
  if (encounter && (local.phase === 'action' || local.phase === 'pause')) {
    if (encounter.tone === 'supportive' && ['quiet-company', 'reassurance', 'check-in'].includes(local.action)) {
      return {
        glyph: '🥺',
        reason: 'support',
        priority: 0.96,
        sourceKey: `support:${encounter.relationshipId ?? encounter.partnerId}:${local.action}`,
      };
    }
    if (encounter.tone === 'warm' && local.action === 'small-shared-laugh') {
      return {
        glyph: '😊',
        reason: 'shared-laugh',
        priority: 0.92,
        sourceKey: `laugh:${encounter.relationshipId ?? encounter.partnerId}`,
      };
    }
    if (encounter.tone === 'warm'
      && ['family', 'friend'].includes(encounter.relationshipKind ?? '')
      && ['warm-conversation', 'linger-together'].includes(local.action)
      && person.id < encounter.partnerId) {
      return {
        glyph: '❤️',
        reason: 'warm-bond',
        priority: 0.86,
        sourceKey: `bond:${encounter.relationshipId ?? encounter.partnerId}`,
      };
    }
    if (encounter.tone === 'tense' && local.action === 'guarded-exchange' && person.id < encounter.partnerId) {
      return {
        glyph: '😡',
        reason: 'tense-exchange',
        priority: 0.78,
        sourceKey: `tense:${encounter.relationshipId ?? encounter.partnerId}`,
      };
    }
  }

  if (evidence.resourceKind === 'timber' && person.activity === 'gather') {
    return { glyph: '🪵', reason: 'timber-work', priority: 0.56, sourceKey: `timber:${person.id}` };
  }

  return undefined;
}

interface Anchor {
  x: number;
  y: number;
  z: number;
  scale: number;
  seen: number;
}

interface Proposal {
  personId: string;
  cue: ReactionGlyphCue;
  distance: number;
  cameraSubject: boolean;
}

interface ActiveGlyph {
  personId: string;
  cue: ReactionGlyphCue;
  startedAt: number;
  duration: number;
  slot: number;
}

interface Slot {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
}

export class ReactionGlyphRenderer {
  readonly group = new THREE.Group();

  private readonly textures = new Map<ReactionGlyph, THREE.CanvasTexture>();
  private readonly slots: Slot[] = [];
  private readonly anchors = new Map<string, Anchor>();
  private readonly proposals: Proposal[] = [];
  private readonly active: ActiveGlyph[] = [];
  private readonly lastShownAt = new Map<string, number>();
  private readonly seed: string;
  private frame = 0;
  private nowSeconds = 0;
  private nextGlobalSpawn = 0;
  private cameraSubjectId?: string;
  private seriousShot = false;
  private reducedMotion = false;
  private cameraX = 0;
  private cameraZ = 0;

  constructor(seed: string) {
    this.seed = seed;
    this.group.name = 'reaction-glyphs';
    this.group.frustumCulled = false;
    for (const glyph of GLYPHS) this.textures.set(glyph, createGlyphTexture(glyph));

    for (let index = 0; index < REACTION_GLYPH_BUDGET; index++) {
      const material = new THREE.SpriteMaterial({
        transparent: true,
        opacity: 0,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      sprite.renderOrder = 2;
      sprite.frustumCulled = false;
      this.group.add(sprite);
      this.slots.push({ sprite, material });
    }
  }

  beginFrame(
    elapsedSeconds: number,
    camera: Readonly<{ x: number; z: number }>,
    cameraSubjectId: string | undefined,
    seriousShot: boolean,
    reducedMotion: boolean,
  ): void {
    this.frame++;
    this.nowSeconds = Math.max(0, elapsedSeconds);
    this.cameraX = camera.x;
    this.cameraZ = camera.z;
    this.cameraSubjectId = cameraSubjectId;
    this.seriousShot = seriousShot;
    this.reducedMotion = reducedMotion;
    this.proposals.length = 0;
    this.group.visible = !seriousShot;
  }

  track(personId: string, x: number, y: number, z: number, scale: number): void {
    const anchor = this.anchors.get(personId);
    if (anchor) {
      anchor.x = x; anchor.y = y; anchor.z = z; anchor.scale = scale; anchor.seen = this.frame;
    } else {
      this.anchors.set(personId, { x, y, z, scale, seen: this.frame });
    }
  }

  consider(personId: string, evidence: ReactionGlyphEvidence): void {
    if (this.seriousShot) return;
    const anchor = this.anchors.get(personId);
    if (!anchor || anchor.seen !== this.frame) return;
    const cue = reactionGlyphCueFor(evidence);
    if (!cue) return;
    const distance = Math.hypot(anchor.x - this.cameraX, anchor.z - this.cameraZ);
    if (distance > REACTION_GLYPH_MAX_DISTANCE) return;
    this.proposals.push({ personId, cue, distance, cameraSubject: personId === this.cameraSubjectId });
  }

  endFrame(): void {
    this.updateActive();
    for (const [id, anchor] of this.anchors) if (anchor.seen !== this.frame) this.anchors.delete(id);
    if (this.seriousShot || this.nowSeconds < this.nextGlobalSpawn || this.active.length >= REACTION_GLYPH_BUDGET) return;

    const activePeople = new Set(this.active.map(item => item.personId));
    const eligible = this.proposals.filter(proposal => {
      if (activePeople.has(proposal.personId)) return false;
      const cooldown = MIN_PERSON_COOLDOWN_SECONDS
        + stableUnit(`${this.seed}:${proposal.personId}:reaction-cooldown`) * PERSON_COOLDOWN_SPAN_SECONDS;
      return this.nowSeconds - (this.lastShownAt.get(proposal.personId) ?? -Infinity) >= cooldown;
    });
    if (!eligible.length) return;

    eligible.sort((a, b) => scoreProposal(b) - scoreProposal(a)
      || stableUnit(`${this.seed}:${a.personId}:${a.cue.sourceKey}`)
        - stableUnit(`${this.seed}:${b.personId}:${b.cue.sourceKey}`));

    const chosen = eligible[0]!;
    const freeSlot = this.slots.findIndex((_, slot) => !this.active.some(item => item.slot === slot));
    if (freeSlot < 0) return;
    const duration = 1.05 + stableUnit(`${this.seed}:${chosen.personId}:${chosen.cue.sourceKey}:duration`) * 0.42;
    this.active.push({ personId: chosen.personId, cue: chosen.cue, startedAt: this.nowSeconds, duration, slot: freeSlot });
    this.lastShownAt.set(chosen.personId, this.nowSeconds);
    this.nextGlobalSpawn = this.nowSeconds + MIN_GLOBAL_GAP_SECONDS
      + stableUnit(`${this.seed}:${chosen.cue.sourceKey}:global-gap`) * 0.55;
    this.updateActive();
  }

  clear(): void {
    this.active.length = 0;
    this.proposals.length = 0;
    this.anchors.clear();
    this.lastShownAt.clear();
    this.nextGlobalSpawn = 0;
    for (const slot of this.slots) {
      slot.sprite.visible = false;
      slot.material.opacity = 0;
    }
  }

  dispose(): void {
    this.clear();
    for (const texture of this.textures.values()) texture.dispose();
    for (const slot of this.slots) slot.material.dispose();
    this.group.clear();
  }

  private updateActive(): void {
    for (let index = this.active.length - 1; index >= 0; index--) {
      const active = this.active[index]!;
      const slot = this.slots[active.slot]!;
      const anchor = this.anchors.get(active.personId);
      const age = this.nowSeconds - active.startedAt;
      if (!anchor || anchor.seen !== this.frame || age >= active.duration) {
        slot.sprite.visible = false;
        slot.material.opacity = 0;
        this.active.splice(index, 1);
        continue;
      }

      const t = clamp01(age / active.duration);
      const envelope = this.reducedMotion
        ? (t < 0.86 ? 1 : 1 - (t - 0.86) / 0.14)
        : smoothstep(Math.min(1, t / 0.16)) * smoothstep(Math.min(1, (1 - t) / 0.22));
      const rise = this.reducedMotion ? 0 : smoothstep(t) * 0.045 * Math.max(0.7, anchor.scale);
      const pulse = this.reducedMotion ? 1 : 0.94 + Math.sin(Math.min(1, t / 0.22) * Math.PI) * 0.08;
      const worldScale = Math.max(0.115, Math.min(0.18, anchor.scale * 0.52)) * pulse;

      slot.material.map = this.textures.get(active.cue.glyph)!;
      slot.material.opacity = Math.max(0, Math.min(1, envelope * 0.94));
      slot.material.needsUpdate = true;
      slot.sprite.position.set(anchor.x, anchor.y + 0.085 + rise, anchor.z);
      slot.sprite.scale.set(worldScale * 1.18, worldScale, 1);
      slot.sprite.visible = !this.seriousShot && slot.material.opacity > 0.01;
    }
  }
}

function scoreProposal(proposal: Proposal): number {
  const subjectBoost = proposal.cameraSubject ? 0.18 : 0;
  const distanceBoost = Math.max(0, 1 - proposal.distance / REACTION_GLYPH_MAX_DISTANCE) * 0.12;
  return proposal.cue.priority + subjectBoost + distanceBoost;
}

function createGlyphTexture(glyph: ReactionGlyph): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 192;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable for reaction glyphs');

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.28)';
  context.shadowBlur = 10;
  context.shadowOffsetY = 5;
  roundedRect(context, 26, 18, 204, 128, 34);
  context.fillStyle = 'rgba(249, 246, 237, 0.94)';
  context.fill();
  context.restore();

  context.lineWidth = 5;
  context.strokeStyle = 'rgba(44, 45, 52, 0.7)';
  roundedRect(context, 26, 18, 204, 128, 34);
  context.stroke();

  context.beginPath();
  context.arc(107, 158, 10, 0, Math.PI * 2);
  context.arc(92, 174, 5, 0, Math.PI * 2);
  context.fillStyle = 'rgba(249, 246, 237, 0.94)';
  context.fill();
  context.lineWidth = 3;
  context.strokeStyle = 'rgba(44, 45, 52, 0.56)';
  context.stroke();

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '88px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  context.fillText(glyph, 128, 84);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function stableUnit(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}
