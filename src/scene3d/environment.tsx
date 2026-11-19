import { useMemo } from 'react'
import * as THREE from 'three'
import { STALL_ROTATION, type OfficeLayout, type Rect, type Room, type RoomId, type Vec3, type Wall as WallSegment } from '../office3d-layout.ts'
import { AcOutdoorUnit, Armchair, ArcadeCabinet, Beanbag, Bed, Bookshelf, CarromTable, CoffeeTable, FlagPole, Fridge, GalonDispenser, Gerobak, KopiSepeda, LongTable, MissionBoardWall, OfficeChair, PantryCounter, PingPongTable, Plant, RBox, ServerRack, Sofa, StreetLamp, Television, Tree, Vendor, Whiteboard } from './props.tsx'
import { asphalt, carpet, floorSign, grass, pavingStones, tileFloor, woodFloor } from './textures.ts'

// One floor of rooms on the layout grid, seen from above like a dollhouse with the roof off:
// low walls (so the fixed, steep camera sees into every room), a name painted on each room's
// floor, the furniture, and the grounds around it (side lane with the street food, yard, sidewalk,
// road). In the evening (dark theme) the room lamps, cart lamps and street lamps come on, and
// rooms nobody is in stay a little dimmer. The desks are drawn by Office3D, which knows who sits.

const WALL = '#efe6d6'
const WALL_TOP = '#cdbfa6'
const WALL_HEIGHT = 0.6
/** Matches the walls the path finder keeps agents away from (0.1 either side of the line). */
const THICK = 0.2
const LAMP_HEIGHT = 2.3
/** How bright an empty room's lamps are in the evening, relative to an occupied one. */
const EMPTY_LEVEL = 0.4

const ALL_ROOMS: RoomId[] = ['kerja', 'rapat', 'lounge', 'game', 'tidur', 'misi', 'server']

/** Each room's floor (texture and tint) and the accent stripe on its name sign. */
const ROOM_STYLE: Record<RoomId, { floor: (repeat: [number, number]) => THREE.Texture; color: string; accent: string; roughness: number }> = {
  kerja: { floor: woodFloor, color: '#ffffff', accent: '#e0a43a', roughness: 0.55 },
  rapat: { floor: (repeat) => carpet('#8a4b3c', repeat), color: '#ffffff', accent: '#e76f51', roughness: 0.9 },
  lounge: { floor: (repeat) => carpet('#4f7d73', repeat), color: '#ffffff', accent: '#7fd1c0', roughness: 0.9 },
  game: { floor: (repeat) => carpet('#3b4170', repeat), color: '#ffffff', accent: '#f4d35e', roughness: 0.9 },
  tidur: { floor: (repeat) => carpet('#6d5a8c', repeat), color: '#ffffff', accent: '#b59ad6', roughness: 0.9 },
  misi: { floor: tileFloor, color: '#ffffff', accent: '#5fa8d3', roughness: 0.4 },
  server: { floor: tileFloor, color: '#9aa6b4', accent: '#4be07a', roughness: 0.4 },
}

const BLANKETS = ['#3d7fd6', '#e76f51', '#2a9d8f', '#e9c46a', '#8d5bc1', '#d64545']

const centre = (rect: Rect): [number, number] => [(rect.minX + rect.maxX) / 2, (rect.minZ + rect.maxZ) / 2]
const size = (rect: Rect): [number, number] => [rect.maxX - rect.minX, rect.maxZ - rect.minZ]
/** A colour scaled towards black (an empty room in the evening). */
const dim = (color: string, factor: number) => factor === 1 ? color : `#${new THREE.Color(color).multiplyScalar(factor).getHexString()}`

/** A flat rectangle on the ground at height `y`, textured with `map`. */
function Ground({ rect, y, map, color = '#ffffff', roughness = 0.85 }: { rect: Rect; y: number; map?: THREE.Texture; color?: string; roughness?: number }) {
  const [x, z] = centre(rect)
  return <mesh position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
    <planeGeometry args={size(rect)}/>
    <meshStandardMaterial map={map} color={color} roughness={roughness}/>
  </mesh>
}

function Wall({ from: [x1, z1], to: [x2, z2] }: WallSegment) {
  const length = Math.hypot(x2 - x1, z2 - z1)
  const angle = Math.atan2(z2 - z1, x2 - x1)
  return <group position={[(x1 + x2) / 2, 0, (z1 + z2) / 2]} rotation={[0, -angle, 0]}>
    <RBox position={[0, WALL_HEIGHT / 2, 0]} size={[length + THICK, WALL_HEIGHT, THICK]} radius={0.02} color={WALL} roughness={0.9}/>
    <RBox position={[0, WALL_HEIGHT + 0.02, 0]} size={[length + THICK + 0.02, 0.04, THICK + 0.04]} radius={0.01} color={WALL_TOP}/>
  </group>
}

