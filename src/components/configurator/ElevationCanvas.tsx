import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Html, useGLTF } from '@react-three/drei';
import { Suspense, useMemo, useRef, useEffect, useCallback, useState } from 'react';
import * as THREE from 'three';
import { Plan, resolveStairGeometry, ensureGarageDoors, applySmartRotations } from '@/lib/floorplan';
import { Material, RoofType, AddOn } from '@/store/configurator';
import { Furniture3D } from './Furniture3D';
import { SceneLighting } from './SceneLighting';
import { SkyEnvironment, EnhancedGround } from './SkyEnvironment';
import { Eye, EyeOff } from 'lucide-react';
import {
  createWoodFloorTexture, createWoodFloorNormal, createWoodFloorRoughness,
  createOakFloorTexture, createOakFloorNormal, createOakFloorRoughness,
  createTileTexture, createTileNormal, createTileRoughness,
  createMarbleTexture, createMarbleRoughness,
  createWallTexture, createWallNormal,
  createDoorWoodTexture, createDoorWoodNormal,
} from './materials';

const isStaircaseRoom = (room: Plan['rooms'][number]) => room.type === 'staircase' || room.id.toLowerCase().includes('staircase') || room.label.toLowerCase().includes('staircase');

interface Props {
  plan: Plan;
  roof: RoofType;
  material: Material;
  addons?: AddOn[];
  activeRoom?: string | null;
  isDoubleStorey?: boolean;
  firstFloorPlan?: Plan;
  hideHelpers?: boolean;
  isNight?: boolean;
  activeFloor?: number;
  interiorMode?: boolean;
  garageShutterOpen?: boolean;
}

const PLOT_PADDING_FT = 2;

const roomMatchesActiveTab = (room: Plan['rooms'][number], activeRoom?: string | null) => {
  if (!activeRoom || activeRoom === 'overview') return false;
  if (activeRoom === 'garden') return room.type === 'garden' || room.type === 'carport';
  if (activeRoom === 'living') return room.type === 'living' || room.type === 'hallway';
  return room.id === activeRoom || room.type === activeRoom;
};

/* Locate the main entrance door in world coords (centered on plan).
   Returns { x, z, nx, nz } where (nx, nz) is the outward normal. */
const findMainDoorWorld = (plan: Plan): { x: number; z: number; nx: number; nz: number } | null => {
  const W = plan.width || 0;
  const D = plan.height || 0;
  const candidates: { x: number; z: number; nx: number; nz: number; roomType: string }[] = [];
  for (const room of plan.rooms || []) {
    if (room.type === 'garden' || room.type === 'carport' || room.type === 'balcony' || room.type === 'hallway' || room.type === 'staircase') continue;
    for (const door of room.doors || []) {
      const isMain = (door.label as unknown as string) === 'MAIN DOOR' || (!(door.connectsTo as unknown) && (door.doorType as unknown as string) !== 'open');
      if (!isMain) continue;
      const rel = (door.position as unknown as number) ?? 0.5;
      let x = 0, z = 0, nx = 0, nz = 0;
      if (door.wall === 'top') { x = room.x + room.w * rel; z = room.y; nz = -1; }
      else if (door.wall === 'bottom') { x = room.x + room.w * rel; z = room.y + room.h; nz = 1; }
      else if (door.wall === 'left') { x = room.x; z = room.y + room.h * rel; nx = -1; }
      else { x = room.x + room.w; z = room.y + room.h * rel; nx = 1; }
      candidates.push({ x: x - W / 2, z: z - D / 2, nx, nz, roomType: room.type });
    }
  }
  // Selection priority: 'hall' > 'living' > others
  return candidates.find(c => c.roomType === 'hall') || candidates.find(c => c.roomType === 'living') || candidates[0] || null;
};

/* Determine which side of the carport opens outward (away from the rest of the house). */
type Side = 'top' | 'bottom' | 'left' | 'right';
const getCarportInfo = (plan: Plan): { cx: number; cz: number; w: number; h: number; side: Side } | null => {
  const c = (plan.rooms || []).find((r) => r.type === 'carport');
  if (!c) return null;
  const W = plan.width || 0;
  const D = plan.height || 0;
  const main = (plan.rooms || []).filter((r) => r.type !== 'carport' && r.type !== 'garden' && r.type !== 'balcony' && r.type !== 'garage');
  if (main.length === 0) return null;
  const mMinX = Math.min(...main.map((r) => r.x));
  const mMaxX = Math.max(...main.map((r) => r.x + r.w));
  const mMinZ = Math.min(...main.map((r) => r.y));
  const mMaxZ = Math.max(...main.map((r) => r.y + r.h));
  const mcx = (mMinX + mMaxX) / 2;
  const mcz = (mMinZ + mMaxZ) / 2;
  const ccx = c.x + c.w / 2;
  const ccz = c.y + c.h / 2;
  const dx = ccx - mcx;
  const dz = ccz - mcz;
  let side: Side;
  if (Math.abs(dx) > Math.abs(dz)) side = dx > 0 ? 'right' : 'left';
  else side = dz > 0 ? 'bottom' : 'top';
  return { cx: ccx - W / 2, cz: ccz - D / 2, w: c.w, h: c.h, side };
};

/* Rectangle on the ground (XZ plane). */
type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
const pointInRect = (x: number, z: number, r: Rect, pad = 0) =>
  x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;
const pointInAnyRect = (x: number, z: number, rects: Rect[], pad = 0) => rects.some(r => pointInRect(x, z, r, pad));

const MATERIAL_COLORS: Record<Material, { wall: string; trim: string; roof: string; window: string; door: string; accent: string; facade: string; rod: string }> = {
  budget: { wall: '#f7f7f5', trim: '#8a8478', roof: '#2e4a62', window: '#b8ddec', door: '#b5835a', accent: '#9a8a78', facade: '#d4cbb8', rod: '#4682B4' },
  modern: { wall: '#f7f7f5', trim: '#1a1a1a', roof: '#2c2c2c', window: '#a8d4e6', door: '#2a2a2a', accent: '#3a3a3a', facade: '#e2dbd0', rod: '#1a1a1a' },
  luxury: { wall: '#f7f7f5', trim: '#c9a84c', roof: '#0d0d0d', window: '#7ab0c8', door: '#8b6914', accent: '#6a4a1a', facade: '#2a2520', rod: '#c9a84c' },
};

const CameraController = ({ activeRoom, plan, firstFloorPlan, activeFloor, isDoubleStorey, interiorMode = false }: { 
  activeRoom?: string | null, 
  plan: Plan,
  firstFloorPlan?: Plan,
  activeFloor: number,
  isDoubleStorey: boolean,
  interiorMode?: boolean,
}) => {
  const currentPlan = (isDoubleStorey && activeFloor === 1 && firstFloorPlan) ? firstFloorPlan : plan;
  const W = currentPlan.width || 0;
  const D = currentPlan.height || 0;
  const levelY = (isDoubleStorey && activeFloor === 1) ? 14 : 0;
  const prevRoom = useRef<string | null | undefined>(null);
  const animProgress = useRef(1);
  const targetPos = useRef(new THREE.Vector3(45, 25, 45));
  const targetLookAt = useRef(new THREE.Vector3(0, 0, 0));

  useEffect(() => {
    if (activeRoom !== prevRoom.current) {
      prevRoom.current = activeRoom;
      animProgress.current = 0; 

      if (!activeRoom || activeRoom === 'overview' || activeRoom === 'garden') {
        const door = findMainDoorWorld(plan);
        if (door) {
          const dist = Math.max(55, Math.max(plan.width || 40, plan.height || 40) * 1.4);
          const offsetX = door.nz !== 0 ? dist * 0.7 : 0;
          const offsetZ = door.nx !== 0 ? dist * 0.7 : 0;
          targetPos.current.set(door.nx * dist + offsetX, 25 + levelY, door.nz * dist + offsetZ);
          targetLookAt.current.set(0, levelY, 0);
        } else {
          targetPos.current.set(55, 35 + levelY, 55);
          targetLookAt.current.set(0, levelY, 0);
        }
      } else {
        const rs = (currentPlan.rooms || []).filter(r => roomMatchesActiveTab(r, activeRoom));
        if (rs.length > 0) {
          const avgX = rs.reduce((sum, r) => sum + r.x + r.w / 2, 0) / rs.length;
          const avgY = rs.reduce((sum, r) => sum + r.y + r.h / 2, 0) / rs.length;
          
          // Offset based on which plan we are using
          let offsetX = 0;
          let offsetZ = 0;
          if (isDoubleStorey && activeFloor === 1 && firstFloorPlan) {
             offsetX = -plan.width / 2 + (plan.width - firstFloorPlan.width) / 2;
             offsetZ = -plan.height / 2 + (plan.height - firstFloorPlan.height) / 2;
          } else {
             offsetX = -W / 2;
             offsetZ = -D / 2;
          }

          const center = new THREE.Vector3(avgX + offsetX, levelY, avgY + offsetZ);

          const minX = Math.min(...rs.map(r => r.x));
          const maxX = Math.max(...rs.map(r => r.x + r.w));
          const minY = Math.min(...rs.map(r => r.y));
          const maxY = Math.max(...rs.map(r => r.y + r.h));
          const extent = Math.max(maxX - minX, maxY - minY);

          if (interiorMode && !isDoubleStorey) {
            const camDistance = Math.max(4.5, extent * 0.75);
            targetPos.current.set(center.x + camDistance, levelY + 6.5, center.z + camDistance);
          } else {
            const height = Math.max(40, extent * 2) + levelY;
            targetPos.current.set(center.x, height, center.z);
          }
          targetLookAt.current.copy(center);
        }
      }
    }
  }, [activeRoom, currentPlan, W, D, levelY, isDoubleStorey, activeFloor, firstFloorPlan, plan, interiorMode]);

  useFrame((state, delta) => {
    if (animProgress.current >= 1) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const controls = state.controls as any;
    if (!controls) return;

    animProgress.current = Math.min(1, animProgress.current + delta * 2.5);
    const t = animProgress.current;
    const ease = 1 - Math.pow(1 - t, 3);

    state.camera.position.lerp(targetPos.current, ease * 0.15);
    controls.target.lerp(targetLookAt.current, ease * 0.15);
  });

  return null;
};

const PottedPlant = ({ position, scale = 1 }: { position: [number, number, number], scale?: number }) => {
  const flowerColors = useMemo(() => ["#ff5555", "#ffaa55", "#ffcc00", "#ff66cc", "#9966ff"], []);
  const color = useMemo(() => flowerColors[Math.floor(Math.random() * flowerColors.length)], [flowerColors]);

  return (
    <group position={position} scale={scale}>
      {/* Architectural Ceramic Pot */}
      <group position={[0, 0.4, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.6, 0.45, 0.8, 24]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.3} metalness={0.6} />
        </mesh>
        {/* Pot Rim Detailing */}
        <mesh position={[0, 0.36, 0]} castShadow>
          <cylinderGeometry args={[0.68, 0.62, 0.12, 24]} />
          <meshStandardMaterial color="#222222" roughness={0.2} metalness={0.7} />
        </mesh>
      </group>

      {/* Lush Foliage & Detailed Flowers */}
      <group position={[0, 0.8, 0]}>
        {/* Foundation Bush */}
        <mesh position={[0, 0.3, 0]} castShadow>
          <sphereGeometry args={[0.65, 16, 12]} />
          <meshStandardMaterial color="#2d5a27" roughness={0.9} />
        </mesh>
        
        {/* Individual Flower Stems and Blossoms */}
        {Array.from({ length: 6 }).map((_, i) => {
          const ang = i * (Math.PI * 2 / 6);
          const r = 0.35 + Math.sin(i * 1.5) * 0.1;
          const h = 0.4 + Math.cos(i * 0.8) * 0.2;
          return (
            <group key={i} position={[Math.cos(ang) * r, 0.2, Math.sin(ang) * r]}>
              {/* Thin Stem */}
              <mesh position={[0, h/2, 0]}>
                <cylinderGeometry args={[0.015, 0.015, h, 6]} />
                <meshStandardMaterial color="#1b3b1b" />
              </mesh>
              {/* Multi-layered Blossom - Petal based */}
              <group position={[0, h, 0]}>
                {/* 5 Petals arranged in a cup */}
                {Array.from({ length: 5 }).map((__, pi) => {
                  const pAng = (pi / 5) * Math.PI * 2;
                  return (
                    <mesh key={pi} rotation={[0.4, pAng, 0]} position={[Math.cos(pAng) * 0.08, 0, Math.sin(pAng) * 0.08]}>
                      <boxGeometry args={[0.18, 0.22, 0.01]} />
                      <meshStandardMaterial color={flowerColors[i % flowerColors.length]} roughness={0.4} side={THREE.DoubleSide} />
                    </mesh>
                  );
                })}
                {/* Yellow center stamen */}
                <mesh position={[0, 0.05, 0]}>
                  <sphereGeometry args={[0.06, 6, 6]} />
                  <meshStandardMaterial color="#ffcc00" emissive="#ffcc00" emissiveIntensity={0.5} />
                </mesh>
              </group>
            </group>
          );
        })}
      </group>
    </group>
  );
};

const Staircase3D = ({ 
  w: roomW, 
  h: roomH, 
  floorHeight, 
  isNight, 
  orientation = 0, 
  isMirrored = false,
  roomX = 0,
  roomY = 0,
  planWidth = 0,
  planHeight = 0,
  landingSize: landingSizeProp
}: { 
  w: number
  h: number
  floorHeight: number
  isNight: boolean
  orientation?: number
  isMirrored?: boolean
  roomX?: number
  roomY?: number
  planWidth?: number
  planHeight?: number
  landingSize?: number
}) => {
  const marbleTextures = useMemo(() => ({
    map: createMarbleTexture(1, 1),
    roughness: createMarbleRoughness(1, 1),
  }), []);

  // Swap dimensions for rotated orientations (90/270 degrees)
  // to ensure the 3D geometry matches the 2D footprint after the group rotation is applied.
  const isRotated = (orientation || 0) % 2 !== 0;
  const w = isRotated ? roomH : roomW;
  const h = isRotated ? roomW : roomH;

  const firstFlightCount = 9;
  const secondFlightCount = 9;
  const stepH = floorHeight / (firstFlightCount + secondFlightCount);
  const landingSize = landingSizeProp ?? Math.min(w, h) * 0.45;
  
  // Railing constants
  const rH = 3.2; 
  const postR = 0.06;

  return (
    <group scale={[isMirrored ? -1 : 1, 1, 1]}>
      <group rotation={[0, -orientation * Math.PI / 2, 0]}>
        {/* Flight 1 (Along Z axis, leading to landing) */}
        {Array.from({ length: firstFlightCount }).map((_, i) => {
          const stepW = landingSize;
          const stepL = (h - landingSize) / firstFlightCount;
          const posX = -w/2 + landingSize/2;
          const posZ = h/2 - i * stepL - stepL/2;
          const posY = i * stepH + stepH/2;
          return (
            <group key={`f1-step-${i}`} position={[posX, posY, posZ]}>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[stepW, 0.25, stepL]} />
                <meshStandardMaterial color="#ffffff" map={marbleTextures.map} roughnessMap={marbleTextures.roughness} roughness={0.05} metalness={0.2} envMapIntensity={2} />
              </mesh>
              <mesh position={[0, -stepH/2, 0]}>
                <boxGeometry args={[stepW - 0.2, stepH, 0.1]} />
                <meshStandardMaterial color="#d0d0d0" roughness={0.4} />
              </mesh>
              {isNight && i % 3 === 0 && <pointLight position={[0, -0.2, 0]} intensity={0.4} distance={3} color="#fff5e0" />}
            </group>
          );
        })}

        {/* Landing — flush with last step of flight 1 */}
        <group position={[-w/2 + landingSize/2, firstFlightCount * stepH, -h/2 + landingSize/2]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[landingSize, 0.25, landingSize]} />
            <meshStandardMaterial color="#ffffff" map={marbleTextures.map} roughnessMap={marbleTextures.roughness} roughness={0.05} metalness={0.2} envMapIntensity={2} />
          </mesh>
          <mesh position={[0, -stepH * 0.5, 0]}>
            <boxGeometry args={[landingSize - 0.2, stepH, landingSize - 0.2]} />
            <meshStandardMaterial color="#c0c0c0" roughness={0.5} />
          </mesh>
        </group>

        {/* Flight 2 (Along X axis, leaving landing) */}
        {Array.from({ length: secondFlightCount }).map((_, i) => {
          const stepW = (w - landingSize) / secondFlightCount;
          const stepL = landingSize;
          const posX = -w/2 + landingSize + i * stepW + stepW/2;
          const posZ = -h/2 + landingSize/2;
          const posY = (firstFlightCount + i) * stepH + stepH/2;
          return (
            <group key={`f2-step-${i}`} position={[posX, posY, posZ]}>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[stepW, 0.25, stepL]} />
                <meshStandardMaterial color="#ffffff" map={marbleTextures.map} roughnessMap={marbleTextures.roughness} roughness={0.05} metalness={0.2} envMapIntensity={2} />
              </mesh>
              <mesh rotation={[0, Math.PI/2, 0]} position={[0, -stepH/2, 0]}>
                <boxGeometry args={[stepL - 0.2, stepH, 0.1]} />
                <meshStandardMaterial color="#d0d0d0" roughness={0.4} />
              </mesh>
              {isNight && i % 3 === 0 && <pointLight position={[0, -0.2, 0]} intensity={0.4} distance={3} color="#fff5e0" />}
            </group>
          );
        })}

        {/* Railings */}
        {/* Flight 1 Inner Handrail (Walnut Wood) */}
        {Array.from({ length: firstFlightCount }).map((_, i) => {
          const stepL = (h - landingSize) / firstFlightCount;
          const posY = (i + 1) * stepH + rH;
          return (
            <mesh key={`f1-r-out-${i}`} position={[-w/2 + landingSize - 0.15, posY, h/2 - i * stepL - stepL/2]}>
              <boxGeometry args={[0.08, 0.08, stepL + 0.1]} />
              <meshStandardMaterial color="#5c4033" roughness={0.3} />
            </mesh>
          );
        })}
        {/* Flight 1 Inner Spindles (Black Steel) */}
        {Array.from({ length: firstFlightCount }).map((_, i) => {
          const stepL = (h - landingSize) / firstFlightCount;
          const spindleH = rH;
          const posY = i * stepH + 0.125 + spindleH/2;
          return (
            <mesh key={`f1-spindle-${i}`} position={[-w/2 + landingSize - 0.15, posY, h/2 - i * stepL - stepL/2]}>
              <cylinderGeometry args={[0.015, 0.015, spindleH, 8]} />
              <meshStandardMaterial color="#222222" metalness={0.8} roughness={0.2} />
            </mesh>
          );
        })}

        {/* Flight 2 Inner Handrail (Walnut Wood) */}
        {Array.from({ length: secondFlightCount }).map((_, i) => {
          const stepW = (w - landingSize) / secondFlightCount;
          const posY = (firstFlightCount + i + 1) * stepH + rH;
          return (
            <mesh key={`f2-r-out-${i}`} position={[-w/2 + landingSize + i * stepW + stepW/2, posY, -h/2 + landingSize - 0.15]}>
              <boxGeometry args={[stepW + 0.1, 0.08, 0.08]} />
              <meshStandardMaterial color="#5c4033" roughness={0.3} />
            </mesh>
          );
        })}
        {/* Flight 2 Inner Spindles (Black Steel) */}
        {Array.from({ length: secondFlightCount }).map((_, i) => {
          const stepW = (w - landingSize) / secondFlightCount;
          const spindleH = rH;
          const posY = (firstFlightCount + i) * stepH + 0.125 + spindleH/2;
          return (
            <mesh key={`f2-spindle-${i}`} position={[-w/2 + landingSize + i * stepW + stepW/2, posY, -h/2 + landingSize - 0.15]}>
              <cylinderGeometry args={[0.015, 0.015, spindleH, 8]} />
              <meshStandardMaterial color="#222222" metalness={0.8} roughness={0.2} />
            </mesh>
          );
        })}

        {/* Premium Handrail Posts */}
        {/* Post 1: Bottom of Flight 1 */}
        <mesh position={[-w/2 + landingSize - 0.15, rH/2, h/2]}>
          <cylinderGeometry args={[postR, postR, rH + stepH, 8]} />
          <meshStandardMaterial color="#5c4033" roughness={0.3} />
        </mesh>
        {/* Post 2: Landing Corner Intersection */}
        <mesh position={[-w/2 + landingSize - 0.15, firstFlightCount * stepH + rH/2, -h/2 + landingSize - 0.15]}>
          <cylinderGeometry args={[postR, postR, rH, 8]} />
          <meshStandardMaterial color="#5c4033" roughness={0.3} />
        </mesh>
        {/* Post 3: Top of Flight 2 */}
        <mesh position={[w/2 - 0.1, floorHeight + rH/2, -h/2 + landingSize - 0.15]}>
          <cylinderGeometry args={[postR, postR, rH, 8]} />
          <meshStandardMaterial color="#5c4033" roughness={0.3} />
        </mesh>
      </group>
    </group>
  );
};


const BlackStonePathway = ({ doorPos, plotW, plotD, isNight = false }: { doorPos: { x: number, z: number, nx: number, nz: number }, plotW: number, plotD: number, isNight?: boolean }) => {
  const marbleTextures = useMemo(() => ({
    map: createMarbleTexture(1, 1),
    roughness: createMarbleRoughness(1, 1),
  }), []);

  const elements = useMemo(() => {
    const items = [];
    const stoneColor = '#1a1a1a'; // Deep black marble base
    const count = 7;
    const pathWidth = 6.4;
    const stepLength = 2.6;
    const gap = 0.5;

    const isVerticalWall = doorPos.nx !== 0;
    const rotationZ = isVerticalWall ? Math.PI / 2 : 0;
    const px = -doorPos.nz;
    const pz = doorPos.nx;

    for (let i = 0; i < count; i++) {
      const dist = 5.8 + i * (stepLength + gap);
      const x = doorPos.x + doorPos.nx * dist;
      const z = doorPos.z + doorPos.nz * dist;
      
      // Luxury Marble Steps
      items.push(
        <mesh key={`stone-${i}`} position={[x, 0.08, z]} rotation={[-Math.PI / 2, 0, rotationZ]} receiveShadow castShadow>
          <boxGeometry args={[pathWidth, stepLength, 0.25]} />
          <meshStandardMaterial 
            color="#0a0a0a"
            map={marbleTextures.map} 
            roughnessMap={marbleTextures.roughness}
            roughness={0.08}
            metalness={0.55}
            envMapIntensity={4}
          />
        </mesh>
      );

      if (isNight) {
        items.push(
          <mesh key={`edge-${i}`} position={[x + px * (pathWidth / 2 + 0.15), 0.05, z + pz * (pathWidth / 2 + 0.15)]}>
            <boxGeometry args={isVerticalWall ? [0.04, 0.04, stepLength + 0.1] : [stepLength + 0.1, 0.04, 0.04]} />
            <meshBasicMaterial color="#c9a84c" toneMapped={false} />
          </mesh>
        );
      }

      // Potted Plants - Restrict from being inside the fence
      if (i % 2 === 0 && i < count - 1) {
        const sideDist = pathWidth / 2 + 1.8;
        
        const posL: [number, number, number] = [x + px * sideDist, 0, z + pz * sideDist];
        const posR: [number, number, number] = [x - px * sideDist, 0, z - pz * sideDist];

        const isInside = (p: [number, number, number]) => 
          Math.abs(p[0]) < plotW / 2 - 0.5 && Math.abs(p[2]) < plotD / 2 - 0.5;

        if (!isInside(posL)) {
          items.push(<PottedPlant key={`plant-l-${i}`} position={posL} scale={0.85 + Math.random() * 0.15} />);
        }
        if (!isInside(posR)) {
          items.push(<PottedPlant key={`plant-r-${i}`} position={posR} scale={0.85 + Math.random() * 0.15} />);
        }
      }
    }

    // Grand Marble Landing Platform
    items.unshift(
      <mesh key="landing" position={[doorPos.x + doorPos.nx * 2.6, 0.12, doorPos.z + doorPos.nz * 2.6]} rotation={[-Math.PI / 2, 0, rotationZ]} receiveShadow castShadow>
        <boxGeometry args={[pathWidth + 2.2, 5, 0.35]} />
        <meshStandardMaterial 
          color="#111111" 
          map={marbleTextures.map} 
          roughnessMap={marbleTextures.roughness}
          roughness={0.1} 
          metalness={0.5} 
          envMapIntensity={3}
        />
      </mesh>
    );
    return items;
  }, [doorPos, marbleTextures, plotD, plotW]);

  return <group>{elements}</group>;
};

