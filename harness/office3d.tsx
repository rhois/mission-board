/* eslint-disable react-refresh/only-export-components -- an entry module: nothing imports it, so there is nothing to hot-swap */
import { Canvas, useThree } from '@react-three/fiber'
import { lazy, StrictMode, useMemo, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/styles.css'
import { createLayout, type OfficeLayout, type RoomId } from '../src/office3d-layout.ts'
import { Environment } from '../src/scene3d/environment.tsx'
import { Lighting } from '../src/scene3d/lighting.tsx'
import { WorkDesk } from '../src/scene3d/props.tsx'
import type { OfficeState, OfficeStation } from '../src/types.ts'

// Dev-only harness for the 3D office, so the scene can be looked at without a Hermes install.
// Query: n=<agents> (default 3), theme=light|dark (default dark), scene=env for the bare scene
// (no agents, fixed camera) and, with it, occupied=<room ids> (default: every room).

const params = new URLSearchParams(window.location.search)
const count = Math.max(0, Number.parseInt(params.get('n') ?? '3', 10) || 0)
const theme: 'light' | 'dark' = params.get('theme') === 'light' ? 'light' : 'dark'
document.documentElement.dataset.theme = theme

const STATES: OfficeState[] = ['Working', 'Reviewing', 'Collaborating', 'Idle', 'Offline', 'Unknown']
const POSITIONS: Record<OfficeState, string> = {
  Working: 'assigned-desk', Reviewing: 'review-desk', Collaborating: 'meeting-area', Idle: 'lounge-seat', Offline: 'offline-station', Unknown: 'neutral-presence',
}
const NAMES = ['Ayu', 'Budi', 'Citra', 'Dewi', 'Eko', 'Fajar', 'Gita', 'Hadi', 'Indra', 'Joko', 'Kiki', 'Lina', 'Made', 'Nina', 'Oka', 'Putu']

/** Sample stations with the states cycling by index, as the server would report them. */
function sampleStations(n: number): OfficeStation[] {
  return Array.from({ length: n }, (_, index) => {
    const state = STATES[index % STATES.length]
    const busy = state === 'Working' || state === 'Reviewing' || state === 'Collaborating'
    return {
      id: `agent-${index + 1}`,
      name: NAMES[index] ?? `Agent ${index + 1}`,
      role: 'Engineer',
      room: state === 'Idle' ? 'Lounge' : 'Workspace',
      roomPosition: state === 'Idle' ? `lounge-seat-${index + 1}` : POSITIONS[state],
      state,
      currentTask: busy ? `Task #${index + 1}` : '',
      recentActivity: '',
      activity: busy ? ['Writing the release notes', 'Reviewing a pull request', 'Replying on Telegram'][index % 3] : '',
      seat: index + 1,
      provenance: 'harness',
      freshness: 'live',
    }
  })
}

/** Fixed camera: the layout's ~55° view at its target, backed off for narrow windows. */
function FixedCamera({ layout }: { layout: OfficeLayout }) {
  const { camera, size } = useThree()
  useEffect(() => {
    const [tx, ty, tz] = layout.camera.target
    const [ox, oy, oz] = layout.camera.offset
    const back = Math.max(1, 1.2 / (size.width / Math.max(size.height, 1)))
    camera.position.set(tx + ox * back, ty + oy * back, tz + oz * back)
    camera.lookAt(tx, ty, tz)
  }, [camera, layout, size.width, size.height])
  return null
}

function SceneOnly() {
  const layout = useMemo(() => createLayout(count), [])
  const occupied = params.get('occupied')
  const occupiedRooms = occupied === null ? undefined : occupied.split(',').filter(Boolean) as RoomId[]
  const [link, setLink] = useState('')
  return <div style={{ height: '100%', position: 'relative' }}>
    <Canvas shadows dpr={[1, 2]} camera={{ fov: 40, near: 0.5, far: 300 }} gl={{ antialias: true }}>
      <Lighting theme={theme} layout={layout}/>
      <FixedCamera layout={layout}/>
      <Environment night={theme === 'dark'} layout={layout} occupiedRooms={occupiedRooms} onNavigate={setLink}/>
      {layout.desks.map((position, index) => <WorkDesk key={index} position={position} active={index % 6 < 2}/>)}
    </Canvas>
    <output style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', font: '12px monospace', left: 8, padding: '4px 8px', position: 'absolute', top: 8 }}>
      n={count} theme={theme}{link && ` · navigate ${link}`}
    </output>
  </div>
}

const Office3D = lazy(() => import('../src/pages/Office3D.tsx'))

function WithOffice() {
  const [stations] = useState(() => sampleStations(count))
  return <Suspense fallback={null}>
    <Office3D stations={stations} onSelect={(station) => console.info('select', station.id)}/>
  </Suspense>
}

createRoot(document.getElementById('root')!).render(<StrictMode>{params.get('scene') === 'env' ? <SceneOnly/> : <WithOffice/>}</StrictMode>)
