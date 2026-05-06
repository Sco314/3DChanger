import * as THREE from 'three';

import { applyWeldedDelta, falloff, type SculptCache } from './SculptContext.js';
import type { BrushHit, BrushKind, BrushParams } from './types.js';

/**
 * Brush implementations ported in spirit from SculptGL's
 * `src/editing/tools/*` files. Behavior similar to the originals but
 * rewritten to operate directly on three.js BufferAttribute positions in
 * mesh-local space, with welded-vertex propagation so non-indexed meshes
 * don't crack.
 *
 * All brushes write only to position (and Mask writes only to the per-
 * welded-vertex mask buffer). UVs, colors, materials, and groups are not
 * touched.
 */

export interface SculptStrokeContext {
  mesh: THREE.Mesh;
  positionAttr: THREE.BufferAttribute;
  cache: SculptCache;
  params: BrushParams;
}

export abstract class BrushBase {
  /** Called once on pointerdown. Default: nothing. Grab caches state here. */
  beginStroke(_ctx: SculptStrokeContext, _hit: BrushHit): void {}
  /** Called once on pointerup. Default: nothing. */
  endStroke(_ctx: SculptStrokeContext): void {}
  /** Called every pointermove during a stroke. Mutates position / mask. */
  abstract applyStep(ctx: SculptStrokeContext, hit: BrushHit, prevHit: BrushHit | null): void;
}

// ---- Inflate: push along vertex (or hit) normal -------------------------

export class InflateBrush extends BrushBase {
  applyStep(ctx: SculptStrokeContext, hit: BrushHit): void {
    const { cache, params, positionAttr } = ctx;
    const r = params.radius;
    const r2 = r * r;
    const step = params.strength * r * 0.05; // scale by radius for unit-size feel
    const cx = hit.positionLocal.x, cy = hit.positionLocal.y, cz = hit.positionLocal.z;
    const fnx = hit.normalLocal.x, fny = hit.normalLocal.y, fnz = hit.normalLocal.z;
    for (let w = 0; w < cache.weldedCount; w++) {
      const dx0 = cache.weldedPos[w * 3]! - cx;
      const dy0 = cache.weldedPos[w * 3 + 1]! - cy;
      const dz0 = cache.weldedPos[w * 3 + 2]! - cz;
      const d2 = dx0 * dx0 + dy0 * dy0 + dz0 * dz0;
      if (d2 > r2) continue;
      const f = falloff(Math.sqrt(d2), r);
      if (f <= 0) continue;
      const m = 1 - cache.mask[w]!;
      const k = step * f * m;
      applyWeldedDelta(cache, positionAttr, w, fnx * k, fny * k, fnz * k);
    }
    positionAttr.needsUpdate = true;
  }
}

// ---- Smooth: Laplacian toward neighbor centroid -------------------------

export class SmoothBrush extends BrushBase {
  applyStep(ctx: SculptStrokeContext, hit: BrushHit): void {
    const { cache, params, positionAttr } = ctx;
    const r = params.radius;
    const r2 = r * r;
    // Smoothing factor — capped so we don't introduce instability.
    const k = Math.min(0.95, params.strength);

    const cx = hit.positionLocal.x, cy = hit.positionLocal.y, cz = hit.positionLocal.z;

    // Two-pass: read all targets first so a vertex isn't affected by its
    // already-moved neighbors within the same step.
    const targets: Array<{ w: number; tx: number; ty: number; tz: number; weight: number }> = [];
    for (let w = 0; w < cache.weldedCount; w++) {
      const px = cache.weldedPos[w * 3]!, py = cache.weldedPos[w * 3 + 1]!, pz = cache.weldedPos[w * 3 + 2]!;
      const dx0 = px - cx, dy0 = py - cy, dz0 = pz - cz;
      const d2 = dx0 * dx0 + dy0 * dy0 + dz0 * dz0;
      if (d2 > r2) continue;
      const neighbors = cache.weldedNeighbors[w];
      if (!neighbors || neighbors.length === 0) continue;
      let ax = 0, ay = 0, az = 0;
      for (const n of neighbors) {
        ax += cache.weldedPos[n * 3]!;
        ay += cache.weldedPos[n * 3 + 1]!;
        az += cache.weldedPos[n * 3 + 2]!;
      }
      const inv = 1 / neighbors.length;
      const f = falloff(Math.sqrt(d2), r);
      if (f <= 0) continue;
      const m = 1 - cache.mask[w]!;
      targets.push({
        w,
        tx: ax * inv - px,
        ty: ay * inv - py,
        tz: az * inv - pz,
        weight: f * m * k,
      });
    }

    for (const t of targets) {
      applyWeldedDelta(cache, positionAttr, t.w, t.tx * t.weight, t.ty * t.weight, t.tz * t.weight);
    }
    positionAttr.needsUpdate = true;
  }
}

