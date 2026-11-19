import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT, clampTarget, createLayout, type OfficeLayout, type Placement, type Rect, type RoomId, type Vec3 } from './office3d-layout.ts'

const ROOM_IDS: RoomId[] = ['kerja', 'rapat', 'lounge', 'game', 'tidur', 'misi', 'server']
const IDLE_KEYS = ['lounge', 'galon', 'dapur', 'game', 'arcade', 'tidur', 'bakso', 'kopi', 'jalan']
const SIZES = [0, 1, 3, 6, 12, 30]
const EPS = 1e-6

const strictlyInside = (x: number, z: number, rect: Rect) => x > rect.minX + EPS && x < rect.maxX - EPS && z > rect.minZ + EPS && z < rect.maxZ - EPS
const within = (x: number, z: number, rect: Rect) => x >= rect.minX - EPS && x <= rect.maxX + EPS && z >= rect.minZ - EPS && z <= rect.maxZ + EPS
const key = ([x, , z]: Vec3) => `${x.toFixed(3)},${z.toFixed(3)}`
const room = (layout: OfficeLayout, id: RoomId) => layout.rooms.find((item) => item.id === id)!
const obstaclesAt = (layout: OfficeLayout, [x, , z]: Vec3) => layout.obstacles.filter((rect) => strictlyInside(x, z, rect)).length

/** Distance from a point to an axis-aligned segment. */
function distanceToSegment([px, pz]: [number, number], [ax, az]: [number, number], [bx, bz]: [number, number]): number {
  const cx = Math.min(Math.max(px, Math.min(ax, bx)), Math.max(ax, bx))
  const cz = Math.min(Math.max(pz, Math.min(az, bz)), Math.max(az, bz))
  return Math.hypot(px - cx, pz - cz)
}

/** Placements that must stand clear of furniture: seated or lying ones may overlap their own piece only. */
function expectClear(layout: OfficeLayout, placement: Placement, what: string) {
  const hits = obstaclesAt(layout, placement.position)
  if (placement.seated || placement.pose) expect(hits, `${what} ${key(placement.position)}`).toBeLessThanOrEqual(1)
  else expect(hits, `${what} ${key(placement.position)}`).toBe(0)
}