export const ElevationCanvas = ({ 
  plan, roof, material, addons = [], activeRoom, isDoubleStorey = false, 
  activeFloor, firstFloorPlan, hideHelpers = false, isNight = false, interiorMode = false, garageShutterOpen = false 
}: Props) => {
  const ensuredPlan = useMemo(() => {
    const p = ensureGarageDoors(plan);
    p.rooms = p.rooms.map(room => {
      if (room.furniture) {
        return { ...room, furniture: applySmartRotations(room.furniture, room.w, room.h) };
      }
      return room;
    });
    return p;
  }, [plan]);
  const ensuredFirstFloorPlan = useMemo(() => firstFloorPlan ? ensureGarageDoors(firstFloorPlan) : undefined, [firstFloorPlan]);
  const [showLabels, setShowLabels] = useState(false);

  const currentFloor = activeFloor ?? 2;
  const hideRoof = isDoubleStorey ? currentFloor !== 2 : interiorMode;
  const safeW = ensuredPlan.width || 0;
  const safeD = ensuredPlan.height || 0;
  const plotW = safeW + PLOT_PADDING_FT * 2;
  const plotD = safeD + PLOT_PADDING_FT * 2;
  const mainDoor = useMemo(() => findMainDoorWorld(ensuredPlan), [ensuredPlan]);
  const gateConfig = useMemo(() => {
    const hw = plotW / 2;
    const hd = plotD / 2;
    const gPos = Math.max(0.1, Math.min(0.9, ensuredPlan.plotEntranceX ?? 0.5));
    
    // Default fallback
    const defaultGate = { x: -hw + gPos * plotW, z: hd, side: 'bottom' as Side };

    if (!mainDoor) return defaultGate;

    // "Focusing main door" means aligning with it.
    // We place the gate on the side the main door faces, at its X/Z coordinate.
    if (mainDoor.nz === -1) return { x: mainDoor.x, z: -hd, side: 'top' as Side };
    if (mainDoor.nz === 1) return { x: mainDoor.x, z: hd, side: 'bottom' as Side };
    if (mainDoor.nx === -1) return { x: -hw, z: mainDoor.z, side: 'left' as Side };
    if (mainDoor.nx === 1) return { x: hw, z: mainDoor.z, side: 'right' as Side };

    return defaultGate;
  }, [mainDoor, ensuredPlan.plotEntranceX, plotW, plotD]);

  const carportInfo = useMemo(() => getCarportInfo(ensuredPlan), [ensuredPlan]);

  const gates = useMemo(() => {
    const list = [{ ...gateConfig, isCarGate: false }];
    if (addons.includes('carport') && carportInfo) {
      // Add a wide car gate in front of the carport
      const hw = plotW / 2;
      const hd = plotD / 2;
      const side = gateConfig.side;
      let gx = carportInfo.cx;
      let gz = hd;
      if (side === 'top') gz = -hd;
      else if (side === 'bottom') gz = hd;
      else if (side === 'left') { gx = -hw; gz = carportInfo.cz; }
      else if (side === 'right') { gx = hw; gz = carportInfo.cz; }
      
      list.push({ x: gx, z: gz, side, isCarGate: true });
    }
    return list;
  }, [gateConfig, carportInfo, addons, plotW, plotD]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl bg-gradient-to-b from-[hsl(210,35%,22%)] to-[hsl(210,30%,12%)]">
      <div className="absolute inset-0 w-full h-full">
        <Canvas
          shadows="soft"
          style={{ width: '100%', height: '100%', display: 'block' }}
        camera={{
          position: [60, 40, 60],
          fov: 38,
          near: 0.1,
          far: 1000
        }}
        dpr={[1, 2]}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: isNight ? 0.9 : 1.15,
          outputColorSpace: THREE.SRGBColorSpace,
          powerPreference: 'high-performance',
        }}
      >
        <Suspense fallback={
          <Html center>
            <div style={{ color: '#fff', fontSize: 12, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', opacity: 0.6 }}>Loading 3D…</div>
          </Html>
        }>
          {/* Premium Lighting System */}
          <SceneLighting isNight={isNight} hideRoof={!!hideRoof} />
          
          {/* Sky & Environment */}
          <SkyEnvironment isNight={isNight} />
          <EnhancedGround isNight={isNight} />
          {addons.includes('landscaping') && <GrassField planW={safeW} planD={safeD} />}
          
          {/* Ground Floor Model */}
          <House plan={ensuredPlan} roof={roof} material={material} activeRoom={activeRoom} addons={addons} isNight={isNight} hideRoof={hideRoof} plotW={plotW} plotD={plotD} isDoubleStorey={isDoubleStorey} showLabels={showLabels} garageShutterOpen={garageShutterOpen} />
          
          {/* Second Floor (Double Storey) */}
          {isDoubleStorey && ensuredFirstFloorPlan && currentFloor !== 0 && (
            <SecondFloor plan={ensuredPlan} firstFloorPlan={ensuredFirstFloorPlan} roof={roof} material={material} activeRoom={activeRoom} addons={addons} hideRoof={hideRoof} isNight={isNight} showLabels={showLabels} garageShutterOpen={garageShutterOpen} />
          )}
          
          
          {addons.includes('carport') && <Carport plan={ensuredPlan} plotW={plotW} plotD={plotD} gateSide={gateConfig.side} />}
          {ensuredPlan.rooms.some(r => r.type === 'garage') && (
            <GarageDriveway plan={ensuredPlan} plotW={plotW} plotD={plotD} isNight={isNight} />
          )}

          {addons.includes('landscaping') && (() => {
            const corridors = computeCorridors(ensuredPlan, plotW, plotD, gateConfig.x, gateConfig.z, gateConfig.side);
            return (
              <>
                <FrontWalkway plan={ensuredPlan} gateX={gateConfig.x} plotD={plotD} />
                <Trees planW={plotW} planD={plotD} corridors={corridors} />
                <Bushes planW={plotW} planD={plotD} corridors={corridors} />
              </>
            );
          })()}
          {addons.includes('fence') && <FenceAround planW={plotW} planD={plotD} gates={gates} isNight={isNight} />}
          
          <CameraController activeRoom={activeRoom} plan={ensuredPlan} firstFloorPlan={ensuredFirstFloorPlan} activeFloor={currentFloor} isDoubleStorey={isDoubleStorey} interiorMode={interiorMode} />
          <ContactShadows position={[0, 0.02, 0]} opacity={isNight ? 0.28 : 0.32} scale={80} blur={2} far={40} />
          <OrbitControls
            makeDefault
            enablePan={true} enableZoom={true} enableRotate={true}
            minDistance={interiorMode && !isDoubleStorey ? 0.8 : 5}
            maxDistance={interiorMode && !isDoubleStorey ? 160 : 100}
            minPolarAngle={interiorMode && !isDoubleStorey ? 0.05 : 0}
            maxPolarAngle={interiorMode && !isDoubleStorey ? Math.PI - 0.05 : Math.PI / 2.1}
            autoRotate={!interiorMode && (!activeRoom || activeRoom === 'overview' || activeRoom === 'garden')} 
            autoRotateSpeed={0.35}
            enableDamping dampingFactor={0.03}
            screenSpacePanning={interiorMode && !isDoubleStorey}
          />

        </Suspense>
      </Canvas>
      </div>
      {!hideHelpers && (
        <div className="pointer-events-none absolute left-4 top-4 rounded-xl glass-panel px-3 py-2 text-[9px] font-display font-semibold uppercase tracking-[0.2em]">
          {interiorMode && !isDoubleStorey ? 'Interior mode · Drag to rotate · Scroll to zoom · Drag right button to pan' : activeRoom && activeRoom !== 'overview' ? 'Drag to rotate · Scroll to zoom · Free camera' : 'Drag to rotate · Scroll to zoom'}
        </div>
      )}
      <button
        onClick={() => setShowLabels(prev => !prev)}
        className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 backdrop-blur-md px-3.5 py-2 text-[10px] font-display font-semibold uppercase tracking-[0.2em] pointer-events-auto cursor-pointer transition-all duration-300 hover:bg-white/15 active:scale-95 text-white shadow-lg"
        style={{ fontFamily: 'inherit' }}
      >
        {showLabels ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        {showLabels ? 'Hide Labels' : 'Show Labels'}
      </button>
    </div>
  );
};

/* ─── Ground ─── */
const Ground = () => (
  <group>
    {/* Base terrain */}
    <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[300, 300]} />
      <meshStandardMaterial color="#2a4a2e" roughness={0.95} />
    </mesh>
    {/* Inner lawn (lighter green around house) */}
    <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
      <planeGeometry args={[120, 120]} />
      <meshStandardMaterial color="#345e38" roughness={0.92} />
    </mesh>
  </group>
);

const GrassField = ({ planW, planD }: { planW: number; planD: number }) => {
  const patches = useMemo(() => {
    const arr: { x: number; z: number; s: number; c: string }[] = [];
    const colors = ['#3d6b3d', '#2d5a2d', '#4a7a4a', '#3a6838', '#2e5530'];
    // Close patches for lush foundation planting look
    for (let i = 0; i < 40; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = planW * 0.4 + Math.random() * 8;
      arr.push({ x: Math.cos(angle) * dist, z: Math.sin(angle) * dist, s: 0.4 + Math.random() * 0.6, c: colors[i % colors.length] });
    }
    // Distant patches for depth
    for (let i = 0; i < 40; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 20 + Math.random() * 40;
      arr.push({ x: Math.cos(angle) * dist, z: Math.sin(angle) * dist, s: 0.3 + Math.random() * 0.5, c: colors[(i + 2) % colors.length] });
    }
    return arr;
  }, [planW]);
  return (
    <group>
      {patches.map((p, i) => (
        <mesh key={i} position={[p.x, 0.03, p.z]} rotation={[-Math.PI / 2, 0, Math.random() * Math.PI]}>
          <circleGeometry args={[p.s, 8]} />
          <meshStandardMaterial color={p.c} roughness={1} />
        </mesh>
      ))}
    </group>
  );
};

const round2 = (num: number) => Math.round(num * 100) / 100;


/* ─── Garden Area ─── */
interface GardenAreaProps {
  room: Plan['rooms'][number];
  W: number;
  D: number;
  isNight: boolean;
  mainDoorPos: { x: number; z: number; nx: number; nz: number } | null;
}

const GardenArea = ({ room: r, W, D, isNight, mainDoorPos }: GardenAreaProps) => {
  const cx = round2(r.x + r.w / 2 - W / 2);
  const cz = round2(r.y + r.h / 2 - D / 2);

  // Pathway "Forbidden Zone" detection
  const isPointInPathway = useCallback((px: number, pz: number) => {
    if (!mainDoorPos) return false;
    // Main pathway width is 6.4, we add 1.0 buffer for plants
    const buffer = 4.2;
    const dx = px - mainDoorPos.x;
    const dz = pz - mainDoorPos.z;
    
    // Project point onto pathway axis (nx, nz)
    const proj = dx * mainDoorPos.nx + dz * mainDoorPos.nz;
    // Distance from axis
    const perp = Math.abs(dx * (-mainDoorPos.nz) + dz * mainDoorPos.nx);
    
    // Pathway extends from door outwards. We clip anything within 'buffer' of the center line
    // and extending from door (proj > -1) outwards.
    return proj > -1.0 && perp < buffer;
  }, [mainDoorPos]);

  const extraGreenery = useMemo(() => {
    const hasPlants = r.furniture && r.furniture.length > 0;
    if (hasPlants && r.furniture.length >= 3) return [];

    const arr = [];
    const count = Math.max(3, Math.floor(r.w * r.h / 15));
    for (let i = 0; i < count; i++) {
      // High-variety floral distribution
      const types = ['flower_pot', 'flower_pot', 'flower_pot', 'tall_plant', 'flower_pot']; 
      const seed = (parseInt(r.id.replace(/\D/g, '') || '1') + i) * 1337;
      const pseudoRandom = (s: number) => {
        const x = Math.sin(s) * 10000;
        return x - Math.floor(x);
      };

      const rx = 1 + pseudoRandom(seed) * (r.w - 2);
      const ry = 1 + pseudoRandom(seed + 1) * (r.h - 2);
      
      const absX = round2(r.x + rx - W / 2);
      const absZ = round2(r.y + ry - D / 2);
      
      if (isPointInPathway(absX, absZ)) continue;

      arr.push({
        id: `auto-plant-${i}-${seed}`, // Provide stable ID for variant selection
        type: types[i % types.length],
        x: rx,
        y: ry,
        rotation: pseudoRandom(seed + 2) * Math.PI * 2,
        w: 1.5, h: 1.5
      });
    }
    return arr;
  }, [r.id, r.w, r.h, r.furniture, D, W, isPointInPathway, r.x, r.y]);

  return (
    <group>
      {/* Garden Bed - Soil & Grass (Slightly lower at 0.35 to sit BELOW the path at 0.2-0.5) */}
      <mesh receiveShadow position={[cx, 0.35, cz]}>
        <boxGeometry args={[r.w, 0.1, r.h]} />
        <meshStandardMaterial color="#3a2a1c" roughness={1} />
      </mesh>
      <mesh receiveShadow position={[cx, 0.41, cz]}>
        <boxGeometry args={[r.w - 0.2, 0.05, r.h - 0.2]} />
        <meshStandardMaterial color="#345e38" roughness={0.9} />
      </mesh>

      {/* Modern Stone Border - Rendered as 4 segments to allow clipping at doorway */}
      {[
        { p: [cx, 0.5, cz - r.h/2 - 0.2], a: [r.w + 0.4, 0.3, 0.4], id: 'top' },
        { p: [cx, 0.5, cz + r.h/2 + 0.2], a: [r.w + 0.4, 0.3, 0.4], id: 'bottom' },
        { p: [cx - r.w/2 - 0.2, 0.5, cz], a: [0.4, 0.3, r.h + 0.4], id: 'left' },
        { p: [cx + r.w/2 + 0.2, 0.5, cz], a: [0.4, 0.3, r.h + 0.4], id: 'right' },
      ].map((seg, i) => {
        // Skip border segment if it directly intersects the doorway path
        if (isPointInPathway(seg.p[0], seg.p[2])) return null;
        return (
          <group key={`border-${i}`}>
            <mesh position={seg.p as [number, number, number]}>
              <boxGeometry args={seg.a as [number, number, number]} />
              <meshStandardMaterial color="#5a554e" roughness={0.8} />
            </mesh>
            <mesh position={[seg.p[0], seg.p[1], seg.p[2]]}>
              <boxGeometry args={[seg.a[0] - 0.05, 0.4, seg.a[2] - 0.05]} />
              <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
            </mesh>
          </group>
        );
      })}

      {/* Plants & Pots */}
      <group position={[0, 0.42, 0]}>
        {[...(r.furniture || []), ...extraGreenery].map((f, fi: number) => {
          const fx = round2(r.x + f.x + (f.w || 1) / 2 - W / 2);
          const fz = round2(r.y + f.y + (f.h || 1) / 2 - D / 2);
          
          // Double check manual furniture too
          if (isPointInPathway(fx, fz)) return null;

          return (
            <group key={`gf-${fi}`} position={[fx, 0, fz]} rotation={[0, f.rotation || 0, 0]}>
              <Furniture3D item={f} isNight={isNight} />
            </group>
          );
        })}
      </group>
    </group>
  );
};

/* ─── Balcony ─── */
interface Balcony3DProps {
  room: Plan['rooms'][number];
  W: number;
  D: number;
  offsetX?: number;
  offsetZ?: number;
  isNight: boolean;
  floorY?: number;
}