// ---- Flatten: project onto a fit plane ---------------------------------

export class FlattenBrush extends BrushBase {
  applyStep(ctx: SculptStrokeContext, hit: BrushHit): void {
    const { cache, params, positionAttr } = ctx;
    const r = params.radius;
    const r2 = r * r;
    const k = params.strength;

    // Gather affected verts and a falloff-weighted centroid.
    const cx = hit.positionLocal.x, cy = hit.positionLocal.y, cz = hit.positionLocal.z;
    const affected: Array<{ w: number; px: number; py: number; pz: number; f: number; m: number }> = [];
    let sx = 0, sy = 0, sz = 0, sw = 0;
    for (let w = 0; w < cache.weldedCount; w++) {
      const px = cache.weldedPos[w * 3]!, py = cache.weldedPos[w * 3 + 1]!, pz = cache.weldedPos[w * 3 + 2]!;
      const dx0 = px - cx, dy0 = py - cy, dz0 = pz - cz;
      const d2 = dx0 * dx0 + dy0 * dy0 + dz0 * dz0;
      if (d2 > r2) continue;
      const f = falloff(Math.sqrt(d2), r);
      if (f <= 0) continue;
      const m = 1 - cache.mask[w]!;
      affected.push({ w, px, py, pz, f, m });
      sx += px * f;
      sy += py * f;
      sz += pz * f;
      sw += f;
    }
    if (sw <= 0 || affected.length === 0) return;
    const ccx = sx / sw, ccy = sy / sw, ccz = sz / sw;

    // Plane normal: take the surface normal at the hit point as a stable
    // approximation. Computing a true least-squares normal from the
    // affected set is more correct but more expensive; the brush is
    // applied repeatedly so this converges to a flat region either way.
    const nx = hit.normalLocal.x, ny = hit.normalLocal.y, nz = hit.normalLocal.z;

    for (const a of affected) {
      // Signed distance from a's position to the plane:
      const sd = (a.px - ccx) * nx + (a.py - ccy) * ny + (a.pz - ccz) * nz;
      const w = a.f * a.m * k;
      const dx = -nx * sd * w;
      const dy = -ny * sd * w;
      const dz = -nz * sd * w;
      applyWeldedDelta(cache, positionAttr, a.w, dx, dy, dz);
    }
    positionAttr.needsUpdate = true;
  }
}

// ---- Pinch: pull toward stroke center ----------------------------------

export class PinchBrush extends BrushBase {
  applyStep(ctx: SculptStrokeContext, hit: BrushHit): void {
    const { cache, params, positionAttr } = ctx;
    const r = params.radius;
    const r2 = r * r;
    const cx = hit.positionLocal.x, cy = hit.positionLocal.y, cz = hit.positionLocal.z;
    const k = params.strength * 0.5;
    for (let w = 0; w < cache.weldedCount; w++) {
      const px = cache.weldedPos[w * 3]!, py = cache.weldedPos[w * 3 + 1]!, pz = cache.weldedPos[w * 3 + 2]!;
      const dx0 = cx - px, dy0 = cy - py, dz0 = cz - pz;
      const d2 = dx0 * dx0 + dy0 * dy0 + dz0 * dz0;
      if (d2 > r2 || d2 === 0) continue;
      const dist = Math.sqrt(d2);
      const f = falloff(dist, r);
      if (f <= 0) continue;
      const m = 1 - cache.mask[w]!;
      const wgt = k * f * m;
      applyWeldedDelta(cache, positionAttr, w, dx0 * wgt, dy0 * wgt, dz0 * wgt);
    }
    positionAttr.needsUpdate = true;
  }
}

