import { ConfigState } from '@/store/configurator';
import { computeArea } from './cost';

export interface FurnitureItem {
  type: 'bed' | 'wardrobe' | 'desk' | 'nightstand' | 'toilet' | 'sink' | 'shower' | 'bathtub' |
  'stove' | 'fridge' | 'counter' | 'island' | 'dining_table' | 'sofa' | 'tv' | 'coffee_table' |
  'plant' | 'rug' | 'bookshelf' | 'washing_machine' | 'table' | 'chair' | 'generator' | 'sectional_sofa' | 'paw_sofa' | 'l_sofa' | 'round_coffee_table' | 'media_console' | 'floor_lamp' | 'side_table' | 'tv_stand' | 'armchair';
  x: number; // relative to room
  y: number;
  w: number;
  h: number;
  rotation?: number;
  flipX?: boolean;
  label?: string;
}

export interface DoorInfo {
  wall: 'top' | 'bottom' | 'left' | 'right';
  position: number; // 0–1 along the wall
  width: number; // ft
  swing?: 'in' | 'out';
  connectsTo?: string; // room id
  doorType?: 'standard' | 'open'; // standard = swinging door, open = archway (no door panel)
  label?: string;
}

export interface WindowInfo {
  wall: 'top' | 'bottom' | 'left' | 'right';
  position: number;
  width: number;
}

export interface StairGeometry {
  stairWidth: number;   // Width of the actual stair flights (ft)
  stairLength: number;  // Total length of the stair footprint (ft)
  landingSize: number;  // Landing square side length (ft)
  openingWidth: number; // Width of the slab opening for upper floor (ft)
  openingLength: number; // Length of the slab opening for upper floor (ft)
  stepCount: number;    // Total number of steps (both flights)
  stepRise: number;     // Height of each step (ft)
  treadDepth: number;   // Depth of each tread (ft)
  stairOffsetX: number; // X offset of stair footprint inside room (ft)
  stairOffsetY: number; // Y offset of stair footprint inside room (ft)
  stairType: 'L_SHAPE'; // Currently only L-shape supported
}

/** Clamp a value between min and max. */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Compute stair geometry from room dimensions. Auto-generates for legacy rooms. */
export function computeStairGeometry(roomW: number, roomH: number): StairGeometry {
  const stepCount = 18; // 9 per flight
  const stepsPerFlight = stepCount / 2;
  const floorHeight = 14; // standard residential floor height in ft
  const stepRise = floorHeight / stepCount;

  // Balanced L-shape: both flights get equal tread depth.
  // Landing side = stair flight width, flightRun = stepsPerFlight * treadDepth.
  // Total footprint side = landingSize + flightRun (same for width & length → square).
  const treadDepth = clamp(0.85, 0.75, 1.0); // ~10 inches, standard residential
  const flightRun = stepsPerFlight * treadDepth; // 7.65ft
  const maxSide = Math.min(roomW - 1, roomH - 1); // leave margin inside room
  const landingSize = clamp(maxSide - flightRun, 3, 4.5);
  const side = landingSize + flightRun; // balanced square footprint
  const stairWidth = Math.min(side, roomW - 0.8);
  const stairLength = Math.min(side, roomH - 0.8);

  const openingWidth = landingSize + 0.15; // fits only the ascending flight & landing
  const openingLength = stairLength;
  // Touch walls completely (no offset gap)
  const stairOffsetX = 0;
  const stairOffsetY = Math.max(0, roomH - stairLength);
  return { stairWidth, stairLength, landingSize, openingWidth, openingLength, stepCount, stepRise, treadDepth, stairOffsetX, stairOffsetY, stairType: 'L_SHAPE' };
}

export function resolveStairGeometry(room: { w: number; h: number; stairGeometry?: Partial<StairGeometry> }): StairGeometry {
  return computeStairGeometry(room.w, room.h);
}

export interface Room {
  id: string;
  type: 'bedroom' | 'bathroom' | 'kitchen' | 'living' | 'lounge' | 'study' | 'dressing' | 'dining' | 'entry' | 'hallway' | 'staircase' | 'balcony' | 'carport' | 'garden' | 'garage' | 'generator';
  label: string;
  x: number; // ft
  y: number;
  w: number;
  h: number;
  color: string;
  furniture: FurnitureItem[];
  doors: DoorInfo[];
  windows: WindowInfo[];
  orientation?: number; // 0: Top, 1: Right, 2: Bottom, 3: Left
  isMirrored?: boolean;
  openWalls?: ('top' | 'bottom' | 'left' | 'right')[];
  kitchenType?: 'standard' | 'open' | 'galley';
  stairGeometry?: StairGeometry;
}

export interface Plan {
  width: number;  // ft
  height: number;
  rooms: Room[];
  plotEntranceX?: number;
  landPaddingFt?: number; // extra plot boundary beyond the building footprint (each side)
}

const COLORS: Record<string, string> = {
  bedroom:  'hsl(33 35% 82%)',
  bathroom: 'hsl(200 30% 82%)',
  kitchen:  'hsl(28 38% 72%)',
  living:   'hsl(40 30% 87%)',
  lounge:   'hsl(32 28% 85%)',
  study:    'hsl(48 35% 88%)',
  dressing: 'hsl(28 24% 84%)',
  dining:   'hsl(36 28% 82%)',
  entry:    'hsl(36 18% 76%)',
  hallway:  'hsl(38 20% 88%)',
  staircase:'hsl(38 20% 88%)',
  balcony:  'hsl(120 18% 78%)',
  carport:  'hsl(0 0% 82%)',
  garden:   'hsl(120 30% 72%)',
  garage:   'hsl(0 0% 78%)',
  generator:'hsl(0 0% 65%)',
};

// ── Furniture helpers (all wall-aligned, walking-space aware) ──────────────

export function regenerateFurniture(room: Room, kitchenType: string = 'open'): FurnitureItem[] {
  const items = generateRoomFurniture(room, kitchenType);
  return clearDoorways(items, room);
}

function generateRoomFurniture(room: Room, kitchenType: string = 'open'): FurnitureItem[] {
  const orient = room.orientation || 0;
  let items: FurnitureItem[] = [];
  switch (room.type) {
    case 'bedroom':
      return bedroomFurniture(room.w, room.h, room.id === 'bed-0', orient);
    case 'dressing':
      return dressingFurniture(room.w, room.h, orient);
    case 'bathroom':
      const isMasterBath = room.id === 'bath-attached-bed-0';
      return bathroomFurniture(room.w, room.h, isMasterBath, orient);
    case 'kitchen':
      return kitchenFurniture(room.w, room.h, room.kitchenType || kitchenType, orient);
    case 'living':
      if (room.id === 'combined-living') {
        return combinedLivingFurniture(room.w, room.h);
      }
      return livingFurniture(room.w, room.h, orient);
    case 'lounge':
      return loungeFurniture(room.w, room.h, orient);
    case 'study':
      return studyFurniture(room.w, room.h, orient);
    case 'dining':
      return diningFurniture(room.w, room.h);
    case 'balcony':
      return [
        { type: 'plant', x: 1, y: 0.8, w: 1.5, h: 1.5 },
        { type: 'plant', x: room.w - 2.5, y: 0.8, w: 1.5, h: 1.5 },
      ];
    case 'garden':
      return gardenFurniture(room.w, room.h);
    case 'garage':
      return [];
    case 'generator':
      return [{ type: 'generator', x: room.w / 2 - 2, y: room.h / 2 - 1.5, w: 4, h: 3, rotation: 0 }];
    default:
      items = room.furniture;
      break;
  }
  return applySmartRotations(items, room.w, room.h);
}

export function applySmartRotations(items: FurnitureItem[], w: number, h: number): FurnitureItem[] {
  const roomCenter = { x: w / 2, y: h / 2 };

  const getCenter = (item: FurnitureItem) => ({
    x: item.x + item.w / 2,
    y: item.y + item.h / 2
  });

  const getAngle = (from: {x:number, y:number}, to: {x:number, y:number}) => {
    let angleDeg = Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
    return (90 - angleDeg + 360) % 360;
  };

  const snapTo90 = (angle: number) => Math.round(angle / 90) * 90 % 360;

  return items.map(item => {
    let target = roomCenter;
    let snap = true;

    if (item.type === 'sofa') {
      const tv = items.find(i => i.type === 'tv');
      if (tv) target = getCenter(tv);
    } else if (item.type === 'tv') {
      const sofa = items.find(i => i.type === 'sofa' || i.type === 'bed');
      if (sofa) target = getCenter(sofa);
    } else if (item.type === 'coffee_table') {
      const tv = items.find(i => i.type === 'tv');
      if (tv) target = getCenter(tv);
    } else if (item.type === 'chair') {
      const desk = items.find(i => i.type === 'desk' || i.type === 'dining_table');
      if (desk) target = getCenter(desk);
      snap = false;
    } else if (item.type === 'bed' || item.type === 'wardrobe' || item.type === 'sink' || item.type === 'toilet' || item.type === 'shower' || item.type === 'stove' || item.type === 'fridge' || item.type === 'counter') {
      target = roomCenter;
    } else if (item.type === 'island' || item.type === 'dining_table') {
      return item; // keep original rotation
    } else {
      target = roomCenter;
    }

    const from = getCenter(item);
    let rotation = getAngle(from, target);
    if (snap) {
      rotation = snapTo90(rotation);
    }

    return { ...item, rotation };
  });
}

// Items that don't really obstruct doorways — never slide/drop these.
const NON_BLOCKING_FURNITURE: Set<FurnitureItem['type']> = new Set([
  'rug', 'plant', 'tv',
]);

// Get the axis-aligned footprint of an item taking 90/270 rotations into account.
function getFurnitureFootprint(item: FurnitureItem) {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  const rot = (((item.rotation || 0) % 360) + 360) % 360;
  const rotated = rot === 90 || rot === 270;
  const fw = rotated ? item.h : item.w;
  const fh = rotated ? item.w : item.h;
  return { x: cx - fw / 2, y: cy - fh / 2, w: fw, h: fh };
}

function rectIntersectionArea(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ix * iy;
}

/**
 * Remove or slide furniture so it doesn't sit in the way of any door.
 * Each door produces a clearance strip along its wall (door width + side
 * padding) extending into the room. Items overlapping the strip are slid
 * along the wall first; if they still don't fit, they are dropped so the
 * doorway stays clear.
 */
export function clearDoorways(items: FurnitureItem[], room: Room): FurnitureItem[] {
  const doors = room.doors || [];
  if (!doors.length) return items;

  const sidePad = 0.6;     // ft of clearance beyond door frame on each side
  const swingDepth = 3.5;  // ft into room for swinging doors (covers the arc)
  const archDepth = 2.0;   // ft into room for archways / open doorways

  type Zone = { x: number; y: number; w: number; h: number; wall: 'top' | 'bottom' | 'left' | 'right' };
  const zones: Zone[] = doors.map((d) => {
    const depth = d.doorType === 'open' ? archDepth : swingDepth;
    const dw = d.width + sidePad * 2;
    if (d.wall === 'top') {
      const cx = d.position * room.w;
      return { x: cx - dw / 2, y: 0, w: dw, h: depth, wall: 'top' };
    } else if (d.wall === 'bottom') {
      const cx = d.position * room.w;
      return { x: cx - dw / 2, y: room.h - depth, w: dw, h: depth, wall: 'bottom' };
    } else if (d.wall === 'left') {
      const cy = d.position * room.h;
      return { x: 0, y: cy - dw / 2, w: depth, h: dw, wall: 'left' };
    } else {
      const cy = d.position * room.h;
      return { x: room.w - depth, y: cy - dw / 2, w: depth, h: dw, wall: 'right' };
    }
  });

  const fitsRoom = (fp: { x: number; y: number; w: number; h: number }) =>
    fp.x >= -0.01 &&
    fp.y >= -0.01 &&
    fp.x + fp.w <= room.w + 0.01 &&
    fp.y + fp.h <= room.h + 0.01;

  const conflictZone = (
    fp: { x: number; y: number; w: number; h: number },
    threshold = 0.04
  ): Zone | null => {
    const itemArea = Math.max(0.01, fp.w * fp.h);
    for (const z of zones) {
      if (rectIntersectionArea(fp, z) / itemArea > threshold) return z;
    }
    return null;
  };

  const result: FurnitureItem[] = [];
  for (const item of items) {
    if (NON_BLOCKING_FURNITURE.has(item.type)) {
      result.push(item);
      continue;
    }

    const fp = getFurnitureFootprint(item);
    let conflict = conflictZone(fp);
    if (!conflict) {
      result.push(item);
      continue;
    }

    // Try sliding the item along the door's wall (parallel to it) so that
    // it ends up flush against either side of the doorway.
    let placed = item;
    let placedFp = fp;
    let tries = 0;
    while (conflict && tries < 8) {
      const z = conflict;
      const candidates: { dx: number; dy: number }[] = [];
      if (z.wall === 'top' || z.wall === 'bottom') {
        // slide along x
        candidates.push({ dx: z.x - 0.2 - (placedFp.x + placedFp.w), dy: 0 });
        candidates.push({ dx: z.x + z.w + 0.2 - placedFp.x, dy: 0 });
      } else {
        // slide along y
        candidates.push({ dx: 0, dy: z.y - 0.2 - (placedFp.y + placedFp.h) });
        candidates.push({ dx: 0, dy: z.y + z.h + 0.2 - placedFp.y });
      }

      // Prefer the smaller-magnitude shift.
      candidates.sort(
        (a, b) => Math.abs(a.dx) + Math.abs(a.dy) - (Math.abs(b.dx) + Math.abs(b.dy))
      );

      let moved = false;
      for (const c of candidates) {
        const newFp = {
          x: placedFp.x + c.dx,
          y: placedFp.y + c.dy,
          w: placedFp.w,
          h: placedFp.h,
        };
        if (!fitsRoom(newFp)) continue;
        if (conflictZone(newFp)) continue;
        placed = { ...placed, x: placed.x + c.dx, y: placed.y + c.dy };
        placedFp = newFp;
        moved = true;
        break;
      }
      if (!moved) break;
      conflict = conflictZone(placedFp);
      tries++;
    }

    if (!conflict) result.push(placed);
    // else: drop the item entirely so the doorway stays clear.
  }

  return result;
}


function gardenFurniture(w: number, h: number): FurnitureItem[] {
  const items: FurnitureItem[] = [];
  // Scatter plants across the garden
  const cols = Math.max(2, Math.floor(w / 4));
  const rows = Math.max(2, Math.floor(h / 4));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      items.push({
        type: 'plant',
        x: 1 + c * ((w - 2) / cols),
        y: 1 + r * ((h - 2) / rows),
        w: 1.5,
        h: 1.5,
      });
    }
  }
  return items;
}

function dressingFurniture(w: number, h: number, orient: number = 0): FurnitureItem[] {
  const items: FurnitureItem[] = [];
  const G = 0.4;
  
  // Single wardrobe to prevent blocking doors
  const wardrobeDepth = 2;
  const wardrobeLong = Math.min(Math.max(4, h - 2*G), 8);
  
  // If door is on the left (orient 0), put wardrobe on the right.
  // If door is on the right (orient 2), put wardrobe on the left.
  const targetX = (orient === 0) ? w - wardrobeDepth - G : G;
  const targetY = (h - wardrobeLong) / 2;
  
  const x = targetX + wardrobeDepth / 2 - wardrobeLong / 2;
  const y = targetY + wardrobeLong / 2 - wardrobeDepth / 2;
  
  items.push({ type: 'wardrobe', x, y, w: wardrobeLong, h: wardrobeDepth, rotation: 90 });
  
  return items;
}

function bedroomFurniture(w: number, h: number, isMaster: boolean, orient: number = 0): FurnitureItem[] {
  const items: FurnitureItem[] = [];
  const G = 0.5;
  const bedW = isMaster ? Math.min(5.5, w * 0.45) : Math.min(4.5, w * 0.45);
  const bedH = isMaster ? 6.5 : 6;
  const wardW = Math.min(Math.max(4, h - 5), 5); // Max 5 feet
  const wardH = 1.8; // Standard wardrobe depth

  if (orient === 0) {
    // Main door on LEFT wall, dressing door on BOTTOM wall
    items.push({ type: 'bed', x: (w - bedW) / 2, y: G, w: bedW, h: bedH, rotation: 0 });
    const targetX = w - G - wardH;
    const targetY = (h - wardW) / 2;
    items.push({ type: 'wardrobe', x: targetX + wardH/2 - wardW/2, y: targetY + wardW/2 - wardH/2, w: wardW, h: wardH, rotation: 90 });
  } else if (orient === 1) {
    items.push({ type: 'bed', x: w - G - bedH/2 - bedW/2, y: h/2 - bedH/2, w: bedW, h: bedH, rotation: 90 });
    items.push({ type: 'wardrobe', x: (w - wardW) / 2, y: G, w: wardW, h: wardH, rotation: 0 });
  } else if (orient === 2) {
    // Main door on RIGHT wall, dressing door on BOTTOM wall
    items.push({ type: 'bed', x: (w - bedW) / 2, y: G, w: bedW, h: bedH, rotation: 0 });
    const targetX = G;
    const targetY = (h - wardW) / 2;
    items.push({ type: 'wardrobe', x: targetX + wardH/2 - wardW/2, y: targetY + wardW/2 - wardH/2, w: wardW, h: wardH, rotation: 90 });
  } else if (orient === 3) {
    items.push({ type: 'bed', x: G + bedH/2 - bedW/2, y: h/2 - bedH/2, w: bedW, h: bedH, rotation: 270 });
    items.push({ type: 'wardrobe', x: (w - wardW) / 2, y: h - G - wardH, w: wardW, h: wardH, rotation: 180 });
  }
  return items;
}

function bathroomFurniture(w: number, h: number, isMaster: boolean, orient: number = 0): FurnitureItem[] {
  const items: FurnitureItem[] = [];
  const G = 0.4;
  const sinkW = 2.2, sinkH = 1.6;
  const toiletW = 1.6, toiletH = 2.2;
  const showerW = isMaster ? 2.6 : 3, showerH = isMaster ? 5 : 3;

  if (orient === 0) {
    items.push({ type: 'sink', x: w - sinkW - G, y: G, w: sinkW, h: sinkH, rotation: 0 });
    items.push({ type: 'toilet', x: w - toiletW - G, y: h - toiletH - G, w: toiletW, h: toiletH, rotation: 0 });
    items.push({ type: 'shower', x: G, y: h - showerH - G, w: showerW, h: showerH, rotation: 0 });
  } else if (orient === 1) {
    items.push({ type: 'sink', x: w - G - sinkH/2 - sinkW/2, y: G + sinkW/2 - sinkH/2, w: sinkW, h: sinkH, rotation: 90 });
    items.push({ type: 'toilet', x: w - G - toiletH/2 - toiletW/2, y: h - G - toiletW/2 - toiletH/2, w: toiletW, h: toiletH, rotation: 90 });
    items.push({ type: 'shower', x: G + showerH/2 - showerW/2, y: h - G - showerW/2 - showerH/2, w: showerW, h: showerH, rotation: 90 });
  } else if (orient === 2) {
    items.push({ type: 'sink', x: G, y: h - sinkH - G, w: sinkW, h: sinkH, rotation: 180 });
    items.push({ type: 'toilet', x: G, y: G, w: toiletW, h: toiletH, rotation: 180 });
    items.push({ type: 'shower', x: w - showerW - G, y: G, w: showerW, h: showerH, rotation: 180 });
  } else if (orient === 3) {
    items.push({ type: 'sink', x: G + sinkH/2 - sinkW/2, y: h - G - sinkW/2 - sinkH/2, w: sinkW, h: sinkH, rotation: 270 });
    items.push({ type: 'toilet', x: G + toiletH/2 - toiletW/2, y: G + toiletW/2 - toiletH/2, w: toiletW, h: toiletH, rotation: 270 });
    items.push({ type: 'shower', x: w - G - showerH/2 - showerW/2, y: G + showerW/2 - showerH/2, w: showerW, h: showerH, rotation: 270 });
  }
  return items;
}

