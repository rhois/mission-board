import { describe, expect, it } from 'vitest'
import { createLayout, DEFAULT_LAYOUT, type Rect, type Vec3 } from './office3d-layout'
import { IDLE_ROUTE, IDLE_STOP_MS, idlePlan, idleStop, meetingSeat, occupiedRoomsFor, placementFor } from './office3d-placement'
import type { OfficeStation } from './types.ts'

const station = (overrides: Partial<OfficeStation>): OfficeStation => ({
  id: 'default', name: 'default', role: 'Hermes profile', room: 'Workspace', roomPosition: 'assigned-desk',
  state: 'Working', currentTask: '', recentActivity: '', activity: '', seat: 1, provenance: '', freshness: '', ...overrides,
})
const room = (id: string, layout = DEFAULT_LAYOUT): Rect => layout.rooms.find((item) => item.id === id)!
const inside = ([x, , z]: Vec3, r: Rect) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ
const near = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]) <= 1
const key = (p: { position: Vec3 }) => p.position.join(',')

describe('placementFor', () => {
  it('seats working and reviewing agents at their desk', () => {
    for (const state of ['Working', 'Reviewing'] as const) {
      const placement = placementFor(station({ seat: 2, state }))
      expect(near(placement.position, DEFAULT_LAYOUT.desks[1])).toBe(true)
      expect(placement.seated).toBe(true)
    }
  })

  it('stands offline and unknown agents at the desk', () => {
    for (const state of ['Offline', 'Unknown'] as const) {
      const placement = placementFor(station({ seat: 2, state }))
      expect(near(placement.position, DEFAULT_LAYOUT.desks[1])).toBe(true)
      expect(placement.seated).toBe(false)
    }
  })

  it('sends collaborating agents to the meeting room, which wins over the desk', () => {
    const placement = placementFor(station({ state: 'Collaborating', roomPosition: 'meeting-area', seat: 3 }), undefined, 2)
    expect(placement.position).toEqual(meetingSeat(2).position)
    expect(inside(placement.position, room('rapat'))).toBe(true)
  })

  it('puts idle lounge agents on a lounge seat', () => {
    const placement = placementFor(station({ state: 'Idle', room: 'Lounge', roomPosition: 'lounge-seat-2', seat: 2 }))
    expect(inside(placement.position, room('lounge'))).toBe(true)
    expect(placement.seated).toBe(true)
  })

  it('clamps out-of-range seats onto a desk', () => {
    const layout = createLayout(3)
    for (const seat of [0, -3, 999]) {
      const { position } = placementFor(station({ seat }), layout)
      expect(position).toBeDefined()
      expect(layout.desks.some((desk) => near(position, desk))).toBe(true)
    }
  })
})

describe('meetingSeat', () => {
  it('stays inside the meeting room and wraps', () => {
    const { seats } = DEFAULT_LAYOUT.meeting
    for (let index = 0; index <= 20; index += 1) {
      expect(inside(meetingSeat(index).position, room('rapat'))).toBe(true)
      expect(meetingSeat(index)).toEqual(meetingSeat(index % seats.length))
    }
  })
})

describe('idle plan', () => {
  it('has only route keys that exist as idle stops', () => {
    const keys = DEFAULT_LAYOUT.idleStops.map((stop) => stop.key)
    for (const item of IDLE_ROUTE) expect(keys).toContain(item)
  })

  it('never shares a spot and changes over time', () => {
    const seats = [1, 2, 3, 4, 5]
    for (const time of [0, IDLE_STOP_MS * 3]) {
      const plan = idlePlan(seats, time)
      expect(new Set([...plan.values()].map((item) => key(item.placement))).size).toBe(seats.length)
    }
    const a = idlePlan(seats, 0)
    const b = idlePlan(seats, IDLE_STOP_MS)
    expect(seats.some((seat) => a.get(seat)!.stop.key !== b.get(seat)!.stop.key)).toBe(true)
  })

  it('is pure', () => {
    expect(idlePlan([1, 2, 3], 12345)).toEqual(idlePlan([1, 2, 3], 12345))
    expect(idleStop(2, 999)).toEqual(idlePlan([2], 999).get(2))
  })

  it('handles 30 idle agents without sharing spots while room remains', () => {
    const layout = createLayout(30)
    const seats = Array.from({ length: 30 }, (_, index) => index + 1)
    const total = layout.idleStops.reduce((sum, stop) => sum + stop.spots.length, 0)
    const plan = idlePlan(seats, 0, layout)
    expect(plan.size).toBe(30)
    if (total >= 30) expect(new Set([...plan.values()].map((item) => `${item.stop.key}:${key(item.placement)}`)).size).toBe(30)
  })

  it('puts sleepers on the first distinct beds', () => {
    const plan = idlePlan([1, 2, 3], 0, DEFAULT_LAYOUT, [1, 3])
    const one = plan.get(1)!
    const three = plan.get(3)!
    expect(one.placement.pose).toBe('lie')
    expect(three.placement.pose).toBe('lie')
    expect(key(one.placement)).not.toBe(key(three.placement))
    expect(plan.get(2)!.placement.pose).not.toBe('lie')
  })
})

describe('hardening and occupied rooms', () => {
  it('does not throw on NaN or fractional seats', () => {
    for (const seat of [NaN, 1.5, -3, Infinity]) {
      expect(() => placementFor(station({ seat }))).not.toThrow()
      expect(() => placementFor(station({ seat, room: 'Lounge' }))).not.toThrow()
      expect(() => idlePlan([seat], 0)).not.toThrow()
      expect(() => idleStop(seat, 0)).not.toThrow()
    }
    expect(placementFor(station({ seat: 1.5 })).position).toEqual(placementFor(station({ seat: 1 })).position)
    expect(placementFor(station({ seat: NaN })).position).toEqual(placementFor(station({ seat: 1 })).position)
  })

  it('lists exactly the rooms that have a station in them', () => {
    const kerja = placementFor(station({ seat: 1 })).position
    const rapat = meetingSeat(1).position
    expect(occupiedRoomsFor([kerja, rapat]).sort()).toEqual(['kerja', 'rapat'])
    expect(occupiedRoomsFor([kerja])).toEqual(['kerja'])
    expect(occupiedRoomsFor([])).toEqual([])
  })
})
