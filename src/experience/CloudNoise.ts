import * as THREE from "three";

/** Tileable cellular noise. Three independent scales form rounded cumulus lobes. */
export function createCloudNoise() {
  const size = 48,
    data = new Uint8Array(size * size * size * 4);
  const random = (x: number, y: number, z: number) => {
    let h =
      Math.imul(x + 971, 374761393) ^
      Math.imul(y + 617, 668265263) ^
      Math.imul(z + 313, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const wrap = (x: number, n: number) => ((x % n) + n) % n;
  const cellular = (x: number, y: number, z: number, n: number) => {
    const ix = Math.floor(x),
      iy = Math.floor(y),
      iz = Math.floor(z);
    let distance = 4;
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const cx = ix + dx,
            cy = iy + dy,
            cz = iz + dz,
            wx = wrap(cx, n),
            wy = wrap(cy, n),
            wz = wrap(cz, n);
          const px = cx + random(wx, wy, wz),
            py = cy + random(wx + 101, wy + 43, wz + 11),
            pz = cz + random(wx + 19, wy + 37, wz + 79);
          distance = Math.min(
            distance,
            (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2,
          );
        }
    return Math.max(0, 1 - Math.sqrt(distance));
  };
  for (let z = 0; z < size; z++)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = ((z * size + y) * size + x) * 4;
        data[i] =
          cellular((x / size) * 4, (y / size) * 4, (z / size) * 4, 4) * 255;
        data[i + 1] =
          cellular((x / size) * 8, (y / size) * 8, (z / size) * 8, 8) * 255;
        data[i + 2] =
          cellular((x / size) * 16, (y / size) * 16, (z / size) * 16, 16) * 255;
        data[i + 3] = 255;
      }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}