/**
 * The room's name painted on its floor by the south wall, where the camera reads it best. Behind
 * an inner wall the sign keeps clear of the strip the wall hides, and further still when the board
 * or the rack stands in front of it.
 */
function RoomSign({ room, layout, night }: { room: Room; layout: OfficeLayout; night: boolean }) {
  const texture = useMemo(() => floorSign(room.label, ROOM_STYLE[room.id].accent), [room.label, room.id])
  const [x] = centre(room)
  const width = Math.min(room.maxX - room.minX - 0.6, 3.4)
  const height = width / 4
  const tallInFront = [layout.board, layout.rack].some(([px, , pz]) => px > room.minX && px < room.maxX && pz > room.maxZ - 0.01 && pz < room.maxZ + 1)
  const gap = room.maxZ >= layout.building.maxZ ? 0.3 : tallInFront ? 1.5 : 1
  return <mesh position={[x, 0.015, room.maxZ - gap - height / 2]} rotation={[-Math.PI / 2, 0, 0]}>
    <planeGeometry args={[width, height]}/>
    <meshBasicMaterial map={texture} transparent depthWrite={false} color={night ? '#d9d9d9' : '#ffffff'}/>
  </mesh>
}

function RoomFloor({ room, night, level }: { room: Room; night: boolean; level: number }) {
  const style = ROOM_STYLE[room.id]
  const [width, depth] = size(room)
  const map = useMemo(() => style.floor([width / 2, depth / 2]), [style, width, depth])
  return <Ground rect={room} y={0.005} map={map} color={dim(style.color, night ? 0.55 + 0.45 * level : 1)} roughness={style.roughness}/>
}

/**
 * The room's lamps: one light per 8 tiles of the room's width, high over the floor. There is no
 * ceiling and no fixture drawn: from the steep fixed camera a hanging lamp would float over the
 * wrong spot, so the lamps show only as the pools of light they cast in the evening.
 */
function RoomLamps({ room, level }: { room: Room; level: number }) {
  const count = Math.max(1, Math.ceil((room.maxX - room.minX) / 8))
  const step = (room.maxX - room.minX) / count
  const [, z] = centre(room)
  return <>{Array.from({ length: count }, (_, index) => <pointLight key={index} position={[room.minX + step * (index + 0.5), LAMP_HEIGHT, z]} color="#fff1dc" intensity={18 * level} distance={10} decay={2}/>)}</>
}

function MeetingRoom({ layout, night }: { layout: OfficeLayout; night: boolean }) {
  const { table, tv, whiteboard, seats } = layout.meeting
  const [tableX, tableZ] = centre(table)
  return <group>
    <LongTable position={[tableX, 0, tableZ]} length={table.maxX - table.minX}/>
    {seats.filter((seat) => seat.seated).map(({ position: [x, , z], facing }) => <OfficeChair key={`${x},${z}`} position={[x, 0, z]} rotation={facing}/>)}
    {/* TV on a stand at the table's west end, showing a slide */}
    <group position={[tv[0], 0, tv[2]]} rotation={[0, Math.PI / 2, 0]}>
      <RBox position={[0, 0.03, 0]} size={[0.8, 0.05, 0.5]} radius={0.02} color="#2a2f33"/>
      <RBox position={[0, 0.7, -0.08]} size={[0.1, 1.35, 0.08]} radius={0.02} color="#3a3f44" metalness={0.5}/>
      <group position={[0, 1.3, 0]} scale={0.8}>
        <Television position={[0, 0, 0]}/>
        <RBox position={[0, 0.36, 0.05]} size={[1.6, 0.14, 0.004]} radius={0.004} color="#f4f1ea" emissive="#f4f1ea" emissiveIntensity={night ? 0.8 : 0.3} shadow={false}/>
        {[0.25, 0.45, 0.32, 0.6].map((height, index) => <RBox key={index} position={[-0.45 + index * 0.3, -0.38 + height / 2, 0.05]} size={[0.18, height, 0.004]} radius={0.004} color={['#e9c46a', '#2a9d8f', '#e76f51', '#8fd18a'][index]} emissive={['#e9c46a', '#2a9d8f', '#e76f51', '#8fd18a'][index]} emissiveIntensity={night ? 0.7 : 0.25} shadow={false}/>)}
      </group>
    </group>
    <Whiteboard position={whiteboard} rotation={-Math.PI / 2}/>
  </group>
}

