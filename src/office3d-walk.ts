// Grid pathfinding for agents walking around the office. A* on a 0.5-tile grid over `layout.pan`,
// with furniture and walls blocked, then string-pulled by line of sight. Pure and deterministic.
import { DEFAULT_LAYOUT, type OfficeLayout, type Vec3 } from './office3d-layout'

const CELL = 0.5
const WALL_HALF = 0.1
const SAMPLE = 0.1

interface Grid { minX: number; minZ: number; cols: number; rows: number; blocked: Uint8Array }

const grids = new WeakMap<OfficeLayout, Grid>()

function buildGrid(layout: OfficeLayout): Grid {
  const { pan } = layout
  const cols = Math.ceil((pan.maxX - pan.minX) / CELL)
  const rows = Math.ceil((pan.maxZ - pan.minZ) / CELL)
  const blocked = new Uint8Array(cols * rows)
  const mark = (x0: number, x1: number, z0: number, z1: number) => {
    // Cells whose open square overlaps the rect.
    const c0 = Math.max(0, Math.floor((x0 - pan.minX) / CELL))
    const c1 = Math.min(cols - 1, Math.ceil((x1 - pan.minX) / CELL) - 1)
    const r0 = Math.max(0, Math.floor((z0 - pan.minZ) / CELL))
    const r1 = Math.min(rows - 1, Math.ceil((z1 - pan.minZ) / CELL) - 1)
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) blocked[r * cols + c] = 1
  }
  for (const o of layout.obstacles) mark(o.minX, o.maxX, o.minZ, o.maxZ)
  for (const w of layout.walls) {
    mark(Math.min(w.from[0], w.to[0]) - WALL_HALF, Math.max(w.from[0], w.to[0]) + WALL_HALF,
      Math.min(w.from[1], w.to[1]) - WALL_HALF, Math.max(w.from[1], w.to[1]) + WALL_HALF)
  }
  return { minX: pan.minX, minZ: pan.minZ, cols, rows, blocked }
}

function gridFor(layout: OfficeLayout): Grid {
  let g = grids.get(layout)
  if (!g) { g = buildGrid(layout); grids.set(layout, g) }
  return g
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const cellOf = (g: Grid, x: number, z: number): [number, number] => [
  clamp(Math.floor((x - g.minX) / CELL), 0, g.cols - 1),
  clamp(Math.floor((z - g.minZ) / CELL), 0, g.rows - 1),
]
const center = (g: Grid, c: number, r: number): [number, number] => [g.minX + (c + 0.5) * CELL, g.minZ + (r + 0.5) * CELL]
const isFree = (g: Grid, c: number, r: number) => c >= 0 && r >= 0 && c < g.cols && r < g.rows && g.blocked[r * g.cols + c] === 0

/** Nearest free cell to a point (by distance to the cell centre), searching outwards in rings. */
function snap(g: Grid, x: number, z: number): [number, number] {
  const [c0, r0] = cellOf(g, x, z)
  if (isFree(g, c0, r0)) return [c0, r0]
  const maxRing = Math.max(g.cols, g.rows)
  let best: [number, number] | null = null
  let bestD = Infinity
  for (let ring = 1; ring <= maxRing; ring++) {
    // Anything in a farther ring is at least (ring - 1) cells away.
    if (best && (ring - 1) * CELL > Math.sqrt(bestD)) break
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue
        const c = c0 + dc, r = r0 + dr
        if (!isFree(g, c, r)) continue
        const [cx, cz] = center(g, c, r)
        const d = (cx - x) ** 2 + (cz - z) ** 2
        if (d < bestD) { bestD = d; best = [c, r] }
      }
    }
  }
  return best ?? [c0, r0]
}

/** True when the straight segment only touches free cells. */
function lineFree(g: Grid, ax: number, az: number, bx: number, bz: number): boolean {
  const len = Math.hypot(bx - ax, bz - az)
  const steps = Math.max(1, Math.ceil(len / SAMPLE))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const [c, r] = cellOf(g, ax + (bx - ax) * t, az + (bz - az) * t)
    if (!isFree(g, c, r)) return false
  }
  return true
}