function kitchenFurniture(w: number, h: number, kitchenType: string, orient: number = 0): FurnitureItem[] {
  const items: FurnitureItem[] = [];
  const G = 0.4;
  
  if (kitchenType === 'open') {
    // OPEN: Island + Back Counter
    if (orient === 2) {
      items.push({ type: 'counter', x: G, y: h - G - 2, w: w - 2*G, h: 2, rotation: 0 });
      items.push({ type: 'stove', x: w * 0.2, y: h - G - 2 + 0.1, w: 2.5, h: 1.6, rotation: 0 });
      items.push({ type: 'fridge', x: w - 2.5 - G, y: h - G - 2 + 0.1, w: 2.2, h: 2.2, rotation: 0 });
      items.push({ type: 'island', x: (w - 6) / 2, y: h * 0.6 - 3, w: 6, h: 3, rotation: 0 });
    } else {
      items.push({ type: 'counter', x: G, y: G, w: w - 2*G, h: 2, rotation: 0 });
      items.push({ type: 'stove', x: w * 0.2, y: G + 0.1, w: 2.5, h: 1.6, rotation: 0 });
      items.push({ type: 'fridge', x: w - 2.5 - G, y: G + 0.1, w: 2.2, h: 2.2, rotation: 0 });
      items.push({ type: 'island', x: (w - 6) / 2, y: h * 0.4, w: 6, h: 3, rotation: 0 });
    }
  } else if (kitchenType === 'galley') {
    // GALLEY: Two parallel vertical counters (on left and right walls)
    // Left counter (originally w: 2, h: h - 2*G at x: G, y: G)
    // newW: h - 2*G, newH: 2
    // cx: G + 1, cy: G + (h - 2*G)/2 = h/2
    items.push({ type: 'counter', x: G + 1 - (h - 2*G)/2, y: h/2 - 1, w: h - 2*G, h: 2, rotation: 270 });
    
    // Right counter (originally w: 2, h: h - 2*G at x: w - 2 - G, y: G)
    // cx: w - G - 1, cy: h/2
    items.push({ type: 'counter', x: w - G - 1 - (h - 2*G)/2, y: h/2 - 1, w: h - 2*G, h: 2, rotation: 90 });
    
    // Left stove (originally w: 1.6, h: 2.5 at x: G + 0.1, y: h * 0.3)
    // cx: G + 0.9, cy: h * 0.3 + 1.25
    items.push({ type: 'stove', x: G + 0.9 - 1.25, y: h * 0.3 + 1.25 - 0.8, w: 2.5, h: 1.6, rotation: 270 });
    
    // Right fridge (originally w: 2.2, h: 2.2 at x: w - G - 2.1, y: h * 0.6)
    // No w/h change, so x, y remain same, just rotate it.
    items.push({ type: 'fridge', x: w - G - 2.1, y: h * 0.6, w: 2.2, h: 2.2, rotation: 90 });
  } else {
    // STANDARD (based on orientation)
    const cW = w - 2 * G - 2.2;
    const cH = h - 2 * G - 2.2;
    const cD = 2;

    if (orient === 0) {
      items.push({ type: 'counter', x: G, y: G, w: cW, h: cD, rotation: 0 });
      items.push({ type: 'stove',   x: G + cW * 0.4, y: G + 0.1, w: 2.5, h: 1.6, rotation: 0 });
      items.push({ type: 'fridge',  x: w - 2.2 - G, y: G + 0.1, w: 2.2, h: 2.2, rotation: 0 });
    } else if (orient === 1) {
      // Right wall
      // Counter: originally x: w - G - cD, y: G, w: cD, h: cH
      // cx: w - G - cD/2, cy: G + cH/2. newW: cH, newH: cD.
      items.push({ type: 'counter', x: w - G - cD/2 - cH/2, y: G + cH/2 - cD/2, w: cH, h: cD, rotation: 90 });
      // Stove: originally x: w - G - 1.7, y: G + cH * 0.4, w: 1.6, h: 2.5
      // cx: w - G - 0.9, cy: G + cH * 0.4 + 1.25. newW: 2.5, newH: 1.6.
      items.push({ type: 'stove',   x: w - G - 0.9 - 1.25, y: G + cH * 0.4 + 1.25 - 0.8, w: 2.5, h: 1.6, rotation: 90 });
      // Fridge: w=2.2, h=2.2 (square).
      items.push({ type: 'fridge',  x: w - G - 2.2 - 0.1, y: h - G - 2.2, w: 2.2, h: 2.2, rotation: 90 });
    } else if (orient === 2) {
      items.push({ type: 'counter', x: G, y: h - G - cD, w: cW, h: cD, rotation: 180 });
      items.push({ type: 'stove',   x: G + cW * 0.4, y: h - G - 1.6 - 0.1, w: 2.5, h: 1.6, rotation: 180 });
      items.push({ type: 'fridge',  x: w - 2.2 - G, y: h - G - 2.2 - 0.1, w: 2.2, h: 2.2, rotation: 180 });
    } else if (orient === 3) {
      // Left wall
      // Counter: originally x: G, y: G, w: cD, h: cH
      // cx: G + cD/2, cy: G + cH/2. newW: cH, newH: cD.
      items.push({ type: 'counter', x: G + cD/2 - cH/2, y: G + cH/2 - cD/2, w: cH, h: cD, rotation: 270 });
      // Stove: originally x: G + 0.1, y: G + cH * 0.4, w: 1.6, h: 2.5
      // cx: G + 0.9, cy: G + cH * 0.4 + 1.25. newW: 2.5, newH: 1.6.
      items.push({ type: 'stove',   x: G + 0.9 - 1.25, y: G + cH * 0.4 + 1.25 - 0.8, w: 2.5, h: 1.6, rotation: 270 });
      // Fridge: square.
      items.push({ type: 'fridge',  x: G + 0.1, y: h - G - 2.2, w: 2.2, h: 2.2, rotation: 270 });
    }
  }
  return items;
}

function livingFurniture(w: number, h: number, orient: number = 0): FurnitureItem[] {
  const items: FurnitureItem[] = [];
  const G = 0.5;
  const tvW = Math.min(5.5, w * 0.4);
  const sofaW = Math.min(8, w * 0.6);
  // Coffee table sized relative to the sofa, placed between sofa and TV
  const ctW = Math.min(4, sofaW * 0.55);
  const ctH = Math.min(2, h * 0.18);

  if (orient === 0) {
    items.push({ type: 'tv', x: (w - tvW) / 2, y: G, w: tvW, h: 1.2, rotation: 0 });
    items.push({ type: 'sofa', x: (w - sofaW) / 2, y: h - 3 - G, w: sofaW, h: 3, rotation: 180 });
    if (h >= 9) items.push({ type: 'coffee_table', x: (w - ctW) / 2, y: h - 3 - G - ctH - 0.6, w: ctW, h: ctH, rotation: 0 });
  } else if (orient === 1) {
    items.push({ type: 'tv', x: w - G - 0.6 - tvW/2, y: h/2 - 0.6, w: tvW, h: 1.2, rotation: 90 });
    items.push({ type: 'sofa', x: G + 1.5 - sofaW/2, y: h/2 - 1.5, w: sofaW, h: 3, rotation: 270 });
    if (w >= 9) items.push({ type: 'coffee_table', x: G + 3 + 0.6, y: (h - ctW) / 2, w: ctH, h: ctW, rotation: 0 });
  } else if (orient === 2) {
    items.push({ type: 'tv', x: (w - tvW) / 2, y: h - G - 1.2, w: tvW, h: 1.2, rotation: 180 });
    items.push({ type: 'sofa', x: (w - sofaW) / 2, y: G, w: sofaW, h: 3, rotation: 0 });
    if (h >= 9) items.push({ type: 'coffee_table', x: (w - ctW) / 2, y: G + 3 + 0.6, w: ctW, h: ctH, rotation: 0 });
  } else if (orient === 3) {
    items.push({ type: 'tv', x: G + 0.6 - tvW/2, y: h/2 - 0.6, w: tvW, h: 1.2, rotation: 270 });
    items.push({ type: 'sofa', x: w - G - 1.5 - sofaW/2, y: h/2 - 1.5, w: sofaW, h: 3, rotation: 90 });
    if (w >= 9) items.push({ type: 'coffee_table', x: w - G - 3 - 0.6 - ctH, y: (h - ctW) / 2, w: ctH, h: ctW, rotation: 0 });
  } else if (orient === 4) {
    items.push({ type: 'tv', x: (w - tvW) / 2, y: G, w: tvW, h: 1.2, rotation: 0 });
    items.push({ type: 'sofa', x: (w - sofaW) / 2, y: h/2 - 1.5, w: sofaW, h: 3, rotation: 180 });
  }

  return items;
}

function studyFurniture(w: number, h: number, orient: number = 0): FurnitureItem[] {
  // Study room: desk against a wall with an office chair, plus a bookshelf along an adjacent wall.
  const items: FurnitureItem[] = [];
  const G = 0.5;
  const deskW = Math.min(5, w * 0.55);
  const deskH = 2.2;
  const chairW = 1.8;
  const chairH = 1.8;
  const shelfW = Math.min(4, w * 0.4);
  const shelfH = 1.2;

  if (orient === 0) {
    // Desk along top wall, chair below desk, bookshelf along bottom wall
    items.push({ type: 'desk', x: (w - deskW) / 2, y: G, w: deskW, h: deskH, rotation: 0 });
    items.push({ type: 'chair', x: (w - chairW) / 2, y: G + deskH + 0.4, w: chairW, h: chairH, rotation: 0 });
    items.push({ type: 'bookshelf', x: (w - shelfW) / 2, y: h - G - shelfH, w: shelfW, h: shelfH, rotation: 0 });
  } else if (orient === 1) {
    // Desk along right wall
    items.push({ type: 'desk', x: w - G - deskH, y: (h - deskW) / 2, w: deskH, h: deskW, rotation: 0 });
    items.push({ type: 'chair', x: w - G - deskH - 0.4 - chairW, y: (h - chairH) / 2, w: chairW, h: chairH, rotation: 0 });
    items.push({ type: 'bookshelf', x: G, y: (h - shelfW) / 2, w: shelfH, h: shelfW, rotation: 0 });
  } else if (orient === 2) {
    items.push({ type: 'desk', x: (w - deskW) / 2, y: h - G - deskH, w: deskW, h: deskH, rotation: 0 });
    items.push({ type: 'chair', x: (w - chairW) / 2, y: h - G - deskH - 0.4 - chairH, w: chairW, h: chairH, rotation: 0 });
    items.push({ type: 'bookshelf', x: (w - shelfW) / 2, y: G, w: shelfW, h: shelfH, rotation: 0 });
  } else {
    // orient 3: desk along left wall
    items.push({ type: 'desk', x: G, y: (h - deskW) / 2, w: deskH, h: deskW, rotation: 0 });
    items.push({ type: 'chair', x: G + deskH + 0.4, y: (h - chairH) / 2, w: chairW, h: chairH, rotation: 0 });
    items.push({ type: 'bookshelf', x: w - G - shelfH, y: (h - shelfW) / 2, w: shelfH, h: shelfW, rotation: 0 });
  }

  // Optional decorative plant in a free corner if the room is large enough
  if (w >= 9 && h >= 9) {
    items.push({ type: 'plant', x: w - G - 1.4, y: G, w: 1.4, h: 1.4, rotation: 0 });
  }

  return items;
}

function entertainerLoungeFurniture(w: number, totalH: number): FurnitureItem[] {
  const items: FurnitureItem[] = [];
  const G = 0.5;
  const longSide = 10;
  const shortSide = 6;
  const ctW = 4;
  const ctH = 2.5;

  // TV unit on the top wall (flush against top wall)
  const tvW = 6;
  const consoleW = 8;
  const consoleDepth = 1.5;
  const tvCenterX = w / 2;
  items.push({ type: 'media_console', x: tvCenterX - consoleW/2, y: 0, w: consoleW, h: consoleDepth, rotation: 0 });
  items.push({ type: 'tv', x: tvCenterX - tvW/2, y: 0.6, w: tvW, h: 1.2, rotation: 0 });

  // L-shaped sectional sofa centered in the lounge
  const visualX = (w - longSide) / 2;
  const visualY = (totalH - shortSide) / 2;
  
  // entertainer_sofa at rotation 0 has backrest at top, chaise on the right.
  // rotation 180 puts backrest at bottom (facing TV at top), chaise on the left.
  items.push({ type: 'entertainer_sofa', x: visualX, y: visualY, w: longSide, h: shortSide, rotation: 180 });

  // Large rectangular coffee table centered in front of the sofa
  // Since sofa faces Top, the nook (inside the L) is on the right side.
  // The chaise is on the left. So the coffee table should be placed to the right of the chaise.
  const nookX = visualX + longSide / 2 + 1; 
  const nookY = visualY + shortSide / 2 - 1.5;
  items.push({ type: 'coffee_table', x: nookX, y: nookY, w: ctW, h: ctH, rotation: 0 });

  // Floor lamp in the bottom-right corner of the lounge
  items.push({ type: 'floor_lamp', x: w - G - 2, y: totalH - G - 2, w: 2, h: 2, rotation: 0 });

  // Round rug underneath the sofa and coffee table area
  const rugR = Math.max(longSide, shortSide) * 0.6;
  items.push({ type: 'rug', x: visualX + longSide/2 - rugR, y: visualY + shortSide/2 - rugR, w: rugR*2, h: rugR*2, rotation: 0 });

  return items;
}

function combinedLivingFurniture(w: number, h: number): FurnitureItem[] {
  const items: FurnitureItem[] = [];
  const G = 0.5;
  const longSide = 10;
  const shortSide = 6;
  const ctR = 1.5;

  // TV on the right side wall, vertically centered
  const tvCenterY = h / 2;
  const consoleW = Math.min(8, h * 0.4);
  const consoleDepth = 1.5;
  items.push({ type: 'media_console', x: w - G - consoleDepth, y: tvCenterY - consoleW/2, w: consoleDepth, h: consoleW, rotation: 0 });
  
  const tvW = Math.min(5.5, consoleW * 0.8);
  items.push({ type: 'tv', x: w - G - 0.6 - tvW/2, y: tvCenterY - 0.6, w: tvW, h: 1.2, rotation: 90 });

  // Sofa centered in the room
  // visual width = longSide, visual height = shortSide
  const visualX = w / 2 - longSide / 2;
  const visualY = h / 2 - shortSide / 2;

  // L-sofa base: Top edge shortSide, Left edge longSide. Corner Top-Left.
  // Rotated 270: Long side BOTTOM, Short side LEFT.
  const sofaX = visualX + longSide/2 - shortSide/2;
  const sofaY = visualY + shortSide/2 - longSide/2;
  items.push({ type: 'l_sofa', x: sofaX, y: sofaY, w: shortSide, h: longSide, rotation: 270 });

  // Side table removed per request
  // const sideTableW = 2;
  // const sideTableH = 2;
  // items.push({ type: 'side_table', x: visualX - sideTableW - 0.2, y: visualY + 0.5, w: sideTableW, h: sideTableH, rotation: 0 });

  // Floor lamp in the top-left corner
  items.push({ type: 'floor_lamp', x: G + 0.5, y: G + 0.5, w: 2, h: 2, rotation: 0 });

  // Round coffee table centered in the nook of the sofa
  // Since the sofa's corner is at Top-Right, the nook is in the Bottom-Left quadrant
  const nookX = visualX + 3.5;
  const nookY = visualY + 4.5;
  items.push({ type: 'round_coffee_table', x: nookX - ctR, y: nookY - ctR, w: ctR*2, h: ctR*2, rotation: 0 });

  // Rug
  const rugX = visualX - 1;
  const rugY = visualY - 1;
  const rugW = longSide + 2;
  const rugH = shortSide + 2;
  items.push({ type: 'rug', x: rugX, y: rugY, w: rugW, h: rugH, rotation: 0 });

  return items;
}

function loungeFurniture(w: number, h: number, orient: number = 0): FurnitureItem[] {
  // Family Lounge: a single U-shaped sectional sofa with built-in coffee table.
  // Visually distinct from the simple rectangular sofa used in the Living Room.
  const margin = 1.5;
  // Pick bounding box size proportional to room, leaving generous space around it.
  const bw = Math.max(5, Math.min(w - margin * 2, w * 0.55));
  const bh = Math.max(4, Math.min(h - margin * 2, h * 0.55));

  return [{
    type: 'sectional_sofa',
    x: (w - bw) / 2,
    y: (h - bh) / 2,
    w: bw,
    h: bh,
    rotation: 0,
  }];
}

function diningFurniture(w: number, h: number): FurnitureItem[] {
  const tableW = Math.min(5, w * 0.65);
  const tableH = Math.min(3, h * 0.45);
  return [
    { type: 'dining_table', x: (w - tableW) / 2, y: (h - tableH) / 2, w: tableW, h: tableH },
  ];
}

// ── Door connectivity ──────────────────────────────────────────────────────

/** Returns true if two rooms share a wall boundary */
function roomsAreAdjacent(a: Room, b: Room): { shared: boolean; wall: 'top'|'bottom'|'left'|'right' } {
  const EPS = 0.5;
  if (Math.abs((a.x + a.w) - b.x) < EPS && overlaps1D(a.y, a.y + a.h, b.y, b.y + b.h)) {
    return { shared: true, wall: 'right' };
  }
  if (Math.abs(a.x - (b.x + b.w)) < EPS && overlaps1D(a.y, a.y + a.h, b.y, b.y + b.h)) {
    return { shared: true, wall: 'left' };
  }
  if (Math.abs((a.y + a.h) - b.y) < EPS && overlaps1D(a.x, a.x + a.w, b.x, b.x + b.w)) {
    return { shared: true, wall: 'bottom' };
  }
  if (Math.abs(a.y - (b.y + b.h)) < EPS && overlaps1D(a.x, a.x + a.w, b.x, b.x + b.w)) {
    return { shared: true, wall: 'top' };
  }
  return { shared: false, wall: 'top' };
}

function overlaps1D(a0: number, a1: number, b0: number, b1: number): boolean {
  return Math.min(a1, b1) - Math.max(a0, b0) > 1.0;
}

function sharedWallMidpoint(a: Room, wall: 'top'|'bottom'|'left'|'right', b: Room): number {
  if (wall === 'top' || wall === 'bottom') {
    const lo = Math.max(a.x, b.x);
    const hi = Math.min(a.x + a.w, b.x + b.w);
    const mid = (lo + hi) / 2;
    return (mid - a.x) / a.w;
  } else {
    const lo = Math.max(a.y, b.y);
    const hi = Math.min(a.y + a.h, b.y + b.h);
    const mid = (lo + hi) / 2;
    return (mid - a.y) / a.h;
  }
}

function getDoorType(roomTypeA: Room['type'], roomTypeB: Room['type']): 'standard' | 'open' {
  const openTypes: Room['type'][] = ['living', 'lounge', 'kitchen', 'dining'];
  // If BOTH rooms are open-type (living↔kitchen, kitchen↔dining, etc.), use open door
  if (openTypes.includes(roomTypeA) && openTypes.includes(roomTypeB)) return 'open';
  // Bedroom and bathroom always get standard doors
  if (roomTypeA === 'bedroom' || roomTypeB === 'bedroom') return 'standard';
  if (roomTypeA === 'bathroom' || roomTypeB === 'bathroom') return 'standard';
  return 'open';
}

function injectAdjacencyDoors(rooms: Room[]): void {
  const connected = new Set<string>();
  const hasDining = rooms.some(r => r.type === 'dining');
  const hasHallway = rooms.some(r => r.type === 'hallway' || r.type === 'staircase');

  const hasEntrance = (room: Room) => room.doors.some(d => {
    const c = rooms.find(r => r.id === d.connectsTo);
    return c && (c.type === 'hallway' || c.type === 'staircase' || c.type === 'living' || c.type === 'lounge');
  });

  // In no-hallway plans, check if bedroom already has any entrance (to living/kitchen/dining)
  const hasAnyEntrance = (room: Room) => room.doors.some(d => {
    const c = rooms.find(r => r.id === d.connectsTo);
    return c && (c.type === 'hallway' || c.type === 'staircase' || c.type === 'living' || c.type === 'lounge' || c.type === 'kitchen' || c.type === 'dining');
  });

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      const key = [a.id, b.id].sort().join('|');
      if (connected.has(key)) continue;

      if (a.type === 'carport' || b.type === 'carport') continue;
      if (a.type === 'garden' || b.type === 'garden') continue;

      const types = [a.type, b.type];

      // Skip balcony connections to kitchen/dining/bathroom (balcony only connects to living/bedroom)
      if (types.includes('balcony') && ['kitchen', 'dining', 'bathroom'].some(t => types.includes(t as any))) continue;
      
      if (a.type === 'bedroom' && b.type === 'bedroom') continue;

      if (hasDining && types.includes('kitchen')) {
        if (types.includes('hallway') || types.includes('staircase') || types.includes('living') || types.includes('lounge')) continue;
      }

      if (types.includes('bathroom') && types.includes('bedroom')) {
        const bath = a.type === 'bathroom' ? a : b;
        const bed = a.type === 'bedroom' ? a : b;
        if (bath.id !== `bath-attached-${bed.id}`) {
          // In no-hallway plans, allow non-attached bath to connect to a bedroom as fallback
          if (hasHallway) continue;
          if (bath.doors.length >= 1) continue;
        }
      }
      
      if (types.includes('bathroom') && (types.includes('hallway') || types.includes('staircase'))) {
        const bath = a.type === 'bathroom' ? a : b;
        if (bath.id.includes('attached')) continue;
      }

      if (a.type === 'bathroom' && b.type === 'bathroom') continue;

      // Bathroom connections to living/kitchen/dining
      if (types.includes('bathroom') && ['living', 'lounge', 'kitchen', 'dining'].some(t => types.includes(t as any))) {
        if (hasHallway) continue;
        // In no-hallway plans, allow non-attached bathroom connections
        const bath = a.type === 'bathroom' ? a : b;
        if (bath.id.includes('attached')) continue;
      }

      if (a.type === 'bathroom' && a.doors.length >= 1) continue;
      if (b.type === 'bathroom' && b.doors.length >= 1) continue;
      
      if (a.type === 'dressing' && a.doors.length >= 1) continue;
      if (b.type === 'dressing' && b.doors.length >= 1) continue;

      if (a.type === 'bedroom' && ['hallway', 'staircase', 'living', 'lounge'].includes(b.type)) {
        if (hasEntrance(a)) continue;
      }
      if (b.type === 'bedroom' && ['hallway', 'staircase', 'living', 'lounge'].includes(a.type)) {
        if (hasEntrance(b)) continue;
      }

      // Bedroom↔kitchen/dining: block in hallway plans, allow in no-hallway plans as fallback
      if (types.includes('bedroom') && ['kitchen', 'dining'].some(t => types.includes(t as any))) {
        if (hasHallway) continue;
        // In no-hallway plans, only allow if bedroom has no entrance yet
        const bed = a.type === 'bedroom' ? a : b;
        if (hasAnyEntrance(bed)) continue;
      }

      const adj = roomsAreAdjacent(a, b);
      if (!adj.shared) continue;

      const posA = sharedWallMidpoint(a, adj.wall, b);
      const oppositeWall: Record<string, DoorInfo['wall']> = {
        top: 'bottom', bottom: 'top', left: 'right', right: 'left',
      };
      const posB = sharedWallMidpoint(b, oppositeWall[adj.wall], a);

      const clamp = (v: number) => Math.max(0.15, Math.min(0.85, v));

      const aHasDoor = a.doors.some(d => d.wall === adj.wall && Math.abs(d.position - clamp(posA)) < 0.25);
      const bHasDoor = b.doors.some(d => d.wall === oppositeWall[adj.wall] && Math.abs(d.position - clamp(posB)) < 0.25);

      let doorW = types.includes('bathroom') ? 2.5 : 3;
      const doorType = getDoorType(a.type, b.type);

      if (!aHasDoor) {
        a.doors.push({ wall: adj.wall, position: clamp(posA), width: doorW, swing: 'in', connectsTo: b.id, doorType });
      }
      if (!bHasDoor) {
        b.doors.push({ wall: oppositeWall[adj.wall], position: clamp(posB), width: doorW, swing: 'in', connectsTo: a.id, doorType });
      }

      connected.add(key);
    }
  }
}

