// Layout of the 3D office as pure geometry on a tile grid (1 unit = 1 tile ≈ 1 metre).
// x east, y up, z south (towards the street). No React or three here, so it can be tested.
//
// One floor, two bands of rooms. Ruang Kerja and Kamar Tidur grow east with the crew (one desk
// and one bed per agent, two rows, at least three columns); every other room has a fixed size
// and shifts east with them. Shown for three agents (K = 10, the workspace width):
//
//  z -8 ┌───────────┬───────┬───────┐
//  gang │ Kamar     │Lounge │ Game  │
//  bakso│ Tidur     ║       ║ Room  │      ║ / ═ : door (2 tiles)
//       │       ═══ │       │       │
//  z  0 ├───────────┼═══────┼───────┤
//  kopi │ Kerja     │ Rapat │Misi│Srv│
//       │ (work)    ║ (mtg) ║    ║   │
//  z  8 └────═══────┴───────┴────┴───┘
//         yard · flag · trees
//         sidewalk · street lamps
//         road
//      x 0          K      K+8 K+12 K+16

export type Vec3 = [number, number, number]
export type RoomId = 'kerja' | 'rapat' | 'lounge' | 'game' | 'tidur' | 'misi' | 'server'
export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Room extends Rect { id: RoomId; label: string; tone: string }
/** Axis-aligned wall segment on the x/z plane, with the door gaps already cut out. */
export interface Wall { from: [number, number]; to: [number, number] }
/** A 2-tile gap in a wall, joining two rooms (or a room and the outside). */
export interface Door { between: [RoomId | 'outside', RoomId | 'outside']; from: [number, number]; to: [number, number] }
/**
 * Where and how an agent is. `pose` lying (bed: `height` is the surface) or sitting on the floor;
 * otherwise standing, or sitting on a chair when `seated`. `facing` is a rotation about y, where 0
 * looks towards +z (the street).
 */
export interface Placement { position: Vec3; facing: number; seated: boolean; label?: string; pose?: 'lie' | 'floor'; height?: number }
export interface IdleStop { key: string; label: string; spots: Placement[] }

export interface OfficeLayout {
  agentCount: number
  rooms: Room[]; walls: Wall[]; doors: Door[]
  building: Rect
  /** Furniture, cart and prop footprints (not walkable). */
  obstacles: Rect[]
  desks: Vec3[]; beds: Vec3[]
  /** Long table along x, TV on a stand at its west end, whiteboard at its east end. */
  meeting: { table: Rect; tv: Vec3; whiteboard: Vec3; seats: Placement[] }
  /** Sofa facing the TV on the north wall; the pantry (galon, fridge, counter) sits along the walls. */
  lounge: { sofa: Vec3; tv: Vec3; coffeeTable: Vec3; seats: Placement[]; pantry: { galon: Vec3; fridge: Vec3; counter: Vec3 } }
  game: { pingPong: Vec3; arcades: Vec3[]; beanbags: Vec3[]; carrom: Vec3; tv: Vec3 }
  /** Papan Misi wall (on the north wall of its room, facing south) and the Server Room rack. */
  board: Vec3; rack: Vec3
  outdoors: { yard: Rect; sidewalk: Rect; road: Rect; entrance: Vec3; baksoCart: Vec3; kopiBike: Vec3; flag: Vec3; streetLamps: Vec3[]; trees: Vec3[] }
  idleStops: IdleStop[]
  camera: { target: Vec3; offset: Vec3 }
  /** Camera target bounds, covering the building, the side lane and the street. */
  pan: Rect
}

/** Street-food carts stand turned a quarter, their customers' side towards the building. */
export const STALL_ROTATION = Math.PI / 2

const DESK_PITCH = 2
const MIN_DESK_COLUMNS = 3
const DESK_ROWS_Z = [2.5, 5.5]
const BED_ROWS_Z = [-6.4, -3]
/** Free tiles between the outer walls and the first and last desk/bed column. */
const SIDE_MARGIN = 2
const BAND_DEPTH = 8
const RAPAT_WIDTH = 8
const LOUNGE_WIDTH = 8
const GAME_WIDTH = 8
const MISI_WIDTH = 4
const SERVER_WIDTH = 4
/** The side lane (gang) west of the building, where the street food parks. */
const GANG_WIDTH = 5
const YARD_DEPTH = 3
const SIDEWALK_DEPTH = 2
const ROAD_DEPTH = 6
const CAMERA_PITCH = (55 * Math.PI) / 180