const SQRT2 = Math.SQRT2
const NEIGHBOURS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
]

/** A* over free cells, 8-connected without cutting corners. Returns cell indices start..goal. */
function search(g: Grid, start: number, goal: number): number[] | null {
  const n = g.cols * g.rows
  const gCost = new Float64Array(n).fill(Infinity)
  const parent = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const gc = goal % g.cols, gr = (goal - gc) / g.cols
  const h = (i: number) => {
    const c = i % g.cols, r = (i - c) / g.cols
    const dx = Math.abs(c - gc), dz = Math.abs(r - gr)
    return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz)
  }
  // Binary min-heap on f, ties broken by insertion order for determinism.
  const heap: [number, number, number][] = []
  let seq = 0
  const less = (a: [number, number, number], b: [number, number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])
  const push = (item: [number, number, number]) => {
    let i = heap.push(item) - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!less(heap[i], heap[p])) break
      ;[heap[i], heap[p]] = [heap[p], heap[i]]
      i = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < heap.length && less(heap[l], heap[m])) m = l
        if (r < heap.length && less(heap[r], heap[m])) m = r
        if (m === i) break
        ;[heap[i], heap[m]] = [heap[m], heap[i]]
        i = m
      }
    }
    return top
  }
  gCost[start] = 0
  push([h(start), seq++, start])
  while (heap.length) {
    const [, , cur] = pop()
    if (closed[cur]) continue
    if (cur === goal) {
      const out: number[] = []
      for (let i = goal; i !== -1; i = parent[i]) out.push(i)
      return out.reverse()
    }
    closed[cur] = 1
    const c = cur % g.cols, r = (cur - c) / g.cols
    for (const [dc, dr, cost] of NEIGHBOURS) {
      const nc = c + dc, nr = r + dr
      if (!isFree(g, nc, nr)) continue
      if (dc !== 0 && dr !== 0 && (!isFree(g, c + dc, r) || !isFree(g, c, r + dr))) continue
      const ni = nr * g.cols + nc
      if (closed[ni]) continue
      const ng = gCost[cur] + cost
      if (ng < gCost[ni]) {
        gCost[ni] = ng
        parent[ni] = cur
        push([ng + h(ni), seq++, ni])
      }
    }
  }
  return null
}

/**
 * Waypoints from `from` (excluded) to `to` (included, exact, last). Segments avoid obstacles and
 * walls (door gaps are passable). If `from` or `to` sits inside a blocked cell (a seat, a bed, a
 * wall footprint) the path starts or ends with one unavoidable segment into/out of it.
 */
export function walkPath(from: Vec3, to: Vec3, layout: OfficeLayout = DEFAULT_LAYOUT): Vec3[] {
  const dest: Vec3 = [to[0], to[1], to[2]]
  if (from[0] === to[0] && from[2] === to[2]) return [dest]
  const g = gridFor(layout)
  if (lineFree(g, from[0], from[2], to[0], to[2])) return [dest]
  const [sc, sr] = snap(g, from[0], from[2])
  const [gc, gr] = snap(g, to[0], to[2])
  const cells = search(g, sr * g.cols + sc, gr * g.cols + gc)
  if (!cells) return [dest]
  const pts: [number, number][] = [[from[0], from[2]]]
  for (const i of cells) { const c = i % g.cols; pts.push(center(g, c, (i - c) / g.cols)) }
  pts.push([to[0], to[2]])
  // String pulling: from each point jump to the farthest one in line of sight.
  const out: Vec3[] = []
  let i = 0
  while (i < pts.length - 1) {
    let j = pts.length - 1
    while (j > i + 1 && !lineFree(g, pts[i][0], pts[i][1], pts[j][0], pts[j][1])) j--
    if (j === pts.length - 1) break
    out.push([pts[j][0], from[1], pts[j][1]])
    i = j
  }
  out.push(dest)
  return out
}
