import { useMemo } from 'react'
import * as THREE from 'three'
import type { OfficeLayout } from '../office3d-layout.ts'

/**
 * Day in the light theme; evening in the dark theme, when the lamps in the scene switch on.
 * The sun's shadow volume and the fog are fitted to the layout, which grows with the crew.
 */
export function Lighting({ theme, layout }: { theme: 'dark' | 'light'; layout: OfficeLayout }) {
  const day = theme === 'light'
  const { pan } = layout
  const centerX = (pan.minX + pan.maxX) / 2
  const centerZ = (pan.minZ + pan.maxZ) / 2
  // Half the diagonal of the grounds: the shadow camera is square and covers it at any light angle.
  const radius = Math.hypot(pan.maxX - pan.minX, pan.maxZ - pan.minZ) / 2 + 2
  const target = useMemo(() => new THREE.Object3D(), [])
  target.position.set(centerX, 0, centerZ)
  const distance = Math.hypot(...layout.camera.offset)
  const background = day ? '#bfe0ef' : '#1a2335'
  const near = distance + radius * 1.3
  return <>
    <color attach="background" args={[background]}/>
    <fog attach="fog" args={[background, near, near + 45]}/>
    <hemisphereLight args={[day ? '#fff4e0' : '#7f95bd', day ? '#5d7a4c' : '#1e2620', day ? 1.1 : 0.32]}/>
    <primitive object={target}/>
    <directionalLight target={target} position={[centerX + 10, 16, centerZ + 9]} intensity={day ? 2.4 : 0.75} color={day ? '#fff1d6' : '#ff9a5a'} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-camera-left={-radius} shadow-camera-right={radius} shadow-camera-top={radius} shadow-camera-bottom={-radius} shadow-camera-far={radius * 2 + 40}/>
    <ambientLight intensity={day ? 0.35 : 0.14} color={day ? '#ffffff' : '#8fa4d8'}/>
  </>
}