// ---- Grab: drag the affected vertex set with the cursor ----------------

interface GrabState {
  /** Welded ids captured at stroke start (don't change during the drag). */
  affected: Array<{ w: number; weight: number }>;
  startLocal: THREE.Vector3;
}

export class GrabBrush extends BrushBase {
  private state: GrabState | null = null;

  beginStroke(ctx: SculptStrokeContext, hit: BrushHit): void {
    const { cache, params } = ctx;
    const r = params.radius;
    const r2 = r * r;
    const cx = hit.positionLocal.x, cy = hit.positionLocal.y, cz = hit.positionLocal.z;
    const affected: Array<{ w: number; weight: number }> = [];
    for (let w = 0; w < cache.weldedCount; w++) {
      const dx = cache.weldedPos[w * 3]! - cx;
      const dy = cache.weldedPos[w * 3 + 1]! - cy;
      const dz = cache.weldedPos[w * 3 + 2]! - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const f = falloff(Math.sqrt(d2), r);
      if (f <= 0) continue;
      const m = 1 - cache.mask[w]!;
      affected.push({ w, weight: f * m });
    }
    this.state = { affected, startLocal: hit.positionLocal.clone() };
  }

  endStroke(): void {
    this.state = null;
  }

  applyStep(ctx: SculptStrokeContext, hit: BrushHit, prevHit: BrushHit | null): void {
    if (!this.state) return;
    const prev = prevHit ?? hit;
    const dx = (hit.positionLocal.x - prev.positionLocal.x) * ctx.params.strength;
    const dy = (hit.positionLocal.y - prev.positionLocal.y) * ctx.params.strength;
    const dz = (hit.positionLocal.z - prev.positionLocal.z) * ctx.params.strength;
    if (dx === 0 && dy === 0 && dz === 0) return;
    for (const a of this.state.affected) {
      applyWeldedDelta(ctx.cache, ctx.positionAttr, a.w, dx * a.weight, dy * a.weight, dz * a.weight);
    }
    ctx.positionAttr.needsUpdate = true;
  }
}

// ---- Mask: paint per-vertex protection ---------------------------------

export class MaskBrush extends BrushBase {
  /** When true, the brush erases mask instead of adding. */
  invert = false;

  applyStep(ctx: SculptStrokeContext, hit: BrushHit): void {
    const { cache, params } = ctx;
    const r = params.radius;
    const r2 = r * r;
    const cx = hit.positionLocal.x, cy = hit.positionLocal.y, cz = hit.positionLocal.z;
    const sign = this.invert ? -1 : 1;
    const k = params.strength * sign;
    for (let w = 0; w < cache.weldedCount; w++) {
      const dx = cache.weldedPos[w * 3]! - cx;
      const dy = cache.weldedPos[w * 3 + 1]! - cy;
      const dz = cache.weldedPos[w * 3 + 2]! - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const f = falloff(Math.sqrt(d2), r);
      if (f <= 0) continue;
      const cur = cache.mask[w]!;
      cache.mask[w] = Math.max(0, Math.min(1, cur + k * f * 0.1));
    }
  }
}

export function makeBrush(kind: BrushKind): BrushBase {
  switch (kind) {
    case 'inflate': return new InflateBrush();
    case 'smooth':  return new SmoothBrush();
    case 'flatten': return new FlattenBrush();
    case 'pinch':   return new PinchBrush();
    case 'grab':    return new GrabBrush();
    case 'mask':    return new MaskBrush();
  }
}
