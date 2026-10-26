// Pointy hexes share a vertical edge at exactly sqrt(3) circumradii.
export function familyLayout(size, centers) {
  const step = Math.sqrt(3) * size;
  const right = Math.max(0, ...centers.map(p => p.x + size));
  const bella = { x: right + size * 1.2, z: 0 };
  const interstellar = { x: bella.x + step, z: 0 };
  const clear = [bella, interstellar].every(p => centers.every(o => Math.hypot(p.x - o.x, p.z - o.z) >= size * 2.04));
  return { bella, interstellar, clear };
}

// The base extends to one wall width from the center. Reserve its full
// diameter plus room for hover and growth animation, not just the wall width.
export const HOUSE_WIDTH = 1.05;
export const FAMILY_MIN_SCALE = 0.35;
export function familySessions(count, size, right) {
  const pack = scale => {
    const spacing = HOUSE_WIDTH * 2 * scale * 1.15 + 0.1;
    const radius = spacing / 2, edge = size * Math.sqrt(3) / 2 - radius;
    const points = [];
    for (let x = radius; x <= edge; x += spacing) {
      for (let z = -edge; z <= edge; z += spacing) {
        if (Math.hypot(x, z) <= edge) points.push({ x: x * (right ? 1 : -1), z });
      }
    }
    return { points, scale, spacing, radius };
  };
  let layout = pack(0.8);
  for (let scale = 0.75; layout.points.length < count && scale >= FAMILY_MIN_SCALE - 1e-9; scale -= 0.05) layout = pack(Math.max(FAMILY_MIN_SCALE, scale));
  const overflow = Math.max(0, count - layout.points.length + (count > layout.points.length ? 1 : 0));
  const marker = overflow ? layout.points.pop() : null;
  return { ...layout, points: layout.points.slice(0, count), overflow, marker };
}

// Shared with the scene: the walking corridor is inside the front of the left
// side of Interstellar's hex, outside the complete Endurance orbit envelope.
export function interstellarLayout(size) {
  return {
    hole: { x: -size * 0.6 / 6.2, z: -size * 0.7 / 6.2 },
    discRadius: size * 2.9 / 6.2,
    orbitRadius: size * 3.4 / 6.2,
    stationRadius: size * 0.75 / 6.2,
    robotRadius: size * 0.55 / 6.2,
    waypoints: [
      { x: -size * 0.24, z: size * 0.65 },
      { x: -size * 0.10, z: size * 0.72 },
      { x: -size * 0.30, z: size * 0.71 },
    ],
  };
}

// Coordinates are in the Overview camera basis: x right, y up, z toward camera.
// Each point reserves only its own pixel margins, so interior chips do not
// shrink the usable viewport for unrelated edge plots.
export function overviewDistance(points, fov, width, height) {
  const tangent = Math.tan(fov * Math.PI / 360), aspect = width / height;
  let distance = 30;
  for (const p of points) {
    const horizontal = p.x < 0 ? p.left ?? 0 : p.right ?? 0;
    const vertical = p.y < 0 ? p.bottom ?? 0 : p.top ?? 0;
    const usableX = Math.max(1, width / 2 - horizontal - 16);
    const usableY = Math.max(1, height / 2 - vertical - 16);
    distance = Math.max(distance, p.z + Math.abs(p.x) * width / (2 * tangent * aspect * usableX), p.z + Math.abs(p.y) * height / (2 * tangent * usableY));
  }
  return distance;
}