const Balcony3D = ({ room, W, D, offsetX = 0, offsetZ = 0, isNight, floorY = 0 }: Balcony3DProps) => {
  const cx = round2(offsetX + room.x + room.w / 2 - W / 2);
  const cz = round2(offsetZ + room.y + room.h / 2 - D / 2);

  const tileTextures = useMemo(() => ({
    map: createTileTexture(4, 4),
    normal: createTileNormal(4, 4),
    rough: createTileRoughness(4, 4),
  }), []);

  const openWalls = room.openWalls || [];
  const rH = 3.2; // railing height
  const postR = 0.05; // steel post radius
  const rw = room.w;
  const rh = room.h;

  return (
    <group position={[cx, floorY, cz]}>
      {/* Floor Slab */}
      <mesh receiveShadow position={[0, 0.01, 0]}>
        <boxGeometry args={[rw, 0.25, rh]} />
        <meshStandardMaterial
          color="#d0d0c0"
          map={tileTextures.map}
          normalMap={tileTextures.normal}
          normalScale={new THREE.Vector2(0.3, 0.3)}
          roughnessMap={tileTextures.rough}
          roughness={0.6}
          metalness={0.1}
          envMapIntensity={0.8}
        />
      </mesh>
      
      {/* Furniture */}
      {room.furniture?.map((f, fi: number) => {
        const fx = f.x + (f.w || 1) / 2 - rw / 2;
        const fz = f.y + (f.h || 1) / 2 - rh / 2;
        return (
          <group key={`f-${fi}`} position={[fx, 0.13, fz]} rotation={[0, f.rotation ? f.rotation * Math.PI / 180 : 0, 0]}>
            <Furniture3D item={f} isNight={isNight} />
          </group>
        );
      })}

      {/* Railings */}
      {['top', 'bottom', 'left', 'right'].map((wallDir: 'top' | 'bottom' | 'left' | 'right') => {
        if (openWalls.includes(wallDir)) return null;
        
        const isHorizontal = wallDir === 'top' || wallDir === 'bottom';
        const len = isHorizontal ? rw : rh;
        const xPos = wallDir === 'left' ? -rw/2 : wallDir === 'right' ? rw/2 : 0;
        const zPos = wallDir === 'top' ? -rh/2 : wallDir === 'bottom' ? rh/2 : 0;
        const rotY = isHorizontal ? 0 : Math.PI / 2;

        return (
          <group key={wallDir} position={[xPos, 0.13, zPos]} rotation={[0, rotY, 0]}>
            {/* Base Upstand */}
            <mesh position={[0, 0.25, 0]} castShadow>
              <boxGeometry args={[len, 0.5, 0.2]} />
              <meshStandardMaterial color="#e0e0e0" roughness={0.8} />
            </mesh>
            
            {/* Glass Panel */}
            <mesh position={[0, 0.5 + (rH - 0.5)/2, 0]}>
              <boxGeometry args={[len - 0.2, rH - 0.5 - 0.12, 0.05]} />
              <meshPhysicalMaterial color="#a0c0d0" transmission={0.95} opacity={1} transparent roughness={0.1} metalness={0.1} clearcoat={1} side={THREE.DoubleSide} />
            </mesh>

            {/* Handrail on top */}
            <mesh position={[0, rH - 0.06, 0]}>
              <boxGeometry args={[len, 0.12, 0.15]} />
              <meshStandardMaterial color="#c0c0c0" metalness={0.9} roughness={0.15} />
            </mesh>

            {/* Steel Posts */}
            <mesh position={[-len/2 + 0.1, rH/2, 0]}>
              <cylinderGeometry args={[postR, postR, rH, 8]} />
              <meshStandardMaterial color="#c0c0c0" metalness={0.9} roughness={0.15} />
            </mesh>
            <mesh position={[len/2 - 0.1, rH/2, 0]}>
              <cylinderGeometry args={[postR, postR, rH, 8]} />
              <meshStandardMaterial color="#c0c0c0" metalness={0.9} roughness={0.15} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
};

/* ─── Main House Component ─── */
const House = ({ plan, roof, material, activeRoom, addons, isNight = false, hideRoof = false, plotW, plotD, isDoubleStorey = false, showLabels = true, garageShutterOpen = false }: {
  plan: Plan; roof: RoofType; material: Material; activeRoom?: string | null; addons: AddOn[]; isNight?: boolean; hideRoof?: boolean; plotW: number; plotD: number; isDoubleStorey?: boolean; showLabels?: boolean; garageShutterOpen?: boolean;
}) => {
  const roofType = isDoubleStorey ? 'flat' : roof;
  const colors = MATERIAL_COLORS[material];
  const W = plan.width;
  const D = plan.height;
  const wallH = 13;
  const t = 0.4; // Realistic wall thickness

  // PBR Floor Textures from materials factory
  const floorTextures = useMemo(() => ({
    walnut: createWoodFloorTexture(2, 2),
    walnutNormal: createWoodFloorNormal(2, 2),
    walnutRough: createWoodFloorRoughness(2, 2),
    oak: createOakFloorTexture(2, 2),
    oakNormal: createOakFloorNormal(2, 2),
    oakRough: createOakFloorRoughness(2, 2),
    tile: createTileTexture(4, 4),
    tileNormal: createTileNormal(4, 4),
    tileRough: createTileRoughness(4, 4),
    marble: createMarbleTexture(1.5, 1.5),
    marbleRough: createMarbleRoughness(1.5, 1.5),
  }), []);

  // Wall textures
  const wallTextures = useMemo(() => ({
    map: createWallTexture(3, 2),
    normal: createWallNormal(3, 2),
  }), []);

  // Door / panel wood textures
  const doorTextures = useMemo(() => ({
    map: createDoorWoodTexture(1, 2),
    normal: createDoorWoodNormal(1, 2),
  }), []);

  // 1. & 4. Compute exact bounding box for the structure
  const mainRooms = (plan.rooms || []).filter(r => r.type !== 'garden' && r.type !== 'carport' && r.type !== 'balcony' && r.type !== 'garage');
  const houseRooms = (plan.rooms || []).filter(r => r.type !== 'garden' && r.type !== 'carport' && r.type !== 'balcony');
  const minX = Math.min(...mainRooms.map(r => r.x));
  const maxX = Math.max(...mainRooms.map(r => r.x + r.w));
  const minZ = Math.min(...mainRooms.map(r => r.y));
  const maxZ = Math.max(...mainRooms.map(r => r.y + r.h));

  const roofW = round2(maxX - minX);
  const roofD = round2(maxZ - minZ);
  const roofCX = round2((minX + maxX) / 2 - W / 2);
  const roofCZ = round2((minZ + maxZ) / 2 - D / 2);

  // Detect carport position for blocking rod removal
  const carportRoom = (plan.rooms || []).find(r => r.type === 'carport');
  const hasCarport = !!carportRoom;
  const cpAtBottom = carportRoom && Math.abs(carportRoom.y + carportRoom.h - maxZ) < 1.0;
  const cpAtTop = carportRoom && Math.abs(carportRoom.y - minZ) < 1.0;
  const cpAtLeft = carportRoom && Math.abs(carportRoom.x - minX) < 1.0;
  const cpAtRight = carportRoom && Math.abs(carportRoom.x + carportRoom.w - maxX) < 1.0;

  // 6. Prevent Duplicate Walls & ensure no overlaps via a deduplication registry
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extractedWalls: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const addWall = (type: 'h'|'v', coord: number, start: number, end: number, doors: any[], windows: any[], height = wallH) => {
    coord = round2(coord);
    start = round2(start);
    end = round2(end);
    
    // Find overlapping wall segment with tolerance
    const existing = extractedWalls.find(w => w.type === type && Math.abs(w.coord - coord) < 0.2 && 
      (Math.max(w.start, start) <= Math.min(w.end, end) + 0.1));
    
    if (existing) {
      existing.start = Math.min(existing.start, start);
      existing.end = Math.max(existing.end, end);
      existing.height = Math.max(existing.height || wallH, height);
      // Dedup doors/windows by absPos so shared-wall openings (e.g., hallway↔room)
      // don't render twice when both rooms contribute the same wall segment.
      for (const d of doors) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!existing.doors.some((ed: any) => Math.abs((ed as any).absPos - (d as any).absPos) < 0.3)) {
          existing.doors.push(d);
        }
      }
      for (const w of windows) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!existing.windows.some((ew: any) => Math.abs((ew as any).absPos - (w as any).absPos) < 0.3)) {
          existing.windows.push(w);
        }
      }
    } else {
      extractedWalls.push({ type, coord, start, end, doors: [...doors], windows: [...windows], height });
    }
  };

  (plan.rooms || []).forEach(room => {
    // Only extract solid walls for enclosed rooms.
    // Hallways still need to participate so user-added walls (via "Add Wall")
    // facing exteriors / non-enclosed neighbors are rendered.
    // Dedup at the same coord merges with adjacent room walls automatically.
    if (room.type === 'garden' || room.type === 'carport' || room.type === 'balcony') return;

    const rX = room.x;
    const rY = room.y;
    const rW = room.w;
    const rH = room.h;

    // Detect accessible room types that should have open connections
    const isAccessibleType = ['hallway', 'staircase', 'living', 'kitchen', 'dining'].includes(room.type);
    const autoOpenWalls: ('top' | 'bottom' | 'left' | 'right')[] = [];
    if (isAccessibleType) {
      // Check each wall for adjacency to another accessible room
      const adjacentChecks: { wall: 'top' | 'bottom' | 'left' | 'right'; checkX: number; checkY: number; checkW: number; checkH: number }[] = [
        { wall: 'top', checkX: rX, checkY: rY - 0.2, checkW: rW, checkH: 0.2 },
        { wall: 'bottom', checkX: rX, checkY: rY + rH, checkW: rW, checkH: 0.2 },
        { wall: 'left', checkX: rX - 0.2, checkY: rY, checkW: 0.2, checkH: rH },
        { wall: 'right', checkX: rX + rW, checkY: rY, checkW: 0.2, checkH: rH },
      ];
      for (const { wall, checkX, checkY, checkW, checkH } of adjacentChecks) {
        const adjacentRoom = (plan.rooms || []).find(other => {
          if (other.id === room.id) return false;
          if (!['hallway', 'staircase', 'living', 'kitchen', 'dining'].includes(other.type)) return false;
          // Check overlap
          const overlapX = Math.max(0, Math.min(checkX + checkW, other.x + other.w) - Math.max(checkX, other.x));
          const overlapY = Math.max(0, Math.min(checkY + checkH, other.y + other.h) - Math.max(checkY, other.y));
          return overlapX > 0.5 && overlapY > 0.5;
        });
        if (adjacentRoom && !(room.openWalls || []).includes(wall)) {
          autoOpenWalls.push(wall);
        }
      }
    }

    // Merge explicit openWalls with auto-detected ones
    const effectiveOpenWalls = [...(room.openWalls || []), ...autoOpenWalls];

    // Convert relative doors/windows to absolute coordinates
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getAbsDoors = (wall: string) => (room.doors || []).filter((d:any) => d.wall === wall).map((d:any) => {
      let doorCategory: 'main' | 'room' | 'bathroom' = 'room';
      if (d.label === 'GARAGE DOOR') {
        // Garage doors keep 'room' category — height is handled specially in getDoorHeight
        doorCategory = 'room';
      } else if (d.label === 'MAIN DOOR' || (!d.connectsTo && d.doorType !== 'open')) {
        doorCategory = 'main';
      } else if (room.type === 'bathroom') {
        doorCategory = 'bathroom';
      } else {
        const connRoom = (plan.rooms || []).find(r => r.id === d.connectsTo);
        if (connRoom?.type === 'bathroom') doorCategory = 'bathroom';
      }
      return {
        ...d, doorCategory, roomType: room.type,
        absPos: (wall === 'top' || wall === 'bottom') ? rX + rW * d.position : rY + rH * d.position
      };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getAbsWindows = (wall: string) => (room.windows || []).filter((w:any) => w.wall === wall).map((win:any) => ({
      ...win, absPos: (wall === 'top' || wall === 'bottom') ? rX + rW * win.position : rY + rH * win.position
    }));

    const rHeight = room.type === 'garage' ? 10 : wallH;

    // 2. Add walls perfectly aligned to room edges (skip if wall is marked as open/removed)
    // For garage rooms, always omit the front (top) wall to expose the garage door.
    if (room.type !== 'garage' && !effectiveOpenWalls.includes('top')) {
      addWall('h', rY, rX, rX + rW, getAbsDoors('top'), getAbsWindows('top'), rHeight);
    }
    if (!effectiveOpenWalls.includes('bottom')) {
      addWall('h', rY + rH, rX, rX + rW, getAbsDoors('bottom'), getAbsWindows('bottom'), rHeight);
    }
    if (!effectiveOpenWalls.includes('left')) {
      addWall('v', rX, rY, rY + rH, getAbsDoors('left'), getAbsWindows('left'), rHeight);
    }
    if (!effectiveOpenWalls.includes('right')) {
      addWall('v', rX + rW, rY, rY + rH, getAbsDoors('right'), getAbsWindows('right'), rHeight);
    }  });

  // Find main entrance door position for canopy & wall lights
  const mainDoorCandidates: Array<{ x: number; z: number; nx: number; nz: number; roomType: string }> = [];
  for (const wall of extractedWalls) {
    for (const door of wall.doors) {
      if (door.doorCategory === 'main') {
        let pos;
        if (wall.type === 'h') {
          const nz = door.wall === 'top' ? -1 : (door.wall === 'bottom' ? 1 : (wall.coord <= minZ + 0.5 ? -1 : 1));
          pos = { x: round2(door.absPos - W/2), z: round2(wall.coord - D/2), nx: 0, nz, roomType: door.roomType };
        } else {
          const nx = door.wall === 'left' ? -1 : (door.wall === 'right' ? 1 : (wall.coord <= minX + 0.5 ? -1 : 1));
          pos = { x: round2(wall.coord - W/2), z: round2(door.absPos - D/2), nx, nz: 0, roomType: door.roomType };
        }
        mainDoorCandidates.push(pos);
      }
    }
  }
  // Priority: Hall > Living > First found
  const mainDoorPos = mainDoorCandidates.find(c => c.roomType === 'hall') 
    || mainDoorCandidates.find(c => c.roomType === 'living')
    || mainDoorCandidates[0] 
    || null;

  const gardenRooms = (plan.rooms || []).filter(r => r.type === 'garden');

  return (
    <group position={[0, 0, 0]}>
      {/* Gardens & Landscaping */}
      {gardenRooms.map(r => (
        <GardenArea key={`garden-area-${r.id}`} room={r} W={W} D={D} isNight={isNight} mainDoorPos={mainDoorPos} />
      ))}

      {/* Per-room Foundations for perfect spatial accuracy */}
      <group position={[0, 0.8, 0]}>
        {houseRooms.map(r => {
          const cx = round2(r.x + r.w / 2 - W / 2);
          const cz = round2(r.y + r.h / 2 - D / 2);
          const isActive = roomMatchesActiveTab(r, activeRoom);

          // Detect adjacency to carport to prevent overhang/overlap
          const isNextToCarportLeft = hasCarport && Math.abs(r.x - (carportRoom.x + carportRoom.w)) < 0.1;
          const isNextToCarportRight = hasCarport && Math.abs((r.x + r.w) - carportRoom.x) < 0.1;
          const isNextToCarportTop = hasCarport && Math.abs(r.y - (carportRoom.y + carportRoom.h)) < 0.1;
          const isNextToCarportBottom = hasCarport && Math.abs((r.y + r.h) - carportRoom.y) < 0.1;

          // Foundation dimensions
          const fW = r.w;
          const fH = r.h;
          
          // Plinth band dimensions (conditional overhang)
          const pW = r.w + (isNextToCarportLeft || isNextToCarportRight ? 0.05 : 0.15);
          const pH = r.h + (isNextToCarportTop || isNextToCarportBottom ? 0.05 : 0.15);
          const pCX = cx + (isNextToCarportLeft ? 0.05 : 0) - (isNextToCarportRight ? 0.05 : 0);
          const pCZ = cz + (isNextToCarportTop ? 0.05 : 0) - (isNextToCarportBottom ? 0.05 : 0);

          return (
            <group key={`room-found-${r.id}`}>
              {/* Individual Foundation Slab */}
              <mesh receiveShadow position={[cx, -0.4, cz]}>
                <boxGeometry args={[fW, 0.8, fH]} />
                <meshStandardMaterial color="#8a8478" roughness={0.9} />
              </mesh>

              {/* Individual Plinth Trim */}
              <mesh position={[pCX, -0.15, pCZ]}>
                <boxGeometry args={[pW, 0.3, pH]} />
                <meshStandardMaterial color="#4a453e" roughness={0.7} />
              </mesh>

              {/* Floor Plane */}
              {(() => {
                const isLivingDining = ['living', 'dining', 'hall', 'lobby', 'foyer', 'entry'].includes(r.type);
                const isBedroom = ['bedroom', 'master', 'guest'].includes(r.type);
                const isKitchen = r.type === 'kitchen';
                const isBath = r.type === 'bathroom';
                const isCorridor = ['corridor', 'hallway', 'passage', 'staircase'].includes(r.type);

                let map = floorTextures.oak;
                let normalMap: THREE.Texture = floorTextures.oakNormal;
                let roughnessMap: THREE.Texture = floorTextures.oakRough;
                let baseColor = '#caa775';
                let roughness = 0.55;
                let metalness = 0;
                let envMapIntensity = 0.6;

                if (isLivingDining) {
                  map = floorTextures.walnut; normalMap = floorTextures.walnutNormal; roughnessMap = floorTextures.walnutRough;
                  baseColor = '#8a5d36'; roughness = 0.5; envMapIntensity = 0.8;
                } else if (isBedroom) {
                  map = floorTextures.oak; normalMap = floorTextures.oakNormal; roughnessMap = floorTextures.oakRough;
                  baseColor = '#caa775'; roughness = 0.6; envMapIntensity = 0.6;
                } else if (isKitchen) {
                  map = floorTextures.marble; normalMap = undefined; roughnessMap = floorTextures.marbleRough;
                  baseColor = '#f1ede5'; roughness = 0.18; metalness = 0.05; envMapIntensity = 1.4;
                } else if (isBath) {
                  map = floorTextures.tile; normalMap = floorTextures.tileNormal; roughnessMap = floorTextures.tileRough;
                  baseColor = '#e6e8e7'; roughness = 0.22; metalness = 0.04; envMapIntensity = 1.2;
                } else if (isCorridor) {
                  map = floorTextures.walnut; normalMap = floorTextures.walnutNormal; roughnessMap = floorTextures.walnutRough;
                  baseColor = '#8a5d36'; roughness = 0.55; envMapIntensity = 0.7;
                } else if (r.type === 'garage') {
                  map = undefined; normalMap = undefined; roughnessMap = undefined;
                  baseColor = '#1e293b'; roughness = 0.08; metalness = 0.75; envMapIntensity = 2.2;
                }

                return (
                  <mesh receiveShadow position={[cx, 0.01, cz]}>
                    <boxGeometry args={[r.w, 0.02, r.h]} />
                    <meshStandardMaterial
                      color={baseColor}
                      map={map}
                      normalMap={normalMap}
                      normalScale={new THREE.Vector2(0.45, 0.45)}
                      roughnessMap={roughnessMap}
                      roughness={roughness}
                      metalness={metalness}
                      envMapIntensity={envMapIntensity}
                    />
                  </mesh>
                );
              })()}



              {/* Ceiling Elements */}
              {!hideRoof && r.type !== 'garden' && r.type !== 'carport' && r.type !== 'balcony' && r.type !== 'garage' && !isStaircaseRoom(r) && (
                <>
                  <mesh position={[cx, wallH - 0.01, cz]}>
                    <boxGeometry args={[r.w - 0.1, 0.02, r.h - 0.1]} />
                    <meshStandardMaterial color="#fafaf6" roughness={0.95} />
                  </mesh>
                  <mesh position={[cx, wallH - 0.18, cz]}>
                    <boxGeometry args={[r.w - 1.2, 0.08, r.h - 1.2]} />
                    <meshStandardMaterial color="#f4f1eb" roughness={0.9} />
                  </mesh>
                  {[
                    { p: [cx, wallH - 0.18, cz - r.h / 2 + 0.65], a: [r.w - 1.2, 0.04, 0.04] },
                    { p: [cx, wallH - 0.18, cz + r.h / 2 - 0.65], a: [r.w - 1.2, 0.04, 0.04] },
                    { p: [cx - r.w / 2 + 0.65, wallH - 0.18, cz], a: [0.04, 0.04, r.h - 1.2] },
                    { p: [cx + r.w / 2 - 0.65, wallH - 0.18, cz], a: [0.04, 0.04, r.h - 1.2] },
                  ].map((s, si) => (
                    <mesh key={`cove-${si}`} position={s.p as [number, number, number]}>
                      <boxGeometry args={s.a as [number, number, number]} />
                      <meshStandardMaterial color="#fff5dc" emissive="#ffd9a0" emissiveIntensity={isNight ? 1.2 : 0.5} roughness={0.4} />
                    </mesh>
                  ))}
                </>
              )}

              {/* Furniture */}
              {(hideRoof || isActive) && r.furniture.map((f, fi: number) => {
                const fx = round2(r.x + f.x + f.w/2 - W/2);
                const fz = round2(r.y + f.y + f.h/2 - D/2);
                return (
                  <group key={`f-${fi}`} position={[fx, 0.02, fz]} rotation={[0, f.rotation ? f.rotation * Math.PI / 180 : 0, 0]}>
                    <Furniture3D item={f} isNight={isNight} />
                  </group>
                );
              })}

              {isStaircaseRoom(r) && (() => {
                const sg = resolveStairGeometry(r);
                // When mirrored, the 2D canvas flips the stair drawing with scaleX:-1,
                // visually moving it from left to right. Mirror the X offset to match in 3D.
                const effectiveOffsetX = r.isMirrored 
                  ? (r.w - sg.stairOffsetX - sg.stairWidth)
                  : sg.stairOffsetX;
                // Position stair 3D model at offset position inside room, not room center
                const stairCX = round2(r.x + effectiveOffsetX + sg.stairWidth / 2 - W / 2);
                const stairCZ = round2(r.y + sg.stairOffsetY + sg.stairLength / 2 - D / 2);
                return (
                  <group position={[stairCX, 0.02, stairCZ]}>
                    <Staircase3D 
                      w={sg.stairWidth} 
                      h={sg.stairLength} 
                      floorHeight={wallH} 
                      isNight={isNight} 
                      orientation={r.orientation || 0} 
                      isMirrored={r.isMirrored}
                      roomX={r.x}
                      roomY={r.y}
                      planWidth={W}
                      planHeight={D}
                      landingSize={sg.landingSize}
                    />
                  </group>
                );
              })()}

              {r.type === 'garage' && (
                <GarageInterior r={r} cx={cx} cz={cz} isNight={isNight} wallH={10} />
              )}
            </group>
          );
        })}

        {/* Balconies */}
        {(plan.rooms || []).filter(r => r.type === 'balcony').map((r) => (
          <Balcony3D key={`balcony-${r.id}`} room={r} W={W} D={D} isNight={!!isNight} floorY={0} />
        ))}

        {/* Interior Walls */}
        {extractedWalls.map((wall, i) => {
          const len = wall.end - wall.start;
          const w = len + t;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mappedDoors = wall.doors.map((d:any) => ({...d, relPos: (d.absPos - wall.start + t/2) / w}));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mappedWindows = wall.windows.map((win:any) => ({...win, relPos: (win.absPos - wall.start + t/2) / w}));

          if (wall.type === 'h') {
            const posX = round2(wall.start + len/2 - W/2);
            const posZ = round2(wall.coord - D/2);
            return <WallSegment key={`wall-${i}`} w={w} h={wall.height || wallH} t={t} color={colors.wall}
              doors={mappedDoors} windows={mappedWindows} materialType={material}
              position={[posX, 0, posZ]} rotation={[0, 0, 0]}
              frameColor={colors.trim} glassColor={colors.window} doorColor={colors.door}
              hideRoof={hideRoof} wallTextures={wallTextures} doorTextures={doorTextures} isNight={isNight} garageShutterOpen={garageShutterOpen} />;
          } else {
            const posX = round2(wall.coord - W/2);
            const posZ = round2(wall.start + len/2 - D/2);
            return <WallSegment key={`wall-${i}`} w={w} h={wall.height || wallH} t={t} color={colors.wall}
              doors={mappedDoors} windows={mappedWindows} materialType={material}
              position={[posX, 0, posZ]} rotation={[0, -Math.PI/2, 0]}
              frameColor={colors.trim} glassColor={colors.window} doorColor={colors.door}
              hideRoof={hideRoof} wallTextures={wallTextures} doorTextures={doorTextures} isNight={isNight} garageShutterOpen={garageShutterOpen} />;
          }
        })}
      </group>

      {/* Exterior Architecture (cornice/trim slabs with staircase cutout) */}
      {!hideRoof && !isDoubleStorey && (() => {
        const groundStaircaseForTrim = (plan.rooms || []).find(r => isStaircaseRoom(r));
        
        // Trim slab shape (roofW + 0.8 x roofD + 0.8)
        const trimShape = new THREE.Shape();
        const tw = roofW + 0.8, td = roofD + 0.8;
        trimShape.moveTo(-tw/2, -td/2);
        trimShape.lineTo(tw/2, -td/2);
        trimShape.lineTo(tw/2, td/2);
        trimShape.lineTo(-tw/2, td/2);
        trimShape.closePath();
        
        // Accent slab shape (roofW + 0.5 x roofD + 0.5)
        const accentShape = new THREE.Shape();
        const aw = roofW + 0.5, ad = roofD + 0.5;
        accentShape.moveTo(-aw/2, -ad/2);
        accentShape.lineTo(aw/2, -ad/2);
        accentShape.lineTo(aw/2, ad/2);
        accentShape.lineTo(-aw/2, ad/2);
        accentShape.closePath();
        
        if (groundStaircaseForTrim) {
          const sg = resolveStairGeometry(groundStaircaseForTrim);
          // Mirror-aware offset: flip X offset when staircase is mirrored
          const trimEffectiveOffsetX = groundStaircaseForTrim.isMirrored
            ? (groundStaircaseForTrim.w - sg.stairOffsetX - sg.openingWidth)
            : sg.stairOffsetX;
          const hx = round2(groundStaircaseForTrim.x + trimEffectiveOffsetX + sg.openingWidth / 2 - W / 2 - roofCX);
          const hz = round2(groundStaircaseForTrim.y + sg.stairOffsetY + sg.openingLength / 2 - D / 2 - roofCZ);
          const hw = sg.openingWidth + 0.2;
          const hh = sg.openingLength + 0.2;
          
          const trimHole = new THREE.Path();
          trimHole.moveTo(hx - hw/2, hz - hh/2);
          trimHole.lineTo(hx + hw/2, hz - hh/2);
          trimHole.lineTo(hx + hw/2, hz + hh/2);
          trimHole.lineTo(hx - hw/2, hz + hh/2);
          trimHole.closePath();
          trimShape.holes.push(trimHole);
          
          const accentHole = new THREE.Path();
          accentHole.moveTo(hx - hw/2, hz - hh/2);
          accentHole.lineTo(hx + hw/2, hz - hh/2);
          accentHole.lineTo(hx + hw/2, hz + hh/2);
          accentHole.lineTo(hx - hw/2, hz + hh/2);
          accentHole.closePath();
          accentShape.holes.push(accentHole);
        }
        
        return (
          <>
            <mesh position={[roofCX, wallH + 0.8, roofCZ]} rotation={[-Math.PI / 2, 0, 0]}>
              <extrudeGeometry args={[trimShape, { depth: 0.35, bevelEnabled: false }]} />
              <meshStandardMaterial color={colors.trim} roughness={0.45} metalness={0.08} />
            </mesh>
            <mesh position={[roofCX, wallH + 0.77, roofCZ]} rotation={[-Math.PI / 2, 0, 0]}>
              <extrudeGeometry args={[accentShape, { depth: 0.15, bevelEnabled: false }]} />
              <meshStandardMaterial color={colors.accent} roughness={0.5} />
            </mesh>
          </>
        );
      })()}

      {/* Entrance Features */}
      {mainDoorPos && (
        <>
          <BlackStonePathway doorPos={mainDoorPos} plotW={plotW} plotD={plotD} isNight={isNight} />
          {!hideRoof && (
            <group position={[mainDoorPos.x, wallH * 0.85 + 0.8, mainDoorPos.z + mainDoorPos.nz * 2 + mainDoorPos.nx * 2]}>
              <mesh castShadow rotation={[0, mainDoorPos.nx !== 0 ? Math.PI/2 : 0, 0]}>
                <boxGeometry args={[6, 0.2, 3.5]} />
                <meshStandardMaterial color={colors.roof} roughness={0.6} />
              </mesh>
              <mesh position={[0, -0.02, 0]} rotation={[0, mainDoorPos.nx !== 0 ? Math.PI/2 : 0, 0]}>
                <boxGeometry args={[6.3, 0.08, 0.12]} />
                <meshStandardMaterial color={colors.trim} roughness={0.4} metalness={0.15} />
              </mesh>
            </group>
          )}
          {[-3, 3].map((o, li) => (
            <group key={`sconce-${li}`} position={[
              mainDoorPos.x + (mainDoorPos.nz !== 0 ? o : 0),
              wallH * 0.5 + 0.8,
              mainDoorPos.z + (mainDoorPos.nx !== 0 ? o : 0)
            ]}>
              <mesh><boxGeometry args={[0.2, 0.5, 0.15]} /><meshStandardMaterial color={colors.trim} roughness={0.3} metalness={0.5} /></mesh>
              <pointLight intensity={0.5} distance={8} color="#ffe8c0" position={[mainDoorPos.nx * 0.3, -0.15, mainDoorPos.nz * 0.3]} />
            </group>
          ))}
        </>
      )}

      {/* Roof System */}
      {!isDoubleStorey && (() => {
        const groundStaircase = (plan.rooms || []).find(r => isStaircaseRoom(r));
        const hole = groundStaircase ? (() => {
          const sg = resolveStairGeometry(groundStaircase);
          // Mirror-aware offset: flip X offset when staircase is mirrored
          const roofEffectiveOffsetX = groundStaircase.isMirrored
            ? (groundStaircase.w - sg.stairOffsetX - sg.openingWidth)
            : sg.stairOffsetX;
          return {
            // Opening position derived from stair offset, not room center
            x: round2(groundStaircase.x + roofEffectiveOffsetX + sg.openingWidth / 2 - W / 2 - roofCX),
            z: round2(groundStaircase.y + sg.stairOffsetY + sg.openingLength / 2 - D / 2 - roofCZ),
            w: sg.openingWidth + 0.2,
            h: sg.openingLength + 0.2
          };
        })() : null;

        // Ensure roof is always visible for single storey, and uses the correct type
        const finalHideRoof = hideRoof;
        const roofOpacity = finalHideRoof ? 0.1 : 1;

        return roofType === 'gable' ? (
          <GableRoof 
            W={roofW} D={roofD} cx={roofCX} cz={roofCZ} wallH={wallH} 
            color={colors.roof} trimColor={colors.trim} rodColor={colors.rod} 
            transparent={finalHideRoof} opacity={roofOpacity} 
            cpAtLeft={cpAtLeft} cpAtRight={cpAtRight} cpAtTop={cpAtTop} cpAtBottom={cpAtBottom} 
          />
        ) : (
          <FlatRoof 
            W={roofW} D={roofD} cx={roofCX} cz={roofCZ} wallH={wallH} 
            color={colors.roof} transparent={finalHideRoof} opacity={roofOpacity} 
            cpAtLeft={cpAtLeft} cpAtRight={cpAtRight} cpAtTop={cpAtTop} cpAtBottom={cpAtBottom} 
            hole={hole} 
          />
        );
      })()}

      {!hideRoof && (plan.rooms || []).filter(r => r.type === 'garage').map(r => (
        <GarageRoof key={`groof-${r.id}`} garage={r} planW={W} planH={D} wallH={10.8} colors={colors} wallTextures={wallTextures} />
      ))}

      {/* Rooftop Equipment */}
      {addons.includes('solar') && !hideRoof && !isDoubleStorey && <SolarPanels minX={minX - W/2} maxX={maxX - W/2} minZ={minZ - D/2} maxZ={maxZ - D/2} roofType={roofType} wallH={wallH} />}
      {addons.includes('water_tank') && !hideRoof && !isDoubleStorey && <WaterTank maxX={maxX - W/2} maxZ={maxZ - D/2} wallH={wallH} roofType={roofType} />}

      {/* Room Labels */}
      {showLabels && (plan.rooms || []).map(r => {
        if (r.type === 'garden' || r.type === 'carport' || r.type === 'balcony') return null;
        const isActive = roomMatchesActiveTab(r, activeRoom);
        const finalHideRoof = hideRoof;
        return (
          <Html key={`label-${r.id}`} position={[r.x - W/2 + r.w/2, finalHideRoof ? 3 : wallH + 3.5, r.y - D/2 + r.h/2]} center zIndexRange={[100, 0]}>
            <div className={`transition-all duration-300 pointer-events-none px-4 py-1.5 rounded-sm border shadow-lg whitespace-nowrap font-display font-bold text-[11px] tracking-widest ${isActive ? 'bg-[hsl(28,40%,55%)] text-white border-transparent scale-110 shadow-[0_4px_12_rgba(200,100,50,0.4)]' : 'bg-white/95 text-black border-black/10 scale-100'}`}>
              {r.label}
            </div>
          </Html>
        );
      })}
    </group>
  );
};

/* ─── Door Dimension Helpers ─── */
const DOOR_DIMS: Record<string, { height: number; minWidth: number }> = {
  main:     { height: 8.6, minWidth: 4.8 },
  room:     { height: 8.4, minWidth: 3 },
  bathroom: { height: 8.0, minWidth: 2.5 },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getDoorHeight = (d: { doorType?: string; [key: string]: any } | any): number => {
  // Garage doors should cut through the entire wall height (13 units) to avoid blocking.
  if (d.label === 'GARAGE DOOR') return 13;
  const cat = d.doorCategory || 'room';
  return DOOR_DIMS[cat]?.height ?? 9;
};

/* ─── Wall Rendering Geometry ─── */
interface WallSegmentProps {
  w: number;
  h: number;
  t: number;
  color: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doors: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  windows: any[];
  position: [number, number, number];
  rotation: [number, number, number];
  frameColor: string;
  glassColor: string;
  doorColor: string;
  materialType: Material;
  hideRoof: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wallTextures?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doorTextures?: any;
  isNight?: boolean;
  garageShutterOpen?: boolean;
}

const WallSegment = ({ w, h, t, color, doors, windows, position, rotation, frameColor, glassColor, doorColor, materialType, hideRoof, wallTextures, doorTextures, isNight, garageShutterOpen = false }: WallSegmentProps) => {
  const solidRuns = useMemo(() => {
    const spans = doors
      .map((d) => {
        const center = w * d.relPos - w / 2;
        const half = (d.width || 0) / 2 + 0.18;
        return { start: Math.max(-w / 2, center - half), end: Math.min(w / 2, center + half) };
      })
      .sort((a, b) => a.start - b.start);

    const runs: Array<{ center: number; length: number }> = [];
    let cursor = -w / 2;
    spans.forEach((span) => {
      if (span.start > cursor + 0.1) {
        runs.push({ center: (cursor + span.start) / 2, length: span.start - cursor });
      }
      cursor = Math.max(cursor, span.end);
    });
    if (cursor < w / 2 - 0.1) {
      runs.push({ center: (cursor + w / 2) / 2, length: w / 2 - cursor });
    }
    return runs.filter((run) => run.length > 0.25);
  }, [doors, w]);

  const shape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-w/2, 0);
    s.lineTo(w/2, 0);
    s.lineTo(w/2, h);
    s.lineTo(-w/2, h);
    s.closePath();

    doors.forEach((d) => {
      const dw = d.width;
      const dh = getDoorHeight(d);
      const dx = w * d.relPos - w/2 - dw/2;
      const hole = new THREE.Path();
      // Start slightly below the bottom edge (y = -0.1) and use Clockwise (CW) winding direction
      // to avoid coincident boundary triangulation errors in Earcut.
      hole.moveTo(dx, -0.1);
      hole.lineTo(dx, dh);
      hole.lineTo(dx + dw, dh);
      hole.lineTo(dx + dw, -0.1);
      hole.closePath();
      s.holes.push(hole);
    });

    windows.forEach((win) => {
      const ww = 3.2;
      const wh = 3.2;
      const wy = 5.5;
      const wx = w * win.relPos - w/2 - ww/2;
      const hole = new THREE.Path();
      // Use Clockwise (CW) winding direction for holes.
      hole.moveTo(wx, wy);
      hole.lineTo(wx, wy + wh);
      hole.lineTo(wx + ww, wy + wh);
      hole.lineTo(wx + ww, wy);
      hole.closePath();
      s.holes.push(hole);
    });

    return s;
  }, [w, h, doors, windows]);

  return (
    <group position={position} rotation={rotation}>
      {/* Main wall body */}
      <mesh castShadow receiveShadow position={[0, 0, -t/2]}>
        <extrudeGeometry args={[shape, { depth: t, bevelEnabled: false }]} />
        <meshStandardMaterial
          color={color}
          map={wallTextures?.map}
          normalMap={wallTextures?.normal}
          normalScale={new THREE.Vector2(0.6, 0.6)}
          roughness={0.88}
          metalness={0.02}
          envMapIntensity={0.5}
        />
      </mesh>

      {/* Exterior facade cladding band (lower 1/3 of wall — stone/brick accent) */}
      {!hideRoof && (
        <>
          {solidRuns.map((run, i) => (
            <mesh key={`clad-${i}`} position={[run.center, 2.2, -t / 2 - 0.06]} castShadow>
              <boxGeometry args={[run.length, 4.4, 0.12]} />
              <meshStandardMaterial
                color="#2e2a24"
                roughness={0.92}
                metalness={0.04}
                envMapIntensity={0.3}
              />
            </mesh>
          ))}
        </>
      )}
      {/* Cladding cap trim line */}
      {!hideRoof && (
        <>
          {solidRuns.map((run, i) => (
            <mesh key={`clad-cap-${i}`} position={[run.center, 4.42, -t / 2 - 0.07]}>
              <boxGeometry args={[run.length, 0.12, 0.14]} />
              <meshStandardMaterial color="#1a1a1a" roughness={0.4} metalness={0.3} />
            </mesh>
          ))}
        </>
      )}
      {/* Skirting board (interior side) */}
      {solidRuns.map((run, i) => (
        <mesh key={`skirting-${i}`} position={[run.center, 0.25, t / 2 + 0.01]}>
          <boxGeometry args={[run.length, 0.5, 0.08]} />
          <meshStandardMaterial color="#e8e2d8" roughness={0.7} />
        </mesh>
      ))}
      {/* Dado rail (interior) */}
      {!hideRoof && (
        <>
          {solidRuns.map((run, i) => (
            <mesh key={`dado-${i}`} position={[run.center, 4.8, t / 2 + 0.01]}>
              <boxGeometry args={[run.length, 0.12, 0.07]} />
              <meshStandardMaterial color="#e0dbd0" roughness={0.5} metalness={0.05} />
            </mesh>
          ))}
        </>
      )}
      {/* Cornice (interior ceiling junction) */}
      {!hideRoof && (
        <>
          {solidRuns.map((run, i) => (
            <mesh key={`cornice-${i}`} position={[run.center, h - 0.25, t / 2 + 0.01]}>
              <boxGeometry args={[run.length, 0.5, 0.1]} />
              <meshStandardMaterial color="#f0ece4" roughness={0.6} />
            </mesh>
          ))}
        </>
      )}
      
      {/* ── Categorized Door Rendering ── */}
      {doors.map((d, i: number) => {
        const cat = d.doorCategory || 'room';
        const dw = d.width;
        const dh = getDoorHeight(d);
        const dx = w * d.relPos - w/2;
        const isOpen = d.doorType === 'open';

        if (d.label === 'GARAGE DOOR') {
          // ── PREMIUM SECTIONAL GARAGE DOOR ──
          // Hide door panels when shutter is open
          if (garageShutterOpen) return null;

          const segCount = 4;
          const segH = dh / segCount;
          const glassMat = (
            <meshStandardMaterial
              color="#0b0f19"
              roughness={0.02}
              metalness={0.9}
              transparent
              opacity={0.88}
              envMapIntensity={2.5}
            />
          );

          return (
            <group key={`d-${i}`} position={[dx, dh/2, 0]}>
              {/* Premium Matte Black Aluminum Outer Frame */}
              <group>
                {/* Top frame header */}
                <mesh position={[0, dh/2 + 0.1, 0]} castShadow>
                  <boxGeometry args={[dw + 0.4, 0.2, t + 0.1]} />
                  <meshStandardMaterial color="#030712" roughness={0.5} metalness={0.4} />
                </mesh>
                {/* Left jamb */}
                <mesh position={[-dw/2 - 0.1, 0, 0]} castShadow>
                  <boxGeometry args={[0.2, dh, t + 0.1]} />
                  <meshStandardMaterial color="#030712" roughness={0.5} metalness={0.4} />
                </mesh>
                {/* Right jamb */}
                <mesh position={[dw/2 + 0.1, 0, 0]} castShadow>
                  <boxGeometry args={[0.2, dh, t + 0.1]} />
                  <meshStandardMaterial color="#030712" roughness={0.5} metalness={0.4} />
                </mesh>
              </group>

              {/* Sectional Panels (4 horizontal segments) */}
              {Array.from({ length: segCount }).map((_, sIdx) => {
                const sY = -dh/2 + sIdx * segH + segH/2;
                const isGlassSegment = sIdx === 1 || sIdx === 2;

                return (
                  <group key={`seg-${sIdx}`} position={[0, sY, 0.02]}>
                    {/* Main segment backing */}
                    <mesh castShadow receiveShadow>
                      <boxGeometry args={[dw - 0.08, segH - 0.04, 0.08]} />
                      <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.8} />
                    </mesh>

                    {/* Segment borders / divisions */}
                    <mesh position={[0, segH/2 - 0.01, 0.05]}>
                      <boxGeometry args={[dw - 0.04, 0.02, 0.02]} />
                      <meshStandardMaterial color="#030712" roughness={0.4} />
                    </mesh>

                    {/* Left and right end caps */}
                    <mesh position={[-dw/2 + 0.05, 0, 0.05]}>
                      <boxGeometry args={[0.1, segH - 0.08, 0.02]} />
                      <meshStandardMaterial color="#030712" roughness={0.4} />
                    </mesh>
                    <mesh position={[dw/2 - 0.05, 0, 0.05]}>
                      <boxGeometry args={[0.1, segH - 0.08, 0.02]} />
                      <meshStandardMaterial color="#030712" roughness={0.4} />
                    </mesh>

                    {/* Inner design layout */}
                    {isGlassSegment ? (
                      <group>
                        {/* 4 glass panes per segment */}
                        {[-1.5, -0.5, 0.5, 1.5].map((paneOff, pIdx) => (
                          <group key={`pane-${pIdx}`} position={[paneOff * (dw/4), 0, 0.04]}>
                            <mesh>
                              <boxGeometry args={[dw/4.3, segH - 0.15, 0.02]} />
                              {glassMat}
                            </mesh>
                            <mesh position={[0, 0, 0.01]}>
                              <boxGeometry args={[dw/4.3 + 0.02, segH - 0.15 + 0.02, 0.005]} />
                              <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.8} />
                            </mesh>
                          </group>
                        ))}
                      </group>
                    ) : (
                      <group>
                        {[-0.15, 0, 0.15].map((lineY, lIdx) => (
                          <mesh key={`line-${lIdx}`} position={[0, lineY * segH, 0.04]}>
                            <boxGeometry args={[dw - 0.4, 0.02, 0.02]} />
                            <meshStandardMaterial color="#1f2937" roughness={0.2} metalness={0.9} />
                          </mesh>
                        ))}
                      </group>
                    )}
                  </group>
                );
              })}

              {/* Optional soft LED light strips around frame (Glowing warm amber/white) */}
              {isNight && (
                <group>
                  <mesh position={[-dw/2 - 0.12, 0, t/2 + 0.06]}>
                    <boxGeometry args={[0.02, dh, 0.02]} />
                    <meshBasicMaterial color="#ffcc80" toneMapped={false} />
                  </mesh>
                  <mesh position={[dw/2 + 0.12, 0, t/2 + 0.06]}>
                    <boxGeometry args={[0.02, dh, 0.02]} />
                    <meshBasicMaterial color="#ffcc80" toneMapped={false} />
                  </mesh>
                  <mesh position={[0, dh/2 + 0.12, t/2 + 0.06]}>
                    <boxGeometry args={[dw + 0.24, 0.02, 0.02]} />
                    <meshBasicMaterial color="#ffcc80" toneMapped={false} />
                  </mesh>
                </group>
              )}
            </group>
          );
        }

        if (isOpen) {
          // Open archway — frame only, no door panel
          return (
            <group key={`d-${i}`} position={[dx, dh/2, 0]}>
              <group>
                <mesh position={[0, dh/2 + 0.075, 0]}>
                  <boxGeometry args={[dw + 0.3, 0.15, t + 0.08]} />
                  <meshStandardMaterial color={frameColor} roughness={0.6} />
                </mesh>
                <mesh position={[-dw/2 - 0.075, 0, 0]}>
                  <boxGeometry args={[0.15, dh, t + 0.08]} />
                  <meshStandardMaterial color={frameColor} roughness={0.6} />
                </mesh>
                <mesh position={[dw/2 + 0.075, 0, 0]}>
                  <boxGeometry args={[0.15, dh, t + 0.08]} />
                  <meshStandardMaterial color={frameColor} roughness={0.6} />
                </mesh>
              </group>
            </group>
          );
        }

        if (cat === 'main') {
          // ── MAIN ENTRANCE DOOR — Premium "Wooden Orange" finish ──
          const mainWood = '#b5651d'; // Warm Cedar/Teak orange
          const panelWood = '#8b4513'; // Saddle Brown for mixed contrast
          const accentMetal = materialType === 'luxury' ? '#d4af37' : materialType === 'modern' ? '#222' : '#999';
          
          return (
            <group key={`d-${i}`} position={[dx, dh/2, 0]}>
              {/* Massive Outer Frame (Perimeter) */}
              <group>
                <mesh position={[0, dh/2 + 0.15, 0]}>
                  <boxGeometry args={[dw + 0.6, 0.3, t + 0.16]} />
                  <meshStandardMaterial color={frameColor} roughness={0.4} metalness={0.1} />
                </mesh>
                <mesh position={[-dw/2 - 0.15, 0, 0]}>
                  <boxGeometry args={[0.3, dh, t + 0.16]} />
                  <meshStandardMaterial color={frameColor} roughness={0.4} metalness={0.1} />
                </mesh>
                <mesh position={[dw/2 + 0.15, 0, 0]}>
                  <boxGeometry args={[0.3, dh, t + 0.16]} />
                  <meshStandardMaterial color={frameColor} roughness={0.4} metalness={0.1} />
                </mesh>
              </group>
              
              {/* Primary Door Panel */}
              <mesh position={[0, 0, 0]}>
                <boxGeometry args={[dw, dh, 0.22]} />
                <meshStandardMaterial color={mainWood} map={doorTextures?.map} normalMap={doorTextures?.normal} normalScale={new THREE.Vector2(0.6, 0.6)} roughness={0.38} metalness={0.06} envMapIntensity={1.2} /></mesh>

              {/* Symmetrical Details for Front and Back */}
              {[-1, 1].map((side) => (
                <group key={`side-${side}`} position={[0, 0, 0.11 * side]}>

                  {/* Horizontal Mixed Grain Bands */}
                  {[ -0.8, 0, 0.8 ].map((yOff, idx) => (
                    <mesh key={`band-${idx}`} position={[0, yOff * (dh/3), 0.01 * side]}>
                      <boxGeometry args={[dw - 0.2, 0.15, 0.02]} />
                      <meshStandardMaterial color={panelWood} map={doorTextures?.map} roughness={0.3} />
                    </mesh>
                  ))}

                  {/* Modern Designer Glass Inserts */}
                  <mesh position={[0, dh/4, 0.02 * side]}>
                    <boxGeometry args={[dw/2.2, dh/4.5, 0.04]} />
                    <meshStandardMaterial color={glassColor} roughness={0.02} metalness={0.8} transparent opacity={0.3} envMapIntensity={2} /></mesh>

                  {/* Modern Vertical Pull Handle (Luxury Style) */}
                  <group position={[side === 1 ? dw/2 - 0.45 : -dw/2 + 0.45, 0, 0.05 * side]}>
                    {/* Handle Bar */}
                    <mesh position={[0, 0, 0.06 * side]}>
                      <boxGeometry args={[0.08, 2.5, 0.08]} />
                      <meshStandardMaterial color={accentMetal} metalness={1} roughness={0.1} /></mesh>
                    {/* Handle Supports */}
                    <mesh position={[0, 1.0, 0.03 * side]} rotation={[Math.PI/2, 0, 0]}>
                      <cylinderGeometry args={[0.03, 0.03, 0.06, 8]} />
                      <meshStandardMaterial color={accentMetal} metalness={1} roughness={0.1} /></mesh>
                    <mesh position={[0, -1.0, 0.03 * side]} rotation={[Math.PI/2, 0, 0]}>
                      <cylinderGeometry args={[0.03, 0.03, 0.06, 8]} />
                      <meshStandardMaterial color={accentMetal} metalness={1} roughness={0.1} /></mesh>
                  </group>
                </group>
              ))}

              {/* Threshold (Marble/Stone feel) */}
              <mesh position={[0, -dh/2 + 0.05, 0.1]}>
                <boxGeometry args={[dw + 0.6, 0.1, t + 0.4]} />
                <meshStandardMaterial color="#dcdcdc" roughness={0.3} metalness={0.1} /></mesh>
            </group>
          );
        }

        if (cat === 'bathroom') {
          // ── BATHROOM DOOR — Compact, frosted glass upper, lighter color ──
          const bathDoorColor = materialType === 'luxury' ? '#a09080' : materialType === 'modern' ? '#c8c8c8' : '#c4b8a8';
          return (
            <group key={`d-${i}`} position={[dx, dh/2, 0]}>
              {/* Slim frame */}
              <group>
                <mesh position={[0, dh/2 + 0.075, 0]}>
                  <boxGeometry args={[dw + 0.3, 0.15, t + 0.08]} />
                  <meshStandardMaterial color={frameColor} roughness={0.6} />
                </mesh>
                <mesh position={[-dw/2 - 0.075, 0, 0]}>
                  <boxGeometry args={[0.15, dh, t + 0.08]} />
                  <meshStandardMaterial color={frameColor} roughness={0.6} />
                </mesh>
                <mesh position={[dw/2 + 0.075, 0, 0]}>
                  <boxGeometry args={[0.15, dh, t + 0.08]} />
                  <meshStandardMaterial color={frameColor} roughness={0.6} />
                </mesh>
              </group>
              {/* Full Door Panel */}
              <mesh position={[0, 0, 0]}>
                <boxGeometry args={[dw, dh, 0.08]} />
                <meshStandardMaterial color={bathDoorColor} normalMap={doorTextures?.normal} normalScale={new THREE.Vector2(0.2, 0.2)} roughness={0.55} /></mesh>
              {/* Upper frosted glass panel insert */}
              <mesh position={[0, dh/4, 0]}>
                <boxGeometry args={[dw - 0.4, dh * 0.4, 0.09]} />
                <meshStandardMaterial color="#d8e8f0" roughness={0.6} metalness={0.05} transparent opacity={0.55} depthWrite={false} /></mesh>
              
              {/* Symmetrical Handles */}
              {[-1, 1].map((side) => (
                <group key={`side-${side}`} position={[0, 0, 0.04 * side]}>
                  {/* Small lever handle */}
                  <mesh position={[side === 1 ? dw/2 - 0.35 : -dw/2 + 0.35, -0.15, 0.02 * side]}>
                    <boxGeometry args={[0.1, 0.35, 0.02]} />
                    <meshStandardMaterial color="#aaa" metalness={0.85} roughness={0.18} /></mesh>
                  <mesh position={[side === 1 ? dw/2 - 0.35 : -dw/2 + 0.35, -0.15, 0.04 * side]} rotation={[0, 0, Math.PI/2]}>
                    <cylinderGeometry args={[0.025, 0.025, 0.2, 6]} />
                    <meshStandardMaterial color="#bbb" metalness={0.85} roughness={0.18} /></mesh>
                </group>
              ))}
            </group>
          );
        }

        // ── ROOM DOOR — Clean panel design, matte wood finish ──
        const roomDoorColor = '#6a4528';
        return (
          <group key={`d-${i}`} position={[dx, dh/2, 0]}>
            {/* Standard frame */}
            <group>
              <mesh position={[0, dh/2 + 0.075, 0]}>
                <boxGeometry args={[dw + 0.3, 0.15, t + 0.1]} />
                <meshStandardMaterial color={frameColor} roughness={0.6} />
              </mesh>
              <mesh position={[-dw/2 - 0.075, 0, 0]}>
                <boxGeometry args={[0.15, dh, t + 0.1]} />
                <meshStandardMaterial color={frameColor} roughness={0.6} />
              </mesh>
              <mesh position={[dw/2 + 0.075, 0, 0]}>
                <boxGeometry args={[0.15, dh, t + 0.1]} />
                <meshStandardMaterial color={frameColor} roughness={0.6} />
              </mesh>
            </group>
            {/* Door panel — wood grain */}
            <mesh position={[0, 0, 0]}>
              <boxGeometry args={[dw, dh, 0.12]} />
              <meshStandardMaterial color={roomDoorColor} map={doorTextures?.map} normalMap={doorTextures?.normal} normalScale={new THREE.Vector2(0.4, 0.4)} roughness={0.5} metalness={0.04} envMapIntensity={0.6} /></mesh>
            
            {/* Symmetrical Details */}
            {[-1, 1].map((side) => (
              <group key={`side-${side}`} position={[0, 0, 0.06 * side]}>
                {/* Upper panel recess */}
                <mesh position={[0, dh/5, 0.02 * side]}>
                  <boxGeometry args={[dw - 0.6, dh * 0.35, 0.04]} />
                  <meshStandardMaterial color={roomDoorColor} map={doorTextures?.map} roughness={0.55} metalness={0.02} /></mesh>
                {/* Lower panel recess */}
                <mesh position={[0, -dh/5, 0.02 * side]}>
                  <boxGeometry args={[dw - 0.6, dh * 0.3, 0.04]} />
                  <meshStandardMaterial color={roomDoorColor} map={doorTextures?.map} roughness={0.55} metalness={0.02} /></mesh>
                {/* Round door knob */}
                <mesh position={[side === 1 ? dw/2 - 0.35 : -dw/2 + 0.35, -0.1, 0.05 * side]}>
                  <sphereGeometry args={[0.1, 12, 12]} />
                  <meshStandardMaterial color="#c0c0c0" metalness={0.8} roughness={0.2} /></mesh>
              </group>
            ))}
          </group>
        );
      })}

      {/* ── Windows — proportioned for taller walls ── */}
      {windows.map((win, i: number) => {
        const ww = 3.2;
        const wh = 3.2;
        const wy = 5.5 + wh/2;
        const wx = w * win.relPos - w/2;
        // Wall thickness is t. Center the window group at z=0.
        return (
          <group key={`w-${i}`} position={[wx, wy, 0]}>
            {/* 1. Main glass pane — bright sky-tinted reflective glass, reads as glass from both sides */}
            <mesh castShadow={false} receiveShadow={false}>
              <boxGeometry args={[ww, wh, 0.04]} />
              <meshPhysicalMaterial
                color="#cfe1ec"
                roughness={0.03}
                metalness={0.6}
                transparent
                opacity={0.65}
                ior={1.52}
                reflectivity={1.0}
                envMapIntensity={4}
                clearcoat={1.0}
                clearcoatRoughness={0.02}
                emissive="#9ec1d4"
                emissiveIntensity={0.35}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
            {/* Subtle inner highlight strip — adds gloss read */}
            <mesh position={[0, wh * 0.18, 0.025]} rotation={[0, 0, 0.18]}>
              <planeGeometry args={[ww * 0.95, 0.35]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.18} depthWrite={false} />
            </mesh>

            {/* 2. Wooden frame — perimeter only (4 thin strips through wall thickness) */}
            {/* Top rail */}
            <mesh position={[0, wh / 2 + 0.06, 0]}>
              <boxGeometry args={[ww + 0.18, 0.12, t + 0.04]} />
              <meshStandardMaterial color="#4a3425" roughness={0.6} metalness={0.05} />
            </mesh>
            {/* Bottom rail */}
            <mesh position={[0, -wh / 2 - 0.06, 0]}>
              <boxGeometry args={[ww + 0.18, 0.12, t + 0.04]} />
              <meshStandardMaterial color="#4a3425" roughness={0.6} metalness={0.05} />
            </mesh>
            {/* Left stile */}
            <mesh position={[-ww / 2 - 0.06, 0, 0]}>
              <boxGeometry args={[0.12, wh, t + 0.04]} />
              <meshStandardMaterial color="#4a3425" roughness={0.6} metalness={0.05} />
            </mesh>
            {/* Right stile */}
            <mesh position={[ww / 2 + 0.06, 0, 0]}>
              <boxGeometry args={[0.12, wh, t + 0.04]} />
              <meshStandardMaterial color="#4a3425" roughness={0.6} metalness={0.05} />
            </mesh>

            {/* 3. Slim glazing bars — cross dividers (thin so glass dominates) */}
            <mesh>
              <boxGeometry args={[ww, 0.05, 0.06]} />
              <meshStandardMaterial color="#4a3425" roughness={0.6} metalness={0.05} />
            </mesh>
            <mesh>
              <boxGeometry args={[0.05, wh, 0.06]} />
              <meshStandardMaterial color="#4a3425" roughness={0.6} metalness={0.05} />
            </mesh>

            {/* 3. Symmetrical casing on Front and Back — PERIMETER ONLY (was solid box, now 4 strips) */}
            {[-1, 1].map((side) => (
              <group key={side} position={[0, 0, (t / 2 + 0.05) * side]}>
                {/* Top casing */}
                <mesh position={[0, wh / 2 + 0.18, 0]}>
                  <boxGeometry args={[ww + 0.5, 0.22, 0.06]} />
                  <meshStandardMaterial color={frameColor} roughness={0.5} />
                </mesh>
                {/* Bottom casing */}
                <mesh position={[0, -wh / 2 - 0.18, 0]}>
                  <boxGeometry args={[ww + 0.5, 0.22, 0.06]} />
                  <meshStandardMaterial color={frameColor} roughness={0.5} />
                </mesh>
                {/* Left casing */}
                <mesh position={[-ww / 2 - 0.18, 0, 0]}>
                  <boxGeometry args={[0.22, wh + 0.5, 0.06]} />
                  <meshStandardMaterial color={frameColor} roughness={0.5} />
                </mesh>
                {/* Right casing */}
                <mesh position={[ww / 2 + 0.18, 0, 0]}>
                  <boxGeometry args={[0.22, wh + 0.5, 0.06]} />
                  <meshStandardMaterial color={frameColor} roughness={0.5} />
                </mesh>
                {/* Window sill — only on bottom edge */}
                <mesh position={[0, -wh / 2 - 0.4, 0.05]}>
                  <boxGeometry args={[ww + 0.8, 0.2, 0.28]} />
                  <meshStandardMaterial color={frameColor} roughness={0.4} />
                </mesh>
              </group>
            ))}
          </group>
        );
      })}
    </group>
  );
};