describe.each(SIZES)('createLayout(%i)', (n) => {
  const layout = createLayout(n)
  const agents = Math.max(1, n)

  it('has one desk and one bed per agent, none sharing a position', () => {
    expect(layout.agentCount).toBe(agents)
    expect(layout.desks).toHaveLength(agents)
    expect(layout.beds).toHaveLength(agents)
    expect(new Set(layout.desks.map(key)).size).toBe(agents)
    expect(new Set(layout.beds.map(key)).size).toBe(agents)
    for (const desk of layout.desks) expect(within(desk[0], desk[2], room(layout, 'kerja'))).toBe(true)
    for (const bed of layout.beds) expect(within(bed[0], bed[2], room(layout, 'tidur'))).toBe(true)
  })

  it('has exactly the seven rooms, inside the building and not overlapping', () => {
    expect(layout.rooms.map((item) => item.id).sort()).toEqual([...ROOM_IDS].sort())
    for (const item of layout.rooms) {
      expect(item.maxX).toBeGreaterThan(item.minX)
      expect(item.maxZ).toBeGreaterThan(item.minZ)
      expect(item.label.length).toBeGreaterThan(0)
      expect(item.tone.length).toBeGreaterThan(0)
      expect(within(item.minX, item.minZ, layout.building) && within(item.maxX, item.maxZ, layout.building)).toBe(true)
    }
    for (const [index, a] of layout.rooms.entries()) {
      for (const b of layout.rooms.slice(index + 1)) {
        const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)
        const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ)
        expect(overlapX <= EPS || overlapZ <= EPS, `${a.id} overlaps ${b.id}`).toBe(true)
      }
    }
  })

  it('gives every room a door, the workspace one to the outside, and every room is reachable from outside', () => {
    for (const id of ROOM_IDS) expect(layout.doors.some((door) => door.between.includes(id)), id).toBe(true)
    expect(layout.doors.some((door) => door.between.includes('kerja') && door.between.includes('outside'))).toBe(true)
    const reached = new Set<string>(['outside'])
    for (let changed = true; changed;) {
      changed = false
      for (const { between: [a, b] } of layout.doors) {
        if (reached.has(a) !== reached.has(b)) { reached.add(a); reached.add(b); changed = true }
      }
    }
    for (const id of ROOM_IDS) expect(reached.has(id), id).toBe(true)
  })

  it('cuts every door, 2 tiles wide, on the shared edge of the rooms it joins, with no wall across it', () => {
    for (const door of layout.doors) {
      const [[ax, az], [bx, bz]] = [door.from, door.to]
      expect(ax === bx || az === bz).toBe(true)
      expect(Math.hypot(bx - ax, bz - az)).toBeCloseTo(2)
      // The door lies on the outline of each room (or of the building, for the outside).
      for (const side of door.between) {
        const rect = side === 'outside' ? layout.building : room(layout, side)
        const onEdge = ([x, z]: [number, number]) => within(x, z, rect) && (Math.abs(x - rect.minX) < EPS || Math.abs(x - rect.maxX) < EPS || Math.abs(z - rect.minZ) < EPS || Math.abs(z - rect.maxZ) < EPS)
        expect(onEdge(door.from) && onEdge(door.to), `door ${door.between.join('-')} on ${side}`).toBe(true)
      }
      // Sample the opening (ends excluded): no wall comes near it.
      for (let t = 0.05; t <= 0.95; t += 0.05) {
        const point: [number, number] = [ax + (bx - ax) * t, az + (bz - az) * t]
        for (const wall of layout.walls) expect(distanceToSegment(point, wall.from, wall.to), `wall over door ${door.between.join('-')}`).toBeGreaterThan(0.05)
      }
    }
    for (const wall of layout.walls) expect(wall.from[0] === wall.to[0] || wall.from[1] === wall.to[1]).toBe(true)
  })

  it('keeps idle spots, meeting and lounge seats and the entrance clear of furniture', () => {
    for (const stop of layout.idleStops) for (const spot of stop.spots) expectClear(layout, spot, stop.key)
    for (const seat of layout.meeting.seats) expectClear(layout, seat, 'meeting')
    for (const seat of layout.lounge.seats) expectClear(layout, seat, 'lounge')
    expect(obstaclesAt(layout, layout.outdoors.entrance)).toBe(0)
  })

  it('has every idle stop the route needs, each with enough spots, and a lying spot per bed', () => {
    expect(layout.idleStops.map((stop) => stop.key).sort()).toEqual([...IDLE_KEYS].sort())
    for (const stop of layout.idleStops) {
      expect(stop.label.length).toBeGreaterThan(0)
      // tidur has exactly one spot per bed (checked below), so it may have fewer than three.
      if (stop.key !== 'tidur') expect(stop.spots.length, stop.key).toBeGreaterThanOrEqual(3)
      for (const spot of stop.spots) expect(within(spot.position[0], spot.position[2], layout.pan), `${stop.key} in pan`).toBe(true)
    }
    const tidur = layout.idleStops.find((stop) => stop.key === 'tidur')!
    expect(tidur.spots).toHaveLength(agents)
    for (const spot of tidur.spots) expect(spot).toMatchObject({ pose: 'lie', height: 0.5 })
    expect(new Set(tidur.spots.map((spot) => key(spot.position))).size).toBe(agents)
  })

  it('seats at least six in the meeting room, all inside it, none sharing a place', () => {
    const rapat = room(layout, 'rapat')
    expect(layout.meeting.seats.length).toBeGreaterThanOrEqual(6)
    expect(layout.meeting.seats.filter((seat) => seat.seated).length).toBeGreaterThanOrEqual(6)
    for (const seat of layout.meeting.seats) expect(strictlyInside(seat.position[0], seat.position[2], rapat)).toBe(true)
    expect(new Set(layout.meeting.seats.map((seat) => key(seat.position))).size).toBe(layout.meeting.seats.length)
    for (const seat of layout.lounge.seats) expect(strictlyInside(seat.position[0], seat.position[2], room(layout, 'lounge'))).toBe(true)
  })

  it('puts the entrance in front of the building and the street food outside it', () => {
    const { outdoors, building } = layout
    const [ex, , ez] = outdoors.entrance
    expect(ez).toBeGreaterThan(building.maxZ)
    expect(within(ex, ez, outdoors.yard) || within(ex, ez, outdoors.sidewalk)).toBe(true)
    for (const [x, , z] of [outdoors.baksoCart, outdoors.kopiBike]) expect(within(x, z, building)).toBe(false)
    expect(outdoors.sidewalk.minZ).toBeGreaterThanOrEqual(outdoors.yard.maxZ - EPS)
    expect(outdoors.road.minZ).toBeGreaterThanOrEqual(outdoors.sidewalk.maxZ - EPS)
    expect(outdoors.streetLamps.length).toBeGreaterThan(0)
    for (const [x, , z] of [outdoors.entrance, outdoors.baksoCart, outdoors.kopiBike, outdoors.flag]) expect(within(x, z, layout.pan)).toBe(true)
  })
})

describe('office grid', () => {
  it('widens the workspace only when the desks need more columns', () => {
    const width = (layout: OfficeLayout) => layout.building.maxX - layout.building.minX
    expect(createLayout(6).building.minX).toBe(createLayout(3).building.minX)
    expect(width(createLayout(6))).toBe(width(createLayout(3)))
    expect(width(createLayout(12))).toBeGreaterThan(width(createLayout(6)))
  })

  it('treats fewer than one agent as one', () => {
    expect(createLayout(0)).toEqual(createLayout(1))
    expect(createLayout(-4)).toEqual(createLayout(1))
  })

  it('keeps the panned view inside the grounds', () => {
    const { pan } = DEFAULT_LAYOUT
    expect(clampTarget(1e6, -1e6, pan)).toEqual([pan.maxX, pan.minZ])
    expect(clampTarget(-1e6, 1e6, pan)).toEqual([pan.minX, pan.maxZ])
    const inside: [number, number] = [(pan.minX + pan.maxX) / 2, (pan.minZ + pan.maxZ) / 2]
    expect(clampTarget(...inside, pan)).toEqual(inside)
  })

  it('is the three-agent office by default', () => {
    expect(DEFAULT_LAYOUT).toEqual(createLayout(3))
  })
})

describe('createLayout limits', () => {
  it('clamps absurd crew sizes instead of throwing', () => {
    expect(() => createLayout(Infinity)).not.toThrow()
    expect(createLayout(Infinity).agentCount).toBe(200)
    expect(createLayout(NaN).agentCount).toBe(1)
  })
})