const vec = (x: number, z: number): Vec3 => [x, 0, z]
const rect = (x: number, z: number, halfX: number, halfZ: number): Rect => ({ minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ })
/** The facing that looks from (x, z) towards (tx, tz). */
const facingTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z)
const spot = (x: number, z: number, facing: number, seated = false, label?: string): Placement => ({ position: vec(x, z), facing, seated, ...(label ? { label } : {}) })
const lookAt = (x: number, z: number, [tx, , tz]: Vec3, seated = false, label?: string) => spot(x, z, facingTo(x, z, tx, tz), seated, label)
/** Lying in a bed: feet at the foot end, head on the pillow towards -z. */
const bedSpot = ([x, , z]: Vec3): Placement => ({ position: vec(x, z + 0.95), facing: 0, seated: false, pose: 'lie', height: 0.5 })
/** A spot given in a stall's own coordinates (as if unrotated), placed in the world. */
function stallSpot(stall: Vec3, x: number, z: number, facing: number, seated = false): Placement {
  const cos = Math.cos(STALL_ROTATION)
  const sin = Math.sin(STALL_ROTATION)
  return spot(stall[0] + x * cos + z * sin, stall[2] - x * sin + z * cos, facing + STALL_ROTATION, seated)
}

/** Splits a straight wall line around the doors that lie on it. */
function cutWall(from: [number, number], to: [number, number], doors: Door[]): Wall[] {
  const alongX = from[1] === to[1]
  const axis = alongX ? 0 : 1
  const line = alongX ? from[1] : from[0]
  const gaps = doors
    .filter((door) => alongX ? door.from[1] === line && door.to[1] === line : door.from[0] === line && door.to[0] === line)
    .map((door) => [Math.min(door.from[axis], door.to[axis]), Math.max(door.from[axis], door.to[axis])] as const)
    .sort((a, b) => a[0] - b[0])
  const point = (value: number): [number, number] => alongX ? [value, line] : [line, value]
  const walls: Wall[] = []
  let start = Math.min(from[axis], to[axis])
  const end = Math.max(from[axis], to[axis])
  for (const [gapStart, gapEnd] of gaps) {
    if (gapEnd <= start || gapStart >= end) continue
    if (gapStart > start) walls.push({ from: point(start), to: point(gapStart) })
    start = Math.max(start, gapEnd)
  }
  if (end > start) walls.push({ from: point(start), to: point(end) })
  return walls
}