// ── Validation ─────────────────────────────────────────────────────────────

function cleanupDoors(rooms: Room[]): void {
  const hasHallway = rooms.some(r => r.type === 'hallway' || r.type === 'staircase');

  for (const room of rooms) {
    if (room.type === 'bathroom') {
      const isAttached = room.id.includes('attached');
      const targetBedId = isAttached ? room.id.replace('bath-attached-', '') : null;

      let validDoorFound = false;
      const validDoors: DoorInfo[] = [];

      for (const door of room.doors) {
        if (!door.connectsTo) {
          validDoors.push(door);
          continue;
        }

        const connectedRoom = rooms.find(r => r.id === door.connectsTo);
        if (!connectedRoom) continue;

        let isValid = false;
        if (isAttached) {
          isValid = (connectedRoom.id === targetBedId);
        } else {
          // Non-attached bath: connect to hallway, or any accessible room if no hallway
          if (hasHallway) {
            isValid = (connectedRoom.type === 'hallway' || connectedRoom.type === 'staircase' || connectedRoom.type === 'dressing');
          } else {
            isValid = ['living', 'kitchen', 'dining', 'hallway', 'staircase', 'bedroom', 'dressing'].includes(connectedRoom.type);
          }
        }

        if (isValid && !validDoorFound) {
          validDoors.push(door);
          validDoorFound = true;
        } else {
          connectedRoom.doors = connectedRoom.doors.filter(d => d.connectsTo !== room.id);
        }
      }

      room.doors = validDoors;
    }
  }

  for (const room of rooms) {
    if (room.type === 'bedroom') {
      let entranceFound = false;
      const validDoors: DoorInfo[] = [];

      for (const door of room.doors) {
        if (!door.connectsTo) {
          validDoors.push(door);
          continue;
        }

        const connectedRoom = rooms.find(r => r.id === door.connectsTo);
        if (!connectedRoom) {
          validDoors.push(door);
          continue;
        }

        if (connectedRoom.type === 'bathroom' || connectedRoom.type === 'balcony' || connectedRoom.type === 'dressing') {
          validDoors.push(door);
        } else if (connectedRoom.type === 'hallway' || connectedRoom.type === 'staircase' || connectedRoom.type === 'living' || connectedRoom.type === 'lounge') {
          if (!entranceFound) {
            validDoors.push(door);
            entranceFound = true;
          } else {
            connectedRoom.doors = connectedRoom.doors.filter(d => d.connectsTo !== room.id);
          }
        } else if (!hasHallway && (connectedRoom.type === 'kitchen' || connectedRoom.type === 'dining')) {
          // In no-hallway plans, allow kitchen/dining as entrance fallback
          if (!entranceFound) {
            validDoors.push(door);
            entranceFound = true;
          } else {
            connectedRoom.doors = connectedRoom.doors.filter(d => d.connectsTo !== room.id);
          }
        } else {
          connectedRoom.doors = connectedRoom.doors.filter(d => d.connectsTo !== room.id);
        }
      }
      room.doors = validDoors;
    }
  }
}

function validateAndFixBathrooms(rooms: Room[]): void {
  const baths = rooms.filter(r => r.type === 'bathroom');
  if (baths.length === 0) return;

  const masterBath = baths.find(b => b.id === 'bath-attached-bed-0');
  if (!masterBath) return;

  const masterArea = masterBath.w * masterBath.h;
  
  for (const bath of baths) {
    if (bath.id === masterBath.id) continue;
    
    const area = bath.w * bath.h;
    if (area >= masterArea) {
      const scale = Math.sqrt((masterArea / 1.25) / area);
      bath.w = Math.max(5, bath.w * scale);
      bath.h = Math.max(7, bath.h * scale);
    }
  }
}

type AbsorbDirection = 'left' | 'right' | 'top' | 'bottom';