function Lounge({ layout }: { layout: OfficeLayout }) {
  const { sofa, tv, coffeeTable, seats, pantry } = layout.lounge
  const armchairs = seats.slice(2)
  return <group>
    <Sofa position={sofa} rotation={Math.PI}/>
    {armchairs.map(({ position, facing }, index) => <Armchair key={index} position={position} rotation={facing} color={index === 0 ? '#d9784a' : '#3d7fd6'}/>)}
    <CoffeeTable position={coffeeTable}/>
    <RBox position={[tv[0], 0.28, tv[2]]} size={[1.6, 0.56, 0.45]} radius={0.03} color="#6b4a32"/>
    <Television position={[tv[0], 1.25, tv[2] - 0.15]}/>
    {/* Pantry: tiles under the galon corner and the kitchen wall */}
    <GalonDispenser position={pantry.galon}/>
    <Fridge position={pantry.fridge} rotation={-Math.PI / 2}/>
    {/* The counter is shortened to its 1.6 footprint along the wall */}
    <group position={pantry.counter} scale={[1, 1, 0.8]}>
      <PantryCounter position={[0, 0, 0]} rotation={-Math.PI / 2}/>
    </group>
  </group>
}

function GameRoom({ layout }: { layout: OfficeLayout }) {
  const { pingPong, arcades, beanbags, carrom, tv } = layout.game
  return <group>
    <PingPongTable position={pingPong}/>
    {arcades.map((position, index) => <ArcadeCabinet key={index} position={position} color={index === 0 ? '#c62828' : '#1d4ed8'}/>)}
    <RBox position={[tv[0], 0.25, tv[2]]} size={[1.6, 0.5, 0.45]} radius={0.03} color="#1f2328"/>
    <RBox position={[tv[0] - 0.3, 0.53, tv[2]]} size={[0.36, 0.08, 0.26]} radius={0.02} color="#f2f2f2"/>
    <Television position={[tv[0], 1.2, tv[2] - 0.15]}/>
    {beanbags.map((position, index) => <Beanbag key={index} position={position} color={index === 0 ? '#e76f51' : '#2a9d8f'}/>)}
    <CarromTable position={carrom}/>
  </group>
}

function Bedroom({ layout, room }: { layout: OfficeLayout; room: Room }) {
  return <group>
    {layout.beds.map((position, index) => <Bed key={index} position={position} color={BLANKETS[index % BLANKETS.length]}/>)}
    <Bookshelf position={[room.minX + 0.32, 0, room.minZ + 3]} rotation={Math.PI / 2}/>
    <Plant position={[room.maxX - 0.5, 0, room.minZ + 0.5]} size={0.9}/>
  </group>
}

function Outdoors({ night, layout }: { night: boolean; layout: OfficeLayout }) {
  const { building, pan, outdoors } = layout
  const { yard, sidewalk, road, entrance, baksoCart, kopiBike, flag, streetLamps, trees } = outdoors
  const lawnRect: Rect = { minX: pan.minX - 30, maxX: pan.maxX + 30, minZ: pan.minZ - 30, maxZ: pan.maxZ + 30 }
  const gangRect: Rect = { minX: yard.minX, maxX: building.minX, minZ: building.minZ, maxZ: building.maxZ }
  const pathRect: Rect = { minX: entrance[0] - 1, maxX: entrance[0] + 1, minZ: building.maxZ, maxZ: sidewalk.minZ }
  const [lawnW, lawnD] = size(lawnRect)
  const lawn = useMemo(() => grass([lawnW / 4, lawnD / 4]), [lawnW, lawnD])
  const [walkW, walkD] = size(sidewalk)
  const paving = useMemo(() => pavingStones([walkW / 2, walkD / 2]), [walkW, walkD])
  const [gangW, gangD] = size(gangRect)
  const gang = useMemo(() => pavingStones([gangW / 2, gangD / 2]), [gangW, gangD])
  const path = useMemo(() => pavingStones([1, 1.5]), [])
  const [roadW] = size(road)
  const asphaltMap = useMemo(() => asphalt([roadW / 6, 1]), [roadW])
  // Trees behind the building and beyond the grounds frame the scene without hiding a room.
  const backTrees: Vec3[] = []
  for (let x = building.minX - 3; x <= building.maxX + 3; x += 6.5) backTrees.push([x, 0, building.minZ - 1.6])
  const sideTrees: Vec3[] = [[pan.minX - 2, 0, -5], [pan.minX - 2.5, 0, 4], [pan.maxX + 2, 0, -4], [pan.maxX + 2.5, 0, 5]]
  return <group>
    <Ground rect={lawnRect} y={-0.03} map={lawn} roughness={1}/>
    <Ground rect={gangRect} y={-0.012} map={gang} roughness={0.9}/>
    <Ground rect={sidewalk} y={-0.01} map={paving} roughness={0.9}/>
    <Ground rect={pathRect} y={-0.008} map={path} roughness={0.9}/>
    <Ground rect={road} y={-0.014} map={asphaltMap} roughness={0.95}/>
    {/* Kerb between the sidewalk and the road */}
    <RBox position={[(road.minX + road.maxX) / 2, 0.03, sidewalk.maxZ]} size={[road.maxX - road.minX, 0.08, 0.16]} radius={0.01} color="#d8d2c6" shadow={false}/>
    {/* The building stands on a low plinth */}
    <mesh position={[(building.minX + building.maxX) / 2, -0.05, (building.minZ + building.maxZ) / 2]} receiveShadow>
      <boxGeometry args={[building.maxX - building.minX + 0.3, 0.1, building.maxZ - building.minZ + 0.3]}/>
      <meshStandardMaterial color="#cfc6b5" roughness={0.9}/>
    </mesh>
    <FlagPole position={flag}/>
    {streetLamps.map((position) => <StreetLamp key={position.join(',')} position={position} night={night}/>)}
    {[...trees, ...backTrees, ...sideTrees].map((position, index) => <Tree key={`${position.join(',')}-${index}`} position={position} size={index < trees.length ? 0.85 : 1.1}/>)}
    {/* AC outdoor units behind the building */}
    <AcOutdoorUnit position={[building.minX + 3, 0, building.minZ - 0.4]} rotation={Math.PI}/>
    <AcOutdoorUnit position={[building.maxX - 5, 0, building.minZ - 0.4]} rotation={Math.PI}/>
    {/* Street food in the gang, turned towards the building */}
    <group position={baksoCart} rotation={[0, STALL_ROTATION, 0]}>
      <Gerobak position={[0, 0, 0]} night={night}/>
      <Vendor position={[-1.6, 0, 0]} rotation={Math.PI / 2} shirt="#f1f1ec" hat="peci"/>
    </group>
    <group position={kopiBike} rotation={[0, STALL_ROTATION, 0]}>
      <KopiSepeda position={[0, 0, 0]} night={night}/>
      <Vendor position={[-1.35, 0, -0.1]} rotation={Math.PI / 2} shirt="#2f6d8f" hat="cap"/>
    </group>
  </group>
}