/** The office for a given number of agents: one desk and one bed each, rooms on a grid around them. */
export function createLayout(agentCount: number): OfficeLayout {
  const agents = Math.max(1, Math.floor(agentCount) || 1)
  const columns = Math.max(MIN_DESK_COLUMNS, Math.ceil(agents / DESK_ROWS_Z.length))
  const K = columns * DESK_PITCH + 2 * SIDE_MARGIN // workspace width
  const columnX = (column: number) => SIDE_MARGIN + 1 + column * DESK_PITCH
  // The back row fills first (west to east), then the front row; beds mirror the desks.
  const grid = (rowsZ: number[]) => Array.from({ length: agents }, (_, index): Vec3 => {
    const row = index < columns ? 0 : 1
    return vec(columnX(row === 0 ? index : index - columns), rowsZ[row])
  })
  const desks = grid(DESK_ROWS_Z)
  const beds = grid(BED_ROWS_Z)

  const north = -BAND_DEPTH
  const south = BAND_DEPTH
  const rapatX = K
  const loungeX = K
  const gameX = loungeX + LOUNGE_WIDTH
  const misiX = rapatX + RAPAT_WIDTH
  const serverX = misiX + MISI_WIDTH
  // Both bands are equally wide (lounge + game = rapat + misi + server).
  const maxX = Math.max(gameX + GAME_WIDTH, serverX + SERVER_WIDTH)
  const building: Rect = { minX: 0, maxX, minZ: north, maxZ: south }

  const rooms: Room[] = [
    { id: 'kerja', label: 'Ruang Kerja', tone: 'kerja', minX: 0, maxX: K, minZ: 0, maxZ: south },
    { id: 'rapat', label: 'Ruang Rapat', tone: 'rapat', minX: rapatX, maxX: misiX, minZ: 0, maxZ: south },
    { id: 'misi', label: 'Papan Misi', tone: 'misi', minX: misiX, maxX: serverX, minZ: 0, maxZ: south },
    { id: 'server', label: 'Server Room', tone: 'server', minX: serverX, maxX, minZ: 0, maxZ: south },
    { id: 'tidur', label: 'Kamar Tidur', tone: 'tidur', minX: 0, maxX: K, minZ: north, maxZ: 0 },
    { id: 'lounge', label: 'Lounge', tone: 'lounge', minX: loungeX, maxX: gameX, minZ: north, maxZ: 0 },
    { id: 'game', label: 'Game Room', tone: 'game', minX: gameX, maxX, minZ: north, maxZ: 0 },
  ]

  const entranceX = K / 2
  const doors: Door[] = [
    { between: ['outside', 'kerja'], from: [entranceX - 1, south], to: [entranceX + 1, south] },
    { between: ['kerja', 'rapat'], from: [K, 5], to: [K, 7] },
    { between: ['kerja', 'tidur'], from: [K - 3, 0], to: [K - 1, 0] },
    { between: ['tidur', 'lounge'], from: [K, -3], to: [K, -1] },
    { between: ['rapat', 'lounge'], from: [rapatX + 5, 0], to: [rapatX + 7, 0] },
    { between: ['lounge', 'game'], from: [gameX, -3], to: [gameX, -1] },
    { between: ['rapat', 'misi'], from: [misiX, 5], to: [misiX, 7] },
    { between: ['misi', 'server'], from: [serverX, 5], to: [serverX, 7] },
  ]
  const wallLines: [[number, number], [number, number]][] = [
    [[0, north], [maxX, north]], [[0, south], [maxX, south]], [[0, north], [0, south]], [[maxX, north], [maxX, south]],
    [[0, 0], [maxX, 0]], [[K, north], [K, south]], [[gameX, north], [gameX, 0]], [[misiX, 0], [misiX, south]], [[serverX, 0], [serverX, south]],
  ]
  const walls = wallLines.flatMap(([from, to]) => cutWall(from, to, doors))

  const obstacles: Rect[] = [
    ...desks.map(([x, , z]) => rect(x, z, 0.95, 0.48)),
    ...beds.map(([x, , z]) => rect(x, z, 0.53, 1.03)),
  ]

  // Ruang Rapat: six chairs around a long table, the presenter at the whiteboard, standing room.
  const tableX = rapatX + RAPAT_WIDTH / 2
  const tableZ = 4
  const table = rect(tableX, tableZ, 1.6, 0.55)
  const meetingTv = vec(table.minX - 0.75, tableZ)
  const whiteboard = vec(table.maxX + 1, tableZ)
  const chairXs = [tableX + 0.8, tableX, tableX - 0.8]
  const chairs = chairXs.flatMap((x): Placement[] => [spot(x, tableZ - 0.8, 0, true), spot(x, tableZ + 0.8, Math.PI, true)])
  const standing = chairXs.flatMap((x): Placement[] => [spot(x, tableZ - 1.6, 0), spot(x, tableZ + 1.6, Math.PI)])
  const presenter = spot(whiteboard[0] - 0.5, tableZ, -Math.PI / 2, false, 'Presenting at the whiteboard')
  obstacles.push(table, rect(meetingTv[0], tableZ, 0.3, 0.4), rect(whiteboard[0], tableZ, 0.12, 0.9))

  // Lounge: TV on the north wall, the sofa facing it across a coffee table, an armchair each side.
  const loungeMidX = loungeX + LOUNGE_WIDTH / 2
  const loungeTv = vec(loungeMidX, north + 0.3)
  const sofa = vec(loungeMidX, -3.8)
  const coffeeTable = vec(loungeMidX, -5.4)
  const armchairs = [vec(loungeMidX - 1.6, -5.4), vec(loungeMidX + 1.6, -5.4)]
  const loungeSeats: Placement[] = [
    spot(loungeMidX - 0.6, -4.2, Math.PI, true),
    spot(loungeMidX + 0.6, -4.2, Math.PI, true),
    ...armchairs.map(([x, , z]) => lookAt(x, z, coffeeTable, true)),
  ]
  const galon = vec(loungeX + 0.6, north + 0.6)
  const fridge = vec(gameX - 0.45, north + 0.6)
  const counter = vec(gameX - 0.35, north + 2.2)
  obstacles.push(
    rect(sofa[0], sofa[2], 1.2, 0.45), rect(coffeeTable[0], coffeeTable[2], 0.5, 0.3), rect(loungeTv[0], loungeTv[2], 0.8, 0.25),
    ...armchairs.map(([x, , z]) => rect(x, z, 0.45, 0.43)),
    rect(galon[0], galon[2], 0.22, 0.22), rect(fridge[0], fridge[2], 0.38, 0.38), rect(counter[0], counter[2], 0.32, 0.8),
  )

  // Game Room: ping-pong in the middle, arcades and a TV with beanbags on the north wall, carrom by the door.
  const pingPong = vec(gameX + 4, -3.5)
  const arcades = [vec(gameX + 1, north + 0.5), vec(gameX + 2, north + 0.5)]
  const gameTv = vec(gameX + 5.6, north + 0.3)
  const beanbags = [vec(gameX + 5, north + 1.7), vec(gameX + 6.2, north + 1.7)]
  const carrom = vec(gameX + 6.6, -1.5)
  obstacles.push(
    rect(pingPong[0], pingPong[2], 1.37, 0.76), rect(gameTv[0], gameTv[2], 0.8, 0.25), rect(carrom[0], carrom[2], 0.45, 1.0),
    ...arcades.map(([x, , z]) => rect(x, z, 0.36, 0.31)),
    ...beanbags.map(([x, , z]) => rect(x, z, 0.42, 0.42)),
  )

  // Papan Misi on the north wall of its room; the server rack against the Server Room's north wall.
  const board = vec(misiX + MISI_WIDTH / 2, 0.15)
  const rack = vec(serverX + SERVER_WIDTH / 2, 0.6)
  obstacles.push(rect(board[0], board[2], 1.5, 0.15), rect(rack[0], rack[2], 0.6, 0.4))

  // Outside: the gang west of the building, the yard in front, then the sidewalk and the road.
  const groundsMinX = -GANG_WIDTH
  const groundsMaxX = maxX + 3
  const yard: Rect = { minX: groundsMinX, maxX: groundsMaxX, minZ: south, maxZ: south + YARD_DEPTH }
  const sidewalk: Rect = { minX: groundsMinX, maxX: groundsMaxX, minZ: yard.maxZ, maxZ: yard.maxZ + SIDEWALK_DEPTH }
  const road: Rect = { minX: groundsMinX, maxX: groundsMaxX, minZ: sidewalk.maxZ, maxZ: sidewalk.maxZ + ROAD_DEPTH }
  const entrance = vec(entranceX, south + 1)
  const baksoCart = vec(-3.4, -2)
  const kopiBike = vec(-3.4, 3)
  const flag = vec(maxX - 1.5, south + 2)
  const streetLamps: Vec3[] = []
  for (let x = groundsMinX + 1; x <= groundsMaxX; x += 8) streetLamps.push(vec(x, sidewalk.maxZ - 0.3))
  const trees = [vec(2, south + 1.5), vec(K + 4, south + 1.5), vec(K + 11, south + 1.5)]
  obstacles.push(
    rect(baksoCart[0], baksoCart[2] + 0.25, 0.5, 1.2), rect(kopiBike[0], kopiBike[2], 0.4, 0.9),
    rect(flag[0], flag[2], 0.2, 0.2), ...trees.map(([x, , z]) => rect(x, z, 0.4, 0.4)),
    ...streetLamps.map(([x, , z]) => rect(x, z, 0.15, 0.15)),
  )

  const idleStops: IdleStop[] = [
    { key: 'lounge', label: 'Relaxing in the lounge', spots: loungeSeats },
    { key: 'galon', label: 'Getting water from the galon', spots: [lookAt(galon[0] + 0.85, galon[2], galon), lookAt(galon[0] + 0.7, galon[2] + 0.75, galon), lookAt(galon[0], galon[2] + 0.9, galon)] },
    { key: 'dapur', label: 'In the kitchen', spots: [lookAt(fridge[0] - 0.95, fridge[2], fridge), spot(counter[0] - 0.85, counter[2] - 0.4, Math.PI / 2), spot(counter[0] - 0.85, counter[2] + 0.4, Math.PI / 2)] },
    { key: 'game', label: 'Playing ping-pong', spots: [
      spot(pingPong[0] - 1.75, pingPong[2], Math.PI / 2), spot(pingPong[0] + 1.75, pingPong[2], -Math.PI / 2),
      spot(carrom[0], carrom[2] - 0.75, 0, true, 'Playing carrom'), spot(carrom[0], carrom[2] + 0.75, Math.PI, true, 'Playing carrom'),
    ] },
    { key: 'arcade', label: 'Playing arcade games', spots: [
      ...arcades.map(([x, , z]) => spot(x, z + 0.8, Math.PI)),
      ...beanbags.map(([x, , z]) => lookAt(x, z, gameTv, true, 'Gaming on the console')),
    ] },
    { key: 'tidur', label: 'Sleeping', spots: beds.map(bedSpot) },
    // On the gerobak's plastic stools, facing the cart.
    { key: 'bakso', label: 'Eating bakso', spots: [stallSpot(baksoCart, 0.5, 1.1, Math.PI, true), stallSpot(baksoCart, -0.3, 1.2, Math.PI, true), stallSpot(baksoCart, 1.3, 0.9, -2.4)] },
    { key: 'kopi', label: 'Coffee at the kopi bike', spots: [stallSpot(kopiBike, -0.5, 0.85, Math.PI), stallSpot(kopiBike, 0.5, 0.85, Math.PI), stallSpot(kopiBike, 1.45, 0.3, -Math.PI / 2)] },
    { key: 'jalan', label: 'Taking a stroll', spots: [
      lookAt(flag[0] - 1, flag[2] + 0.2, flag),
      spot(entranceX + 4, sidewalk.minZ + 1, 0, false, 'Watching the street'),
      spot(-1, -6, Math.PI, false),
      lookAt(board[0], 1.4, board, false, 'Reading the mission board'),
    ] },
  ]

  const pan: Rect = { minX: groundsMinX - 1, maxX: groundsMaxX + 1, minZ: north - 2, maxZ: road.maxZ }
  // Azimuth locked north, about 55° down; far enough back to frame the whole width.
  const sceneWidth = pan.maxX - pan.minX
  const distance = Math.max(26, sceneWidth * 0.9)
  const camera = {
    target: vec((groundsMinX + groundsMaxX) / 2, (north + sidewalk.maxZ) / 2 + 1.5),
    offset: [0, distance * Math.sin(CAMERA_PITCH), distance * Math.cos(CAMERA_PITCH)] as Vec3,
  }

  return {
    agentCount: agents, rooms, walls, doors, building, obstacles, desks, beds,
    meeting: { table, tv: meetingTv, whiteboard, seats: [presenter, ...chairs, ...standing] },
    lounge: { sofa, tv: loungeTv, coffeeTable, seats: loungeSeats, pantry: { galon, fridge, counter } },
    game: { pingPong, arcades, beanbags, carrom, tv: gameTv },
    board, rack,
    outdoors: { yard, sidewalk, road, entrance, baksoCart, kopiBike, flag, streetLamps, trees },
    idleStops, camera, pan,
  }
}

/** Keeps a panned camera target inside the given bounds. */
export function clampTarget(x: number, z: number, bounds: Rect): [number, number] {
  return [Math.min(Math.max(x, bounds.minX), bounds.maxX), Math.min(Math.max(z, bounds.minZ), bounds.maxZ)]
}

/** The stock office (three agents), for callers that do not know the crew size. */
export const DEFAULT_LAYOUT: OfficeLayout = createLayout(3)