/* ─── Roofs ─── */
const GableRoof = ({ 
  W, D, cx, cz, wallH, color, trimColor, rodColor, transparent, opacity,
  cpAtLeft, cpAtRight, cpAtTop, cpAtBottom 
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}: any) => {
  const roofH = 6;
  const overhang = 2.5;
  
  // Adjust horizontal bounds based on carport adjacency to prevent floating gutters
  const leftOverhang = cpAtLeft ? 0.2 : overhang;
  const rightOverhang = cpAtRight ? 0.2 : overhang;
  const topOverhang = cpAtTop ? 0.2 : overhang;
  const bottomOverhang = cpAtBottom ? 0.2 : overhang;

  const hw_l = W / 2 + leftOverhang;
  const hw_r = W / 2 + rightOverhang;
  const hd_t = D / 2 + topOverhang;
  const hd_b = D / 2 + bottomOverhang;
  
  // For simplicity in the shape, we'll use a symmetrical base for the main gable if both sides are free
  // but if one side is blocked, we shift the peak? No, let's just use the max overhang for the shape width 
  // but truncate the visuals.
  const hw = W / 2 + overhang;
  const hd = D / 2 + overhang;

  const shape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-hw, 0);
    s.lineTo(0, roofH);
    s.lineTo(hw, 0);
    s.closePath();
    return s;
  }, [hw, roofH]);

  return (
    <group position={[cx, wallH + 0.8, cz - hd]}>
      {/* Main roof */}
      <mesh castShadow>
        <extrudeGeometry args={[shape, { steps: 1, depth: hd * 2, bevelEnabled: false }]} />
        <meshStandardMaterial
          color={color}
          roughness={0.82}
          metalness={0.05}
          side={THREE.DoubleSide}
          transparent={transparent}
          opacity={opacity}
          depthWrite={!transparent}
        />
      </mesh>
      {/* Ridge cap */}
      <mesh position={[0, roofH + 0.15, hd]}>
        <boxGeometry args={[0.5, 0.3, hd * 2 + 0.6]} />
        <meshStandardMaterial color={trimColor} roughness={0.4} metalness={0.3} transparent={transparent} opacity={opacity} depthWrite={!transparent} />
      </mesh>
      {/* Roof underlayment shadow line — gives depth to eave edge */}
      {!transparent && (
        <mesh position={[0, -0.08, hd]} castShadow>
          <boxGeometry args={[hw * 2 + 0.1, 0.06, 0.18]} />
          <meshStandardMaterial color="#111" roughness={0.6} />
        </mesh>
      )}
      {/* Ventilation ridge cap end caps */}
      {[0, hd * 2].map((zPos, zi) => (
        <mesh key={`cap-end-${zi}`} position={[0, roofH + 0.15, zPos - hd]}>
          <boxGeometry args={[0.55, 0.35, 0.18]} />
          <meshStandardMaterial color={trimColor} roughness={0.4} metalness={0.3} transparent={transparent} opacity={opacity} />
        </mesh>
      ))}
      {/* Standing Seam Ribs (High-detail architectural feature) */}
      {Array.from({ length: Math.floor(hd * 2 / 3) }).map((_, i) => (
        <group key={`rib-${i}`} position={[0, 0, i * 3 + 1.5]}>
          {[-1, 1].map((side) => {
            const angle = Math.atan2(roofH, hw) * -side;
            const len = Math.hypot(hw, roofH);
            return (
              <mesh key={side} position={[side * hw / 2, roofH / 2 + 0.05, 0]} rotation={[0, 0, angle]}>
                <boxGeometry args={[len, 0.08, 0.08]} />
                <meshStandardMaterial color={rodColor || trimColor} roughness={0.3} metalness={0.2} transparent={transparent} opacity={0.6} depthWrite={!transparent} />
              </mesh>
            );
          })}
        </group>
      ))}
      {/* Fascia boards (front & back gable edges) */}
      {[0, hd * 2].map((zPos, zi) => (
        <group key={zi} position={[0, 0, zPos + (zi === 0 ? -0.08 : 0.08)]}>
          {[-1, 1].map((side, si) => {
            const angle = Math.atan2(roofH, hw) * -side;
            const len = Math.hypot(hw, roofH);
            return (
              <mesh key={si} position={[side * hw / 2, roofH / 2, 0]} rotation={[0, 0, angle]}>
                <boxGeometry args={[len + 0.1, 0.4, 0.15]} />
                <meshStandardMaterial color={trimColor} roughness={0.5} metalness={0.1} transparent={transparent} opacity={opacity} depthWrite={!transparent} />
              </mesh>
            );
          })}
        </group>
      ))}
      {/* Eave / soffit trim (left & right overhangs) */}
      {[-1, 1].map((side, ei) => {
        if (side === -1 && cpAtLeft) return null;
        if (side === 1 && cpAtRight) return null;
        return (
          <mesh key={`eave-${ei}`} position={[side * hw, -0.1, hd]}>
            <boxGeometry args={[0.18, 0.3, hd * 2 + 0.5]} />
            <meshStandardMaterial color={trimColor} roughness={0.5} metalness={0.1} transparent={transparent} opacity={opacity} depthWrite={!transparent} />
          </mesh>
        );
      })}
      {/* Gutter line */}
      {[-1, 1].map((side, gi) => {
        if (side === -1 && cpAtLeft) return null;
        if (side === 1 && cpAtRight) return null;
        return (
          <mesh key={`gutter-${gi}`} position={[side * (hw + 0.08), -0.2, hd]}>
            <boxGeometry args={[0.1, 0.12, hd * 2 + 0.3]} />
            <meshStandardMaterial color="#8a8a8a" roughness={0.3} metalness={0.4} transparent={transparent} opacity={opacity} depthWrite={!transparent} />
          </mesh>
        );
      })}
    </group>
  );
};

