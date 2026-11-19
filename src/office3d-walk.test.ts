import { describe, expect, it } from 'vitest'
import { createLayout, DEFAULT_LAYOUT, type OfficeLayout, type Rect, type Vec3 } from './office3d-layout'
import { walkPath } from './office3d-walk'

type P2 = [number, number]
const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
function segsCross(a: P2, b: P2, c: P2, d: P2) {
  const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b)
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))
}
function crossesWall(a: Vec3, b: Vec3, layout: OfficeLayout) {
  return layout.walls.some((w) => segsCross([a[0], a[2]], [b[0], b[2]], w.from, w.to))
}
function inRect(x: number, z: number, r: Rect, e = 0) {
  return x > r.minX + e && x < r.maxX - e && z > r.minZ + e && z < r.maxZ - e
}
function inObstacle(p: Vec3, layout: OfficeLayout) {
  return layout.obstacles.some((r) => inRect(p[0], p[2], r, 0.01))
}
/** Segment passes through the interior of an obstacle (sampled). */
function segHitsObstacle(a: Vec3, b: Vec3, layout: OfficeLayout) {
  const len = Math.hypot(b[0] - a[0], b[2] - a[2])
  const steps = Math.max(1, Math.ceil(len / 0.05))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    if (inObstacle([a[0] + (b[0] - a[0]) * t, 0, a[2] + (b[2] - a[2]) * t], layout)) return true
  }
  return false
}
function expectClean(from: Vec3, path: Vec3[], layout: OfficeLayout) {
  const pts = [from, ...path]
  for (let i = 0; i < pts.length - 1; i++) {
    expect(crossesWall(pts[i], pts[i + 1], layout)).toBe(false)
    const skipObstacle = (i === 0 && inObstacle(from, layout)) || (i === pts.length - 2 && inObstacle(pts[i + 1], layout))
    if (!skipObstacle) expect(segHitsObstacle(pts[i], pts[i + 1], layout)).toBe(false)
  }
}

describe.each([3, 12])('walkPath on createLayout(%i)', (n) => {
  const layout = createLayout(n)
  it('reaches every idle spot from the entrance without crossing walls or obstacles', () => {
    for (const stop of layout.idleStops) {
      for (const s of stop.spots) {
        const path = walkPath(layout.outdoors.entrance, s.position, layout)
        expect(path[path.length - 1]).toEqual(s.position)
        expectClean(layout.outdoors.entrance, path, layout)
      }
    }
  })
  it('walks desk to lounge and back through a door', () => {
    const lounge = layout.idleStops.find((s) => s.key === 'lounge')!.spots[0].position
    // A waypoint need not sit near the door (string pulling goes straight through the gap), so
    // the proof is that the walked polyline crosses a door's span or has a waypoint within 0.6 of it.
    const usesDoor = (from: Vec3, path: Vec3[]) => {
      const pts = [from, ...path]
      return layout.doors.some((d) => {
        const [x0, x1] = [Math.min(d.from[0], d.to[0]) - 0.6, Math.max(d.from[0], d.to[0]) + 0.6]
        const [z0, z1] = [Math.min(d.from[1], d.to[1]) - 0.6, Math.max(d.from[1], d.to[1]) + 0.6]
        return path.some((p) => p[0] >= x0 && p[0] <= x1 && p[2] >= z0 && p[2] <= z1)
          || pts.slice(1).some((p, i) => segsCross([pts[i][0], pts[i][2]], [p[0], p[2]], d.from, d.to))
      })
    }
    for (const desk of layout.desks) {
      const there = walkPath(desk, lounge, layout)
      const back = walkPath(lounge, desk, layout)
      expect(there[there.length - 1]).toEqual(lounge)
      expect(back[back.length - 1]).toEqual(desk)
      expect(usesDoor(desk, there)).toBe(true)
      expect(usesDoor(lounge, back)).toBe(true)
      expectClean(desk, there, layout)
      expectClean(lounge, back, layout)
    }
  })
})

describe('walkPath edge cases', () => {
  it('returns [to] when from equals to', () => {
    const p: Vec3 = [3, 0, 4]
    expect(walkPath(p, p)).toEqual([p])
  })
  it('still ends exactly at to when from is inside an obstacle', () => {
    const o = DEFAULT_LAYOUT.obstacles[0]
    const from: Vec3 = [(o.minX + o.maxX) / 2, 0, (o.minZ + o.maxZ) / 2]
    const to = DEFAULT_LAYOUT.outdoors.entrance
    const path = walkPath(from, to)
    expect(path[path.length - 1]).toEqual(to)
  })
  it('still ends exactly at to when from is inside a wall footprint', () => {
    const w = DEFAULT_LAYOUT.walls[0]
    const from: Vec3 = [(w.from[0] + w.to[0]) / 2, 0, (w.from[1] + w.to[1]) / 2]
    const to = DEFAULT_LAYOUT.outdoors.entrance
    const path = walkPath(from, to)
    expect(path[path.length - 1]).toEqual(to)
    expect(path.length).toBeGreaterThan(0)
  })
  it('does not mutate or alias the destination', () => {
    const to: Vec3 = [5, 0, 5]
    const path = walkPath([6, 0, 6], to)
    expect(path[path.length - 1]).toEqual(to)
  })
})

describe('walkPath performance', () => {
  it('computes 30 paths on createLayout(30) in under 500 ms', () => {
    const layout = createLayout(30)
    const spots = layout.idleStops.flatMap((s) => s.spots.map((p) => p.position))
    let seed = 7
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
    const pairs: [Vec3, Vec3][] = []
    while (pairs.length < 30) {
      const a = spots[Math.floor(rnd() * spots.length)]
      const b = spots[Math.floor(rnd() * spots.length)]
      if (a !== b && (a[0] !== b[0] || a[2] !== b[2])) pairs.push([a, b])
    }
    const t0 = performance.now()
    for (const [a, b] of pairs) walkPath(a, b, layout)
    const ms = performance.now() - t0
    console.log(`30 paths: ${ms.toFixed(1)} ms`)
    expect(ms).toBeLessThan(500)
  })
})
