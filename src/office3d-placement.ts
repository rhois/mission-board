import { DEFAULT_LAYOUT, type IdleStop, type OfficeLayout, type Placement, type RoomId, type Vec3 } from './office3d-layout'
import type { OfficeStation } from './types.ts'

/** The n-th place in the meeting room (0-based): the whiteboard, then the chairs, then standing room. */
export function meetingSeat(index: number, layout: OfficeLayout = DEFAULT_LAYOUT): Placement {
  const { seats } = layout.meeting
  return seats[index % seats.length]
}

/** A usable 1-based seat number: whole, and at least 1 (NaN and fractions must not index arrays). */
const wholeSeat = (seat: number) => Math.max(Number.isFinite(seat) ? Math.trunc(seat) : 1, 1)

/** The rooms that have someone in them: a position on a shared edge counts for either room. */
export function occupiedRoomsFor(positions: Vec3[], layout: OfficeLayout = DEFAULT_LAYOUT): RoomId[] {
  return layout.rooms
    .filter((room) => positions.some(([x, , z]) => x >= room.minX && x <= room.maxX && z >= room.minZ && z <= room.maxZ))
    .map((room) => room.id)
}

/**
 * Where a station stands: a desk (seat n uses desk n; out-of-range seats wrap), a place at the
 * meeting table (`meetingIndex` counts the agents already there), or a lounge seat.
 */
export function placementFor(station: OfficeStation, layout: OfficeLayout = DEFAULT_LAYOUT, meetingIndex = 0): Placement {
  const seat = wholeSeat(station.seat) - 1
  if (station.room === 'Lounge') {
    const seats = layout.lounge.seats
    const spot = seats[seat % seats.length]
    return { ...spot, seated: true }
  }
  if (station.roomPosition === 'meeting-area') return meetingSeat(meetingIndex, layout)
  const [x, y, z] = layout.desks[seat % layout.desks.length]
  return { position: [x, y, z - 0.75], facing: 0, seated: station.state === 'Working' || station.state === 'Reviewing' }
}

/** How long an idle agent stays at one stop (walking included). */
export const IDLE_STOP_MS = 32_000
export const IDLE_ROUTE = ['lounge', 'galon', 'game', 'bakso', 'tidur', 'jalan', 'arcade', 'kopi', 'dapur', 'game', 'tidur']

export interface IdleAssignment { stop: IdleStop; placement: Placement }

/**
 * Where each idle agent is at a given time. Purely decorative and deterministic (only the clock
 * and the seats matter, never agent data): each seat starts at a different point of the route, and
 * an agent whose stop is already full moves on along the route, so nobody shares a spot while
 * free ones remain.
 */
export function idlePlan(seats: number[], time: number, layout: OfficeLayout = DEFAULT_LAYOUT, sleepers: number[] = []): Map<number, IdleAssignment> {
  const plan = new Map<number, IdleAssignment>()
  const taken = new Map<string, number>()
  const step = Math.floor(time / IDLE_STOP_MS)
  const stopAt = (index: number) => layout.idleStops.find((item) => item.key === IDLE_ROUTE[index % IDLE_ROUTE.length])!
  // Sleepers (when the viewer sends idle agents to bed) stay in bed; they take the first beds.
  const beds = layout.idleStops.find((item) => item.key === 'tidur')!
  for (const seat of [...sleepers].sort((a, b) => a - b)) {
    const used = taken.get('tidur') ?? 0
    taken.set('tidur', used + 1)
    plan.set(seat, { stop: beds, placement: beds.spots[used % beds.spots.length] })
  }
  for (const seat of [...seats].filter((item) => !plan.has(item)).sort((a, b) => a - b)) {
    const start = step + (wholeSeat(seat) - 1) * 3
    let stop = stopAt(start)
    for (let offset = 0; offset < IDLE_ROUTE.length; offset += 1) {
      const candidate = stopAt(start + offset)
      if ((taken.get(candidate.key) ?? 0) < candidate.spots.length) { stop = candidate; break }
    }
    const used = taken.get(stop.key) ?? 0
    taken.set(stop.key, used + 1)
    plan.set(seat, { stop, placement: stop.spots[used % stop.spots.length] })
  }
  return plan
}

/** One idle agent on its own. */
export function idleStop(seat: number, time: number, layout: OfficeLayout = DEFAULT_LAYOUT): IdleAssignment {
  return idlePlan([seat], time, layout).get(seat)!
}