const FlatRoof = ({ 
  W, D, cx, cz, wallH, color, transparent, opacity,
  cpAtLeft, cpAtRight, cpAtTop, cpAtBottom,
  hole
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}: any) => {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    const rw = W + (cpAtLeft ? 0 : 1.25) + (cpAtRight ? 0 : 1.25);
    const rh = D + (cpAtTop ? 0 : 1.25) + (cpAtBottom ? 0 : 1.25);
    
    s.moveTo(-rw/2, -rh/2);
    s.lineTo(rw/2, -rh/2);
    s.lineTo(rw/2, rh/2);
    s.lineTo(-rw/2, rh/2);
    s.closePath();
    
    if (hole) {
      const holesArr = Array.isArray(hole) ? hole : [hole];
      holesArr.forEach(hRect => {
        const hPath = new THREE.Path();
        hPath.moveTo(hRect.x - hRect.w/2, hRect.z - hRect.h/2);
        hPath.lineTo(hRect.x + hRect.w/2, hRect.z - hRect.h/2);
        hPath.lineTo(hRect.x + hRect.w/2, hRect.z + hRect.h/2);
        hPath.lineTo(hRect.x - hRect.w/2, hRect.z + hRect.h/2);
        hPath.closePath();
        s.holes.push(hPath);
      });
    }
    return s;
  }, [W, D, cpAtLeft, cpAtRight, cpAtTop, cpAtBottom, hole]);

  return (
    <group position={[cx, wallH + 0.8, cz]}>
      {/* Main slab */}
      <mesh castShadow rotation={[-Math.PI / 2, 0, 0]}>
        <extrudeGeometry args={[shape, { depth: 0.8, bevelEnabled: false }]} />
        <meshStandardMaterial color={color} roughness={0.65} transparent={transparent} opacity={opacity} depthWrite={!transparent} />
      </mesh>
      {/* Parapet walls */}
      {[[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dz], i) => {
        if (dx === -1 && cpAtLeft) return null;
        if (dx === 1 && cpAtRight) return null;
        if (dz === -1 && cpAtTop) return null;
        if (dz === 1 && cpAtBottom) return null;
        return (
          <mesh key={i} position={[dx * (W / 2 + 1), 0.7, dz * (D / 2 + 1)]}>
            <boxGeometry args={[dx ? 0.35 : W + 2.5, 1, dz ? 0.35 : D + 2.5]} />
            <meshStandardMaterial color={color} roughness={0.65} transparent={transparent} opacity={opacity} depthWrite={!transparent} />
          </mesh>
        );
      })}
      {/* Parapet cap / coping */}
      {[[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dz], i) => {
        if (dx === -1 && cpAtLeft) return null;
        if (dx === 1 && cpAtRight) return null;
        if (dz === -1 && cpAtTop) return null;
        if (dz === 1 && cpAtBottom) return null;
        return (
          <mesh key={`cap-${i}`} position={[dx * (W / 2 + 1), 1.25, dz * (D / 2 + 1)]}>
            <boxGeometry args={[dx ? 0.5 : W + 2.8, 0.12, dz ? 0.5 : D + 2.8]} />
            <meshStandardMaterial color="#888" roughness={0.35} metalness={0.2} transparent={transparent} opacity={opacity} depthWrite={!transparent} />
          </mesh>
        );
      })}
      {/* Drainage scuppers — small rectangular cutouts in parapet base */}
      {[[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dz], i) => {
        if (dx === -1 && cpAtLeft) return null;
        if (dx === 1 && cpAtRight) return null;
        if (dz === -1 && cpAtTop) return null;
        if (dz === 1 && cpAtBottom) return null;
        return (
          <mesh key={`scupper-${i}`} position={[dx * (W / 2 + 1), 0.35, dz * (D / 2 + 1)]}>
            <boxGeometry args={[dx ? 0.36 : 0.8, 0.22, dz ? 0.36 : 0.8]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.5} />
          </mesh>
        );
      })}
      {/* Standing seam metal detail on parapet face */}
      {!transparent && [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dz], i) => {
        if (dx === -1 && cpAtLeft) return null;
        if (dx === 1 && cpAtRight) return null;
        if (dz === -1 && cpAtTop) return null;
        if (dz === 1 && cpAtBottom) return null;
        const isH = dx !== 0;
        const faceLen = isH ? D + 2.5 : W + 2.5;
        const seamCount = Math.floor(faceLen / 1.8);
        return Array.from({ length: seamCount }).map((_, si) => (
          <mesh
            key={`seam-${i}-${si}`}
            position={[
              dx * (W / 2 + 1) + (isH ? 0 : -faceLen / 2 + si * 1.8 + 0.9),
              0.78,
              dz * (D / 2 + 1) + (isH ? -faceLen / 2 + si * 1.8 + 0.9 : 0),
            ]}
          >
            <boxGeometry args={[isH ? 0.04 : 1.75, 1.05, isH ? 1.75 : 0.04]} />
            <meshStandardMaterial color="#777" roughness={0.3} metalness={0.5} />
          </mesh>
        ));
      })}
    </group>
  );
};

/* ─── Add-ons ─── */
const SolarPanels = ({ minX, maxX, minZ, maxZ, roofType, wallH }: { minX: number; maxX: number; minZ: number; maxZ: number; roofType: RoofType; wallH: number }) => {
  const isFlat = roofType === 'flat';
  const margin = 2;
  const tankSpace = 4; // reserve space for water tank

  const panelW = 3.5;
  const panelD = 5;
  const gap = 1;

  const startX = minX + margin;
  const startZ = minZ + margin;

  const widthAvailable = (maxX - minX) - margin * 2;
  const cols = Math.max(1, Math.floor(widthAvailable / (panelW + gap)));
  
  const panels = [];
  
  if (isFlat) {
    const depthAvailable = (maxZ - minZ) - margin * 2;
    const rows = Math.max(1, Math.floor(depthAvailable / (panelD + gap)));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = startX + c * (panelW + gap) + panelW/2;
        const pz = startZ + r * (panelD + gap) + panelD/2;
        
        // Prevent overlap with tank corner
        if (px > maxX - tankSpace - margin && pz > maxZ - tankSpace - margin) continue;
        
        panels.push(
          <mesh key={`${r}-${c}`} position={[px, wallH + 1.8, pz]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
            <boxGeometry args={[panelW, panelD, 0.2]} />
            <meshStandardMaterial color="#1a2a4a" metalness={0.8} roughness={0.2} />
          </mesh>
        );
      }
    }
  } else {
    // Gable Roof (Ridge along Z)
    const centerX = (minX + maxX) / 2;
    const roofH = 6;
    const overhang = 2.5;
    const run = (maxX - minX) / 2 + overhang;
    const angle = Math.atan2(roofH, run);
    
    const depthAvailable = (maxZ - minZ) - margin * 2;
    const rows = Math.max(1, Math.floor(depthAvailable / (panelD + gap)));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px_raw = startX + c * (panelW + gap) + panelW/2;
        const pz = startZ + r * (panelD + gap) + panelD/2;
        
        const isLeft = px_raw < centerX;
        let px = px_raw;
        if (isLeft) {
          px = Math.min(px, centerX - 3);
        } else {
          px = Math.max(px, centerX + 3);
        }

        const distFromCenter = Math.abs(px - centerX);
        const heightOnSlope = (1 - distFromCenter / run) * roofH;
        const py = wallH + 0.8 + heightOnSlope + 0.15; 

        // Tilt angle for the group
        const rotZ = isLeft ? angle : -angle;

        panels.push(
          <group key={`g-${r}-${c}`} position={[px, py, pz]} rotation={[0, 0, rotZ]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} castShadow>
              {/* Swap W and D: 5 units along the slope (X), 3.5 units along the ridge (Z) */}
              <boxGeometry args={[5, 3.5, 0.12]} />
              <meshStandardMaterial color="#0a1224" metalness={0.95} roughness={0.05} />
            </mesh>
          </group>
        );
      }
    }
  }

  return <group>{panels}</group>;
};

const WaterTank = ({ maxX, maxZ, wallH, roofType }: { maxX: number; maxZ: number; wallH: number; roofType: RoofType }) => {
  const margin = 2;
  const tankHeight = 3;
  const tankRadius = 1.5;
  
  const x = maxX - margin - tankRadius;
  const z = maxZ - margin - tankRadius;
  
  const y = wallH + (roofType === 'flat' ? 1.2 : 3) + tankHeight / 2;

  return (
    <group position={[x, y, z]}>
      <mesh castShadow>
        <cylinderGeometry args={[tankRadius, tankRadius, tankHeight, 16]} />
        <meshStandardMaterial color="#e0e0e0" roughness={0.4} metalness={0.1} />
      </mesh>
    </group>
  );
};