function overlapLength(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function findAbsorptionDirection(candidate: Room, removed: Room): AbsorbDirection | null {
  const EPS = 0.75;
  const xOverlap = overlapLength(candidate.x, candidate.x + candidate.w, removed.x, removed.x + removed.w);
  const yOverlap = overlapLength(candidate.y, candidate.y + candidate.h, removed.y, removed.y + removed.h);

  if (Math.abs((candidate.x + candidate.w) - removed.x) <= EPS && yOverlap > 0.5) return 'right';
  if (Math.abs(candidate.x - (removed.x + removed.w)) <= EPS && yOverlap > 0.5) return 'left';
  if (Math.abs((candidate.y + candidate.h) - removed.y) <= EPS && xOverlap > 0.5) return 'bottom';
  if (Math.abs(candidate.y - (removed.y + removed.h)) <= EPS && xOverlap > 0.5) return 'top';
  return null;
}

function absorbRemovedRoomSpace(rooms: Room[], removedRoom: Room, c: ConfigState): void {
  const typePriority: Partial<Record<Room['type'], Partial<Record<Room['type'], number>>>> = {
    bedroom:   { bedroom: 5, dressing: 4, hallway: 4, staircase: 4, living: 3, lounge: 3, dining: 2, kitchen: 2, bathroom: 1, balcony: 0, carport: 0, garden: 0, entry: 0 },
    bathroom:  { bathroom: 5, dressing: 3, hallway: 4, staircase: 4, bedroom: 3, living: 2, lounge: 2, kitchen: 1, dining: 1, balcony: 0, carport: 0, garden: 0, entry: 0 },
    kitchen:   { kitchen: 5, dining: 4, living: 3, lounge: 3, hallway: 2, staircase: 2, bedroom: 1, dressing: 1, bathroom: 1, balcony: 0, carport: 0, garden: 0, entry: 0 },
    living:    { living: 5, lounge: 4, dining: 4, hallway: 3, staircase: 3, kitchen: 3, bedroom: 2, dressing: 1, bathroom: 1, balcony: 0, carport: 0, garden: 0, entry: 0 },
    lounge:    { lounge: 5, living: 4, dining: 4, hallway: 3, staircase: 3, kitchen: 3, bedroom: 2, dressing: 1, bathroom: 1, balcony: 0, carport: 0, garden: 0, entry: 0 },
    dressing:  { dressing: 5, bedroom: 4, bathroom: 3, hallway: 2, staircase: 2, living: 1, lounge: 1, kitchen: 0, dining: 0, balcony: 0, carport: 0, garden: 0, entry: 0 },
    dining:    { dining: 5, kitchen: 4, living: 3, lounge: 3, hallway: 2, staircase: 2, bedroom: 1, dressing: 1, bathroom: 1, balcony: 0, carport: 0, garden: 0, entry: 0 },
    balcony:   { balcony: 5, garden: 4, living: 3, lounge: 3, hallway: 2, staircase: 2, bedroom: 1, dressing: 1, bathroom: 1, kitchen: 1, carport: 0, entry: 0, dining: 0 },
    carport:   { carport: 5, garden: 4, hallway: 2, staircase: 2, living: 1, lounge: 1, bedroom: 0, dressing: 0, bathroom: 0, kitchen: 0, dining: 0, balcony: 0, entry: 0 },
    garden:    { garden: 5, balcony: 4, carport: 3, living: 2, lounge: 2, hallway: 2, staircase: 2, bedroom: 1, dressing: 1, bathroom: 1, kitchen: 1, dining: 1, entry: 0 },
    entry:     { entry: 5, hallway: 4, staircase: 4, living: 3, lounge: 3, bedroom: 2, dressing: 2, bathroom: 1, kitchen: 1, dining: 1, balcony: 0, carport: 0, garden: 0 },
    hallway:   { hallway: 5, staircase: 5, living: 4, lounge: 4, dining: 3, kitchen: 3, bedroom: 2, dressing: 2, bathroom: 2, balcony: 1, carport: 1, garden: 1, entry: 3 },
    staircase: { staircase: 5, hallway: 5, living: 4, lounge: 4, dining: 3, kitchen: 3, bedroom: 2, dressing: 2, bathroom: 2, balcony: 1, carport: 1, garden: 1, entry: 3 },
  };

  let bestCandidate: Room | null = null;
  let bestDirection: AbsorbDirection | null = null;
  let bestScore = -1;

  for (const candidate of rooms) {
    if (candidate.id === removedRoom.id) continue;
    const direction = findAbsorptionDirection(candidate, removedRoom);
    if (!direction) continue;

    const overlap = direction === 'left' || direction === 'right'
      ? overlapLength(candidate.y, candidate.y + candidate.h, removedRoom.y, removedRoom.y + removedRoom.h)
      : overlapLength(candidate.x, candidate.x + candidate.w, removedRoom.x, removedRoom.x + removedRoom.w);

    const baseScore = typePriority[removedRoom.type]?.[candidate.type] ?? 0;
    const score = baseScore * 100 + overlap;

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
      bestDirection = direction;
    }
  }

  if (!bestCandidate || !bestDirection) return;

  switch (bestDirection) {
    case 'left':
      bestCandidate.x = Math.min(bestCandidate.x, removedRoom.x);
      bestCandidate.w = Math.max(bestCandidate.x + bestCandidate.w, removedRoom.x + removedRoom.w) - bestCandidate.x;
      break;
    case 'right':
      bestCandidate.w = Math.max(bestCandidate.x + bestCandidate.w, removedRoom.x + removedRoom.w) - bestCandidate.x;
      break;
    case 'top':
      bestCandidate.y = Math.min(bestCandidate.y, removedRoom.y);
      bestCandidate.h = Math.max(bestCandidate.y + bestCandidate.h, removedRoom.y + removedRoom.h) - bestCandidate.y;
      break;
    case 'bottom':
      bestCandidate.h = Math.max(bestCandidate.y + bestCandidate.h, removedRoom.y + removedRoom.h) - bestCandidate.y;
      break;
  }

  if (['bedroom', 'bathroom', 'kitchen', 'living', 'lounge', 'dressing', 'dining', 'balcony', 'garden'].includes(bestCandidate.type)) {
    bestCandidate.furniture = regenerateFurniture(bestCandidate, c.kitchen);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── PRESET-BASED PLAN GENERATION ──────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// Each home type has 2 presets with unique layouts scaled to their target sqft.
// Family and Premium presets include a front corner garden.

// ── STARTER PRESETS (1200–2400 sqft → plot ~32×44 ≈ 1408 sqft) ───────────

function starterPresetA(c: ConfigState): Plan {
  const W = 28;
  const H = 40;
  const rooms: Room[] = [];

  // Left side
  rooms.push({
    id: 'living', type: 'living', label: 'HALL + LIVING ROOM',
    x: 0, y: 0, w: 14, h: 18,
    color: COLORS.living,
    furniture: livingFurniture(14, 18, 4),
    openWalls: ['right'],
    doors: [
      { wall: 'left', position: 0.15, width: 3.5, swing: 'in', doorType: 'standard' },
      { wall: 'bottom', position: 0.5, width: 3.5, swing: 'out', doorType: 'open', connectsTo: 'dining' }
    ],
    windows: [{ wall: 'left', position: 0.5, width: 5 }, { wall: 'top', position: 0.5, width: 6 }],
  });

  rooms.push({
    id: 'dining', type: 'dining', label: 'DINING',
    x: 0, y: 18, w: 14, h: 10,
    color: COLORS.dining,
    furniture: diningFurniture(14, 10),
    doors: [
      { wall: 'top', position: 0.5, width: 3.5, swing: 'in', doorType: 'open', connectsTo: 'living' },
      { wall: 'bottom', position: 0.5, width: 3.5, swing: 'out', doorType: 'open', connectsTo: 'kitchen' },
      { wall: 'right', position: 0.5, width: 3.5, swing: 'in', doorType: 'open', connectsTo: 'main-hallway' }
    ],
    windows: [{ wall: 'left', position: 0.5, width: 4 }],
  });

  rooms.push({
    id: 'kitchen', type: 'kitchen', label: 'KITCHEN',
    x: 0, y: 28, w: 14, h: 8,
    color: COLORS.kitchen,
    furniture: kitchenFurniture(14, 8, c.kitchen, 2),
    doors: [
      { wall: 'top', position: 0.5, width: 3.5, swing: 'in', doorType: 'standard', connectsTo: 'dining' }
    ],
    windows: [{ wall: 'left', position: 0.5, width: 4 }], // Left center
  });

  // Center Hallway
  rooms.push({
    id: 'main-hallway', type: 'hallway', label: 'HALLWAY',
    x: 14, y: 0, w: 4, h: 36,
    color: COLORS.hallway,
    openWalls: ['left'],
    furniture: [],
    doors: [
      { wall: 'left', position: 9/36, width: 3.5, swing: 'in', doorType: 'standard', connectsTo: 'living' },
      { wall: 'left', position: 23/36, width: 3.5, swing: 'out', doorType: 'open', connectsTo: 'dining' },
      { wall: 'right', position: 8/36, width: 3, swing: 'in', doorType: 'standard', connectsTo: 'bed-0' },
      { wall: 'right', position: 20/36, width: 2.5, swing: 'in', doorType: 'standard', connectsTo: 'bath-common-1' },
      { wall: 'right', position: 30/36, width: 3, swing: 'in', doorType: 'standard', connectsTo: 'bed-1' },
      { wall: 'bottom', position: 0.5, width: 3.5, swing: 'in', doorType: 'standard', connectsTo: 'balcony' }
    ],
    windows: [],
  });

  // Right side
  rooms.push({
    id: 'bed-0', type: 'bedroom', label: 'MASTER BEDROOM',
    x: 18, y: 0, w: 10, h: 16,
    color: COLORS.bedroom,
    furniture: bedroomFurniture(10, 16, true, 1),
    doors: [
      { wall: 'left', position: 0.5, width: 3, swing: 'out', doorType: 'standard', connectsTo: 'main-hallway' }
    ],
    windows: [{ wall: 'right', position: 0.5, width: 4 }, { wall: 'top', position: 0.5, width: 4 }], // Right middle
  });

  rooms.push({
    id: 'bath-common-1', type: 'bathroom', label: 'COMMON BATH',
    x: 18, y: 16, w: 10, h: 8,
    color: COLORS.bathroom,
    furniture: bathroomFurniture(10, 8, false, 1),
    doors: [
      { wall: 'left', position: 0.5, width: 2.5, swing: 'out', doorType: 'standard', connectsTo: 'main-hallway' }
    ],
    windows: [{ wall: 'right', position: 0.25, width: 3 }], // Right top middle
  });

  rooms.push({
    id: 'bed-1', type: 'bedroom', label: 'BEDROOM 2',
    x: 18, y: 24, w: 10, h: 12,
    color: COLORS.bedroom,
    furniture: bedroomFurniture(10, 12, false, 1),
    doors: [
      { wall: 'left', position: 0.5, width: 3, swing: 'out', doorType: 'standard', connectsTo: 'main-hallway' }
    ],
    windows: [{ wall: 'right', position: 0.5, width: 4 }], // Right middle
  });

  rooms.push({
    id: 'balcony', type: 'balcony', label: 'BALCONY',
    x: 0, y: 36, w: 28, h: 4,
    color: COLORS.balcony,
    furniture: [
      { type: 'plant', x: 2, y: 1.5, w: 1.5, h: 1.5 },
      { type: 'plant', x: 26, y: 1.5, w: 1.5, h: 1.5 },
    ],
    doors: [
      { wall: 'top', position: 16/28, width: 3.5, swing: 'out', doorType: 'standard', connectsTo: 'main-hallway' }
    ],
    windows: [],
  });

  // We skip injectAdjacencyDoors to strictly enforce this highly logical preset
  // but we still run standard validators just in case
  validateAndFixBathrooms(rooms);

  return { width: W, height: H, rooms, landPaddingFt: 2 };
}

// ── FAMILY PRESETS (1800–3600 sqft → plot ~52×52 ≈ 2704 sqft) ────────────

function familyPresetA(c: ConfigState): Plan {
  const W = 40;
  const H = 40;
  const rooms: Room[] = [];

  rooms.push({
    id: 'balcony', type: 'garden', label: 'GARDEN',
    x: 0, y: 36, w: 40, h: 4,
    color: COLORS.garden,
    furniture: [
      { type: 'plant', x: 2, y: 1.5, w: 1.5, h: 1.5 },
      { type: 'plant', x: 38, y: 1.5, w: 1.5, h: 1.5 },
    ],
    doors: [
      { wall: 'top', position: 14/40, width: 3.5, swing: 'out', doorType: 'standard', connectsTo: 'main-hallway' }
    ],
    windows: [],
  });

  rooms.push({
    id: 'garden', type: 'balcony', label: 'COVERED PATIO',
    x: 0, y: 0, w: 12, h: 10,
    color: COLORS.balcony,
    furniture: [
      { type: 'plant', x: 2, y: 2, w: 2, h: 2 },
      { type: 'plant', x: 8, y: 2, w: 2, h: 2 },
      { type: 'plant', x: 2, y: 6, w: 2, h: 2 },
      { type: 'plant', x: 8, y: 6, w: 2, h: 2 }
    ],
    doors: [
      { wall: 'right', position: 0.5, width: 4, swing: 'in', doorType: 'standard', connectsTo: 'living' }
    ],
    windows: [],
  });

  rooms.push({
    id: 'dining', type: 'dining', label: 'DINING',
    x: 0, y: 10, w: 12, h: 14,
    color: COLORS.dining,
    furniture: [{ type: 'dining_table', x: 2, y: 4, w: 8, h: 6, rotation: 0 }],
    doors: [
      { wall: 'bottom', position: 0.5, width: 3.5, swing: 'out', doorType: 'open', connectsTo: 'kitchen' },
      { wall: 'right', position: 0.8, width: 3.5, swing: 'out', doorType: 'open', connectsTo: 'main-hallway' }
    ],
    windows: [{ wall: 'left', position: 0.5, width: 4 }],
  });

  rooms.push({
    id: 'kitchen', type: 'kitchen', label: 'KITCHEN',
    x: 0, y: 24, w: 12, h: 12,
    color: COLORS.kitchen,
    furniture: kitchenFurniture(12, 12, c.kitchen, 1),
    doors: [
      { wall: 'right', position: 0.5, width: 3.5, swing: 'out', doorType: 'standard', connectsTo: 'main-hallway' }
    ],
    windows: [{ wall: 'left', position: 0.5, width: 4 }],
  });

  rooms.push({
    id: 'living', type: 'living', label: 'HALL + LIVING ROOM',
    x: 12, y: 0, w: 14, h: 16,
    color: COLORS.living,
    openWalls: ['bottom'],
    furniture: livingFurniture(14, 16, 4),
    doors: [],
    windows: [{ wall: 'top', position: 0.5, width: 5 }],
  });

  rooms.push({
    id: 'main-hallway', type: 'hallway', label: 'HALLWAY',
    x: 12, y: 16, w: 4, h: 20,
    color: COLORS.hallway,
    openWalls: ['top', 'right'],
    furniture: [],
    doors: [],
    windows: [],
  });

  rooms.push({
    id: 'sub-hallway', type: 'hallway', label: '',
    x: 16, y: 22, w: 24, h: 4,
    color: COLORS.hallway,
    openWalls: ['left'],
    furniture: [],
    doors: [],
    windows: [],
  });

  rooms.push({
    id: 'bed-0', type: 'bedroom', label: 'MASTER BEDROOM',
    x: 26, y: 0, w: 14, h: 16,
    color: COLORS.bedroom,
    furniture: bedroomFurniture(14, 16, true, 1),
    doors: [
      { wall: 'left', position: 0.8, width: 3.5, swing: 'out', doorType: 'standard', connectsTo: 'living' }
    ],
    windows: [{ wall: 'right', position: 0.5, width: 5 }],
  });

  rooms.push({
    id: 'bath-master', type: 'bathroom', label: 'MASTER BATH',
    x: 26, y: 16, w: 14, h: 6,
    color: COLORS.bathroom,
    furniture: bathroomFurniture(14, 6, true, 0),
    doors: [
      { wall: 'top', position: 0.5, width: 2.5, swing: 'in', doorType: 'standard', connectsTo: 'bed-0' }
    ],
    windows: [{ wall: 'right', position: 0.5, width: 3 }],
  });

  rooms.push({
    id: 'bath-common-1', type: 'bathroom', label: 'COMMON BATH',
    x: 16, y: 16, w: 10, h: 6,
    color: COLORS.bathroom,
    furniture: bathroomFurniture(10, 6, false, 0),
    doors: [
      { wall: 'bottom', position: 0.5, width: 2.5, swing: 'out', doorType: 'standard', connectsTo: 'sub-hallway' }
    ],
    windows: [],
  });

  rooms.push({
    id: 'bed-1', type: 'bedroom', label: 'BEDROOM 2',
    x: 16, y: 26, w: 12, h: 10,
    color: COLORS.bedroom,
    furniture: bedroomFurniture(12, 10, false, 0),
    doors: [
      { wall: 'top', position: 0.5, width: 3, swing: 'in', doorType: 'standard', connectsTo: 'sub-hallway' }
    ],
    windows: [{ wall: 'bottom', position: 0.5, width: 4 }],
  });

  rooms.push({
    id: 'bed-2', type: 'bedroom', label: 'BEDROOM 3',
    x: 28, y: 26, w: 12, h: 10,
    color: COLORS.bedroom,
    furniture: bedroomFurniture(12, 10, false, 0),
    doors: [
      { wall: 'top', position: 0.5, width: 3, swing: 'in', doorType: 'standard', connectsTo: 'sub-hallway' }
    ],
    windows: [{ wall: 'right', position: 0.5, width: 4 }, { wall: 'bottom', position: 0.5, width: 4 }],
  });

  validateAndFixBathrooms(rooms);
  return { width: W, height: H, rooms, landPaddingFt: 6 };
}

// ── EXECUTIVE PRESETS (2100–4200 sqft → plot ~56×58 ≈ 3248 sqft) ─────────

function premiumPresetA(c: ConfigState): Plan {
  const W = 48;
  const H = 50;
  const rooms: Room[] = [];

  // Bottom Balcony
  rooms.push({
    id: 'balcony', type: 'balcony', label: 'BALCONY',
    x: 0, y: 46, w: 48, h: 4,
    color: COLORS.balcony,
    furniture: [
      { type: 'plant', x: 2, y: 1.5, w: 1.5, h: 1.5 },
      { type: 'plant', x: 46, y: 1.5, w: 1.5, h: 1.5 },
    ],
    doors: [],
    windows: [],
  });

  // Vertical Hallway
  rooms.push({
    id: 'main-hallway', type: 'hallway', label: 'HALLWAY',
    x: 34, y: 0, w: 4, h: 46,
    color: COLORS.hallway,
    openWalls: ['left'],
    furniture: [],
    doors: [
      { wall: 'bottom', position: 0.5, width: 3.5, swing: 'out', doorType: 'standard', connectsTo: 'balcony' }
    ],
    windows: [],
  });

  // LEFT ZONE
  rooms.push({
    id: 'garden', type: 'garden', label: 'GARDEN',
    x: 0, y: 0, w: 14, h: 14,
    color: COLORS.garden,
    furniture: gardenFurniture(14, 14),
    doors: [],
    windows: [],
  });

  rooms.push({
    id: 'kitchen', type: 'kitchen', label: 'KITCHEN',
    x: 0, y: 14, w: 14, h: 16,
    color: COLORS.kitchen,
    furniture: kitchenFurniture(14, 16, c.kitchen, 3),
    doors: [
      { wall: 'bottom', position: 0.5, width: 3.5, swing: 'out', doorType: 'open', connectsTo: 'dining' },
      { wall: 'right', position: 0.5, width: 3.5, swing: 'out', doorType: 'open', connectsTo: 'living' }
    ],
    windows: [{ wall: 'left', position: 0.5, width: 4 }],
  });

  rooms.push({
    id: 'dining', type: 'dining', label: 'DINING',
    x: 0, y: 30, w: 14, h: 16,
    color: COLORS.dining,
    furniture: [{ type: 'dining_table', x: 2, y: 5, w: 10, h: 6, rotation: 0 }],
    doors: [
      { wall: 'top', position: 0.5, width: 3.5, swing: 'in', doorType: 'open', connectsTo: 'kitchen' }
    ],
    windows: [{ wall: 'left', position: 0.5, width: 4 }, { wall: 'bottom', position: 0.5, width: 4 }],
  });

  // Column 2 (x: 14, w: 20)
  rooms.push({
    id: 'living', type: 'living', label: 'HALL + LIVING ROOM',
    x: 14, y: 0, w: 20, h: 22,
    color: COLORS.living,
    openWalls: ['right'],
    furniture: livingFurniture(20, 22, 1),
    doors: [
      { wall: 'top', position: 0.3, width: 4, swing: 'in', doorType: 'standard', label: 'MAIN DOOR' },
      { wall: 'left', position: 0.8, width: 3.5, swing: 'out', doorType: 'open', connectsTo: 'kitchen' }
    ],
    windows: [{ wall: 'top', position: 0.7, width: 5 }],
  });

  rooms.push({
    id: 'bed-2', type: 'bedroom', label: 'BEDROOM 3',
    x: 14, y: 22, w: 20, h: 12,
    color: COLORS.bedroom,
    furniture: bedroomFurniture(20, 12, false, 3),
    doors: [
      { wall: 'right', position: 0.5, width: 3, swing: 'in', doorType: 'standard', connectsTo: 'main-hallway' }
    ],
    windows: [],
  });

  rooms.push({
    id: 'bed-3', type: 'bedroom', label: 'BEDROOM 4',
    x: 14, y: 34, w: 20, h: 12,
    color: COLORS.bedroom,
    furniture: bedroomFurniture(20, 12, false, 3),
    doors: [
      { wall: 'right', position: 0.5, width: 3, swing: 'in', doorType: 'standard', connectsTo: 'main-hallway' }
    ],
    windows: [],
  });

  // RIGHT ZONE (x: 38, w: 10)
  rooms.push({
    id: 'bed-0', type: 'bedroom', label: 'MASTER BEDROOM',
    x: 38, y: 0, w: 10, h: 16,
    color: COLORS.bedroom,
    furniture: bedroomFurniture(10, 16, true, 1),
    doors: [
      { wall: 'left', position: 0.5, width: 3, swing: 'in', doorType: 'standard', connectsTo: 'main-hallway' }
    ],
    windows: [{ wall: 'top', position: 0.5, width: 4 }, { wall: 'right', position: 0.5, width: 4 }],
  });

  rooms.push({
    id: 'bath-master', type: 'bathroom', label: 'MASTER BATH',
    x: 38, y: 16, w: 10, h: 9,
    color: COLORS.bathroom,
    furniture: bathroomFurniture(10, 9, true, 1),
    doors: [
      { wall: 'top', position: 0.5, width: 2.5, swing: 'in', doorType: 'standard', connectsTo: 'bed-0' }
    ],
    windows: [{ wall: 'right', position: 0.5, width: 2 }],
  });

  rooms.push({
    id: 'bed-1', type: 'bedroom', label: 'BEDROOM 2',
    x: 38, y: 25, w: 10, h: 11,
    color: COLORS.bedroom,
    furniture: bedroomFurniture(10, 11, false, 1),
    doors: [
      { wall: 'left', position: 0.5, width: 3, swing: 'in', doorType: 'standard', connectsTo: 'main-hallway' }
    ],
    windows: [{ wall: 'right', position: 0.5, width: 4 }],
  });

  rooms.push({
id: 'bath-attached-bed-1', type: 'bathroom', label: 'ENSUITE 2',
    x: 38, y: 36, w: 10, h: 7,
    color: COLORS.bathroom,
    furniture: bathroomFurniture(10, 7, false, 1),
    doors: [
      { wall: 'top', position: 0.5, width: 2.5, swing: 'in', doorType: 'standard', connectsTo: 'bed-1' }
    ],
    windows: [{ wall: 'right', position: 0.5, width: 2 }],
  });

  rooms.push({
    id: 'bath-common-1', type: 'bathroom', label: 'BATH',
    x: 38, y: 43, w: 10, h: 3,
    color: COLORS.bathroom,
    furniture: bathroomFurniture(10, 3, false, 1),
    doors: [
      { wall: 'left', position: 0.5, width: 2.5, swing: 'in', doorType: 'standard', connectsTo: 'main-hallway' }
    ],
    windows: [{ wall: 'right', position: 0.5, width: 2 }],
  });

  validateAndFixBathrooms(rooms);
  return { width: W, height: H, rooms, landPaddingFt: 4 };
}



// ── Main plan generator ────────────────────────────────────────────────────

import { LayoutStyle } from '@/store/configurator';

/**
 * Ensures that every bedroom and bathroom room has at least one door
 * connecting it to an adjacent hallway (or living/dining as fallback).
 * This is a post-processing fix that runs after any layout is applied so
 * that saved/cached plans with missing doors are automatically repaired.
 */
function ensureBedBathHallwayDoors(rooms: Room[]): void {
  const hallway = rooms.find(r => r.type === 'hallway');
  if (!hallway) return; // No hallway to connect to

  const hallwayId = hallway.id;

  for (const room of rooms) {
    if (room.type !== 'bedroom' && room.type !== 'bathroom') continue;

    // Check if room already has a door connecting to this hallway (or any hallway)
    const hasHallwayDoor = (room.doors || []).some(d =>
      !d.connectsTo || // doors without connectsTo are standalone (always render)
      d.connectsTo === hallwayId ||
      rooms.find(r => r.id === d.connectsTo)?.type === 'hallway'
    );
    if (hasHallwayDoor) continue;

    // Determine which wall faces the hallway (based on x/y overlap)
    const roomCenterX = room.x + room.w / 2;
    const roomCenterY = room.y + room.h / 2;
    const hallCenterX = hallway.x + hallway.w / 2;
    const hallCenterY = hallway.y + hallway.h / 2;

    // Check adjacency: hallway is to the left/right/top/bottom of room
    const leftAdj  = Math.abs(room.x - (hallway.x + hallway.w)) < 1.5;
    const rightAdj = Math.abs(room.x + room.w - hallway.x) < 1.5;
    const topAdj   = Math.abs(room.y - (hallway.y + hallway.h)) < 1.5;
    const botAdj   = Math.abs(room.y + room.h - hallway.y) < 1.5;

    let doorWall: 'left' | 'right' | 'top' | 'bottom' | null = null;
    let doorPos = 0.5;

    if (leftAdj) {
      doorWall = 'left';
      // Position door at overlap center
      const overlapTop    = Math.max(room.y, hallway.y);
      const overlapBottom = Math.min(room.y + room.h, hallway.y + hallway.h);
      if (overlapBottom > overlapTop) {
        doorPos = ((overlapTop + overlapBottom) / 2 - room.y) / room.h;
      }
    } else if (rightAdj) {
      doorWall = 'right';
      const overlapTop    = Math.max(room.y, hallway.y);
      const overlapBottom = Math.min(room.y + room.h, hallway.y + hallway.h);
      if (overlapBottom > overlapTop) {
        doorPos = ((overlapTop + overlapBottom) / 2 - room.y) / room.h;
      }
    } else if (topAdj) {
      doorWall = 'top';
      const overlapLeft  = Math.max(room.x, hallway.x);
      const overlapRight = Math.min(room.x + room.w, hallway.x + hallway.w);
      if (overlapRight > overlapLeft) {
        doorPos = ((overlapLeft + overlapRight) / 2 - room.x) / room.w;
      }
    } else if (botAdj) {
      doorWall = 'bottom';
      const overlapLeft  = Math.max(room.x, hallway.x);
      const overlapRight = Math.min(room.x + room.w, hallway.x + hallway.w);
      if (overlapRight > overlapLeft) {
        doorPos = ((overlapLeft + overlapRight) / 2 - room.x) / room.w;
      }
    }

    if (!doorWall) continue; // Not adjacent to hallway

    const doorWidth = room.type === 'bedroom' ? 3 : 2.5;
    doorPos = Math.max(0.15, Math.min(0.85, doorPos));

    room.doors = room.doors || [];
    room.doors.push({
      wall: doorWall,
      position: doorPos,
      width: doorWidth,
      swing: 'in',
      doorType: 'standard',
    } as DoorInfo);
  }
}

export function applyLayoutStyle(plan: Plan, style: LayoutStyle, kitchenType: 'standard' | 'open' | 'galley' = 'standard'): Plan {
  if (['default', 'open_plan', 'entertainer', 'family_suite'].includes(style)) {
    // Fix up missing bed/bath → hallway doors
    const fixed: Plan = JSON.parse(JSON.stringify(plan));
    ensureBedBathHallwayDoors(fixed.rooms);
    
    // Update kitchen furniture based on kitchenType
    const k = fixed.rooms.find(r => r.type === 'kitchen');
    if (k) {
       k.furniture = kitchenFurniture(k.w, k.h, kitchenType, k.doors.length + k.windows.length);
    }
    
    if (['open_plan', 'entertainer', 'family_suite'].includes(style)) {
       const openRooms = ['living', 'kitchen', 'dining', 'lounge', 'hallway'];


       const getSharedWall = (a: Room, b: Room): { wall: DoorInfo['wall'], overlapRatio: number } | null => {
         const aRight = a.x + a.w;
         const aBottom = a.y + a.h;
         const bRight = b.x + b.w;
         const bBottom = b.y + b.h;
         const overlapX = Math.min(aRight, bRight) - Math.max(a.x, b.x);
         const overlapY = Math.min(aBottom, bBottom) - Math.max(a.y, b.y);
         if (overlapY > 0 && Math.abs(aRight - b.x) < 0.5) return { wall: 'right', overlapRatio: overlapY / a.h };
         if (overlapY > 0 && Math.abs(bRight - a.x) < 0.5) return { wall: 'left', overlapRatio: overlapY / a.h };
         if (overlapX > 0 && Math.abs(aBottom - b.y) < 0.5) return { wall: 'bottom', overlapRatio: overlapX / a.w };
         if (overlapX > 0 && Math.abs(bBottom - a.y) < 0.5) return { wall: 'top', overlapRatio: overlapX / a.w };
         return null;
       };

       fixed.rooms.forEach(room => {
          if (style === 'entertainer' && (room.type === 'living' || room.type === 'lounge')) {
             room.doors.forEach(door => {
                if (door.wall === 'top') {
                   door.position = 0.85; // Move door to the right, away from the centrally placed TV
                }
             });
          }

          if (!openRooms.includes(room.type)) return;

          // Convert existing connecting doors to wide open archways
          room.doors.forEach(door => {
             if (door.connectsTo) {
                const target = fixed.rooms.find(r => r.id === door.connectsTo);
                if (target && openRooms.includes(target.type)) {
                   door.doorType = 'open';
                   door.width = 5;
                }
             }
          });

          // Also find adjacent social rooms and mark shared walls as openWalls
          fixed.rooms.forEach(other => {
             if (other.id === room.id) return;
             if (!openRooms.includes(other.type)) return;
             const shared = getSharedWall(room, other);
             // Only open the wall if the adjacent room covers a significant portion of it
             if (shared && shared.overlapRatio > 0.6) {
                const wall = shared.wall;
                if (!room.openWalls) room.openWalls = [];
                // Only mark wall as fully open if there's no existing 'open'-type door already
                // handling this transition (avoids floating archways without a wall)
                const hasOpenDoor = room.doors.some(d => d.wall === wall && d.doorType === 'open' && d.connectsTo === other.id);
                if (!hasOpenDoor && !room.openWalls.includes(wall)) room.openWalls.push(wall);
                // Remove any standard door between them (wall is fully open now)
                room.doors = room.doors.filter(d => d.connectsTo !== other.id || d.doorType === 'open');
             }
          });
       });
    }

    // Apply specific label/color/furniture updates for entertainer and family_suite
    const livingRoom = fixed.rooms.find(r => r.id === 'gf-living' || r.type === 'living');
    if (livingRoom) {
      if (style === 'family_suite') {
        livingRoom.label = 'COMBINED LIVING + FAMILY LOUNGE';
        livingRoom.color = '#fffbe6';
        livingRoom.furniture = combinedLivingFurniture(livingRoom.w, livingRoom.h);
      } else if (style === 'entertainer') {
        livingRoom.label = 'ENTERTAINMENT LOUNGE';
        livingRoom.color = COLORS.lounge;
        livingRoom.furniture = entertainerLoungeFurniture(livingRoom.w, livingRoom.h);
      }
    }
    
    return fixed;
  }
  
  const newPlan: Plan = JSON.parse(JSON.stringify(plan));
  
  // Calculate the interior footprint (excluding addons and structural rooms like hallways)
  const boundsTypes = ['bedroom', 'bathroom', 'living', 'dining', 'kitchen', 'lounge'];
  const interiorRoomsForBounds = newPlan.rooms.filter(r => boundsTypes.includes(r.type));
  
  let offsetX = 0;
  let offsetY = 0;
  let W = newPlan.width;
  let H = newPlan.height;
  
  if (interiorRoomsForBounds.length > 0) {
      offsetX = Math.min(...interiorRoomsForBounds.map(r => r.x));
      offsetY = Math.min(...interiorRoomsForBounds.map(r => r.y));
      const maxX = Math.max(...interiorRoomsForBounds.map(r => r.x + r.w));
      const maxY = Math.max(...interiorRoomsForBounds.map(r => r.y + r.h));
      W = maxX - offsetX;
      H = maxY - offsetY;
  }

  // Extract necessary rooms
  const beds = newPlan.rooms.filter(r => r.type === 'bedroom');
  const baths = newPlan.rooms.filter(r => r.type === 'bathroom');
  
  // Addons shouldn't be touched structurally.
  // NOTE: We intentionally exclude base-plan garden rooms (e.g. "garden-0" from premiumPresetA)
  // because those rooms are decorative/positional for the DEFAULT layout only. When a layout
  // style (open_plan, entertainer, family_suite) regenerates the entire interior, those old
  // garden rooms would remain at their original coordinates and visually overlap the new rooms.
  // Only addon- prefixed rooms and hard structural types (garage, carport) are preserved.
  const preserved = newPlan.rooms.filter(r => 
    r.id.startsWith('addon-') || r.type === 'garage' || r.type === 'carport'
  );

  // We are going to generate NEW rooms for the interior footprint
  const newRooms: Room[] = [...preserved];

  const packRoomsSmartly = (
      roomsToPack: Room[], 
      x: number, y: number, w: number, h: number, 
      doorWall: 'left'|'right'|'top'|'bottom', 
      doorConnectsTo?: string,
      doorSafeMaxY?: number
  ) => {
      if (roomsToPack.length === 0) return;
      const count = roomsToPack.length;
      const projectedH = h / count;
      let finalRooms: Partial<Room>[] = [];
      
      if (projectedH > 13) {
         roomsToPack.forEach((r, idx) => {
             if (r.type === 'bedroom') {
                finalRooms.push({ ...r, h: 14 });
                finalRooms.push({
                  id: `dynamic-dressing-${idx}-${r.id}`, type: 'dressing', label: 'WALK-IN ROBE', h: 5, color: '#e6f2ff'
                });
             } else if (r.type === 'bathroom') {
                finalRooms.push({ ...r, h: 8 });
             } else if (r.type === 'carport') {
                finalRooms.push({ ...r, h: r.h || 11 });
             } else {
                finalRooms.push({ ...r, h: 12 });
             }
         });
         
         const requested = finalRooms.reduce((sum, r) => sum + (r.h || 0), 0);
         const leftover = h - requested;
         
         if (leftover !== 0) {
             const expandables = finalRooms.filter(r => r.type !== 'dressing' && r.type !== 'bathroom' && r.type !== 'carport');
             if (expandables.length > 0) {
                 const reduction = leftover / expandables.length;
                 expandables.forEach(r => r.h! += reduction);
             } else {
                 const reduction = leftover / finalRooms.length;
                 finalRooms.forEach(r => r.h! += reduction);
             }
         }
      } else {
         finalRooms = roomsToPack.map(r => ({ ...r, h: r.h || projectedH }));
         const sumH = finalRooms.reduce((sum, r) => sum + r.h!, 0);
         const leftover = h - sumH;
         if (Math.abs(leftover) > 0.01) {
             const reduction = leftover / finalRooms.length;
             finalRooms.forEach(r => r.h! += reduction);
         }
      }
      
      let curY = y;
      finalRooms.forEach((r, i) => {
         const isNew = !r.doors; // simplistic check
         // Try to map colors, fallback to a neutral tone if unknown
         const rColor = r.color || (COLORS as Record<string, string>)[r.type!] || '#eeeeee';
         const actualRoom: Room = isNew ? { ...r, x: 0, y: 0, w: 0, color: rColor, doors: [], windows: [], furniture: [] } as Room : (r as Room);
         
         actualRoom.x = x;
         actualRoom.y = curY;
         actualRoom.w = w;
         
         let doorPos = 0.5;
         if (doorSafeMaxY !== undefined) {
             let targetCy = curY + (actualRoom.h / 2);
             if (targetCy > doorSafeMaxY && curY < doorSafeMaxY) {
                 targetCy = doorSafeMaxY;
                 if (targetCy < curY + 1.75) targetCy = curY + 1.75;
             }
             doorPos = (targetCy - curY) / actualRoom.h;
             doorPos = Math.max(0.1, Math.min(0.9, doorPos));
         }
         
         actualRoom.openWalls = [];
         actualRoom.windows = [];
         
         let connectsTo = undefined;
         if (!isNew && r.doors && r.doors.length > 0 && r.doors[0].connectsTo) {
             connectsTo = r.doors[0].connectsTo;
         } else if (doorConnectsTo) {
             connectsTo = doorConnectsTo;
         }
         
         // Clear old doors so we don't retain ghost doors from the starter layout
         actualRoom.doors = [];
         
         let hasMainDoor = true;
         
         if (actualRoom.type === 'bedroom' && i + 1 < finalRooms.length && finalRooms[i+1].type === 'dressing') {
             actualRoom.doors.push({ wall: 'bottom', position: 0.5, width: 3.5, swing: 'in', doorType: 'standard' });
             // Bedroom still needs main door
         } 
         else if (actualRoom.type === 'dressing') {
             if (i > 0 && finalRooms[i-1].type === 'bedroom') {
                 actualRoom.doors.push({ wall: 'top', position: 0.5, width: 3.5, swing: 'out', doorType: 'standard' });
             }
             if (i + 1 < finalRooms.length && finalRooms[i+1].type === 'bathroom') {
                 actualRoom.doors.push({ wall: 'bottom', position: 0.5, width: 3.5, swing: 'out', doorType: 'standard' });
             }
             hasMainDoor = false; // Walk-in robe only accessed internally
         }
         else if (actualRoom.type === 'bathroom' && i > 0 && finalRooms[i-1].type === 'dressing') {
             actualRoom.doors.push({ wall: 'top', position: 0.5, width: 3.5, swing: 'in', doorType: 'standard' });
             hasMainDoor = false; // No direct access to living
         }

         if (hasMainDoor) {
             actualRoom.doors.push({ wall: doorWall, position: doorPos, width: 3.5, swing: 'in', doorType: 'standard', connectsTo });
         }
         
         actualRoom.orientation = doorWall === 'right' ? 2 : doorWall === 'left' ? 0 : 1;
         
         if (x === 0) actualRoom.windows.push({ wall: 'left', position: 0.5, width: 4 });
         else if (x + w >= W - 1) actualRoom.windows.push({ wall: 'right', position: 0.5, width: 4 });
         
         if (actualRoom.y <= 1) {
            actualRoom.windows.push({ wall: 'top', position: 0.5, width: 4 });
         }
         if (i === finalRooms.length - 1 && actualRoom.y + actualRoom.h >= h - 1) {
            actualRoom.windows.push({ wall: 'bottom', position: 0.5, width: 4 });
         }
         
         actualRoom.furniture = regenerateFurniture(actualRoom, 'open');
         newRooms.push(actualRoom);
         curY += actualRoom.h;
      });
  };

  const packPrivateRooms = (xStart: number, yStart: number, w: number, h: number, doorsOnWall: 'left' | 'right' | 'top' | 'bottom') => {
      packRoomsSmartly([...baths, ...beds], xStart, yStart, w, h, doorsOnWall);
  };

  const packEntertainerPrivateWing = (xStart: number, yStart: number, w: number, h: number) => {
      if (beds.length >= 3 && baths.length >= 2) {
          // Corridor layout to prevent secondary bedrooms from opening into the Kitchen!
          const masterBedH = Math.round(h * 0.35);
          const bathRowH = Math.round(h * 0.18);
          const remainingH = h - masterBedH - bathRowH;
          const secondaryBeds = beds.length - 1;
          const secBedH = Math.round(remainingH / secondaryBeds);

          const hallW = 4;
          const bedW = w - hallW;

          // Master Bedroom — full width, top
          const mBed = beds[0];
          mBed.x = xStart; mBed.y = yStart; mBed.w = w; mBed.h = masterBedH;
          mBed.doors = [{ wall: 'left', position: 0.5, width: 2.5, swing: 'in', doorType: 'standard' }];
          mBed.windows = [{ wall: 'right', position: 0.5, width: 6 }];
          mBed.color = COLORS.bedroom;
          mBed.furniture = regenerateFurniture({ ...mBed, type: 'bedroom' } as Room, 'open');
          newRooms.push(mBed);

          // Dedicated Hallway for Bedrooms 2 & 3 to shield them from the Kitchen
          const hallH = h - masterBedH;
          newRooms.push({
              id: 'private-corridor', type: 'hallway', label: 'HALL',
              x: xStart, y: yStart + masterBedH, w: hallW, h: hallH,
              color: COLORS.hallway, orientation: 0, openWalls: [],
              doors: [{ wall: 'left', position: 0.1, width: 3, swing: 'in', doorType: 'standard' }], // Connects to Lounge
              windows: [], furniture: []
          });

          // Bathrooms side-by-side
          const cBath = baths[1]; // Common Bath
          const mBath = baths[0]; // Master Bath
          const bathW = Math.round(bedW / 2);
          
          if (cBath) {
              cBath.x = xStart + hallW; cBath.y = yStart + masterBedH; cBath.w = bathW; cBath.h = bathRowH;
              cBath.color = COLORS.bathroom;
              cBath.windows = [];
              cBath.doors = [
                  { wall: 'left', position: 0.5, width: 2.5, swing: 'in', doorType: 'standard', connectsTo: 'private-corridor' }
              ];
              cBath.furniture = regenerateFurniture({ ...cBath, type: 'bathroom' } as Room, 'open');
              newRooms.push(cBath);
          }
          
          if (mBath) {
              mBath.x = xStart + hallW + bathW; mBath.y = yStart + masterBedH; mBath.w = bedW - bathW; mBath.h = bathRowH;
              mBath.color = COLORS.bathroom;
              mBath.windows = [{ wall: 'right', position: 0.5, width: 4 }];
              // Master Bath connects ONLY to Master Bedroom (en-suite)
              mBath.doors = [{ wall: 'top', position: 0.5, width: 2.5, swing: 'in', doorType: 'standard', connectsTo: mBed.id }];
              
              // Correct door placement for Master Bed
              const mbCenter = hallW + bathW + (bedW - bathW)/2;
              mBed.doors.push({ wall: 'bottom', position: mbCenter / w, width: 2.5, swing: 'in', doorType: 'standard', connectsTo: mBath.id });
              mBath.furniture = regenerateFurniture({ ...mBath, type: 'bathroom' } as Room, 'open');
              newRooms.push(mBath);
          }

          // Secondary bedrooms
          let curY = yStart + masterBedH + bathRowH;
          for (let i = 1; i < beds.length; i++) {
              const bed = beds[i];
              const isLast = (i === beds.length - 1);
              const bh = isLast ? (yStart + h - curY) : secBedH;
              bed.x = xStart + hallW; bed.y = curY; bed.w = bedW; bed.h = bh;
              bed.doors = [{ wall: 'left', position: 0.5, width: 2.5, swing: 'in', doorType: 'standard', connectsTo: 'private-corridor' }];
              bed.windows = [{ wall: 'right', position: 0.5, width: 6 }];
              bed.color = COLORS.bedroom;
              
              if (i === 1 && cBath) {
                  bed.doors.push({ wall: 'top', position: 0.25, width: 2.5, swing: 'in', doorType: 'standard', connectsTo: cBath.id });
                  cBath.doors.push({ wall: 'bottom', position: 0.5, width: 2.5, swing: 'in', doorType: 'standard', connectsTo: bed.id });
              }

              bed.furniture = regenerateFurniture({ ...bed, type: 'bedroom' } as Room, 'open');
              newRooms.push(bed);
              curY += bh;
          }
      } else {
          // Simple layout for 2 beds / 2 baths or fewer
          const allPrivate: Room[] = [];
          for (let i = 0; i < Math.max(beds.length, baths.length); i++) {
              if (baths[i]) allPrivate.push(baths[i]);
              if (beds[i]) allPrivate.push(beds[i]);
          }
          packRoomsSmartly(allPrivate, xStart, yStart, w, h, 'left');

          // Master en-suite
          const mBed = newRooms.find(r => r.id === beds[0]?.id);
          const mBath = newRooms.find(r => r.id === baths[0]?.id);
          if (mBed && mBath) {
              mBath.doors = [];
              mBed.doors.push({ wall: 'top', position: 0.5, width: 2.5, swing: 'in', doorType: 'standard', connectsTo: mBath.id });
              mBath.doors.push({ wall: 'bottom', position: 0.5, width: 2.5, swing: 'in', doorType: 'standard', connectsTo: mBed.id });
          }
          for (let i = 1; i < Math.min(beds.length, baths.length); i++) {
              const bed = newRooms.find(r => r.id === beds[i].id);
              const bath = newRooms.find(r => r.id === baths[i].id);
              if (bed && bath) {
                  bed.doors.push({ wall: 'top', position: 0.5, width: 2.5, swing: 'in', doorType: 'standard', connectsTo: bath.id });
                  bath.doors.push({ wall: 'bottom', position: 0.5, width: 2.5, swing: 'in', doorType: 'standard', connectsTo: bed.id });
              }
          }
      }
  };

  const carport = preserved.find(r => r.type === 'carport');
    
  if (carport) {
    const cX = carport.x - offsetX;
    const cY = carport.y - offsetY;
    const cH = Math.max(0, cY + carport.h);
    
    // Only apply this special logic if the carport intrudes into the top-right of our bounds
    if (cX > 0 && cH > 0) {
      // ── Shared geometry (Architectural 3-Column Grid) ─────────────────────────
      const carportW  = carport.w;
      const livingW   = W - carportW;       // full left column width for top area
      const lowerH    = H - cH;             // height of the zone below the carport

      // 3-Column Grid for the lower half
      const col3W = carportW;               // Right column (Baths/Beds)
      const col2W = 10;                     // Middle column (Hallway/Bed 2)
      const col1W = W - col3W - col2W;      // Left column (Kitchen/Dining)

      // X-coordinates
      const col1X = 0;
      const col2X = col1W;
      const col3X = col1W + col2W;

      // Position carport at top-right
      carport.x = offsetX + col3X;
      carport.y = offsetY + 0;

      // Adjust garden width so it doesn't overlap the carport
      const garden = preserved.find(r => r.type === 'garden');
      if (garden) garden.w = W - carportW;

      // Extract preserved private rooms
      const mBed = beds.length > 0 ? beds[0] : null;
      const sBed = beds.length > 1 ? beds[1] : null;
      const cBath = baths.length > 0 ? baths[0] : null;

      // Heights to match reference architecture (proportional to lowerH = 19 based on image)
      const hallH = Math.round(lowerH * (10/19));
      const bed2H = lowerH - hallH;
      const kitH  = hallH;
      const dinH  = bed2H;
      const bathH = Math.round(lowerH * (6/19));
      const masterH = lowerH - bathH;

      // ════════════════════════════════════════════════════════════════════════
      // STYLE BRANCHES
      // ════════════════════════════════════════════════════════════════════════

      if (style === 'open_plan') {
        // ── OPEN PLAN ──────────────────────────────────────────────────────────
        // TOP:    [ OPEN LIVING (col1+2)            |  CARPORT (col3) ]
        // BOTTOM: [ OPEN KITCHEN/DINING (col1) | HALLWAY (col2) | BATHS/BEDS (col3) ]
        // ──────────────────────────────────────────────────────────────────────

        // Top-Left: Living Room
        newRooms.push({
          id: 'living', type: 'living', label: 'OPEN LIVING',
          x: 0, y: 0, w: livingW, h: cH,
          color: COLORS.living, orientation: 1,
          openWalls: ['bottom'], // Open to Kitchen/Dining and Hallway below
          doors: [{ wall: 'top', position: 0.85, width: 4, swing: 'in', doorType: 'standard', label: 'ENTRY' }],
          windows: [{ wall: 'left', position: 0.5, width: 5 }],
          furniture: regenerateFurniture({ type: 'living', w: livingW, h: cH, orientation: 1 } as Room, 'open')
        });

        // Bottom-Left: Kitchen (top) & Dining (bottom)
        newRooms.push({
          id: 'kitchen', type: 'kitchen', label: 'KITCHEN',
          x: col1X, y: cH, w: col1W, h: kitH,
          color: COLORS.kitchen, orientation: 2,
          openWalls: ['top', 'bottom', 'right'],
          doors: [],
          windows: [{ wall: 'left', position: 0.5, width: 3 }],
          furniture: regenerateFurniture({ type: 'kitchen', w: col1W, h: kitH, orientation: 2 } as Room, kitchenType)
        });

        newRooms.push({
          id: 'dining', type: 'dining', label: 'OPEN DINING',
          x: col1X, y: cH + kitH, w: col1W, h: dinH,
          color: COLORS.dining, orientation: 1,
          openWalls: ['top', 'right'],
          doors: [{ wall: 'bottom', position: 0.5, width: 6, swing: 'out', doorType: 'open', connectsTo: 'garden' }],
          windows: [{ wall: 'left', position: 0.5, width: 4 }],
          furniture: regenerateFurniture({ type: 'dining', w: col1W, h: dinH } as Room, 'open')
        });

        // Middle: Hallway
        // In open plan, bedroom 2 is still private
        newRooms.push({
          id: 'hallway', type: 'hallway', label: 'HALLWAY',
          x: col2X, y: cH, w: col2W, h: sBed ? hallH : lowerH,
          color: COLORS.hallway, orientation: 1,
          openWalls: ['top', 'left'],
          doors: [], windows: [], furniture: []
        });

        if (sBed) {
          newRooms.push({
            ...sBed,
            x: col2X, y: cH + hallH, w: col2W, h: bed2H,
            doors: [{ wall: 'top', position: 0.5, width: 3, swing: 'in', doorType: 'standard', connectsTo: 'hallway' }],
            windows: [],
            furniture: regenerateFurniture({ ...sBed, w: col2W, h: bed2H } as Room, 'open')
          });
        }

      } else if (style === 'entertainer') {
        // ── ENTERTAINER ────────────────────────────────────────────────────────
        // TOP:    [ ENTERTAINMENT LOUNGE (col1+2)   |  CARPORT (col3) ]
        // BOTTOM: [ KITCHEN & DINING (col1) | HALLWAY & BED2 (col2) | BATHS/BEDS (col3) ]
        // ──────────────────────────────────────────────────────────────────────

        // Top-Left: Entertainment Lounge
        newRooms.push({
          id: 'lounge', type: 'lounge', label: 'ENTERTAINMENT LOUNGE',
          x: 0, y: 0, w: livingW, h: cH,
          color: COLORS.lounge, orientation: 1,
          openWalls: ['bottom'], // Open to Dining and Hallway
          doors: [{ wall: 'top', position: 0.85, width: 4, swing: 'in', doorType: 'standard', label: 'ENTRY' }],
          windows: [{ wall: 'left', position: 0.5, width: 4 }],
          furniture: regenerateFurniture({ type: 'lounge', w: livingW, h: cH, orientation: 1 } as Room, 'open')
        });

        // Bottom-Left: Kitchen (top) & Dining (bottom)
        newRooms.push({
          id: 'kitchen', type: 'kitchen', label: 'KITCHEN',
          x: col1X, y: cH, w: col1W, h: kitH,
          color: COLORS.kitchen, orientation: 2,
          openWalls: ['top', 'bottom', 'right'], // Open to lounge above, dining below, hallway right
          doors: [],
          windows: [{ wall: 'left', position: 0.5, width: 3 }],
          furniture: regenerateFurniture({ type: 'kitchen', w: col1W, h: kitH, orientation: 2 } as Room, kitchenType)
        });

        newRooms.push({
          id: 'dining', type: 'dining', label: 'DINING',
          x: col1X, y: cH + kitH, w: col1W, h: dinH,
          color: COLORS.dining, orientation: 1,
          openWalls: ['top', 'right'], // Open to kitchen above, bed2 right
          doors: [{ wall: 'bottom', position: 0.5, width: 6, swing: 'out', doorType: 'open', connectsTo: 'garden' }],
          windows: [{ wall: 'left', position: 0.5, width: 4 }],
          furniture: regenerateFurniture({ type: 'dining', w: col1W, h: dinH } as Room, 'open')
        });

        // Middle: Hallway (top) & Bedroom 2 (bottom)
        newRooms.push({
          id: 'hallway', type: 'hallway', label: 'HALLWAY',
          x: col2X, y: cH, w: col2W, h: sBed ? hallH : lowerH,
          color: COLORS.hallway, orientation: 1,
          openWalls: ['top', 'left'],
          doors: [], windows: [], furniture: []
        });

        if (sBed) {
          newRooms.push({
            ...sBed,
            x: col2X, y: cH + hallH, w: col2W, h: bed2H,
            doors: [{ wall: 'top', position: 0.5, width: 3, swing: 'in', doorType: 'standard', connectsTo: 'hallway' }],
            windows: [],
            furniture: regenerateFurniture({ ...sBed, w: col2W, h: bed2H } as Room, 'open')
          });
        }

      } else if (style === 'family_suite') {
        // ── FAMILY SUITE ───────────────────────────────────────────────────────
        // TOP:    [ COMBINED LIVING + FAMILY LOUNGE |  CARPORT ]
        // BOTTOM: [ GRAND KITCHEN | HALLWAY & BED2 | BATHS/BEDS ]
        // ──────────────────────────────────────────────────────────────────────

        // Top-Left: Combined Living + Family Lounge
        newRooms.push({
          id: 'living', type: 'living', label: 'COMBINED LIVING +\nFAMILY LOUNGE',
          x: 0, y: 0, w: livingW, h: cH,
          color: 'hsl(36 32% 84%)',
          orientation: 1,
          openWalls: ['bottom'], // Fully open to kitchen + hallway below
          doors: [
            { wall: 'top', position: 0.5, width: 4, swing: 'in', doorType: 'standard', label: 'ENTRY' },
          ],
          windows: [{ wall: 'left', position: 0.3, width: 4 }, { wall: 'left', position: 0.7, width: 4 }],
          furniture: regenerateFurniture({ type: 'living', w: livingW, h: cH, orientation: 1 } as Room, 'open')
        });

        // Bottom-Left: Kitchen (full height)
        newRooms.push({
          id: 'kitchen', type: 'kitchen', label: 'GRAND KITCHEN',
          x: col1X, y: cH, w: col1W, h: lowerH,
          color: COLORS.kitchen, orientation: 2,
          openWalls: ['right', 'top'], // Open to hallway on right, open to living above
          doors: [{ wall: 'bottom', position: 0.5, width: 6, swing: 'out', doorType: 'open', connectsTo: 'garden' }],
          windows: [{ wall: 'left', position: 0.5, width: 3 }],
          furniture: regenerateFurniture({ type: 'kitchen', w: col1W, h: lowerH, orientation: 2 } as Room, kitchenType)
        });

        // Middle: Hallway (top) & Bedroom 2 (bottom)
        newRooms.push({
          id: 'hallway', type: 'hallway', label: 'HALLWAY',
          x: col2X, y: cH, w: col2W, h: sBed ? hallH : lowerH,
          color: COLORS.hallway, orientation: 1,
          openWalls: ['left', 'top'], // Open to kitchen on left, open to living above
          doors: [], windows: [], furniture: []
        });

        if (sBed) {
          newRooms.push({
            ...sBed,
            x: col2X, y: cH + hallH, w: col2W, h: bed2H,
            doors: [{ wall: 'top', position: 0.5, width: 3, swing: 'in', doorType: 'standard', connectsTo: 'hallway' }],
            windows: [],
            furniture: regenerateFurniture({ ...sBed, w: col2W, h: bed2H } as Room, 'open')
          });
        }

      } else {
        // ── STANDARD (default) ────────────────────────────────────────────────
        // TOP:    [ HALL + LIVING ROOM (left)  |  CARPORT (right) ]
        // BOTTOM: [ KITCHEN (top), DINING (btm) | HALLWAY/BED2 | BATH/MASTER ]
        // ──────────────────────────────────────────────────────────────────────

        // TOP-LEFT: Hall + Living Room
        newRooms.push({
          id: 'living', type: 'living', label: 'HALL + LIVING ROOM',
          x: 0, y: 0, w: livingW, h: cH,
          color: COLORS.living, orientation: 1,
          openWalls: [],
          doors: [
            { wall: 'top', position: 0.5, width: 4, swing: 'in', doorType: 'standard', label: 'ENTRY' }
          ],
          windows: [{ wall: 'left', position: 0.5, width: 4 }],
          furniture: regenerateFurniture({ type: 'living', w: livingW, h: cH, orientation: 1 } as Room, 'open')
        });

        // BOTTOM-LEFT: Kitchen
        newRooms.push({
          id: 'kitchen', type: 'kitchen', label: 'KITCHEN',
          x: col1X, y: cH, w: col1W, h: kitH,
          color: COLORS.kitchen, orientation: 2,
          openWalls: kitchenType === 'open' ? ['bottom'] : [],
          doors: kitchenType === 'open' 
            ? [{ wall: 'top', position: 0.5, width: 3, swing: 'in', doorType: 'standard', connectsTo: 'living' }] 
            : [
                { wall: 'bottom', position: 0.5, width: 3, swing: 'out', doorType: 'standard' },
                { wall: 'top', position: 0.5, width: 3, swing: 'in', doorType: 'standard', connectsTo: 'living' }
              ],
          windows: [{ wall: 'left', position: 0.5, width: 3 }],
          furniture: regenerateFurniture({ type: 'kitchen', w: col1W, h: kitH, orientation: 2 } as Room, kitchenType)
        });

        // BOTTOM-LEFT: Dining
        newRooms.push({
          id: 'dining', type: 'dining', label: 'DINING',
          x: col1X, y: cH + kitH, w: col1W, h: dinH,
          color: COLORS.dining, orientation: 1,
          openWalls: kitchenType === 'open' ? ['top'] : [],
          doors: [{ wall: 'bottom', position: 0.5, width: 6, swing: 'out', doorType: 'open', connectsTo: 'garden' }],
          windows: [{ wall: 'left', position: 0.5, width: 4 }],
          furniture: regenerateFurniture({ type: 'dining', w: col1W, h: dinH } as Room, 'open')
        });

        // Middle: Hallway (top) & Bedroom 2 (bottom)
        newRooms.push({
          id: 'hallway', type: 'hallway', label: 'HALLWAY',
          x: col2X, y: cH, w: col2W, h: sBed ? hallH : lowerH,
          color: COLORS.hallway, orientation: 1,
          openWalls: [],
          doors: [{ wall: 'top', position: 0.5, width: 3, swing: 'in', doorType: 'standard', connectsTo: 'living' }],
          windows: [], furniture: []
        });

        if (sBed) {
          newRooms.push({
            ...sBed,
            x: col2X, y: cH + hallH, w: col2W, h: bed2H,
            doors: [{ wall: 'top', position: 0.5, width: 3, swing: 'in', doorType: 'standard', connectsTo: 'hallway' }],
            windows: [],
            furniture: regenerateFurniture({ ...sBed, w: col2W, h: bed2H } as Room, 'open')
          });
        }
      }

      // COMMON BATH & MASTER BEDROOM for ALL layouts (Right Column)
      if (cBath) {
        newRooms.push({
          ...cBath,
          x: col3X, y: cH, w: col3W, h: bathH,
          doors: [{ wall: 'left', position: 0.5, width: 2.5, swing: 'in', doorType: 'standard', connectsTo: 'hallway' }],
          windows: [{ wall: 'right', position: 0.5, width: 3 }],
          furniture: regenerateFurniture({ ...cBath, w: col3W, h: bathH } as Room, 'open')
        });
      }

      if (mBed) {
        const sharedLen = hallH - bathH;
        let doorPos = 0.5;
        if (sharedLen >= 3) {
           doorPos = (sharedLen / 2) / masterH; 
        } else {
           doorPos = 0.2;
        }

        newRooms.push({
          ...mBed,
          x: col3X, y: cH + bathH, w: col3W, h: masterH,
          doors: [{ wall: 'left', position: doorPos, width: 3, swing: 'in', doorType: 'standard', connectsTo: 'hallway' }],
          windows: [{ wall: 'right', position: 0.5, width: 4 }],
          furniture: regenerateFurniture({ ...mBed, w: col3W, h: masterH } as Room, 'open')
        });
      }

      // ── Cleanup & shift to world coordinates ────────────────────────────────
      newRooms.forEach(r => {
        if (r.windows) r.windows = r.windows.filter(w => w.width > 0);
        if (!preserved.some(p => p.id === r.id)) {
          r.x += offsetX;
          r.y += offsetY;
        }
      });
      newPlan.rooms = newRooms;
      ensureBedBathHallwayDoors(newPlan.rooms);
      return newPlan;
    }

  }

  if (style === 'open_plan') {
    // Grand Split Floor Plan: Central Open Core (50%), flanked by Private Wings (25% each)
    const midW = Math.round(W * 0.50);
    const sideW = Math.floor((W - midW) / 2);
    const rightW = W - sideW - midW;

    const lH = Math.round(H * 0.42);
    const dH = Math.round(H * 0.33);
    const kH = H - lH - dH;

    newRooms.push({
      id: 'living', type: 'living', label: 'GRAND LIVING',
      x: sideW, y: 0, w: midW, h: lH, color: COLORS.living, orientation: 1,
      openWalls: ['bottom'], doors: [{ wall: 'top', position: 0.5, width: 6, swing: 'in', doorType: 'standard', label: 'ENTRY' }], 
      windows: [],
      furniture: regenerateFurniture({ type: 'living', w: midW, h: lH, orientation: 1 } as Room, 'open')
    });

    newRooms.push({
      id: 'dining', type: 'dining', label: 'OPEN DINING',
      x: sideW, y: lH, w: midW, h: dH, color: COLORS.dining,
      openWalls: kitchenType === 'open' ? ['top', 'bottom'] : ['top'], doors: kitchenType === 'open' ? [] : [{ wall: 'bottom', position: 0.5, width: 3.5, swing: 'in', doorType: 'standard' }], windows: [],
      furniture: regenerateFurniture({ type: 'dining', w: midW, h: dH } as Room, 'open')
    });

    newRooms.push({
      id: 'kitchen', type: 'kitchen', label: 'CHEF KITCHEN',
      x: sideW, y: lH + dH, w: midW, h: kH, color: COLORS.kitchen, orientation: 2,
      openWalls: kitchenType === 'open' ? ['top'] : [], 
      doors: kitchenType === 'open' ? [{ wall: 'bottom', position: 0.5, width: 8, swing: 'out', doorType: 'open', connectsTo: 'garden' }] : [{ wall: 'bottom', position: 0.5, width: 8, swing: 'out', doorType: 'open', connectsTo: 'garden' }, { wall: 'top', position: 0.5, width: 3.5, swing: 'out', doorType: 'standard' }], 
      windows: [{ wall: 'bottom', position: 0.5, width: 6 }],
      furniture: regenerateFurniture({ type: 'kitchen', w: midW, h: kH, orientation: 2 } as Room, kitchenType)
    });

    const carports = preserved.filter(r => r.type === 'carport' && r.x <= offsetX);
    const hasIntegratedCarport = carports.length > 0;
    
    const leftBeds = hasIntegratedCarport && beds.length > 2 ? [beds[2]] : [beds[0]];
    const rightBeds = hasIntegratedCarport && beds.length > 2 
        ? [beds[0], beds[1], ...beds.slice(3)] 
        : beds.slice(1);

    const masterRooms = [...leftBeds, baths[0]].filter(Boolean) as Room[];
    
    if (hasIntegratedCarport) {
        carports.forEach(c => {
            const pIdx = preserved.findIndex(r => r.id === c.id);
            if (pIdx !== -1) preserved.splice(pIdx, 1);
            const nIdx = newRooms.findIndex(r => r.id === c.id);
            if (nIdx !== -1) newRooms.splice(nIdx, 1);
        });
        masterRooms.unshift({
            id: 'integrated-carport', type: 'carport', label: 'CARPORT',
            x: 0, y: 0, w: sideW, h: 17, 
            color: COLORS.carport,
            furniture: [{ type: 'car', x: 2, y: 2.5, w: 8, h: 12 }], 
            doors: [], windows: []
        });
    }

    packRoomsSmartly(masterRooms, 0, 0, sideW, H, 'right');

    const secBaths = baths.slice(1);
    const secondaryRooms: Room[] = [];
    if (rightBeds.length > 0) secondaryRooms.push(rightBeds[0]);
    secondaryRooms.push(...secBaths);
    if (rightBeds.length > 1) secondaryRooms.push(...rightBeds.slice(1));
    // Prevent lower bedroom doors from opening into the kitchen
    packRoomsSmartly(secondaryRooms, sideW + midW, 0, rightW, H, 'left', undefined, lH + dH - 2.5);

  } else if (style === 'entertainer') {
    // Grand Split Floor Plan (copied from open_plan): Central Core (50%), flanked by Private Wings (25% each)
    const midW = Math.round(W * 0.50);
    const sideW = Math.floor((W - midW) / 2);
    const rightW = W - sideW - midW;

    const eH = Math.round(H * 0.75); // Combined Living and Dining
    const kH = H - eH;

    newRooms.push({
      id: 'lounge', type: 'lounge', label: 'ENTERTAINMENT LOUNGE',
      x: sideW, y: 0, w: midW, h: eH, color: COLORS.lounge, orientation: 1,
      openWalls: kitchenType === 'open' ? ['bottom'] : [], 
      doors: kitchenType === 'open' ? [{ wall: 'top', position: 0.85, width: 6, swing: 'in', doorType: 'standard', label: 'ENTRY' }] : [{ wall: 'top', position: 0.85, width: 6, swing: 'in', doorType: 'standard', label: 'ENTRY' }, { wall: 'bottom', position: 0.5, width: 3.5, swing: 'in', doorType: 'standard' }],
      windows: [],
      furniture: entertainerLoungeFurniture(midW, eH)
    });

    newRooms.push({
      id: 'kitchen', type: 'kitchen', label: 'GRAND KITCHEN & BAR',
      x: sideW, y: eH, w: midW, h: kH, color: COLORS.kitchen, orientation: 2,
      openWalls: kitchenType === 'open' ? ['top'] : [], 
      doors: kitchenType === 'open' ? [{ wall: 'bottom', position: 0.5, width: 8, swing: 'out', doorType: 'open', connectsTo: 'garden' }] : [{ wall: 'bottom', position: 0.5, width: 8, swing: 'out', doorType: 'open', connectsTo: 'garden' }, { wall: 'top', position: 0.5, width: 3.5, swing: 'out', doorType: 'standard' }], 
      windows: [{ wall: 'bottom', position: 0.5, width: 6 }],
      furniture: regenerateFurniture({ type: 'kitchen', w: midW, h: kH, orientation: 2 } as Room, kitchenType)
    });

    const carports = preserved.filter(r => r.type === 'carport' && r.x <= offsetX);
    const hasIntegratedCarport = carports.length > 0;
    
    const leftBeds = hasIntegratedCarport && beds.length > 2 ? [beds[2]] : [beds[0]];
    const rightBeds = hasIntegratedCarport && beds.length > 2 
        ? [beds[0], beds[1], ...beds.slice(3)] 
        : beds.slice(1);

    const masterRooms = [...leftBeds, baths[0]].filter(Boolean) as Room[];
    
    if (hasIntegratedCarport) {
        carports.forEach(c => {
            const pIdx = preserved.findIndex(r => r.id === c.id);
            if (pIdx !== -1) preserved.splice(pIdx, 1);
            const nIdx = newRooms.findIndex(r => r.id === c.id);
            if (nIdx !== -1) newRooms.splice(nIdx, 1);
        });
        masterRooms.unshift({
            id: 'integrated-carport', type: 'carport', label: 'CARPORT',
            x: 0, y: 0, w: sideW, h: 17, 
            color: COLORS.carport,
            furniture: [{ type: 'car', x: 2, y: 2.5, w: 8, h: 12 }], 
            doors: [], windows: []
        });
    }

    packRoomsSmartly(masterRooms, 0, 0, sideW, H, 'right');

    const secBaths = baths.slice(1);
    const secondaryRooms: Room[] = [];
    if (rightBeds.length > 0) secondaryRooms.push(rightBeds[0]);
    secondaryRooms.push(...secBaths);
    if (rightBeds.length > 1) secondaryRooms.push(...rightBeds.slice(1));
    // Prevent lower bedroom doors from opening into the kitchen
    packRoomsSmartly(secondaryRooms, sideW + midW, 0, rightW, H, 'left', undefined, eH - 2.5);

  } else if (style === 'family_suite') {
    // 3 columns: Left Private, Center Communal, Right Private
    const colW = Math.round(W * 0.3);
    const centerW = W - (colW * 2);
    
    const leftRooms: Room[] = [];
    const rightRooms: Room[] = [];
    
    const carports = preserved.filter(r => r.type === 'carport' && r.x <= offsetX);
    const hasIntegratedCarport = carports.length > 0;

    if (hasIntegratedCarport) {
        carports.forEach(c => {
            const pIdx = preserved.findIndex(r => r.id === c.id);
            if (pIdx !== -1) preserved.splice(pIdx, 1);
            const nIdx = newRooms.findIndex(r => r.id === c.id);
            if (nIdx !== -1) newRooms.splice(nIdx, 1);
        });
        leftRooms.push({
            id: 'integrated-carport', type: 'carport', label: 'CARPORT',
            x: 0, y: 0, w: colW, h: 17, 
            color: COLORS.carport,
            furniture: [{ type: 'car', x: 2, y: 2.5, w: 8, h: 12 }], 
            doors: [], windows: []
        });
    }

    const leftBeds = hasIntegratedCarport && beds.length > 2 ? [beds[2]] : [beds[0]];
    const rightBeds = hasIntegratedCarport && beds.length > 2 
        ? [beds[0], beds[1], ...beds.slice(3)] 
        : beds.slice(1);

    if (leftBeds.length > 0) leftRooms.push(leftBeds[0]);
    if (baths[0]) leftRooms.push(baths[0]);

    for (let i = 0; i < rightBeds.length; i++) {
        if (rightBeds[i]) rightRooms.push(rightBeds[i]);
        if (baths[i + 1]) rightRooms.push(baths[i + 1]);
    }
    
    // Manual proportion override for left wing to clear the kitchen wall
    if (leftRooms.length === 3) {
        if (leftRooms[1]?.type === 'bathroom' && leftRooms[2]?.type === 'bathroom') {
            // 2 Bed / 3 Bath configuration: Split Bath 3 into a Walk-in Robe and Bath 3
            const robe3: Room = {
                id: 'dynamic-dressing-bath3',
                type: 'dressing',
                label: 'WALK-IN ROBE',
                x: 0, y: 0, w: 0, h: 6,
                color: '#e6f2ff',
                doors: [], windows: [], furniture: []
            };
            leftRooms.splice(2, 0, robe3);
            leftRooms[0].h = 16; // Master Bed
            leftRooms[1].h = 12; // Master Bath
            leftRooms[2].h = 12; // Walk-in Robe
            leftRooms[3].h = 12; // Bath 3
        } else {
            // Apply to 3 Bed/2 Bath configurations
            leftRooms[0].h = 16; // Master Bed
            leftRooms[1].h = 14; // Master Bath (Reduced)
            leftRooms[2].h = 22; // Bedroom 3
        }
    }

    if (leftRooms.length + rightRooms.length <= 3) {
        leftRooms.push(...rightRooms);
        rightRooms.length = 0;
    }

    let hubX = colW;
    let hubW = centerW;
    if (leftRooms.length === 0) { hubX = 0; hubW += colW; }
    if (rightRooms.length === 0) { hubW += colW; }

    // Center Hub (Reverted flow: Living at rear, Lounge middle, Kitchen at front)
    const livingH = Math.round(H * 0.4);
    const kH = Math.round(H * 0.25);
    const loungeH = H - livingH - kH;
    
    const combinedLivingH = livingH + loungeH;

    const pack = (rooms: Room[], x: number, y: number, w: number, h: number, doorWall: 'right'|'left') => {
       packRoomsSmartly(rooms, x, y, w, h, doorWall, undefined, H - kH - 2.5);
    };

    pack(leftRooms, 0, 0, colW, H, 'right');
    pack(rightRooms, hubX + hubW, 0, colW, H, 'left');

    newRooms.push({
      id: 'combined-living', type: 'living', label: 'COMBINED LIVING + FAMILY LOUNGE',
      x: hubX, y: 0, w: hubW, h: combinedLivingH, color: '#fffbe6', orientation: 1,
      openWalls: ['bottom'], doors: [{ wall: 'top', position: 0.5, width: 6, swing: 'in', doorType: 'standard', label: 'ENTRY' }],
      windows: [],
      furniture: combinedLivingFurniture(hubW, combinedLivingH)
    });

    newRooms.push({
      id: 'kitchen', type: 'kitchen', label: 'KITCHEN',
      x: hubX, y: combinedLivingH, w: hubW, h: kH, color: COLORS.kitchen, orientation: 2,
      openWalls: kitchenType === 'open' ? ['top'] : [], doors: kitchenType === 'open' ? [{ wall: 'bottom', position: 0.5, width: 4, swing: 'out', doorType: 'open' }] : [
        { wall: 'bottom', position: 0.5, width: 4, swing: 'out', doorType: 'open' },
        { wall: 'top', position: 0.5, width: 3.5, swing: 'out', doorType: 'standard' }
      ],
      windows: [],
      furniture: regenerateFurniture({ type: 'kitchen', w: hubW, h: kH, orientation: 2 } as Room, 'open')
    });
  }

  // Cleanup invalid windows
  newRooms.forEach(r => {
    if (r.windows) r.windows = r.windows.filter(w => w.width > 0);
  });

  // Shift newly generated interior rooms back into the interior bounding box
  newRooms.forEach(r => {
    if (!preserved.some(p => p.id === r.id)) {
      r.x += offsetX;
      r.y += offsetY;
    }
  });



  newPlan.rooms = newRooms;
  ensureBedBathHallwayDoors(newPlan.rooms);
  return newPlan;
}

export function generatePlan(c: ConfigState): Plan {
  let plan: Plan;

  switch (c.homeType) {
    case 'starter':
      plan = starterPresetA(c);
      break;
    case 'family':
      plan = familyPresetA(c);
      break;
    case 'premium':
      plan = premiumPresetA(c);
      break;
    default:
      plan = starterPresetA(c);
  }

  const finalPlan = ensureGarageDoors(applyDynamicChanges(plan, c));
  finalPlan.rooms.forEach(room => {
    if (room.furniture) {
      room.furniture = applySmartRotations(room.furniture, room.w, room.h);
    }
  });
  return finalPlan;
}

const ADDON_ROOM_PREFIXES = ['addon-'];

export function applyAddOnsToPlan(plan: Plan, c: Pick<ConfigState, 'addons'>): Plan {
  const W = plan.width;
  const H = plan.height;
  const baseRooms = (plan.rooms || []).filter((r) => !ADDON_ROOM_PREFIXES.some((prefix) => r.id.startsWith(prefix)));

  const wantTrees = c.addons.includes('landscaping');
  const wantFence = c.addons.includes('fence');

  const hasIntegratedCarport = baseRooms.some(r => r.type === 'carport');
  const wantCarport = c.addons.includes('carport') && !hasIntegratedCarport;
  const wantSolar = c.addons.includes('solar');
  const wantTank = c.addons.includes('water_tank');

  // ── 1. Reserve perimeter space for layout-affecting add-ons ──────────
  // Only Carport gets a strip on the LEFT and reshapes the building.
  // Landscaping ("Furniture"), fence, solar and water tank are VISUAL-ONLY:
  // they do NOT reserve perimeter space and do NOT reshape any rooms.
  const carportStrip = wantCarport ? Math.min(13, Math.max(9, Math.round(W * 0.25))) : 0;

  const reserveLeft = carportStrip;
  const reserveRight = 0;   // landscaping is no longer layout-affecting
  const reserveTop = 0;
  const reserveBottom = 0;  // landscaping is no longer layout-affecting

  const buildX = reserveLeft;
  const buildY = reserveTop;
  const buildW = Math.max(8, W - reserveLeft - reserveRight);
  const buildH = Math.max(8, H - reserveTop - reserveBottom);

  // ── 2. Reshape the building rooms to fit inside the build zone ───────
  // Only carport triggers a reshape (it's the only layout-affecting addon).
  const mainHouse = baseRooms.filter((r) => r.type !== 'garden' && r.type !== 'carport' && r.type !== 'balcony');
  const needsReshape = reserveLeft > 0 && mainHouse.length > 0;

  let rooms: Room[];
  let finalW = W;
  let finalH = H;

  if (needsReshape) {
    const minX = Math.min(...mainHouse.map((r) => r.x));
    const minY = Math.min(...mainHouse.map((r) => r.y));
    const maxX = Math.max(...mainHouse.map((r) => r.x + r.w));
    const maxY = Math.max(...mainHouse.map((r) => r.y + r.h));
    const curW = Math.max(1, maxX - minX);
    const curH = Math.max(1, maxY - minY);
    
    // To preserve square feet, we NO LONGER scale (sX/sY). 
    // We simply shift rooms right/down by the reserved strip amount.
    finalW = curW + reserveLeft + reserveRight;
    finalH = curH + reserveTop + reserveBottom;

    rooms = baseRooms
      .filter((r) => {
        // Drop existing exterior zones — they will be replaced by new reserved strips
        if (r.type === 'garden' || r.type === 'carport' || r.type === 'balcony') return false;
        return true;
      })
      .map((r) => {
        const nx = Math.round(buildX + (r.x - minX));
        const ny = Math.round(buildY + (r.y - minY));
        const newRoom: Room = { ...r, x: nx, y: ny };
        // No need to regenerate furniture since dimensions didn't change
        return newRoom;
      });
  } else {
    // No reshape needed — keep existing rooms, just filter out stale exterior markers
    rooms = baseRooms.filter((r) => {
      if (r.type === 'carport' && !wantCarport) return false;
      return true;
    });
  }

  // ── 3. Place reserved-strip add-ons inside the plan boundary ─────────
  if (wantCarport && carportStrip > 0) {
    rooms.push({
      id: 'addon-carport',
      type: 'carport',
      label: 'CARPORT',
      x: 0,            // Start at the left edge — this IS the reserved strip
      y: buildY,
      w: carportStrip, // Fill the full reserved width so no gap is left
      h: buildH,
      color: COLORS.carport,
      furniture: [],
      doors: [],
      windows: [],
    });
  }

  // Landscaping is visual-only: overlay small garden / tree markers at the plan
  // perimeter WITHOUT shifting or resizing any rooms.
  if (wantTrees) {
    const treeSize = 3;
    const treeSpots = [
      { id: 'addon-tree-1', x: W - treeSize - 1, y: 1 },
      { id: 'addon-tree-2', x: W - treeSize - 1, y: H - treeSize - 1 },
      { id: 'addon-tree-3', x: 1, y: H - treeSize - 1 },
      { id: 'addon-tree-4', x: Math.round(W / 2) - treeSize, y: H - treeSize - 1 },
    ];
    treeSpots.forEach((t) => {
      rooms.push({
        ...t,
        type: 'garden',
        label: 'TREE',
        w: treeSize,
        h: treeSize,
        color: 'rgba(34, 197, 94, 0.4)',
        furniture: [],
        doors: [],
        windows: [],
      });
    });
  }

  // ── 4. Roof-only markers ─────────────────────────────────────────────
  if (wantSolar) {
    const solarW = Math.min(10, Math.max(6, buildW - 4));
    const solarH = Math.min(4, Math.max(3, buildH - 4));
    rooms.push({
      id: 'addon-solar',
      type: 'garden',
      label: 'SOLAR PANELS (ROOF)',
      x: buildX + 2,
      y: buildY + 2,
      w: solarW,
      h: solarH,
      color: 'rgba(26, 42, 74, 0.4)',
      furniture: [],
      doors: [],
      windows: [],
    });
  }

  if (wantTank) {
    const tankSize = Math.min(4, Math.max(3, Math.min(buildW, buildH) - 2));
    rooms.push({
      id: 'addon-tank',
      type: 'garden',
      label: 'WATER TANK (ROOF)',
      x: buildX + buildW - tankSize - 2,
      y: buildY + 2,
      w: tankSize,
      h: tankSize,
      color: 'rgba(0, 0, 255, 0.2)',
      furniture: [],
      doors: [],
      windows: [],
    });
  }

  // ── 5. Perimeter fence wrapping the entire plan ──────────────────────
  if (wantFence) {
    rooms.push({
      id: 'addon-fence',
      type: 'garden',
      label: 'PERIMETER FENCE',
      x: 0,
      y: 0,
      w: W,
      h: H,
      color: 'transparent',
      furniture: [],
      doors: [],
      windows: [],
      openWalls: ['top', 'bottom', 'left', 'right'],
    });
  }

  return ensureGarageDoors({ ...plan, rooms, width: finalW, height: finalH });
}

function applyDynamicChanges(plan: Plan, c: ConfigState): Plan {
  let rooms = [...plan.rooms];
  let currentWidth = plan.width;
  let currentHeight = plan.height;
  const removedRooms: Room[] = [];
  
  // 1. Handle Bedrooms
  const beds = rooms.filter(r => r.type === 'bedroom');
  if (beds.length < c.bedrooms) {
    for (let i = beds.length; i < c.bedrooms; i++) {
      const rightmostBed = [...beds].sort((a, b) => (b.x + b.w) - (a.x + a.w))[0] || rooms[rooms.length - 1];
      const newBed: Room = {
        id: `dynamic-bed-${i}`,
        type: 'bedroom',
        label: `BEDROOM ${i + 1}`,
        x: rightmostBed.x + rightmostBed.w,
        y: rightmostBed.y,
        w: 12,
        h: 10,
        color: COLORS.bedroom,
        furniture: bedroomFurniture(12, 10, false),
        doors: [{ wall: 'top', position: 0.5, width: 3, swing: 'in' }],
        windows: [{ wall: 'right', position: 0.5, width: 4 }],
      };
      
      const subHallway = rooms.find(r => r.id === 'sub-hallway');
      if (subHallway) {
        subHallway.w = Math.max(subHallway.w, (newBed.x + newBed.w) - subHallway.x);
      }
      
      rooms.push(newBed);
      beds.push(newBed);
    }
  } else if (beds.length > c.bedrooms) {
    let toRemove = beds.length - c.bedrooms;
    for (let i = rooms.length - 1; i >= 0 && toRemove > 0; i--) {
      if (rooms[i].type === 'bedroom' && !rooms[i].label.toLowerCase().includes('master')) {
        removedRooms.push(rooms[i]);
        rooms.splice(i, 1);
        toRemove--;
      }
    }
  }

  // 2. Handle Bathrooms
  const baths = rooms.filter(r => r.type === 'bathroom');
  if (baths.length < c.bathrooms) {
    for (let i = baths.length; i < c.bathrooms; i++) {
      // Determine the bath row y coordinate (same row as existing baths)
      const bathRowY = baths.length > 0 ? Math.min(...baths.map(b => b.y)) : 16;
      const bathRowH = baths.length > 0 ? Math.max(...baths.map(b => b.h)) : 6;

      // Only non-master baths count as "covering" a bedroom's x-range for common access
      const commonBaths = baths.filter(b => !b.label.toLowerCase().includes('master'));

      // Find a non-master bedroom whose x-range is NOT already covered by a common bath
      const unpairedBed = rooms
        .filter(r => r.type === 'bedroom' && !r.label.toLowerCase().includes('master'))
        .find(bed => {
          return !commonBaths.some(b =>
            // Common bath X-range overlaps this bedroom's x-range
            b.x < bed.x + bed.w - 1 && b.x + b.w > bed.x + 1
          );
        });

      let newBath: Room;

      if (unpairedBed) {
        // Place bath at bath-row height, directly above the unpaired bedroom
        const bathW = Math.min(unpairedBed.w, 12);
        newBath = {
          id: `dynamic-bath-${i}`,
          type: 'bathroom',
          label: `BATH ${i + 1}`,
          x: unpairedBed.x,
          y: bathRowY,
          w: bathW,
          h: bathRowH,
          color: COLORS.bathroom,
          furniture: bathroomFurniture(bathW, bathRowH, false),
          doors: [{ wall: 'bottom', position: 0.5, width: 2.5, swing: 'in' }],
          windows: [],
        };
      } else {
        // Fallback: place to the right of the rightmost bath, expanding the plan
        const rightmostBath = [...baths].sort((a, b) => (b.x + b.w) - (a.x + a.w))[0] || rooms[rooms.length - 1];
        newBath = {
          id: `dynamic-bath-${i}`,
          type: 'bathroom',
          label: `BATH ${i + 1}`,
          x: rightmostBath.x + rightmostBath.w,
          y: rightmostBath.y,
          w: 8,
          h: 6,
          color: COLORS.bathroom,
          furniture: bathroomFurniture(8, 6, false),
          doors: [{ wall: 'bottom', position: 0.5, width: 2.5, swing: 'in' }],
          windows: [{ wall: 'right', position: 0.5, width: 3 }],
        };
      }

      const subHallway = rooms.find(r => r.id === 'sub-hallway');
      if (subHallway) {
        subHallway.w = Math.max(subHallway.w, (newBath.x + newBath.w) - subHallway.x);
      } else {
        newBath.doors = [{ wall: 'left', position: 0.5, width: 2.5, swing: 'in' }];
      }

      rooms.push(newBath);
      baths.push(newBath);
    }
  } else if (baths.length > c.bathrooms) {
    let toRemove = baths.length - c.bathrooms;
    for (let i = rooms.length - 1; i >= 0 && toRemove > 0; i--) {
      if (rooms[i].type === 'bathroom' && !rooms[i].label.toLowerCase().includes('master')) {
        removedRooms.push(rooms[i]);
        rooms.splice(i, 1);
        toRemove--;
      }
    }
  }

  // Reclaim the empty footprint left behind by removed bedrooms/bathrooms so the
  // plan stays visually compact instead of showing dead space.
  for (const removedRoom of removedRooms) {
    absorbRemovedRoomSpace(rooms, removedRoom, c);
  }

  // 3. Handle Kitchen Layout
  const kitchenRoom = rooms.find(r => r.id === 'kitchen');
  const diningRoom = rooms.find(r => r.id === 'dining');

  if (kitchenRoom && diningRoom) {
    if (c.kitchen === 'open') {
      // MERGE: Combine kitchen and dining into one large space
      const startY = Math.min(kitchenRoom.y, diningRoom.y);
      const totalH = kitchenRoom.h + diningRoom.h;
      const combinedW = Math.max(kitchenRoom.w, diningRoom.w);
      
      kitchenRoom.y = startY;
      kitchenRoom.h = totalH;
      kitchenRoom.w = combinedW;
      kitchenRoom.label = 'OPEN KITCHEN + DINING';
      kitchenRoom.color = COLORS.kitchen;
      
      // Add a standard door to the hallway
      kitchenRoom.doors = [
        ...(kitchenRoom.doors || []).filter(d => d.connectsTo !== 'dining'), // Clean up old links
        { wall: 'right', position: 0.2, width: 2.8, swing: 'in', doorType: 'standard', connectsTo: 'main-hallway' }
      ];
      
      // Add shared furniture
      kitchenRoom.furniture = [
        ...kitchenFurniture(combinedW, totalH * 0.5, 'open'),
        { type: 'dining_table', x: combinedW * 0.2, y: totalH * 0.6, w: 6, h: 4, rotation: 0 }
      ];
      
      // Remove the separate dining room
      rooms = rooms.filter(r => r.id !== 'dining');
    } else if (c.kitchen === 'galley') {
      // GALLEY: Side-by-side vertical rooms filling the original combined area
      const startX = Math.min(kitchenRoom.x, diningRoom.x);
      const startY = Math.min(kitchenRoom.y, diningRoom.y);
      const endY = Math.max(kitchenRoom.y + kitchenRoom.h, diningRoom.y + diningRoom.h);
      const totalW = Math.max(kitchenRoom.w, diningRoom.w);
      const totalH = endY - startY;

      kitchenRoom.x = startX;
      kitchenRoom.y = startY;
      kitchenRoom.w = totalW * 0.6;
      kitchenRoom.h = totalH;
      kitchenRoom.label = 'KITCHEN (GALLEY)';
      kitchenRoom.furniture = kitchenFurniture(kitchenRoom.w, kitchenRoom.h, 'galley');
      
      diningRoom.x = startX + kitchenRoom.w;
      diningRoom.y = startY;
      diningRoom.w = totalW * 0.4;
      diningRoom.h = totalH;
      diningRoom.label = 'DINING';
      diningRoom.furniture = diningFurniture(diningRoom.w, diningRoom.h);
    } else {
      // STANDARD: Stacked horizontally (original layout)
      // Ensure they are separate and labeled
      kitchenRoom.label = 'KITCHEN';
      diningRoom.label = 'DINING';
      // Reset to original positions if they were modified
      // (The preset defines these, so we just ensure they aren't merged)
    }
  }

  // Final Bounds Calculation & Normalization
  const minX = Math.min(0, ...rooms.map(r => r.x));
  const minY = Math.min(0, ...rooms.map(r => r.y));
  
  if (minX < 0 || minY < 0) {
    rooms = rooms.map(r => ({ ...r, x: r.x - minX, y: r.y - minY }));
  }
  
  const maxX = Math.max(1, ...rooms.map(r => r.x + r.w));
  const maxY = Math.max(1, ...rooms.map(r => r.y + r.h));

  return applyAddOnsToPlan({ ...plan, width: maxX, height: maxY, rooms }, c);
}

// ── Generate empty plan for custom editor ─────────────────────────

export function generateEmptyPlan(homeType: 'starter' | 'family' | 'premium'): Plan {
  const dimensions: Record<string, { w: number, h: number }> = {
    starter:  { w: 25, h: 40 },  // ~1000 sqft
    family:   { w: 32, h: 50 },  // ~1600 sqft
    premium:  { w: 40, h: 60 },  // ~2400 sqft
  };
  const dim = dimensions[homeType];
  return {
    width: dim.w,
    height: dim.h,
    rooms: [],
  };
}

/**
 * Synchronise openWalls of structural rooms (staircases, hallways) between
 * two floors. When a user removes a wall on the ground floor staircase, the
 * matching first-floor staircase should mirror the change.
 *
 * Matching is done by room type + positional overlap (>50% area overlap).
 * Only `openWalls` are propagated — furniture, doors, etc. stay independent.
 */
export function syncStructuralWalls(sourcePlan: Plan, targetPlan: Plan): Plan {
  if (!sourcePlan?.rooms || !targetPlan?.rooms) return targetPlan;

  const structuralTypes = new Set<Room['type']>(['hallway', 'staircase']);

  const sourceStructural = sourcePlan.rooms.filter(r => structuralTypes.has(r.type));
  if (sourceStructural.length === 0) return targetPlan;

  const updatedRooms = targetPlan.rooms.map(targetRoom => {
    if (!structuralTypes.has(targetRoom.type)) return targetRoom;

    // Find the best positional match on the source floor
    let bestMatch: Room | null = null;
    let bestOverlap = 0;

    for (const src of sourceStructural) {
      if (src.type !== targetRoom.type) continue;

      // Calculate 2D overlap area
      const ox = Math.max(0, Math.min(src.x + src.w, targetRoom.x + targetRoom.w) - Math.max(src.x, targetRoom.x));
      const oy = Math.max(0, Math.min(src.y + src.h, targetRoom.y + targetRoom.h) - Math.max(src.y, targetRoom.y));
      const overlap = ox * oy;
      const minArea = Math.min(src.w * src.h, targetRoom.w * targetRoom.h);

      // Require > 50% area overlap to count as a structural match
      if (overlap > minArea * 0.5 && overlap > bestOverlap) {
        bestOverlap = overlap;
        bestMatch = src;
      }
    }

    if (bestMatch && bestMatch.openWalls) {
      return { ...targetRoom, openWalls: [...bestMatch.openWalls] };
    } else if (bestMatch && !bestMatch.openWalls) {
      // Source has no openWalls, so remove any openWalls from target too
      const { openWalls: _removed, ...rest } = targetRoom;
      return rest as Room;
    }
    return targetRoom;
  });

  return { ...targetPlan, rooms: updatedRooms };
}

// ── Double Storey Support ─────────────────────────────────────────

function familyDoubleStorey(W: number, H: number, kitchenType: string = 'standard', bedrooms: number = 3, bathrooms: number = 2, addons: string[] = [], layoutStyle: string = 'default'): { ground: Plan; first: Plan } {
  // Ground rules for blueprint scale mapping to a standard 40x40 dimension
  // W=40, H=40. Let's arrange them based on relative coordinates from the image.
  
  const wantCarport = addons.includes('carport');
  
  const gRooms: Room[] = [];
  
  // Let's formalize the grid logic based on W and H
  const x1 = Math.round(W * 0.35); // 14
  const x2 = Math.round(W * 0.60); // 24
  
  const y1 = Math.round(H * 0.40); // 16
  const y2 = Math.round(H * 0.65); // 26
  
  // Ground Floor Mapping
  // TOP ROW (y: 0 to y1)
  gRooms.push({
    id: 'gf-bed-0', type: 'bedroom', label: 'BED',
    x: 0, y: 0, w: x1, h: y1, // Bed matches Staircase width (x1)
    color: COLORS.bedroom,
    furniture: bedroomFurniture(x1, y1, true, 1),
    doors: [],
    windows: [{ wall: 'left', position: 0.5, width: 4 }, { wall: 'top', position: 0.5, width: 4 }]
  });
  
  const bathW = 5;
  const bathH = Math.round(y1 * 0.5); // 8

  gRooms.push({
    id: 'bath-attached-gf-bed-0', type: 'bathroom', label: 'TOILET',
    x: x1, y: 0, w: bathW, h: bathH, // Back Bath
    color: COLORS.bathroom,
    furniture: bathroomFurniture(bathW, bathH, true, 0),
    doors: [
      { wall: 'left', position: 0.5, width: 2.5, swing: 'in', doorType: 'standard', connectsTo: 'gf-bed-0' }
    ],
    windows: [{ wall: 'top', position: 0.5, width: 2 }]
  });

  gRooms.push({
    id: 'gf-bath-common', type: 'bathroom', label: 'TOILET',
    x: x1, y: bathH, w: bathW, h: y1 - bathH, // Front Bath
    color: COLORS.bathroom,
    furniture: bathroomFurniture(bathW, y1 - bathH, false, 2),
    doors: [
      { wall: 'bottom', position: 0.5, width: 2.5, swing: 'out', doorType: 'standard', connectsTo: 'gf-dining' }
    ],
    windows: []
  });

  gRooms.push({
    id: 'gf-kitchen', type: 'kitchen', label: kitchenType === 'open' ? 'OPEN KITCHEN + DINING' : kitchenType === 'galley' ? 'KITCHEN (GALLEY)' : 'KITCHEN',
    x: x1 + bathW, y: 0,
    w: kitchenType === 'open' ? W - (x1 + bathW) : kitchenType === 'galley' ? Math.round((W - (x1 + bathW)) * 0.6) : W - (x1 + bathW),
    h: kitchenType === 'open' ? y2 - 0 : y1,
    color: COLORS.kitchen,
    furniture: kitchenType === 'open'
      ? [
          ...kitchenFurniture(W - (x1 + bathW), y1, 'open', 0),
          { type: 'dining_table' as const, x: (W - (x1 + bathW)) * 0.2, y: y1 + 2, w: 6, h: 4, rotation: 0 }
        ]
      : kitchenType === 'galley'
        ? kitchenFurniture(Math.round((W - (x1 + bathW)) * 0.6), y1, 'galley', 0)
        : kitchenFurniture(W - (x1 + bathW), y1, 'standard', 0),
    doors: kitchenType === 'open'
      ? [{ wall: 'bottom' as const, position: 0.5, width: 4, swing: 'out' as const, doorType: 'open' as const, connectsTo: 'gf-living' }]
      : [{ wall: 'bottom' as const, position: 0.5, width: 3.5, swing: 'out' as const, doorType: 'open' as const, connectsTo: 'gf-dining' }],
    windows: [{ wall: 'top', position: 0.5, width: 4 }, { wall: 'right', position: 0.5, width: 4 }]
  });

  // MIDDLE ROW (y: y1 to y2)
  gRooms.push({
    id: 'gf-staircase', type: 'hallway', label: 'STAIRCASE\n↑',
    x: 0, y: y1, w: x1, h: y2 - y1,
    color: COLORS.hallway,
    furniture: [],
    doors: [
      { wall: 'right', position: 0.5, width: 3.5, swing: 'in', doorType: 'open', connectsTo: kitchenType === 'open' ? 'gf-kitchen' : 'gf-dining' }
    ],
    windows: [{ wall: 'left', position: 0.5, width: 4 }]
  });

  // Dining room (only for standard and galley layouts — open plan merges into kitchen above)
  if (kitchenType === 'galley') {
    // Galley: dining sits beside the galley kitchen
    const galleyKitchenW = Math.round((W - (x1 + bathW)) * 0.6);
    gRooms.push({
      id: 'gf-dining', type: 'dining', label: 'DINING',
      x: x1 + bathW + galleyKitchenW, y: 0, w: W - (x1 + bathW + galleyKitchenW), h: y1,
      color: COLORS.dining,
      furniture: diningFurniture(W - (x1 + bathW + galleyKitchenW), y1),
      doors: [
        { wall: 'bottom', position: 0.5, width: 3.5, swing: 'out', doorType: 'open', connectsTo: 'gf-staircase' }
      ],
      windows: [{ wall: 'right', position: 0.5, width: 4 }]
    });
    // Hallway/corridor between staircase and living (middle row)
    gRooms.push({
      id: 'gf-corridor', type: 'hallway', label: '',
      x: x1, y: y1, w: W - x1, h: y2 - y1,
      color: COLORS.hallway,
      openWalls: ['left'],
      furniture: [],
      doors: [
        { wall: 'bottom', position: 0.5, width: 4, swing: 'out', doorType: 'open', connectsTo: 'gf-living' },
        { wall: 'left', position: 0.2, width: 3, swing: 'in', doorType: 'standard', connectsTo: 'gf-bed-0' }
      ],
      windows: [{ wall: 'right', position: 0.5, width: 4 }]
    });
  } else if (kitchenType !== 'open') {
    // Standard: separate dining room in middle row
    gRooms.push({
      id: 'gf-dining', type: 'dining', label: 'DINING',
      x: x1, y: y1, w: W - x1, h: y2 - y1,
      color: COLORS.dining,
      furniture: diningFurniture(W - x1, y2 - y1),
      doors: [
        { wall: 'bottom', position: 0.5, width: 4, swing: 'out', doorType: 'open', connectsTo: 'gf-living' },
        { wall: 'left', position: 0.2, width: 3, swing: 'in', doorType: 'standard', connectsTo: 'gf-bed-0' }
      ],
      windows: [{ wall: 'right', position: 0.5, width: 4 }]
    });
  } else {
    // Open plan: middle row is a corridor connecting staircase to living
    gRooms.push({
      id: 'gf-corridor', type: 'hallway', label: '',
      x: x1, y: y1, w: x1 + bathW > x1 ? bathW : W - x1, h: y2 - y1,
      color: COLORS.hallway,
      openWalls: ['left'],
      furniture: [],
      doors: [
        { wall: 'left', position: 0.2, width: 3, swing: 'in', doorType: 'standard', connectsTo: 'gf-bed-0' }
      ],
      windows: []
    });
  }

  // BOTTOM ROW (y: y2 to H)
  const wantLandscaping = addons.includes('landscaping');

    // No carport explicitly modeled here. The global applyAddOnsToPlan handles it cleanly.
    // Expand living and provide a nice front sitout / garden
    const sitoutW = 8;
    gRooms.push({
      id: 'gf-sitout', type: wantLandscaping ? 'garden' : 'balcony', 
      label: wantLandscaping ? 'FRONT GARDEN' : 'SIT OUT',
      x: 0, y: y2, w: sitoutW, h: H - y2,
      color: wantLandscaping ? COLORS.garden : COLORS.balcony,
      furniture: wantLandscaping ? gardenFurniture(sitoutW, H - y2) : [{ type: 'plant', x: 1, y: 1, w: 2, h: 2 }],
      doors: [],
      openWalls: ['bottom', 'left'],
      windows: []
    });

    gRooms.push({
      id: 'gf-living', type: 'living', label: 'LIVING ROOM',
      x: sitoutW, y: y2, w: W - sitoutW, h: H - y2,
      color: COLORS.living,
      furniture: livingFurniture(W - sitoutW, H - y2, 2),
      doors: [
        { wall: 'left', position: 0.5, width: 4, swing: 'in', doorType: 'standard', connectsTo: 'gf-sitout', label: 'MAIN DOOR' },
        { wall: 'bottom', position: 0.5, width: 3.5, swing: 'in', doorType: 'standard', label: 'FRONT ENTRY' }
      ],
      windows: [{ wall: 'bottom', position: 0.2, width: 4 }, { wall: 'bottom', position: 0.8, width: 4 }, { wall: 'right', position: 0.5, width: 4 }]
    });
  
  const livingRoom = gRooms.find(r => r.id === 'gf-living');
  if (livingRoom) {
    if (layoutStyle === 'family_suite') {
      livingRoom.label = 'COMBINED LIVING + FAMILY LOUNGE';
      livingRoom.color = '#fffbe6';
      livingRoom.furniture = combinedLivingFurniture(livingRoom.w, livingRoom.h);
    } else if (layoutStyle === 'entertainer') {
      livingRoom.label = 'ENTERTAINMENT LOUNGE';
      livingRoom.color = COLORS.lounge;
      livingRoom.furniture = entertainerLoungeFurniture(livingRoom.w, livingRoom.h);
    }
  }

  injectAdjacencyDoors(gRooms);
  cleanupDoors(gRooms);

  // Restore the door from common bath to dining/corridor which cleanupDoors incorrectly strips
  const commonBath = gRooms.find(r => r.id === 'gf-bath-common');
  const corridorTarget = kitchenType === 'open' ? 'gf-corridor' : kitchenType === 'galley' ? 'gf-corridor' : 'gf-dining';
  if (commonBath && !commonBath.doors.some(d => d.connectsTo === corridorTarget)) {
    commonBath.doors.push({ wall: 'bottom', position: 0.5, width: 2.5, swing: 'out', doorType: 'standard', connectsTo: corridorTarget });
  }

  // ══════════════════════════════════════════════════════════════════
  // FIRST FLOOR
  const fRooms: Room[] = [];

  // Above porch/garden: Open Terrace / Garden Terrace
  fRooms.push({
    id: 'ff-open-terrace', 
    type: 'balcony', 
    label: wantLandscaping ? 'GARDEN TERRACE' : 'OPEN TERRACE',
    x: 0, y: y2, w: x1, h: H - y2,
    color: wantLandscaping ? COLORS.garden : COLORS.balcony,
    furniture: wantLandscaping ? gardenFurniture(x1, H - y2) : [],
    doors: [],
    windows: []
  });
  
  // Above sit out: Balcony
  fRooms.push({
    id: 'ff-balcony', type: 'balcony', label: 'BALCONY',
    x: x1, y: y2, w: x2 - x1, h: H - y2,
    color: COLORS.balcony,
    furniture: [],
    doors: [
      { wall: 'top', position: 0.5, width: 3.5, swing: 'in', doorType: 'standard', connectsTo: 'ff-upper-living' }
    ],
    windows: []
  });

  // Above living: Bed
  fRooms.push({
    id: 'ff-bed-1', type: 'bedroom', label: 'BED',
    x: x2, y: y2, w: W - x2, h: H - y2,
    color: COLORS.bedroom,
    furniture: bedroomFurniture(W - x2, H - y2, false, 2),
    doors: [
      { wall: 'top', position: 0.2, width: 3, swing: 'in', doorType: 'standard', connectsTo: 'ff-upper-living' }
    ],
    windows: [{ wall: 'bottom', position: 0.5, width: 4 }, { wall: 'right', position: 0.5, width: 4 }]
  });

  // Above Staircase: Staircase
  fRooms.push({
    id: 'ff-staircase', type: 'hallway', label: 'STAIRCASE\n↓',
    x: 0, y: y1, w: x1, h: y2 - y1,
    color: COLORS.hallway,
    furniture: [],
    doors: [
      { wall: 'right', position: 0.5, width: 3.5, swing: 'in', doorType: 'open', connectsTo: 'ff-upper-living' },
      { wall: 'bottom', position: 0.5, width: 3.5, swing: 'in', doorType: 'standard', connectsTo: 'ff-open-terrace' }
    ],
    windows: [{ wall: 'left', position: 0.5, width: 4 }]
  });

  // Above Dining: Upper Living
  fRooms.push({
    id: 'ff-upper-living', type: 'living', label: 'UPPER LIVING',
    x: x1, y: y1, w: W - x1, h: y2 - y1,
    color: COLORS.hallway,
    furniture: livingFurniture(W - x1, y2 - y1, 3), // some sofas
    doors: [],
    windows: []
  });

  // Above Master Bed: Bed
  fRooms.push({
    id: 'ff-bed-2', type: 'bedroom', label: 'BED',
    x: 0, y: 0, w: x1, h: y1,
    color: COLORS.bedroom,
    furniture: bedroomFurniture(x1, y1, false, 1),
    doors: [
      { wall: 'bottom', position: 0.2, width: 3, swing: 'in', doorType: 'standard', connectsTo: 'ff-staircase' }
    ],
    windows: [{ wall: 'left', position: 0.5, width: 4 }, { wall: 'top', position: 0.5, width: 4 }]
  });
  
  // Above Master Bath: Toilet
  fRooms.push({
    id: 'bath-attached-ff-bed-2', type: 'bathroom', label: 'TOILET',
    x: x1, y: 0, w: bathW, h: bathH,
    color: COLORS.bathroom,
    furniture: bathroomFurniture(bathW, bathH, true, 0),
    doors: [
      { wall: 'left', position: 0.5, width: 2.5, swing: 'in', doorType: 'standard', connectsTo: 'ff-bed-2' }
    ],
    windows: [{ wall: 'top', position: 0.5, width: 2 }]
  });

  // Above Kitchen: Rear Open Terrace + Common Toilet
  // Rear Corridor connects Upper Living to the common toilet / rear terrace
  fRooms.push({
    id: 'ff-hallway', type: 'hallway', label: 'CORRIDOR',
    x: x1, y: bathH, w: bathW, h: y1 - bathH,
    color: COLORS.hallway,
    furniture: [],
    doors: [
      { wall: 'bottom', position: 0.5, width: 3, swing: 'out', doorType: 'open', connectsTo: 'ff-upper-living' }
    ],
    windows: []
  });

  fRooms.push({
    id: 'ff-bath-common', type: 'bathroom', label: 'TOILET',
    x: x1 + bathW, y: Math.round(y1 * 0.5), w: 6, h: y1 - bathH,
    color: COLORS.bathroom,
    furniture: bathroomFurniture(6, y1 - bathH, false, 1),
    doors: [
      { wall: 'left', position: 0.5, width: 2.5, swing: 'in', doorType: 'standard', connectsTo: 'ff-hallway' }
    ],
    windows: []
  });

  fRooms.push({
    id: 'ff-rear-terrace', 
    type: 'balcony', 
    label: 'OPEN TERRACE',
    x: x1 + bathW, y: 0, w: W - (x1 + bathW), h: bathH,
    color: wantLandscaping ? COLORS.garden : COLORS.balcony,
    furniture: wantLandscaping ? gardenFurniture(W - (x1 + bathW), bathH) : [],
    doors: [
      { wall: 'bottom', position: 0.2, width: 3.5, swing: 'in', doorType: 'standard', connectsTo: 'ff-hallway' }
    ],
    openWalls: ['top', 'right'],
    windows: []
  });

  const terr2X = x1 + bathW + 6;
  const terr2W = W - terr2X;
  if (terr2W > 0) {
    fRooms.push({
      id: 'ff-rear-terrace-2', 
      type: 'balcony', 
      label: '',
      x: terr2X, y: bathH, w: terr2W, h: y1 - bathH,
      color: wantLandscaping ? COLORS.garden : COLORS.balcony,
      furniture: wantLandscaping ? gardenFurniture(terr2W, y1 - bathH) : [],
      doors: [],
      openWalls: ['top', 'right'],
      windows: []
    });
  }

  injectAdjacencyDoors(fRooms);
  cleanupDoors(fRooms);

  return {
    ground: { width: W, height: H, rooms: gRooms },
    first: { width: W, height: H, rooms: fRooms }
  };
}

/**
 * Split a plan into ground + first floor for double storey.
 * Ground: living, kitchen, dining, MASTER BEDROOM + bath, staircase.
 * First: 2 bedrooms accessible via hallway, common bath, staircase, open terrace.
 * Both floors share the same footprint — every cell filled, zero gaps.
 */
export function splitPlanToFloors(
  plan: Plan,
  homeType?: string,
  kitchen: string = 'standard',
  bedrooms: number = 3,
  bathrooms: number = 2,
  addons: string[] = [],
  layoutStyle: string = 'default'
): { ground: Plan; first: Plan } {
  let result: { ground: Plan; first: Plan };

  if (homeType === 'family') {
    result = familyDoubleStorey(plan.width, plan.height, kitchen, bedrooms, bathrooms, addons, layoutStyle);
  } else {
    result = _splitPlanGeneric(plan, layoutStyle);
  }

  // Only carport is layout-affecting (it physically shifts and resizes rooms).
  // Landscaping ("Furniture") is visual-only — applying it here would change room
  // dimensions every time the customer selects Furniture, which must not happen.
  const layoutAddons = addons.filter(a => a === 'carport');
  if (layoutAddons.length > 0) {
    const groundWithAddons = applyAddOnsToPlan(result.ground, { addons: layoutAddons as any[] });
    // Apply addons to the first floor too so the rooms shift rightward and stay structurally aligned
    const firstWithAddons = applyAddOnsToPlan(result.first, { addons: layoutAddons as any[] });
    
    // We don't want a carport room generated on the first floor, so remove it if it exists
    firstWithAddons.rooms = firstWithAddons.rooms.filter(r => r.type !== 'carport');
    
    result = { ground: groundWithAddons, first: firstWithAddons };
  }

  result.ground = ensureGarageDoors(result.ground);
  return result;
}

/**
 * Apply layout-style overrides (label, color, furniture) to the ground floor
 * living room of an already-split double-storey result.  This must be called
 * even on cached / package layouts so that switching between Standard,
 * Entertainer and Family Suite is always visible.
 */
export function applyDoubleStoreyLayoutStyle(
  floors: { ground: Plan; first: Plan },
  layoutStyle: string = 'default'
): { ground: Plan; first: Plan } {
  if (layoutStyle === 'default') return floors;

  // Deep-clone ground so we never mutate cached data
  const ground: Plan = JSON.parse(JSON.stringify(floors.ground));
  const livingRoom = ground.rooms.find(r => r.id === 'gf-living' || r.type === 'living');

  if (['open_plan', 'entertainer', 'family_suite'].includes(layoutStyle)) {
     const openRooms = ['living', 'kitchen', 'dining', 'lounge', 'hallway'];

     // Helper to detect which wall of roomA faces roomB
     const getSharedWall = (a: Room, b: Room): DoorInfo['wall'] | null => {
       const aRight = a.x + a.w;
       const aBottom = a.y + a.h;
       const bRight = b.x + b.w;
       const bBottom = b.y + b.h;
       const overlapX = Math.min(aRight, bRight) - Math.max(a.x, b.x);
       const overlapY = Math.min(aBottom, bBottom) - Math.max(a.y, b.y);
       if (overlapY > 0 && Math.abs(aRight - b.x) < 0.5) return 'right';   // a is left of b
       if (overlapY > 0 && Math.abs(bRight - a.x) < 0.5) return 'left';    // a is right of b
       if (overlapX > 0 && Math.abs(aBottom - b.y) < 0.5) return 'bottom'; // a is above b
       if (overlapX > 0 && Math.abs(bBottom - a.y) < 0.5) return 'top';    // a is below b
       return null;
     };

     ground.rooms.forEach(room => {
        if (!openRooms.includes(room.type)) return;

        // Convert existing connecting doors to wide open archways
        room.doors.forEach(door => {
           if (door.connectsTo) {
              const target = ground.rooms.find(r => r.id === door.connectsTo);
              if (target && openRooms.includes(target.type)) {
                 door.doorType = 'open';
                 door.width = 5;
              }
           }
        });

        // Also find adjacent social rooms and mark shared walls as openWalls
        ground.rooms.forEach(other => {
           if (other.id === room.id) return;
           if (!openRooms.includes(other.type)) return;
           const wall = getSharedWall(room, other);
           if (wall) {
              if (!room.openWalls) room.openWalls = [];
              if (!room.openWalls.includes(wall)) room.openWalls.push(wall);
              // Remove any standard door between them (wall is fully open now)
              room.doors = room.doors.filter(d => d.connectsTo !== other.id || d.doorType === 'open');
           }
        });
     });
  }

  if (livingRoom) {
    if (layoutStyle === 'family_suite') {
      livingRoom.label = 'COMBINED LIVING + FAMILY LOUNGE';
      livingRoom.color = '#fffbe6';
      livingRoom.furniture = combinedLivingFurniture(livingRoom.w, livingRoom.h);
    } else if (layoutStyle === 'entertainer') {
      livingRoom.label = 'ENTERTAINMENT LOUNGE';
      livingRoom.color = COLORS.lounge;
      livingRoom.furniture = entertainerLoungeFurniture(livingRoom.w, livingRoom.h);
    } else if (layoutStyle === 'open_plan') {
      livingRoom.label = 'OPEN LIVING ROOM';
      livingRoom.color = 'hsl(200 40% 88%)';
      livingRoom.furniture = livingFurniture(livingRoom.w, livingRoom.h, 2);
    }
  }

  return { ground, first: floors.first };
}

// Internal generic double-storey splitter (for non-family home types)
function _splitPlanGeneric(plan: Plan, layoutStyle: string = 'default'): { ground: Plan; first: Plan } {
  const W = plan.width;
  const H = plan.height;

  // ── Dimensions ───────────────────────────────────────────────────
  const STAIR_W = 6;
  const STAIR_H = 8;

  // ══════════════════════════════════════════════════════════════════
  // GROUND FLOOR
  // ┌──────────────────────┬────────────┐
  // │                      │            │
  // │   HALL + LIVING      │  KITCHEN   │  Row 1 (topH)
  // │                      │            │
  // ├───────┬──────────────┼─────┬──────┤
  // │       │              │MSTR │      │
  // │DINING │ MASTER BED   │BATH │STAIR │  Row 2 (botH)
  // │       │              │     │  ↑   │
  // └───────┴──────────────┴─────┴──────┘
  // ══════════════════════════════════════════════════════════════════

  const gRooms: Room[] = [];
  const topH = Math.round(H * 0.5);
  const botH = H - topH;
  const kitchenW = Math.round(W * 0.32);
  const livingW = W - kitchenW;

  // Bottom row widths
  const diningW = Math.round(W * 0.22);
  const masterBathW = Math.max(7, Math.round(W * 0.15));
  const masterBedW = W - diningW - masterBathW - STAIR_W;

  // Row 1: Living + Kitchen
  gRooms.push({
    id: 'gf-living', type: 'living', label: 'HALL + LIVING ROOM',
    x: 0, y: 0, w: livingW, h: topH,
    color: 'hsl(40 30% 87%)',
    furniture: livingFurniture(livingW, topH),
    doors: [{ wall: 'left', position: 0.75, width: 3.5, swing: 'in', doorType: 'standard' }],
    windows: [{ wall: 'left', position: 0.3, width: 5 }, { wall: 'top', position: 0.4, width: 5 }],
  });

  gRooms.push({
    id: 'gf-kitchen', type: 'kitchen', label: 'KITCHEN',
    x: livingW, y: 0, w: kitchenW, h: topH,
    color: 'hsl(28 38% 72%)',
    furniture: kitchenFurniture(kitchenW, topH, 'open'),
    doors: [],
    windows: [{ wall: 'right', position: 0.4, width: 3 }, { wall: 'top', position: 0.5, width: 3 }],
  });

  // Row 2: Dining | Master Bedroom | Master Bath | Staircase
  gRooms.push({
    id: 'gf-dining', type: 'dining', label: 'DINING',
    x: 0, y: topH, w: diningW, h: botH,
    color: 'hsl(36 28% 82%)',
    furniture: diningFurniture(diningW, botH),
    doors: [],
    windows: [{ wall: 'left', position: 0.5, width: 3 }, { wall: 'bottom', position: 0.5, width: 3 }],
  });

  gRooms.push({
    id: 'gf-master-bed', type: 'bedroom', label: 'MASTER BEDROOM',
    x: diningW, y: topH, w: masterBedW, h: botH,
    color: 'hsl(33 35% 82%)',
    furniture: bedroomFurniture(masterBedW, botH, true),
    doors: [],
    windows: [{ wall: 'bottom', position: 0.5, width: 4 }],
  });

  gRooms.push({
    id: 'gf-master-bath', type: 'bathroom', label: 'MASTER\nBATH',
    x: diningW + masterBedW, y: topH, w: masterBathW, h: botH,
    color: 'hsl(200 30% 82%)',
    furniture: bathroomFurniture(masterBathW, botH, true),
    doors: [],
    windows: [{ wall: 'bottom', position: 0.5, width: 2 }],
  });

  gRooms.push({
    id: 'staircase-gf', type: 'hallway', label: 'STAIRCASE\n↑',
    x: W - STAIR_W, y: topH, w: STAIR_W, h: botH,
    color: 'hsl(38 20% 82%)',
    furniture: [],
    doors: [],
    windows: [],
  });

  const livingRoom = gRooms.find(r => r.id === 'gf-living');
  if (livingRoom) {
    if (layoutStyle === 'family_suite') {
      livingRoom.label = 'COMBINED LIVING + FAMILY LOUNGE';
      livingRoom.color = '#fffbe6';
      livingRoom.furniture = combinedLivingFurniture(livingRoom.w, livingRoom.h);
    } else if (layoutStyle === 'entertainer') {
      livingRoom.label = 'ENTERTAINMENT LOUNGE';
      livingRoom.color = COLORS.lounge;
      livingRoom.furniture = entertainerLoungeFurniture(livingRoom.w, livingRoom.h);
    }
  }

  injectAdjacencyDoors(gRooms);
  cleanupDoors(gRooms);

  // ══════════════════════════════════════════════════════════════════
  // FIRST FLOOR
  // ┌────────────────┬────────────────┬──────┐
  // │                │                │      │
  // │   BEDROOM 2    │   BEDROOM 3    │      │
  // │                │                │ HALL │  Row 1 (bedsH)
  // │                │                │ WAY  │
  // ├────────────────┴───┬────────────┤      │
  // │                    │            │      │
  // │   OPEN TERRACE     │ COMMON     ├──────┤
  // │                    │  BATH      │STAIR │  Row 2 (restH)
  // │                    │            │  ↓   │
  // └────────────────────┴────────────┴──────┘
  // ══════════════════════════════════════════════════════════════════

  const fRooms: Room[] = [];
  const hallW = Math.max(5, Math.round(W * 0.12));
  const roomsW = W - hallW;  // Width for bedrooms/terrace/bath
  const bedsH = Math.round(H * 0.55);
  const restH = H - bedsH;

  // Row 1: Two bedrooms side by side
  const bed2W = Math.round(roomsW * 0.5);
  const bed3W = roomsW - bed2W;

  fRooms.push({
    id: 'ff-bed-0', type: 'bedroom', label: 'BEDROOM 2',
    x: 0, y: 0, w: bed2W, h: bedsH,
    color: 'hsl(33 35% 82%)',
    furniture: bedroomFurniture(bed2W, bedsH, false),
    doors: [],
    windows: [{ wall: 'left', position: 0.4, width: 4 }, { wall: 'top', position: 0.5, width: 4 }],
  });

  fRooms.push({
    id: 'ff-bed-1', type: 'bedroom', label: 'BEDROOM 3',
    x: bed2W, y: 0, w: bed3W, h: bedsH,
    color: 'hsl(33 35% 82%)',
    furniture: bedroomFurniture(bed3W, bedsH, false),
    doors: [],
    windows: [{ wall: 'top', position: 0.5, width: 4 }],
  });

  // Hallway (right side, full height minus staircase)
  fRooms.push({
    id: 'ff-hallway', type: 'hallway', label: 'HALLWAY',
    x: roomsW, y: 0, w: hallW, h: H - restH,
    color: 'hsl(38 20% 88%)',
    furniture: [],
    doors: [],
    windows: [],
  });

  // Row 2: Terrace + Common Bath + Staircase
  const bathW = Math.max(7, Math.round(roomsW * 0.35));
  const terraceW = roomsW - bathW;

  fRooms.push({
    id: 'ff-terrace', type: 'balcony', label: 'OPEN TERRACE',
    x: 0, y: bedsH, w: terraceW, h: restH,
    color: 'hsl(120 18% 78%)',
    furniture: [
      { type: 'plant', x: 2, y: restH / 2 - 0.75, w: 1.5, h: 1.5 },
      { type: 'plant', x: terraceW - 4, y: restH / 2 - 0.75, w: 1.5, h: 1.5 },
    ],
    doors: [],
    windows: [{ wall: 'left', position: 0.5, width: 5 }, { wall: 'bottom', position: 0.5, width: 5 }],
  });

  fRooms.push({
    id: 'ff-bath', type: 'bathroom', label: 'COMMON\nBATH',
    x: terraceW, y: bedsH, w: bathW, h: restH,
    color: 'hsl(200 30% 82%)',
    furniture: bathroomFurniture(bathW, restH, false),
    doors: [],
    windows: [{ wall: 'bottom', position: 0.5, width: 2 }],
  });

  // Staircase + landing (bottom-right, aligned with ground floor)
  fRooms.push({
    id: 'staircase-ff', type: 'hallway', label: 'STAIRCASE\n↓',
    x: roomsW, y: bedsH, w: hallW, h: restH,
    color: 'hsl(38 20% 82%)',
    furniture: [],
    doors: [],
    windows: [],
  });

  injectAdjacencyDoors(fRooms);
  cleanupDoors(fRooms);

  return {
    ground: { width: W, height: H, rooms: gRooms },
    first: { width: W, height: H, rooms: fRooms },
  };
}

export function ensureGarageDoors(plan: Plan): Plan {
  const rooms = plan.rooms.map(r => {
    if (r.type !== 'garage') return r;

    // Create a copy of the garage room
    const gar = { ...r, doors: [...(r.doors || [])] };

    // Check if the garage already has a door labeled 'GARAGE DOOR'
    const hasGarageDoor = gar.doors.some(d => d.label === 'GARAGE DOOR');
    if (!hasGarageDoor) {
      const frontWalls: DoorInfo['wall'][] = ['bottom', 'left', 'top', 'right'];
      const garageDoorWall = frontWalls[gar.orientation || 0];
      gar.doors.push({
        wall: garageDoorWall,
        position: 0.5,
        width: 16,
        swing: 'out',
        doorType: 'standard',
        label: 'GARAGE DOOR'
      });
    }

    // Check if the garage has an internal connecting door
    const hasConnectingDoor = gar.doors.some(d => d.connectsTo);
    if (!hasConnectingDoor) {
      // Find adjacent interior room to connect to
      const priority: string[] = ['hallway', 'staircase', 'living', 'kitchen', 'dining'];
      let bestAdj: { otherId: string; wall: 'top'|'bottom'|'left'|'right'; otherWall: 'top'|'bottom'|'left'|'right'; pos: number; otherPos: number } | null = null;
      let bestPriority = priority.length;

      for (const other of plan.rooms) {
        if (other.id === gar.id) continue;
        if (other.type === 'garden' || other.type === 'carport' || other.type === 'garage') continue;

        // Check adjacency
        const isAdj = roomsAreAdjacent(gar, other);
        if (!isAdj.shared) continue;

        const idx = priority.indexOf(other.type);
        if (idx !== -1 && idx < bestPriority) {
          const wallA = isAdj.wall;
          const oppositeWall: Record<'top' | 'bottom' | 'left' | 'right', 'top' | 'bottom' | 'left' | 'right'> = {
            top: 'bottom',
            bottom: 'top',
            left: 'right',
            right: 'left',
          };
          const wallB = oppositeWall[wallA];
          const midA = Math.max(0.15, Math.min(0.85, sharedWallMidpoint(gar, wallA, other)));
          const midB = Math.max(0.15, Math.min(0.85, sharedWallMidpoint(other, wallB, gar)));
          bestAdj = {
            otherId: other.id,
            wall: wallA,
            otherWall: wallB,
            pos: midA,
            otherPos: midB
          };
          bestPriority = idx;
        }
      }

      if (bestAdj) {
        // Add connecting door to garage
        gar.doors.push({
          wall: bestAdj.wall,
          position: bestAdj.pos,
          width: 3,
          swing: 'in',
          connectsTo: bestAdj.otherId,
          doorType: 'standard'
        });

        // Also add the corresponding connecting door to the adjacent room
        const adjRoomIdx = plan.rooms.findIndex(rm => rm.id === bestAdj!.otherId);
        if (adjRoomIdx !== -1) {
          const adjRoom = plan.rooms[adjRoomIdx];
          if (!adjRoom.doors.some(d => d.connectsTo === gar.id)) {
            adjRoom.doors = [
              ...adjRoom.doors,
              {
                wall: bestAdj.otherWall,
                position: bestAdj.otherPos,
                width: 3,
                swing: 'in',
                connectsTo: gar.id,
                doorType: 'standard'
              }
            ];
          }
        }
      }
    }

    return gar;
  });

  return { ...plan, rooms };
}