/**
 * The office and its grounds, built from `layout`. `occupiedRooms` lists the rooms someone is in
 * (all of them when left out); the others are dimmer in the evening. The Papan Misi board and the
 * server rack are links: they call `onNavigate` with the hash of the Task Board and Calendar pages.
 */
export function Environment({ night = false, layout, onNavigate, occupiedRooms = ALL_ROOMS }: { night?: boolean; layout: OfficeLayout; onNavigate?: (hash: string) => void; occupiedRooms?: RoomId[] }) {
  const level = (id: RoomId) => occupiedRooms.includes(id) ? 1 : EMPTY_LEVEL
  const rooms = new Map(layout.rooms.map((room) => [room.id, room]))
  const kerja = rooms.get('kerja')
  const tidur = rooms.get('tidur')
  const rapat = rooms.get('rapat')
  return <group>
    {layout.rooms.map((room) => <RoomFloor key={room.id} room={room} night={night} level={level(room.id)}/>)}
    {/* Pantry tiles along the lounge's east wall, under the fridge and the counter */}
    <Ground rect={{ minX: layout.lounge.pantry.counter[0] - 1.45, maxX: layout.lounge.pantry.counter[0] + 0.35, minZ: layout.building.minZ, maxZ: layout.lounge.pantry.counter[2] + 1.1 }} y={0.008} map={tileFloor([1, 2])} color={dim('#ffffff', night ? 0.55 + 0.45 * level('lounge') : 1)} roughness={0.35}/>
    {layout.rooms.map((room) => <RoomSign key={room.id} room={room} layout={layout} night={night}/>)}
    {layout.walls.map((wall) => <Wall key={`${wall.from.join(',')}-${wall.to.join(',')}`} {...wall}/>)}
    {night && layout.rooms.map((room) => <RoomLamps key={room.id} room={room} level={level(room.id)}/>)}
    {kerja && <>
      <Plant position={[kerja.minX + 0.5, 0, kerja.minZ + 0.5]} size={0.9}/>
      <Plant position={[kerja.minX + 0.5, 0, kerja.maxZ - 0.5]} size={0.9}/>
    </>}
    {tidur && <Bedroom layout={layout} room={tidur}/>}
    {rapat && <Plant position={[rapat.minX + 0.5, 0, rapat.minZ + 0.5]} size={0.8}/>}
    <MeetingRoom layout={layout} night={night}/>
    <Lounge layout={layout}/>
    <GameRoom layout={layout}/>
    <MissionBoardWall position={layout.board} night={night} onClick={onNavigate && (() => onNavigate('#/task-board'))}/>
    <ServerRack position={layout.rack} night={night} onClick={onNavigate && (() => onNavigate('#/calendar'))}/>
    <Outdoors night={night} layout={layout}/>
  </group>
}