const GarageDriveway = ({ plan, plotW, plotD, isNight }: { plan: Plan; plotW: number; plotD: number; isNight: boolean }) => {
  const garage = (plan.rooms || []).find(r => r.type === 'garage');
  if (!garage) return null;

  const halfPlotW = plotW / 2;
  const halfPlotD = plotD / 2;
  const garageElevation = 0.8;
  const rampL = 3.0; // ramp length

  const frontWalls: ('top' | 'bottom' | 'left' | 'right')[] = ['bottom', 'left', 'top', 'right'];
  const doorWall = frontWalls[garage.orientation || 0];

  let rampCX = 0;
  let rampCZ = 0;
  let rampRotY = 0;
  let rampH = garage.w;
  
  let dwW = 0;
  let dwD = 0;
  let dwCX = 0;
  let dwCZ = 0;
  let isVertical = false;

  const planW = plan.width;
  const planH = plan.height;

  if (doorWall === 'bottom') {
    const gCX = garage.x + garage.w / 2 - planW / 2;
    const gCZ = garage.y + garage.h - planH / 2;
    rampH = garage.w;
    rampCX = gCX;
    rampCZ = gCZ + rampL / 2;
    rampRotY = 0;

    const dwMinX = gCX - rampH / 2 + 0.6;
    const dwMaxX = gCX + rampH / 2 - 0.6;
    const dwMinZ = gCZ + rampL;
    const dwMaxZ = halfPlotD;
    dwW = dwMaxX - dwMinX;
    dwD = Math.max(0.1, dwMaxZ - dwMinZ);
    dwCX = (dwMinX + dwMaxX) / 2;
    dwCZ = (dwMinZ + dwMaxZ) / 2;
    isVertical = true;
  } else if (doorWall === 'top') {
    const gCX = garage.x + garage.w / 2 - planW / 2;
    const gCZ = garage.y - planH / 2;
    rampH = garage.w;
    rampCX = gCX;
    rampCZ = gCZ - rampL / 2;
    rampRotY = Math.PI;

    const dwMinX = gCX - rampH / 2 + 0.6;
    const dwMaxX = gCX + rampH / 2 - 0.6;
    const dwMinZ = -halfPlotD;
    const dwMaxZ = gCZ - rampL;
    dwW = dwMaxX - dwMinX;
    dwD = Math.max(0.1, dwMaxZ - dwMinZ);
    dwCX = (dwMinX + dwMaxX) / 2;
    dwCZ = (dwMinZ + dwMaxZ) / 2;
    isVertical = true;
  } else if (doorWall === 'left') {
    const gCX = garage.x - planW / 2;
    const gCZ = garage.y + garage.h / 2 - planH / 2;
    rampH = garage.h;
    rampCX = gCX - rampL / 2;
    rampCZ = gCZ;
    rampRotY = Math.PI / 2;

    const dwMinX = -halfPlotW;
    const dwMaxX = gCX - rampL;
    const dwMinZ = gCZ - rampH / 2 + 0.6;
    const dwMaxZ = gCZ + rampH / 2 - 0.6;
    dwW = Math.max(0.1, dwMaxX - dwMinX);
    dwD = dwMaxZ - dwMinZ;
    dwCX = (dwMinX + dwMaxX) / 2;
    dwCZ = (dwMinZ + dwMaxZ) / 2;
    isVertical = false;
  } else { // right
    const gCX = garage.x + garage.w - planW / 2;
    const gCZ = garage.y + garage.h / 2 - planH / 2;
    rampH = garage.h;
    rampCX = gCX + rampL / 2;
    rampCZ = gCZ;
    rampRotY = -Math.PI / 2;

    const dwMinX = gCX + rampL;
    const dwMaxX = halfPlotW;
    const dwMinZ = gCZ - rampH / 2 + 0.6;
    const dwMaxZ = gCZ + rampH / 2 - 0.6;
    dwW = Math.max(0.1, dwMaxX - dwMinX);
    dwD = dwMaxZ - dwMinZ;
    dwCX = (dwMinX + dwMaxX) / 2;
    dwCZ = (dwMinZ + dwMaxZ) / 2;
    isVertical = false;
  }

  const rampAngle = Math.atan2(garageElevation, rampL);
  const rampHypot = Math.hypot(garageElevation, rampL);

  return (
    <group>
      {/* Ramp from 0 to 0.8 */}
      <mesh position={[rampCX, garageElevation / 2, rampCZ]} rotation={[rampAngle, rampRotY, 0]} receiveShadow castShadow>
        <boxGeometry args={[rampH - 1.2, 0.08, rampHypot]} />
        <meshStandardMaterial color="#555558" roughness={0.88} />
      </mesh>

      {/* Main Driveway Slab (Pavers/Concrete) */}
      {dwW > 0.5 && dwD > 0.5 && (
        <group position={[dwCX, 0.01, dwCZ]}>
          {/* Main slab */}
          <mesh receiveShadow>
            <boxGeometry args={[dwW, 0.02, dwD]} />
            <meshStandardMaterial color="#3a3a3d" roughness={0.8} />
          </mesh>

          {/* Premium Paver Grid Overlay lines */}
          {isVertical ? (
            <>
              {Array.from({ length: Math.ceil(dwD / 2) }).map((_, i) => (
                <mesh key={`pLine-${i}`} position={[0, 0.011, -dwD/2 + i * 2]} rotation={[-Math.PI / 2, 0, 0]}>
                  <planeGeometry args={[dwW, 0.02]} />
                  <meshBasicMaterial color="#1a1a1a" transparent opacity={0.6} />
                </mesh>
              ))}
              {Array.from({ length: Math.ceil(dwW / 3) }).map((_, i) => (
                <mesh key={`pCol-${i}`} position={[-dwW/2 + i * 3, 0.011, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                  <planeGeometry args={[0.02, dwD]} />
                  <meshBasicMaterial color="#1a1a1a" transparent opacity={0.6} />
                </mesh>
              ))}
            </>
          ) : (
            <>
              {Array.from({ length: Math.ceil(dwW / 2) }).map((_, i) => (
                <mesh key={`pLine-${i}`} position={[-dwW/2 + i * 2, 0.011, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                  <planeGeometry args={[0.02, dwD]} />
                  <meshBasicMaterial color="#1a1a1a" transparent opacity={0.6} />
                </mesh>
              ))}
              {Array.from({ length: Math.ceil(dwD / 3) }).map((_, i) => (
                <mesh key={`pCol-${i}`} position={[0, 0.011, -dwD/2 + i * 3]} rotation={[-Math.PI / 2, 0, 0]}>
                  <planeGeometry args={[dwW, 0.02]} />
                  <meshBasicMaterial color="#1a1a1a" transparent opacity={0.6} />
                </mesh>
              ))}
            </>
          )}

          {/* Subtle LED Edge Lighting */}
          {isNight && (
            <group>
              {isVertical ? (
                <>
                  <mesh position={[-dwW / 2 - 0.1, 0.03, 0]}>
                    <boxGeometry args={[0.04, 0.03, dwD]} />
                    <meshBasicMaterial color="#ffcc80" toneMapped={false} />
                  </mesh>
                  <mesh position={[dwW / 2 + 0.1, 0.03, 0]}>
                    <boxGeometry args={[0.04, 0.03, dwD]} />
                    <meshBasicMaterial color="#ffcc80" toneMapped={false} />
                  </mesh>
                </>
              ) : (
                <>
                  <mesh position={[0, 0.03, -dwD / 2 - 0.1]}>
                    <boxGeometry args={[dwW, 0.03, 0.04]} />
                    <meshBasicMaterial color="#ffcc80" toneMapped={false} />
                  </mesh>
                  <mesh position={[0, 0.03, dwD / 2 + 0.1]}>
                    <boxGeometry args={[dwW, 0.03, 0.04]} />
                    <meshBasicMaterial color="#ffcc80" toneMapped={false} />
                  </mesh>
                </>
              )}
            </group>
          )}
        </group>
      )}
    </group>
  );
};

const GarageInterior = ({ r, cx, cz, isNight, wallH = 10 }: { r: Plan['rooms'][number]; cx: number; cz: number; isNight: boolean; wallH?: number }) => {
  const w = r.w;
  const h = r.h;
  const t = 0.4;

  const orient = r.orientation || 0;
  const rotationY = -orient * Math.PI / 2;

  const EpoxyFloor = () => (
    <group position={[0, 0.02, 0]}>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w - t * 2, h - t * 2]} />
        <meshStandardMaterial color="#111318" roughness={0.04} metalness={0.55} envMapIntensity={3} />
      </mesh>
      {Array.from({ length: Math.ceil((w - t * 2) / 1.5) }).map((_, i) => (
        <mesh key={`gx-${i}`} position={[-(w - t * 2) / 2 + i * 1.5, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.015, h - t * 2]} />
          <meshBasicMaterial color="#1e2430" transparent opacity={0.7} />
        </mesh>
      ))}
      {Array.from({ length: Math.ceil((h - t * 2) / 1.5) }).map((_, i) => (
        <mesh key={`gz-${i}`} position={[0, 0.001, -(h - t * 2) / 2 + i * 1.5]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[w - t * 2, 0.015]} />
          <meshBasicMaterial color="#1e2430" transparent opacity={0.7} />
        </mesh>
      ))}
      <mesh position={[0, 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w - t * 2 - 1.5, 0.06]} />
        <meshBasicMaterial color="#f5c518" />
      </mesh>
      <mesh position={[0, 0.003, -(h - t * 2) / 2 + 0.06]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w - t * 2, 0.12]} />
        <meshBasicMaterial color="#f5c518" transparent opacity={0.6} />
      </mesh>
      <mesh position={[0, 0.003, (h - t * 2) / 2 - 0.06]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w - t * 2, 0.12]} />
        <meshBasicMaterial color="#f5c518" transparent opacity={0.6} />
      </mesh>
    </group>
  );

  const CeilingLighting = () => (
    <group position={[0, wallH - 0.1, 0]}>
      <mesh>
        <boxGeometry args={[w - t * 2, 0.05, h - t * 2]} />
        <meshStandardMaterial color="#0d0f12" roughness={0.85} />
      </mesh>
      {[-w * 0.28, 0, w * 0.28].map((xOff, idx) => (
        <group key={idx} position={[xOff, -0.02, 0]}>
          <mesh>
            <boxGeometry args={[0.25, 0.06, h - t * 2 - 1]} />
            <meshStandardMaterial color="#1a1e24" roughness={0.6} metalness={0.4} />
          </mesh>
          <mesh position={[0, -0.04, 0]}>
            <boxGeometry args={[0.18, 0.02, h - t * 2 - 1.2]} />
            <meshBasicMaterial color="#ffffff" toneMapped={false} />
          </mesh>
          <pointLight position={[0, -1.5, 0]} intensity={isNight ? 4 : 2.5} distance={18} color="#f5f0e8" castShadow={false} />
        </group>
      ))}
      {[[-w * 0.42, -h * 0.38], [w * 0.42, -h * 0.38], [-w * 0.42, h * 0.38], [w * 0.42, h * 0.38]].map(([xo, zo], i) => (
        <group key={`dl-${i}`} position={[xo, -0.03, zo]}>
          <mesh>
            <cylinderGeometry args={[0.18, 0.18, 0.04, 16]} />
            <meshStandardMaterial color="#0a0a0a" roughness={0.3} />
          </mesh>
          <mesh position={[0, -0.01, 0]}>
            <cylinderGeometry args={[0.12, 0.12, 0.01, 16]} />
            <meshBasicMaterial color="#fff8e0" toneMapped={false} />
          </mesh>
          <spotLight position={[0, -0.1, 0]} angle={0.45} penumbra={0.4} intensity={isNight ? 3 : 1.5} distance={12} color="#fff5d0">
            <object3D attach="target" position={[0, -8, 0]} />
          </spotLight>
        </group>
      ))}
    </group>
  );

  const CarLift = ({ xPos }: { xPos: number }) => (
    <group position={[xPos, 0.02, 0]}>
      <mesh castShadow receiveShadow position={[0, 0.08, 0]}>
        <boxGeometry args={[w * 0.42, 0.16, h * 0.72]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.3} metalness={0.8} />
      </mesh>
      {[[-w * 0.21, 0], [w * 0.21, 0]].map(([xo], i) => (
        <mesh key={i} position={[xo, 0.17, 0]}>
          <boxGeometry args={[0.06, 0.02, h * 0.72]} />
          <meshBasicMaterial color="#f5c518" />
        </mesh>
      ))}
      {[0, -h * 0.36, h * 0.36].map((zo, i) => (
        i > 0 ? (
          <mesh key={i} position={[0, 0.17, zo]}>
            <boxGeometry args={[w * 0.42, 0.02, 0.06]} />
            <meshBasicMaterial color="#f5c518" />
          </mesh>
        ) : null
      ))}
      {[[-w * 0.19, -h * 0.32], [w * 0.19, -h * 0.32], [-w * 0.19, h * 0.32], [w * 0.19, h * 0.32]].map(([xo, zo], i) => (
        <mesh key={`col-${i}`} position={[xo, 1.0, zo]} castShadow>
          <cylinderGeometry args={[0.06, 0.08, 2.0, 12]} />
          <meshStandardMaterial color="#2a2a2a" metalness={0.9} roughness={0.1} />
        </mesh>
      ))}
      <mesh position={[0, 2.08, 0]} castShadow>
        <boxGeometry args={[w * 0.42 - 0.1, 0.12, 0.14]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.85} roughness={0.15} />
      </mesh>
    </group>
  );

  const WallStorage = () => (
    <group position={[w / 2 - t - 0.08, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
      <mesh position={[0, wallH / 2, 0]}>
        <boxGeometry args={[h - t * 2, wallH, 0.06]} />
        <meshStandardMaterial color="#0d0f12" roughness={0.7} />
      </mesh>
      {Array.from({ length: Math.floor((h - t * 2) / 3.2) }).map((_, i) => {
        const zOff = -(h - t * 2) / 2 + i * 3.2 + 1.6;
        return (
          <group key={`cab-${i}`} position={[zOff, 1.6, 0.04]}>
            <mesh castShadow>
              <boxGeometry args={[3.0, 3.2, 0.85]} />
              <meshStandardMaterial color="#111620" roughness={0.4} metalness={0.6} />
            </mesh>
            {[-0.72, 0.72].map((xo, di) => (
              <group key={di}>
                <mesh position={[xo, 0, 0.44]}>
                  <boxGeometry args={[1.35, 3.05, 0.04]} />
                  <meshStandardMaterial color="#1a2030" roughness={0.2} metalness={0.8} />
                </mesh>
                <mesh position={[xo * 0.55, 0, 0.47]}>
                  <boxGeometry args={[0.06, 0.8, 0.04]} />
                  <meshStandardMaterial color="#c9a84c" roughness={0.1} metalness={0.95} />
                </mesh>
              </group>
            ))}
            <mesh position={[0, -1.62, 0.38]}>
              <boxGeometry args={[2.9, 0.03, 0.04]} />
              <meshBasicMaterial color="#ff8c00" toneMapped={false} />
            </mesh>
            {isNight && <pointLight position={[0, -1.8, 0.5]} intensity={0.8} distance={4} color="#ff8c00" />}
          </group>
        );
      })}
      {[4.2, 6.0, 7.8].map((y, i) => (
        <mesh key={`shelf-${i}`} position={[0, y, 0.04]}>
          <boxGeometry args={[h - t * 2 - 0.4, 0.08, 0.55]} />
          <meshStandardMaterial color="#1e2535" roughness={0.3} metalness={0.7} />
        </mesh>
      ))}
    </group>
  );

  const ToolWall = () => (
    <group position={[-w / 2 + t + 0.08, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
      <mesh position={[0, wallH * 0.55, 0]}>
        <boxGeometry args={[h - t * 2, wallH * 0.7, 0.05]} />
        <meshStandardMaterial color="#0a0c10" roughness={0.85} />
      </mesh>
      <mesh position={[0, wallH * 0.55, 0.03]}>
        <boxGeometry args={[h - t * 2 - 0.2, wallH * 0.7 - 0.2, 0.01]} />
        <meshStandardMaterial color="#111520" roughness={0.9} />
      </mesh>
      {[-h * 0.3, -h * 0.1, h * 0.1, h * 0.3].map((zo, i) => (
        <group key={`tool-${i}`} position={[zo, wallH * 0.65, 0.06]}>
          <mesh rotation={[0, 0, Math.PI * 0.1 * (i % 2 === 0 ? 1 : -1)]}>
            <boxGeometry args={[0.08, 1.2, 0.03]} />
            <meshStandardMaterial color="#3a3a3a" metalness={0.9} roughness={0.15} />
          </mesh>
          <mesh position={[0, 0.55, 0]}>
            <sphereGeometry args={[0.14, 8, 6]} />
            <meshStandardMaterial color="#3a3a3a" metalness={0.9} roughness={0.15} />
          </mesh>
        </group>
      ))}
      <group position={[0, 2.2, 0.08]}>
        <mesh castShadow>
          <boxGeometry args={[3.5, 4.4, 0.9]} />
          <meshStandardMaterial color="#8b0000" roughness={0.3} metalness={0.5} />
        </mesh>
        {[0.8, 0, -0.8, -1.6].map((y, i) => (
          <group key={i}>
            <mesh position={[0, y, 0.48]}>
              <boxGeometry args={[3.3, 0.62, 0.04]} />
              <meshStandardMaterial color="#6b0000" roughness={0.2} metalness={0.6} />
            </mesh>
            <mesh position={[0, y, 0.52]}>
              <boxGeometry args={[1.2, 0.08, 0.03]} />
              <meshStandardMaterial color="#c9a84c" roughness={0.1} metalness={0.9} />
            </mesh>
          </group>
        ))}
      </group>
      <group position={[h * 0.38, 1.8, 0.08]}>
        <mesh castShadow>
          <boxGeometry args={[1.2, 2.4, 0.55]} />
          <meshStandardMaterial color="#0d1117" roughness={0.2} metalness={0.9} />
        </mesh>
        <mesh position={[0, 0.4, 0.29]}>
          <boxGeometry args={[0.75, 0.55, 0.02]} />
          <meshBasicMaterial color={isNight ? '#00e676' : '#004d26'} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.9, 0.29]}>
          <boxGeometry args={[1.1, 0.06, 0.01]} />
          <meshBasicMaterial color="#00b4ff" toneMapped={false} />
        </mesh>
        <mesh position={[0.35, -0.5, 0.35]} rotation={[0, 0, Math.PI / 6]}>
          <cylinderGeometry args={[0.04, 0.04, 1.8, 8]} />
          <meshStandardMaterial color="#111" roughness={0.8} />
        </mesh>
        <mesh position={[0, -0.6, 0.29]}>
          <torusGeometry args={[0.22, 0.04, 8, 24]} />
          <meshBasicMaterial color={isNight ? '#00e676' : '#005522'} toneMapped={false} />
        </mesh>
        {isNight && <pointLight position={[0, 0.5, 0.8]} intensity={1.2} distance={5} color="#00b4ff" />}
      </group>
    </group>
  );

  const Cars = () => (
    <>
      <group position={[-w * 0.24, 0.18, h * 0.04]} rotation={[0, 0, 0]} scale={[4.5, 4.5, 4.5]}>
        <ParkedCar color="#0a0f1e" accent="#080808" />
      </group>
      <group position={[w * 0.24, 0.18, h * 0.04]} rotation={[0, 0, 0]} scale={[4.5, 4.5, 4.5]}>
        <ParkedCar color="#3d0000" accent="#080808" />
      </group>
    </>
  );

  const GlassPartition = () => (
    <group position={[0, wallH / 2 - 0.5, -h / 2 + t + 0.1]}>
      <mesh>
        <boxGeometry args={[w - t * 2, wallH - 1, 0.08]} />
        <meshStandardMaterial color="#0d0f12" roughness={0.4} metalness={0.8} />
      </mesh>
      {Array.from({ length: Math.floor((w - t * 2) / 2.5) }).map((_, i) => (
        <mesh key={i} position={[-(w - t * 2) / 2 + i * 2.5 + 1.2, 0, 0.05]}>
          <boxGeometry args={[2.2, wallH - 1.4, 0.04]} />
          <meshPhysicalMaterial color="#8ab8cc" transmission={0.85} roughness={0.06} metalness={0.05} envMapIntensity={2} clearcoat={1} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );

  const RearWallFeature = () => (
    <group position={[0, wallH / 2, h / 2 - t - 0.05]}>
      <mesh>
        <boxGeometry args={[w - t * 2, wallH, 0.12]} />
        <meshStandardMaterial color="#080a0d" roughness={0.6} metalness={0.1} />
      </mesh>
      {[wallH * 0.25, wallH * 0.5, wallH * 0.75].map((y, i) => (
        <mesh key={i} position={[0, y - wallH / 2, 0.07]}>
          <boxGeometry args={[w - t * 2 - 0.4, 0.04, 0.02]} />
          <meshBasicMaterial color={isNight ? '#c9a84c' : '#8a7030'} toneMapped={false} />
        </mesh>
      ))}
      <mesh position={[0, 1.5, 0.08]}>
        <boxGeometry args={[4.5, 1.2, 0.04]} />
        <meshStandardMaterial color="#111620" roughness={0.2} metalness={0.9} />
      </mesh>
      <mesh position={[0, 2.2, 0.08]}>
        <boxGeometry args={[4.2, 0.06, 0.03]} />
        <meshBasicMaterial color={isNight ? '#00b4ff' : '#003355'} toneMapped={false} />
      </mesh>
      {isNight && <pointLight position={[0, 2.5, 1.5]} intensity={2} distance={10} color="#00b4ff" />}
    </group>
  );

  return (
    <group position={[cx, 0, cz]} rotation={[0, rotationY, 0]}>
      <EpoxyFloor />
      <CeilingLighting />
      <WallStorage />
      <ToolWall />
      <Cars />
      <GlassPartition />
      <RearWallFeature />
      <CarLift xPos={-w * 0.24} />
      <CarLift xPos={w * 0.24} />
    </group>
  );
}

const GarageRoof = ({ garage, planW, planH, wallH, colors, wallTextures }: { garage: Plan['rooms'][number]; planW: number; planH: number; wallH: number; colors: Record<string, string>; wallTextures: Record<string, THREE.Texture> }) => {
  const gCX = garage.x + garage.w / 2 - planW / 2;
  const gCZ = garage.y + garage.h / 2 - planH / 2;
  const gw = garage.w;
  const gd = garage.h;
  const t = 0.4;
  const parapetH = 1.8; // Parapet height

  return (
    <group position={[gCX, wallH, gCZ]}>
      {/* Roof Slab */}
      <mesh position={[0, -0.1, 0]} castShadow receiveShadow>
        <boxGeometry args={[gw + 0.2, 0.2, gd + 0.2]} />
        <meshStandardMaterial color={colors.trim} roughness={0.6} />
      </mesh>

      {/* Parapet Walls */}
      <mesh position={[0, parapetH / 2, gd / 2 - t / 2]} castShadow receiveShadow>
        <boxGeometry args={[gw, parapetH, t]} />
        <meshStandardMaterial color={colors.wall} map={wallTextures?.map} normalMap={wallTextures?.normal} roughness={0.9} />
      </mesh>
      <mesh position={[0, parapetH / 2, -gd / 2 + t / 2]} castShadow receiveShadow>
        <boxGeometry args={[gw, parapetH, t]} />
        <meshStandardMaterial color={colors.wall} map={wallTextures?.map} normalMap={wallTextures?.normal} roughness={0.9} />
      </mesh>
      <mesh position={[-gw / 2 + t / 2, parapetH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[t, parapetH, gd - 2 * t]} />
        <meshStandardMaterial color={colors.wall} map={wallTextures?.map} normalMap={wallTextures?.normal} roughness={0.9} />
      </mesh>
      <mesh position={[gw / 2 - t / 2, parapetH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[t, parapetH, gd - 2 * t]} />
        <meshStandardMaterial color={colors.wall} map={wallTextures?.map} normalMap={wallTextures?.normal} roughness={0.9} />
      </mesh>

      {/* Metal Trim Cap on Parapets (4 thin border cap segments instead of a solid box) */}
      {/* Front Trim */}
      <mesh position={[0, parapetH, gd / 2 - t / 2]} castShadow>
        <boxGeometry args={[gw + 0.08, 0.08, t + 0.08]} />
        <meshStandardMaterial color={colors.trim} roughness={0.5} />
      </mesh>
      {/* Back Trim */}
      <mesh position={[0, parapetH, -gd / 2 + t / 2]} castShadow>
        <boxGeometry args={[gw + 0.08, 0.08, t + 0.08]} />
        <meshStandardMaterial color={colors.trim} roughness={0.5} />
      </mesh>
      {/* Left Trim */}
      <mesh position={[-gw / 2 + t / 2, parapetH, 0]} castShadow>
        <boxGeometry args={[t + 0.08, 0.08, gd - 2 * t]} />
        <meshStandardMaterial color={colors.trim} roughness={0.5} />
      </mesh>
      {/* Right Trim */}
      <mesh position={[gw / 2 - t / 2, parapetH, 0]} castShadow>
        <boxGeometry args={[t + 0.08, 0.08, gd - 2 * t]} />
        <meshStandardMaterial color={colors.trim} roughness={0.5} />
      </mesh>
    </group>
  );
};

/* Realistic parked car loaded from a real 3D model (GLB).
   The model is normalized to length CAR_TARGET_LENGTH along +/- Z so existing
   callers (carport + garage) keep working with their current position/rotation/scale. */
const CAR_MODEL_URL = '/models/car.glb';
const CAR_TARGET_LENGTH = 2.4; // local units — normalized car length

const ParkedCar = ({ color = '#1f2937' }: { color?: string; accent?: string }) => {
  const { scene } = useGLTF(CAR_MODEL_URL);

  const model = useMemo(() => {
    const root = scene.clone(true);

    // Re-skin using material names (more precise than mesh names for this GLB).
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const matName = (mat?.name || mesh.name).toLowerCase();
      if (matName === 'body' || matName === 'body_2') {
        mesh.material = new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(color),
          metalness: 0.82,
          roughness: 0.26,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
          envMapIntensity: 1.4,
        });
      } else if (matName === 'grills') {
        mesh.material = new THREE.MeshStandardMaterial({ color: '#0a0a0a', roughness: 0.45, metalness: 0.8 });
      } else if (matName === 'bottom') {
        mesh.material = new THREE.MeshStandardMaterial({ color: '#111214', roughness: 0.9, metalness: 0.1 });
      } else if (matName === 'window') {
        mesh.material = new THREE.MeshPhysicalMaterial({
          color: new THREE.Color('#0c1422'),
          metalness: 0.1, roughness: 0.04,
          transmission: 0.62, transparent: true, opacity: 0.65,
          clearcoat: 1, ior: 1.45,
        });
      } else if (matName === 'headlights') {
        mesh.material = new THREE.MeshPhysicalMaterial({
          color: '#f0f6ff', roughness: 0.05, metalness: 0.1,
          transmission: 0.4, transparent: true, opacity: 0.92,
          clearcoat: 1, emissive: new THREE.Color('#fff8e0'), emissiveIntensity: 0.35,
        });
      } else if (matName === 'brakelights' || matName === 'tailights') {
        mesh.material = new THREE.MeshStandardMaterial({ color: '#7a0000', emissive: new THREE.Color('#cc1111'), emissiveIntensity: 0.5, roughness: 0.3 });
      } else if (matName === 'reverselights') {
        mesh.material = new THREE.MeshStandardMaterial({ color: '#ddeeff', roughness: 0.2 });
      } else if (matName.includes('paint') || matName.includes('carrosserie')) {
        mesh.material = new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(color), metalness: 0.85, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05,
        });
      } else if (matName.includes('glass') || matName.includes('vitre') || matName.includes('windshield')) {
        mesh.material = new THREE.MeshPhysicalMaterial({
          color: new THREE.Color('#0c1422'), metalness: 0.1, roughness: 0.05,
          transmission: 0.6, transparent: true, opacity: 0.6, clearcoat: 1, ior: 1.45,
        });
      }
    });

    // Normalize: centre on X/Z, rest on ground (y = 0), scale to target length.
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    root.position.set(-center.x, -box.min.y, -center.z);

    const wrapper = new THREE.Group();
    wrapper.add(root);
    const lengthAxis = Math.max(size.x, size.z) || 1;
    wrapper.scale.setScalar(CAR_TARGET_LENGTH / lengthAxis);
    if (size.x > size.z) wrapper.rotation.y = Math.PI / 2;

    // The GLB wheel nodes are empty transforms (no mesh).
    // Find them by name, get their world positions, and add procedural tyres there.
    wrapper.updateMatrixWorld(true);
    const WHEEL_R = 0.50;
    const WHEEL_W = 0.36;
    const RIM_R   = 0.32;
    const tyreMat  = new THREE.MeshStandardMaterial({ color: '#0c0c0e', roughness: 0.94, metalness: 0.04 });
    const rimMat   = new THREE.MeshStandardMaterial({ color: '#c4c8cc', roughness: 0.22, metalness: 0.92 });
    const capMat   = new THREE.MeshStandardMaterial({ color: '#1a1a1c', roughness: 0.4, metalness: 0.7 });

    root.traverse((obj) => {
      if (!obj.name.toLowerCase().startsWith('wheel')) return;
      const worldPos = new THREE.Vector3();
      obj.getWorldPosition(worldPos);
      const lp = wrapper.worldToLocal(worldPos.clone());

      const wg = new THREE.Group();
      wg.position.copy(lp);

      // Tyre body
      const tyreM = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_W, 40), tyreMat);
      tyreM.rotation.z = Math.PI / 2;
      tyreM.castShadow = true;
      wg.add(tyreM);

      // Tread shoulder ring
      const treadM = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R + 0.015, WHEEL_R + 0.015, WHEEL_W - 0.08, 40), new THREE.MeshStandardMaterial({ color: '#161618', roughness: 1.0 }));
      treadM.rotation.z = Math.PI / 2;
      wg.add(treadM);

      // Alloy rim (outboard face)
      const side = lp.x > 0 ? 1 : -1;
      const rimFace = new THREE.Mesh(new THREE.CylinderGeometry(RIM_R, RIM_R, 0.04, 28), rimMat);
      rimFace.rotation.z = Math.PI / 2;
      rimFace.position.x = side * (WHEEL_W / 2 - 0.01);
      rimFace.castShadow = true;
      wg.add(rimFace);

      // Rim dish
      const dish = new THREE.Mesh(new THREE.CylinderGeometry(RIM_R - 0.04, RIM_R, 0.10, 28), new THREE.MeshStandardMaterial({ color: '#9aa0a6', roughness: 0.35, metalness: 0.88 }));
      dish.rotation.z = Math.PI / 2;
      dish.position.x = side * (WHEEL_W / 2 - 0.08);
      wg.add(dish);

      // Spokes ×5
      for (let i = 0; i < 5; i++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, RIM_R * 1.8), rimMat);
        spoke.rotation.x = (i * Math.PI * 2) / 5;
        spoke.rotation.z = Math.PI / 2;
        spoke.position.x = side * (WHEEL_W / 2 - 0.01);
        wg.add(spoke);
      }

      // Center cap
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 16), capMat);
      cap.rotation.z = Math.PI / 2;
      cap.position.x = side * (WHEEL_W / 2);
      wg.add(cap);

      // Brake disc (inboard side)
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(RIM_R - 0.04, RIM_R - 0.04, 0.04, 28), new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.5, metalness: 0.6 }));
      disc.rotation.z = Math.PI / 2;
      disc.position.x = -side * (WHEEL_W / 2 - 0.01);
      wg.add(disc);

      wrapper.add(wg);
    });

    return wrapper;
  }, [scene, color]);

  return <primitive object={model} />;
};
useGLTF.preload(CAR_MODEL_URL);

const Carport = ({ plan, plotW, plotD, gateSide }: { plan: Plan; plotW: number; plotD: number; gateSide: Side }) => {
  const info = useMemo(() => getCarportInfo(plan), [plan]);
  if (!info) return null;
  const { cx, cz, w: cw, h: ch, side } = info;

  const halfPlotW = plotW / 2;
  const halfPlotD = plotD / 2;

  const cpElevation = 0.8; // Match house foundation height
  const rampL = 2.0;

  // Driveway rectangle: from carport's ramp edge out to plot edge.
  let dwMinX = 0, dwMaxX = 0, dwMinZ = 0, dwMaxZ = 0;
  let carYaw = 0; // car orientation

  const openingSide = gateSide;
  const isVertical = openingSide === 'top' || openingSide === 'bottom';

  if (isVertical) {
    if (openingSide === 'top') {
      dwMinX = cx - cw / 2 + 0.6; dwMaxX = cx + cw / 2 - 0.6;
      dwMinZ = -halfPlotD; dwMaxZ = cz - ch / 2 - rampL;
      carYaw = Math.PI; // facing back
    } else {
      dwMinX = cx - cw / 2 + 0.6; dwMaxX = cx + cw / 2 - 0.6;
      dwMinZ = cz + ch / 2 + rampL; dwMaxZ = halfPlotD;
      carYaw = 0; // facing front
    }
  } else {
    if (openingSide === 'left') {
      dwMinX = -halfPlotW; dwMaxX = cx - cw / 2 - rampL;
      dwMinZ = cz - ch / 2 + 0.6; dwMaxZ = cz + ch / 2 - 0.6;
      carYaw = -Math.PI / 2; // facing left
    } else {
      dwMinX = cx + cw / 2 + rampL; dwMaxX = halfPlotW;
      dwMinZ = cz - ch / 2 + 0.6; dwMaxZ = cz + ch / 2 - 0.6;
      carYaw = Math.PI / 2; // facing right
    }
  }

  const dwW = Math.max(0.1, dwMaxX - dwMinX);
  const dwD = Math.max(0.1, dwMaxZ - dwMinZ);
  const dwCX = (dwMinX + dwMaxX) / 2;
  const dwCZ = (dwMinZ + dwMaxZ) / 2;

  // Parked car position: shifted toward the opening so the larger car doesn't clip the house wall
  const carPullOut = 1.5; // pull the car toward the driveway opening
  let carX = cx;
  let carZ = cz;
  if (isVertical) {
    carZ += openingSide === 'top' ? -carPullOut : carPullOut;
  } else {
    carX += openingSide === 'left' ? -carPullOut : carPullOut;
  }

  const rampAngle = Math.atan2(cpElevation, rampL);
  const rampHypot = Math.hypot(cpElevation, rampL);

  return (
    <group>
      {/* ── Carport pad + structure ── */}
      <group position={[cx, 0, cz]}>
        {/* Concrete pad — slightly thicker than house foundation to prevent ground bleed */}
        <mesh receiveShadow position={[0, 0.41, 0]}>
          <boxGeometry args={[cw, 0.82, ch]} />
          <meshStandardMaterial color="#9a9a96" roughness={0.95} />
        </mesh>
        {/* Painted parking bay outline */}
        <mesh position={[0, cpElevation + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[Math.min(cw, ch) * 0.32, Math.min(cw, ch) * 0.34, 32]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.45} />
        </mesh>

        {/* Ramp */}
        {isVertical ? (
          openingSide === 'top' ? (
            <mesh position={[0, cpElevation / 2, -ch / 2 - rampL / 2]} rotation={[-rampAngle, 0, 0]} receiveShadow>
              <boxGeometry args={[cw - 1.2, 0.1, rampHypot]} />
              <meshStandardMaterial color="#9a9a96" roughness={0.95} />
            </mesh>
          ) : (
            <mesh position={[0, cpElevation / 2, ch / 2 + rampL / 2]} rotation={[rampAngle, 0, 0]} receiveShadow>
              <boxGeometry args={[cw - 1.2, 0.1, rampHypot]} />
              <meshStandardMaterial color="#9a9a96" roughness={0.95} />
            </mesh>
          )
        ) : (
          openingSide === 'left' ? (
            <mesh position={[-cw / 2 - rampL / 2, cpElevation / 2, 0]} rotation={[0, 0, rampAngle]} receiveShadow>
              <boxGeometry args={[rampHypot, 0.1, ch - 1.2]} />
              <meshStandardMaterial color="#9a9a96" roughness={0.95} />
            </mesh>
          ) : (
            <mesh position={[cw / 2 + rampL / 2, cpElevation / 2, 0]} rotation={[0, 0, -rampAngle]} receiveShadow>
              <boxGeometry args={[rampHypot, 0.1, ch - 1.2]} />
              <meshStandardMaterial color="#9a9a96" roughness={0.95} />
            </mesh>
          )
        )}

        {/* Car shed roof and pillars removed per user request for an open-air parking space */}

        {/* Wheel-stop curbs at the back of the bay */}
        {(() => {
          const stopGeom = isVertical ? [cw * 0.7, 0.18, 0.22] : [0.22, 0.18, ch * 0.7];
          let sp: [number, number, number] = [0, cpElevation + 0.09, 0];
          if (isVertical) {
             if (openingSide === 'top') sp = [0, cpElevation + 0.09, ch / 2 - 0.7]; // entrance -Z, back is +Z
             else sp = [0, cpElevation + 0.09, -ch / 2 + 0.7]; // entrance +Z, back is -Z
          } else {
             if (openingSide === 'left') sp = [cw / 2 - 0.7, cpElevation + 0.09, 0]; // entrance -X, back is +X
             else sp = [-cw / 2 + 0.7, cpElevation + 0.09, 0]; // entrance +X, back is -X
          }
          return (
            <mesh position={sp} castShadow>
              <boxGeometry args={stopGeom as [number, number, number]} />
              <meshStandardMaterial color="#cfcfcf" roughness={0.85} />
            </mesh>
          );
        })()}
      </group>

      {/* ── Driveway: tarmac/asphalt slab from carport opening to plot edge ── */}
      {dwW > 0.5 && dwD > 0.5 && (
        <group>
          {/* Asphalt base — slightly higher to prevent lawn bleed */}
          <mesh receiveShadow position={[dwCX, 0.02, dwCZ]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[dwW, dwD]} />
            <meshStandardMaterial color="#3c3c40" roughness={1} />
          </mesh>
          {/* Light trim edge stripes */}
          {isVertical ? (
            <>
              <mesh position={[dwMinX + 0.12, 0.018, dwCZ]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[0.08, dwD]} />
                <meshBasicMaterial color="#e8e2c8" />
              </mesh>
              <mesh position={[dwMaxX - 0.12, 0.018, dwCZ]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[0.08, dwD]} />
                <meshBasicMaterial color="#e8e2c8" />
              </mesh>
            </>
          ) : (
            <>
              <mesh position={[dwCX, 0.018, dwMinZ + 0.12]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[dwW, 0.08]} />
                <meshBasicMaterial color="#e8e2c8" />
              </mesh>
              <mesh position={[dwCX, 0.018, dwMaxZ - 0.12]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[dwW, 0.08]} />
                <meshBasicMaterial color="#e8e2c8" />
              </mesh>
            </>
          )}
        </group>
      )}

      {/* ── Parked car ── */}
      <group position={[carX, cpElevation, carZ]} rotation={[0, carYaw, 0]} scale={[4.5, 4.5, 4.5]}>
        <ParkedCar color="#1f2a44" />
      </group>
    </group>
  );
};

/* Compute the corridor rectangles to keep clear of greenery (driveway + walkway). */
const computeCorridors = (
  plan: Plan,
  plotW: number,
  plotD: number,
  gateX: number,
  gateZ: number,
  gateSide: Side,
): Rect[] => {
  const rects: Rect[] = [];
  const halfPlotW = plotW / 2;
  const halfPlotD = plotD / 2;

  // Driveway corridor
  const ci = getCarportInfo(plan);
  if (ci) {
    const { cx, cz, w: cw, h: ch, side } = ci;
    const openingSide = gateSide;
    const isVertical = openingSide === 'top' || openingSide === 'bottom';
    if (isVertical) {
      const clearW = Math.max(cw / 2 + 1.5, 7.5);
      if (openingSide === 'top') rects.push({ minX: cx - clearW, maxX: cx + clearW, minZ: -halfPlotD - 1.0, maxZ: cz - ch / 2 + 1.0 });
      else rects.push({ minX: cx - clearW, maxX: cx + clearW, minZ: cz + ch / 2 - 1.0, maxZ: halfPlotD + 1.0 });
    } else {
      const clearH = Math.max(ch / 2 + 1.5, 7.5);
      if (openingSide === 'left') rects.push({ minX: -halfPlotW - 1.0, maxX: cx - cw / 2 + 1.0, minZ: cz - clearH, maxZ: cz + clearH });
      else rects.push({ minX: cx + cw / 2 - 1.0, maxX: halfPlotW + 1.0, minZ: cz - clearH, maxZ: cz + clearH });
    }
  }

  // Garage driveway corridor
  const garageRoom = (plan.rooms || []).find(r => r.type === 'garage');
  if (garageRoom) {
    const frontWalls: ('top' | 'bottom' | 'left' | 'right')[] = ['bottom', 'left', 'top', 'right'];
    const doorWall = frontWalls[garageRoom.orientation || 0];

    const gCX = garageRoom.x + garageRoom.w / 2 - plan.width / 2;
    const gCZ = garageRoom.y + garageRoom.h / 2 - plan.height / 2;
    const gW = garageRoom.w;
    const gH = garageRoom.h;

    if (doorWall === 'bottom') {
      rects.push({
        minX: gCX - gW / 2 - 1.5,
        maxX: gCX + gW / 2 + 1.5,
        minZ: gCZ + gH / 2 - 1.0,
        maxZ: halfPlotD + 1.0
      });
    } else if (doorWall === 'top') {
      rects.push({
        minX: gCX - gW / 2 - 1.5,
        maxX: gCX + gW / 2 + 1.5,
        minZ: -halfPlotD - 1.0,
        maxZ: gCZ - gH / 2 + 1.0
      });
    } else if (doorWall === 'left') {
      rects.push({
        minX: -halfPlotW - 1.0,
        maxX: gCX - gW / 2 + 1.0,
        minZ: gCZ - gH / 2 - 1.5,
        maxZ: gCZ + gH / 2 + 1.5
      });
    } else { // right
      rects.push({
        minX: gCX + gW / 2 - 1.0,
        maxX: halfPlotW + 1.0,
        minZ: gCZ - gH / 2 - 1.5,
        maxZ: gCZ + gH / 2 + 1.5
      });
    }
  }

  // Walkway corridor (gate to main door)
  const door = findMainDoorWorld(plan);
  if (door) {
    const wkW = 8.5; // Massive walkway clearance (17 units total width) to remove all surrounding bushes
    // Vertical leg from gate down toward door's z
    const aX = gateX;
    const aZ1 = gateZ;
    const aZ2 = door.z + door.nz * 1.0;
    rects.push({
      minX: Math.min(aX, door.x) - wkW,
      maxX: Math.max(aX, door.x) + wkW,
      minZ: Math.min(aZ1, aZ2),
      maxZ: Math.max(aZ1, aZ2),
    });
    // Extended approach to door to clear the entire stone pathway and foundation bushes
    rects.push({
      minX: Math.min(door.x - wkW, door.x + door.nx * 30 - wkW),
      maxX: Math.max(door.x + wkW, door.x + door.nx * 30 + wkW),
      // Start the clearance 4 units behind the door to catch foundation planting
      minZ: Math.min(door.z - door.nz * 4 - wkW, door.z + door.nz * 30 - wkW),
      maxZ: Math.max(door.z - door.nz * 4 + wkW, door.z + door.nz * 30 + wkW),
    });
  }
  return rects;
};

/* ─── Decor ─── */
const BROADLEAF_GREENS = ['#3d6e3a', '#4a7a44', '#2f5f2f', '#356a36', '#5a8b50'];
const CYPRESS_GREENS = ['#284e2c', '#1f4524', '#2c5630'];

type TreeKind = 'broadleaf' | 'cypress' | 'small';

const Tree = ({ kind, s, h, palette }: { kind: TreeKind; s: number; h: number; palette: number }) => {
  if (kind === 'cypress') {
    // Tall slim Italian cypress
    return (
      <group>
        <mesh castShadow position={[0, h * 0.06, 0]}>
          <cylinderGeometry args={[0.16 * s, 0.22 * s, h * 0.12, 8]} />
          <meshStandardMaterial color="#2a1c10" roughness={0.95} />
        </mesh>
        <mesh castShadow position={[0, h * 0.55, 0]}>
          <coneGeometry args={[0.85 * s, h * 0.96, 12]} />
          <meshStandardMaterial color={CYPRESS_GREENS[palette % CYPRESS_GREENS.length]} roughness={0.9} />
        </mesh>
      </group>
    );
  }
  if (kind === 'small') {
    return (
      <group>
        <mesh castShadow position={[0, h * 0.18, 0]}>
          <cylinderGeometry args={[0.12 * s, 0.18 * s, h * 0.36, 6]} />
          <meshStandardMaterial color="#3a2818" roughness={0.92} />
        </mesh>
        <mesh castShadow position={[0, h * 0.55, 0]}>
          <sphereGeometry args={[1.4 * s, 10, 8]} />
          <meshStandardMaterial color={BROADLEAF_GREENS[palette % BROADLEAF_GREENS.length]} roughness={0.9} />
        </mesh>
        <mesh castShadow position={[0.4 * s, 0.7 * h, 0.2 * s]}>
          <sphereGeometry args={[1.0 * s, 8, 7]} />
          <meshStandardMaterial color={BROADLEAF_GREENS[(palette + 2) % BROADLEAF_GREENS.length]} roughness={0.9} />
        </mesh>
      </group>
    );
  }
  // broadleaf — lush full canopy
  const trunkH = h * 0.55;
  return (
    <group>
      <mesh castShadow position={[0, trunkH * 0.5, 0]}>
        <cylinderGeometry args={[0.22 * s, 0.42 * s, trunkH, 8]} />
        <meshStandardMaterial color="#3a2818" roughness={0.95} />
      </mesh>
      {/* Layered canopy clusters for organic feel */}
      <mesh castShadow position={[0, trunkH + 1.2 * s, 0]}>
        <sphereGeometry args={[2.6 * s, 12, 10]} />
        <meshStandardMaterial color={BROADLEAF_GREENS[palette % BROADLEAF_GREENS.length]} roughness={0.9} />
      </mesh>
      <mesh castShadow position={[1.5 * s, trunkH + 0.8 * s, 0.7 * s]}>
        <sphereGeometry args={[1.9 * s, 10, 9]} />
        <meshStandardMaterial color={BROADLEAF_GREENS[(palette + 1) % BROADLEAF_GREENS.length]} roughness={0.9} />
      </mesh>
      <mesh castShadow position={[-1.3 * s, trunkH + 0.6 * s, -0.6 * s]}>
        <sphereGeometry args={[1.7 * s, 10, 8]} />
        <meshStandardMaterial color={BROADLEAF_GREENS[(palette + 2) % BROADLEAF_GREENS.length]} roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0.3 * s, trunkH + 2.4 * s, -0.4 * s]}>
        <sphereGeometry args={[1.4 * s, 10, 8]} />
        <meshStandardMaterial color={BROADLEAF_GREENS[(palette + 3) % BROADLEAF_GREENS.length]} roughness={0.9} />
      </mesh>
      <mesh castShadow position={[-0.8 * s, trunkH + 2.0 * s, 0.5 * s]}>
        <sphereGeometry args={[1.2 * s, 8, 7]} />
        <meshStandardMaterial color={BROADLEAF_GREENS[(palette + 4) % BROADLEAF_GREENS.length]} roughness={0.9} />
      </mesh>
    </group>
  );
};

const Trees = ({ planW, planD, corridors = [] }: { planW: number; planD: number; corridors?: Rect[] }) => {
  const treeData = useMemo(() => {
    const arr: { x: number; z: number; s: number; h: number; kind: TreeKind; palette: number }[] = [];
    const hw = planW / 2;
    const hd = planD / 2;
    const blocked = (x: number, z: number) => pointInAnyRect(x, z, corridors, 1.2);

    // Background trees are now only placed at a significant distance from the plot

    // Distant background trees
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.max(hw, hd) + 32 + Math.random() * 40;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      if (Math.abs(x) < planW / 2 + 12 && Math.abs(z) < planD / 2 + 12) continue;
      if (blocked(x, z)) continue;
      arr.push({ x, z, s: 0.85 + Math.random() * 0.5, h: 7 + Math.random() * 5, kind: Math.random() < 0.18 ? 'cypress' : 'broadleaf', palette: i });
    }
    return arr;
  }, [planW, planD, corridors]);
  return (
    <group>
      {treeData.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]} rotation={[0, (i * 1.7) % (Math.PI * 2), 0]}>
          <Tree kind={t.kind} s={t.s} h={t.h} palette={t.palette} />
        </group>
      ))}
    </group>
  );
};

const POT_COLORS = ['#e85d75', '#f4a261', '#f7d046', '#9b5de5', '#f15bb5', '#fefae0', '#e76f51', '#8ac926', '#1982c4', '#ff595e'];

const FlowerPot = ({ x, z, flowerColor, potType = 'square' }: { x: number; z: number; flowerColor: string; potType?: 'round' | 'square' }) => {
  return (
    <group position={[x, 0, z]}>
      {/* Realistic Pot with Tapered Profile */}
      <mesh castShadow position={[0, 0.35, 0]}>
        {potType === 'square' ? <boxGeometry args={[0.8, 0.7, 0.8]} /> : <cylinderGeometry args={[0.5, 0.35, 0.8, 24]} />}
        <meshStandardMaterial color="#1a1a1a" roughness={0.3} metalness={0.5} />
      </mesh>
      {/* Polished Gold Decorative Band */}
      <mesh position={[0, 0.68, 0]}>
        {potType === 'square' ? <boxGeometry args={[0.85, 0.06, 0.85]} /> : <cylinderGeometry args={[0.52, 0.52, 0.06, 24]} />}
        <meshStandardMaterial color="#c9a84c" roughness={0.1} metalness={0.9} />
      </mesh>
      {/* Soil with dark organic texture */}
      <mesh position={[0, 0.65, 0]}>
        {potType === 'square' ? <boxGeometry args={[0.7, 0.1, 0.7]} /> : <cylinderGeometry args={[0.45, 0.45, 0.1, 16]} />}
        <meshStandardMaterial color="#1e140a" roughness={1} />
      </mesh>
      
      {/* Detailed Plant Structure */}
      <group position={[0, 0.75, 0]}>
        {/* Central Stem */}
        <mesh position={[0, 0.25, 0]}>
          <cylinderGeometry args={[0.03, 0.05, 0.6, 8]} />
          <meshStandardMaterial color="#1b3b1b" />
        </mesh>
        
        {/* Lush Base Leaves */}
        <group scale={[1.2, 0.8, 1.2]}>
          <mesh castShadow position={[0, 0.1, 0]}>
            <sphereGeometry args={[0.5, 12, 10]} />
            <meshStandardMaterial color="#2d5a2d" roughness={0.9} />
          </mesh>
        </group>

        {/* Realistic Flowers with Detailed Petals */}
        {[
          { p: [-0.3, 0.65, 0.1], s: 0.22 },
          { p: [0.25, 0.55, 0.3], s: 0.25 },
          { p: [0.05, 0.75, -0.2], s: 0.2 }
        ].map((f, i) => (
          <group key={i} position={f.p as [number, number, number]}>
            {/* 6 Petals arranged in a bloom */}
            {Array.from({ length: 6 }).map((_, pi) => {
              const angle = (pi / 6) * Math.PI * 2;
              return (
                <mesh 
                  key={pi} 
                  position={[Math.cos(angle) * 0.12, 0, Math.sin(angle) * 0.12]}
                  rotation={[0.5, angle, 0]}
                >
                  <boxGeometry args={[0.2, 0.25, 0.01]} />
                  <meshStandardMaterial color={flowerColor} roughness={0.3} side={THREE.DoubleSide} />
                </mesh>
              );
            })}
            {/* Detailed center */}
            <mesh position={[0, 0.05, 0]}>
              <sphereGeometry args={[0.08, 8, 8]} />
              <meshStandardMaterial color="#443300" emissive="#ffcc00" emissiveIntensity={0.2} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
};

const Bushes = ({ planW, planD, corridors = [] }: { planW: number; planD: number; corridors?: Rect[] }) => {
  const pots = useMemo(() => {
    const hw = planW / 2;
    const hd = planD / 2;
    const arr: { x: number; z: number; c: string; type: 'round' | 'square' }[] = [];
    const blocked = (x: number, z: number) => pointInAnyRect(x, z, corridors, 0.8);

    // RESTRICTED TO FRONT GARDEN ONLY
    const spacing = 4.0;
    // Front Garden Row (inside the fence area)
    for (let x = -hw + 3; x <= hw - 3; x += spacing) {
      const zPos = hd - 2.5; // Moved slightly further inside the plot
      if (blocked(x, zPos)) continue;
      arr.push({ 
        x, 
        z: zPos, 
        c: POT_COLORS[Math.abs(Math.floor(x * 1.7)) % POT_COLORS.length],
        type: (Math.abs(Math.floor(x)) % 2 === 0) ? 'square' : 'round'
      });
    }

    return arr;
  }, [planW, planD, corridors]);

  return (
    <group>
      {pots.map((p, i) => (
        <FlowerPot key={i} x={p.x} z={p.z} flowerColor={p.c} potType={p.type} />
      ))}
    </group>
  );
};

/* ─── Mulch beds + Stepping-Stone path ─── */
const LandscapeBeds = ({ plan, gateX, corridors }: { plan: Plan; gateX: number; corridors: Rect[] }) => {
  const halfW = plan.width / 2;
  const halfD = plan.height / 2;
  const bedWidth = 1.8;
  const bedDepth = 1.2;
  const mulchColor = "#4a3020";

  const inCorridor = (x: number, z: number) => {
    return corridors.some(c => x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ);
  };

  return (
    <group>
      {/* Mulch perimeter strips along walls (slightly wider than bushes) */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, -halfD - 1.5]}>
        <planeGeometry args={[plan.width + 4, 1.6]} />
        <meshStandardMaterial color={mulchColor} roughness={1} />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[-halfW - 1.5, 0.005, 0]}>
        <planeGeometry args={[1.6, plan.height + 4]} />
        <meshStandardMaterial color={mulchColor} roughness={1} />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[halfW + 1.5, 0.005, 0]}>
        <planeGeometry args={[1.6, plan.height + 4]} />
        <meshStandardMaterial color={mulchColor} roughness={1} />
      </mesh>
      {/* Front mulch (split around path) */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[(-halfW + (gateX - 2.5)) / 2, 0.005, halfD - 1.0]}>
        <planeGeometry args={[Math.max(0.1, (gateX - 2.5) - (-halfW)), 1.4]} />
        <meshStandardMaterial color={mulchColor} roughness={1} />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[((gateX + 2.5) + halfW) / 2, 0.005, halfD - 1.0]}>
        <planeGeometry args={[Math.max(0.1, halfW - (gateX + 2.5)), 1.4]} />
        <meshStandardMaterial color={mulchColor} roughness={1} />
      </mesh>
    </group>
  );
};

const FrontWalkway = ({ plan, gateX, plotD }: { plan: Plan; gateX: number; plotD: number }) => {
  return null; // Removed legacy white pathway in favor of the new custom marble pathway
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FenceAround = ({ planW, planD, gates, isNight }: { planW: number; planD: number; gates: Array<{ [key: string]: any }>; isNight?: boolean }) => {
  const hw = planW / 2;
  const hd = planD / 2;

  // Corner pillars
  const pillars: [number, number][] = [[-hw, -hd], [-hw, hd], [hw, -hd], [hw, hd]];
  
  // Posts
  const posts: [number, number][] = [];
  const isPointInAnyGate = (x: number, z: number) => {
    return gates.some(g => {
      const half = g.isCarGate ? 6.0 : 2.2;
      if (g.side === 'top' || g.side === 'bottom') {
        return Math.abs(z - g.z) < 0.1 && x > g.x - half && x < g.x + half;
      } else {
        return Math.abs(x - g.x) < 0.1 && z > g.z - half && z < g.z + half;
      }
    });
  };

  for (let x = -hw; x <= hw; x += 3) {
    if (!isPointInAnyGate(x, -hd)) posts.push([x, -hd]);
    if (!isPointInAnyGate(x, hd)) posts.push([x, hd]);
  }
  for (let z = -hd + 3; z < hd; z += 3) {
    if (!isPointInAnyGate(-hw, z)) posts.push([-hw, z]);
    if (!isPointInAnyGate(hw, z)) posts.push([hw, z]);
  }

  return (
    <group>
      {/* Corner pillars */}
      {pillars.map(([x, z], i) => (
        <group key={`pillar-${i}`} position={[x, 0, z]}>
          <mesh castShadow position={[0, 1.5, 0]}>
            <boxGeometry args={[0.5, 3.2, 0.5]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.4} metalness={0.1} />
          </mesh>
          <mesh position={[0, 3.2, 0]}>
            <boxGeometry args={[0.6, 0.15, 0.6]} />
            <meshStandardMaterial color="#333" roughness={0.3} metalness={0.5} />
          </mesh>
          {/* Pillar cap light */}
          <mesh position={[0, 3.25, 0]}>
            <boxGeometry args={[0.22, 0.12, 0.22]} />
            <meshStandardMaterial 
              color="#fff" 
              emissive="#ffcc80" 
              emissiveIntensity={isNight ? 4 : 0.8} 
            />
          </mesh>
          {isNight && (
            <pointLight position={[0, 3.3, 0]} intensity={15} distance={12} color="#ffcc80" castShadow />
          )}
        </group>
      ))}
      {/* Fence posts */}
      {posts.map(([x, z], i) => (
        <group key={i} position={[x, 1.3, z]}>
          <mesh castShadow>
            <boxGeometry args={[0.14, 2.6, 0.14]} />
            <meshStandardMaterial color="#0a0a0a" roughness={0.3} metalness={0.6} />
          </mesh>
          {/* Post cap */}
          <mesh position={[0, 1.35, 0]}>
            <boxGeometry args={[0.18, 0.08, 0.18]} />
            <meshStandardMaterial color="#c9a84c" roughness={0.2} metalness={0.9} />
          </mesh>
        </group>
      ))}
      {/* Horizontal rails (3 levels for modern look) */}
      {[0.6, 1.4, 2.2].map((y) => (
        <group key={y}>
          {/* Back Wall */}
          {(() => {
            const sideGates = gates.filter(g => g.side === 'top');
            if (sideGates.length > 0) {
              // Complicated: multiple gaps. For simplicity, we just check segments.
              // We'll use a simpler approach: check if point is in any gate.
              return null; // Handle below
            }
            return <mesh position={[0, y, -hd]}><boxGeometry args={[hw * 2, 0.08, 0.06]} /><meshStandardMaterial color="#555" roughness={0.5} metalness={0.15} /></mesh>;
          })()}
          
          {/* Optimized Rail Rendering with multi-gate support */}
          {['top', 'bottom', 'left', 'right'].map(side => {
            const sideGates = gates.filter(g => g.side === side);
            const isVert = side === 'left' || side === 'right';
            const coord = (side === 'left' || side === 'top') ? (isVert ? -hw : -hd) : (isVert ? hw : hd);
            
            if (sideGates.length === 0) {
            const pos: [number, number, number] = isVert ? [coord, y, 0] : [0, y, coord];
            const size: [number, number, number] = isVert ? [0.08, 0.08, hd * 2] : [hw * 2, 0.08, 0.08];
            return <mesh key={`${side}-${y}`} position={pos}><boxGeometry args={size} /><meshStandardMaterial color="#0a0a0a" roughness={0.3} metalness={0.6} /></mesh>;
          }

          // Render segments between gates
          const segments: Array<{ p: [number, number, number]; a: [number, number, number]; mid: number; len: number }> = [];
          const halfLen = isVert ? hd : hw;
          const sortedGates = [...sideGates].sort((a, b) => (isVert ? a.z - b.z : a.x - b.x));
          
          let last = -halfLen;
          sortedGates.forEach((g, idx) => {
            const gHalf = g.isCarGate ? 6.0 : 2.2;
            const gStart = (isVert ? g.z : g.x) - gHalf;
            const gEnd = (isVert ? g.z : g.x) + gHalf;
            
            if (gStart > last) {
              const len = gStart - last;
              const mid = last + len / 2;
              segments.push({ mid, len, p: [0, 0, 0], a: [0, 0, 0] });
            }
            last = gEnd;
          });
          if (last < halfLen) {
            const len = halfLen - last;
            const mid = last + len / 2;
            segments.push({ mid, len, p: [0, 0, 0], a: [0, 0, 0] });
          }

          return segments.map((seg, i) => (
            <mesh key={`${side}-${y}-${i}`} position={isVert ? [coord, y, seg.mid] : [seg.mid, y, coord]}>
              <boxGeometry args={isVert ? [0.08, 0.08, seg.len] : [seg.len, 0.08, 0.08]} />
              <meshStandardMaterial color="#0a0a0a" roughness={0.3} metalness={0.6} />
            </mesh>
          ));
          })}
        </group>
      ))}

      {/* Entrance gates */}
      {gates.map((g, i) => {
        const gHalf = g.isCarGate ? 6.0 : 2.2;
        return (
          <group key={`gate-${i}`} position={[g.x, 0, g.z]} rotation={[0, (g.side === 'left' || g.side === 'right') ? Math.PI / 2 : 0, 0]}>
            {/* Unified Gate Posts */}
            <mesh castShadow position={[-gHalf, 1.5, 0]}>
              <boxGeometry args={[0.32, 3.4, 0.32]} />
              <meshStandardMaterial color="#1a1a1a" roughness={0.3} metalness={0.6} />
            </mesh>
            <mesh castShadow position={[gHalf, 1.5, 0]}>
              <boxGeometry args={[0.32, 3.4, 0.32]} />
              <meshStandardMaterial color="#1a1a1a" roughness={0.3} metalness={0.6} />
            </mesh>
            
            {/* Premium Sliding/Panel Logic for Both Gates */}
            <group position={[0, 1.4, 0.02]}>
              {/* Left Panel */}
              <mesh castShadow position={[-gHalf / 2, 0, 0]}>
                <boxGeometry args={[gHalf - 0.2, 2.8, 0.12]} />
                <meshPhysicalMaterial color="#0d0d0d" roughness={0.15} metalness={0.7} clearcoat={1} />
              </mesh>
              {/* Right Panel */}
              <mesh castShadow position={[gHalf / 2, 0, 0]}>
                <boxGeometry args={[gHalf - 0.2, 2.8, 0.12]} />
                <meshPhysicalMaterial color="#0d0d0d" roughness={0.15} metalness={0.7} clearcoat={1} />
              </mesh>
              
              {/* Unified Decorative Gold Slats */}
              {Array.from({ length: 8 }).map((_, idx) => {
                const sy = -1.2 + idx * 0.35;
                return (
                  <mesh key={idx} position={[0, sy, 0.08]}>
                    <boxGeometry args={[gHalf * 2 - 0.4, 0.04, 0.03]} />
                    <meshStandardMaterial color="#c9a84c" roughness={0.1} metalness={0.9} />
                  </mesh>
                );
              })}
            </group>
          </group>
        );
      })}
    </group>
  );
};

/* ─── Second Floor (Double Storey) ─── */
const SecondFloor = ({ plan, firstFloorPlan, roof, material, activeRoom, addons = [], hideRoof, isNight, showLabels = true, garageShutterOpen = false }: {
  plan: Plan; firstFloorPlan: Plan; roof: RoofType; material: Material; activeRoom?: string | null; addons?: AddOn[]; hideRoof?: boolean; isNight?: boolean; showLabels?: boolean; garageShutterOpen?: boolean;
}) => {
  const colors = MATERIAL_COLORS[material];
  const W = plan.width;
  const D = plan.height;
  const wallH = 13;
  const t = 0.4;
  const floorY = wallH; // Ground floor walls end at wallH
  const round2 = (n: number) => Math.round(n * 100) / 100;

  // PBR Floor Textures from materials factory (same as House component)
  const floorTextures = useMemo(() => ({
    walnut: createWoodFloorTexture(2, 2),
    walnutNormal: createWoodFloorNormal(2, 2),
    walnutRough: createWoodFloorRoughness(2, 2),
    oak: createOakFloorTexture(2, 2),
    oakNormal: createOakFloorNormal(2, 2),
    oakRough: createOakFloorRoughness(2, 2),
    tile: createTileTexture(4, 4),
    tileNormal: createTileNormal(4, 4),
    tileRough: createTileRoughness(4, 4),
    marble: createMarbleTexture(1.5, 1.5),
    marbleRough: createMarbleRoughness(1.5, 1.5),
  }), []);

  // Door / panel wood textures
  const doorTextures = useMemo(() => ({
    map: createDoorWoodTexture(1, 2),
    normal: createDoorWoodNormal(1, 2),
  }), []);

  // Use firstFloorPlan dimensions (may be smaller than ground)
  const ffW = firstFloorPlan.width;
  const ffH = firstFloorPlan.height;
  const upperOffsetX = round2(-W / 2 + (W - ffW) / 2);
  const upperOffsetZ = round2(-D / 2 + (D - ffH) / 2);
  // Include ALL rooms (including staircase/hallway) for roof bounds so holes can clip correctly
  const allUpperRooms = (firstFloorPlan?.rooms || []).filter(r => r.type !== 'garden' && r.type !== 'carport' && r.type !== 'balcony');
  const upperMinX = allUpperRooms.length ? Math.min(...allUpperRooms.map(r => r.x)) : 0;
  const upperMaxX = allUpperRooms.length ? Math.max(...allUpperRooms.map(r => r.x + r.w)) : ffW;
  const upperMinZ = allUpperRooms.length ? Math.min(...allUpperRooms.map(r => r.y)) : 0;
  const upperMaxZ = allUpperRooms.length ? Math.max(...allUpperRooms.map(r => r.y + r.h)) : ffH;
  const upperRoofW = round2(upperMaxX - upperMinX);
  const upperRoofD = round2(upperMaxZ - upperMinZ);
  const upperRoofCX = round2((upperMinX + upperMaxX) / 2);
  const upperRoofCZ = round2((upperMinZ + upperMaxZ) / 2);


  // Extract walls for first floor
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extractedWalls: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const addWall = (type: 'h'|'v', coord: number, start: number, end: number, doors: any[], windows: any[]) => {
    coord = round2(coord); start = round2(start); end = round2(end);
    const existing = extractedWalls.find(w => w.type === type && w.coord === coord &&
      (Math.max(w.start, start) <= Math.min(w.end, end) + 0.1));
    if (existing) {
      existing.start = Math.min(existing.start, start);
      existing.end = Math.max(existing.end, end);
      existing.doors.push(...doors); existing.windows.push(...windows);
    } else {
      extractedWalls.push({ type, coord, start, end, doors: [...doors], windows: [...windows] });
    }
  };

  (firstFloorPlan?.rooms || []).forEach(room => {
    if (room.type === 'garden' || room.type === 'carport' || room.type === 'balcony') return;
    const rX = room.x, rY = room.y, rW = room.w, rH = room.h;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getAbsDoors = (wall: string) => (room.doors || []).filter((d:any) => d.wall === wall).map((d:any) => {
      let doorCategory: 'main' | 'room' | 'bathroom' = 'room';
      if (d.label === 'MAIN DOOR' || (!d.connectsTo && d.doorType !== 'open')) {
        doorCategory = 'main';
      } else if (room.type === 'bathroom') {
        doorCategory = 'bathroom';
      } else {
        const connRoom = (firstFloorPlan?.rooms || []).find(r => r.id === d.connectsTo);
        if (connRoom?.type === 'bathroom') doorCategory = 'bathroom';
      }
      return {
        ...d, doorCategory,
        absPos: (wall === 'top' || wall === 'bottom') ? rX + rW * d.position : rY + rH * d.position
      };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getAbsWindows = (wall: string) => (room.windows || []).filter((w:any) => w.wall === wall).map((win:any) => ({
      ...win, absPos: (wall === 'top' || wall === 'bottom') ? rX + rW * win.position : rY + rH * win.position
    }));
    
    // Check openWalls property (skip if wall is marked as open/removed)
    const openWalls = room.openWalls || [];
    if (!openWalls.includes('top')) {
      addWall('h', rY, rX, rX + rW, getAbsDoors('top'), getAbsWindows('top'));
    }
    if (!openWalls.includes('bottom')) {
      addWall('h', rY + rH, rX, rX + rW, getAbsDoors('bottom'), getAbsWindows('bottom'));
    }
    if (!openWalls.includes('left')) {
      addWall('v', rX, rY, rY + rH, getAbsDoors('left'), getAbsWindows('left'));
    }
    if (!openWalls.includes('right')) {
      addWall('v', rX + rW, rY, rY + rH, getAbsDoors('right'), getAbsWindows('right'));
    }
  });

  return (
    <group position={[0, floorY, 0]}>
      {/* Floor slab only beneath added upper-floor rooms */}
      {(firstFloorPlan?.rooms || [])
        .filter(r => r.type !== 'garden' && r.type !== 'carport' && r.type !== 'balcony')
        .map(r => {
          const cx = round2(upperOffsetX + r.x + r.w / 2);
          const cz = round2(upperOffsetZ + r.y + r.h / 2);
          
          // For staircase rooms: render slab but only for the non-opening portion
          if (isStaircaseRoom(r)) {
            const sg = resolveStairGeometry(r);
            const openW = sg.openingWidth;
            const openL = sg.openingLength;
            // Mirror-aware offset: flip X offset when staircase is mirrored
            const slabEffectiveOffsetX = r.isMirrored
              ? (r.w - sg.stairOffsetX - openW)
              : sg.stairOffsetX;
            // Opening position derived from stair offset inside room
            const openCX = round2(upperOffsetX + r.x + slabEffectiveOffsetX + openW / 2);
            const openCZ = round2(upperOffsetZ + r.y + sg.stairOffsetY + openL / 2);
            // Compute 4 slab segments around the offset opening
            const EPS = 0.02; // tiny gap to prevent visual sealing
            const slabs = [];
            const slabY = 0.4;
            const slabH = 0.8;
            // Left slab: from room left edge to opening left edge
            const leftW = slabEffectiveOffsetX - EPS;
            if (leftW > 0.15) {
              slabs.push(
                <mesh key={`slab-l-${r.id}`} receiveShadow position={[round2(upperOffsetX + r.x + leftW / 2), slabY, cz]}>
                  <boxGeometry args={[leftW, slabH, r.h]} />
                  <meshStandardMaterial color="#9a8a78" roughness={0.8} />
                </mesh>
              );
            }
            // Right slab: from opening right edge to room right edge
            const rightEdge = slabEffectiveOffsetX + openW;
            const rightW = r.w - rightEdge - EPS;
            if (rightW > 0.15) {
              slabs.push(
                <mesh key={`slab-r-${r.id}`} receiveShadow position={[round2(upperOffsetX + r.x + rightEdge + rightW / 2), slabY, cz]}>
                  <boxGeometry args={[rightW, slabH, r.h]} />
                  <meshStandardMaterial color="#9a8a78" roughness={0.8} />
                </mesh>
              );
            }
            // Top slab: from room top edge to opening top edge (within opening width)
            const topH = sg.stairOffsetY - EPS;
            if (topH > 0.15) {
              slabs.push(
                <mesh key={`slab-t-${r.id}`} receiveShadow position={[openCX, slabY, round2(upperOffsetZ + r.y + topH / 2)]}>
                  <boxGeometry args={[openW, slabH, topH]} />
                  <meshStandardMaterial color="#9a8a78" roughness={0.8} />
                </mesh>
              );
            }
            // Bottom slab: from opening bottom edge to room bottom edge
            const bottomEdge = sg.stairOffsetY + openL;
            const bottomH = r.h - bottomEdge - EPS;
            if (bottomH > 0.15) {
              slabs.push(
                <mesh key={`slab-b-${r.id}`} receiveShadow position={[openCX, slabY, round2(upperOffsetZ + r.y + bottomEdge + bottomH / 2)]}>
                  <boxGeometry args={[openW, slabH, bottomH]} />
                  <meshStandardMaterial color="#9a8a78" roughness={0.8} />
                </mesh>
              );
            }
            // Stairwell trim beam — structural edge framing around opening
            const beamT = 0.1; // beam thickness
            const beamH = slabH + 0.1; // slightly taller than slab
            const beamY = slabY;
            // Front beam (along X at top of opening)
            slabs.push(
              <mesh key={`beam-f-${r.id}`} position={[openCX, beamY, round2(upperOffsetZ + r.y + sg.stairOffsetY - beamT / 2)]}>
                <boxGeometry args={[openW + beamT * 2, beamH, beamT]} />
                <meshStandardMaterial color="#7a6e62" roughness={0.7} />
              </mesh>
            );
            // Back beam
            slabs.push(
              <mesh key={`beam-b-${r.id}`} position={[openCX, beamY, round2(upperOffsetZ + r.y + sg.stairOffsetY + openL + beamT / 2)]}>
                <boxGeometry args={[openW + beamT * 2, beamH, beamT]} />
                <meshStandardMaterial color="#7a6e62" roughness={0.7} />
              </mesh>
            );
            // Left beam
            slabs.push(
              <mesh key={`beam-l-${r.id}`} position={[round2(upperOffsetX + r.x + sg.stairOffsetX - beamT / 2), beamY, openCZ]}>
                <boxGeometry args={[beamT, beamH, openL]} />
                <meshStandardMaterial color="#7a6e62" roughness={0.7} />
              </mesh>
            );
            // Right beam
            slabs.push(
              <mesh key={`beam-r-${r.id}`} position={[round2(upperOffsetX + r.x + sg.stairOffsetX + openW + beamT / 2), beamY, openCZ]}>
                <boxGeometry args={[beamT, beamH, openL]} />
                <meshStandardMaterial color="#7a6e62" roughness={0.7} />
              </mesh>
            );
            return <group key={`upper-slab-${r.id}`}>{slabs}</group>;
          }
          
          return (
            <mesh key={`upper-slab-${r.id}`} receiveShadow position={[cx, 0.4, cz]}>
              <boxGeometry args={[r.w, 0.8, r.h]} />
              <meshStandardMaterial color="#9a8a78" roughness={0.8} />
            </mesh>
          );
        })}

      {/* Balcony floors/railings for upper level */}
      {(firstFloorPlan?.rooms || []).filter(r => r.type === 'balcony').map(r => (
        <Balcony3D key={`balcony-ff-${r.id}`} room={r} W={firstFloorPlan.width} D={firstFloorPlan.height} offsetX={(plan.width - firstFloorPlan.width)/2} offsetZ={(plan.height - firstFloorPlan.height)/2} isNight={false} floorY={0} />
      ))}

      <group position={[upperOffsetX, 0.8, upperOffsetZ]}>
        {/* Room floors & ceilings */}
        {(firstFloorPlan?.rooms || []).filter(r => r.type !== 'garden' && r.type !== 'carport' && r.type !== 'balcony').map(r => {
          const cx = round2(r.x + r.w / 2);
          const cz = round2(r.y + r.h / 2);
          const isStaircase = isStaircaseRoom(r);
          
          // Staircase rooms now render normally — slab opening is handled by segmented slab above

          // Get floor material based on room type (same logic as House component)
          const isLivingDining = ['living', 'dining', 'hall', 'lobby', 'foyer', 'entry'].includes(r.type);
          const isBedroom = ['bedroom', 'master', 'guest'].includes(r.type);
          const isKitchen = r.type === 'kitchen';
          const isBath = r.type === 'bathroom';
          const isCorridor = ['corridor', 'hallway', 'passage', 'staircase'].includes(r.type);

          let map = floorTextures.oak;
          let normalMap: THREE.Texture | undefined = floorTextures.oakNormal;
          let roughnessMap: THREE.Texture = floorTextures.oakRough;
          let baseColor = '#caa775';
          let roughness = 0.55;
          let metalness = 0;
          let envMapIntensity = 0.6;

          if (isLivingDining) {
            map = floorTextures.walnut; normalMap = floorTextures.walnutNormal; roughnessMap = floorTextures.walnutRough;
            baseColor = '#8a5d36'; roughness = 0.5; envMapIntensity = 0.8;
          } else if (isBedroom) {
            map = floorTextures.oak; normalMap = floorTextures.oakNormal; roughnessMap = floorTextures.oakRough;
            baseColor = '#caa775'; roughness = 0.6; envMapIntensity = 0.6;
          } else if (isKitchen) {
            map = floorTextures.marble; normalMap = undefined; roughnessMap = floorTextures.marbleRough;
            baseColor = '#f1ede5'; roughness = 0.18; metalness = 0.05; envMapIntensity = 1.4;
          } else if (isBath) {
            map = floorTextures.tile; normalMap = floorTextures.tileNormal; roughnessMap = floorTextures.tileRough;
            baseColor = '#e6e8e7'; roughness = 0.22; metalness = 0.04; envMapIntensity = 1.2;
          } else if (isCorridor) {
            map = floorTextures.walnut; normalMap = floorTextures.walnutNormal; roughnessMap = floorTextures.walnutRough;
            baseColor = '#8a5d36'; roughness = 0.55; envMapIntensity = 0.7;
          }

          return (
            <group key={r.id}>
              {/* Floor — skip for staircase rooms (segmented slabs handle the floor above) */}
              {!isStaircase && (
                <mesh receiveShadow position={[cx, 0.01, cz]}>
                  <boxGeometry args={[r.w, 0.02, r.h]} />
                  <meshStandardMaterial
                    color={baseColor}
                    map={map}
                    normalMap={normalMap}
                    normalScale={new THREE.Vector2(0.45, 0.45)}
                    roughnessMap={roughnessMap}
                    roughness={roughness}
                    metalness={metalness}
                    envMapIntensity={envMapIntensity}
                  />
                </mesh>
              )}
              
              {/* Ceiling — skip for staircase rooms (stairwell must be open) */}
              {!hideRoof && r.type !== 'hallway' && !isStaircase && (
                <mesh position={[cx, wallH - 0.01, cz]}>
                  <boxGeometry args={[r.w - 0.1, 0.02, r.h - 0.1]} />
                  <meshStandardMaterial color="#fafaf6" roughness={0.95} />
                </mesh>
              )}

              {/* Furniture */}
              {r.furniture.map((f, i: number) => (
                <group key={`f-${i}`} position={[round2(r.x + f.x + f.w/2), 0.02, round2(r.y + f.y + f.h/2)]}
                  rotation={[0, f.rotation ? f.rotation * Math.PI / 180 : 0, 0]}>
                  <Furniture3D item={f} />
                </group>
              ))}
            </group>
          );
        })}

        {/* Walls */}
        {extractedWalls.map((wall, i) => {
          const len = wall.end - wall.start;
          const w = len + t;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mappedDoors = wall.doors.map((d:any) => ({...d, relPos: (d.absPos - wall.start + t/2) / w}));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mappedWindows = wall.windows.map((win:any) => ({...win, relPos: (win.absPos - wall.start + t/2) / w}));
          if (wall.type === 'h') {
            return <WallSegment key={`w2-${i}`} w={w} h={wallH} t={t} color={colors.wall}
              doors={mappedDoors} windows={mappedWindows} materialType={material}
              position={[round2(wall.start + len/2), 0, round2(wall.coord)]} rotation={[0, 0, 0]}
              frameColor={colors.trim} glassColor={colors.window} doorColor={colors.door} hideRoof={hideRoof}
              wallTextures={{}} doorTextures={{ }} isNight={isNight} garageShutterOpen={garageShutterOpen} />;
          } else {
            return <WallSegment key={`w2-${i}`} w={w} h={wallH} t={t} color={colors.wall}
              doors={mappedDoors} windows={mappedWindows} materialType={material}
              position={[round2(wall.coord), 0, round2(wall.start + len/2)]} rotation={[0, -Math.PI/2, 0]}
              frameColor={colors.trim} glassColor={colors.window} doorColor={colors.door} hideRoof={hideRoof}
              wallTextures={{ }} doorTextures={{ }} isNight={isNight} garageShutterOpen={garageShutterOpen} />;
          }
        })}

        {(() => {
          const clipRooms = (firstFloorPlan?.rooms || []).filter(r => {
            const label = r.label.toLowerCase();
            return (
              r.type === 'garden' || 
              r.type === 'carport' || 
              r.type === 'balcony' ||
              label.includes('terrace') ||
              label.includes('open terrace')
            );
          });

          
          const holes = clipRooms.map(r => ({
            x: round2(r.x + r.w / 2 - upperRoofCX),
            z: round2(r.y + r.h / 2 - upperRoofCZ),
            w: r.w + 0.4, // Clearance margin
            h: r.h + 0.4
          }));


          return roof === 'gable' ? (
            <GableRoof W={upperRoofW} D={upperRoofD} cx={upperRoofCX} cz={upperRoofCZ} wallH={wallH - 0.8} color={colors.roof} trimColor={colors.trim} rodColor={colors.rod} transparent={hideRoof} opacity={hideRoof ? 0.1 : 1} />
          ) : (
            <FlatRoof W={upperRoofW} D={upperRoofD} cx={upperRoofCX} cz={upperRoofCZ} wallH={wallH - 0.8} color={colors.roof} transparent={hideRoof} opacity={hideRoof ? 0.1 : 1} hole={holes} />
          );
        })()}

        {addons.includes('solar') && !hideRoof && <SolarPanels minX={upperMinX} maxX={upperMaxX} minZ={upperMinZ} maxZ={upperMaxZ} roofType={roof} wallH={wallH} />}
        {addons.includes('water_tank') && !hideRoof && <WaterTank maxX={upperMaxX} maxZ={upperMaxZ} wallH={wallH} roofType={roof} />}

        {/* Room labels */}
        {showLabels && (firstFloorPlan?.rooms || []).map(r => (
          <Html key={`label2-${r.id}`} position={[r.x + r.w/2, 3, r.y + r.h/2]} center zIndexRange={[100, 0]}>
            <div className="pointer-events-none px-3 py-1 rounded-sm bg-white/90 border border-black/10 shadow-lg text-[10px] font-display font-bold tracking-widest whitespace-nowrap">
              {r.label}
            </div>
          </Html>
        ))}
      </group>
    </group>
  );
};

