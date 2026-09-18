/*
 * Grandmer - src/scene voxel examiner character (FEAT-002).
 *
 * ORIGINAL, code-authored procedural voxel geometry. No downloaded model is
 * used for the character; it is built entirely from grouped BoxGeometry blocks
 * (head, torso, arms, hands, a mortarboard cap, and a simple face) so it is
 * license-clean by construction. The style is deliberately chunky and cartoony
 * (bright, saturated MeshToonMaterial) to match the youth-friendly art
 * direction while the room behind it comes from a real 3D HDRI environment.
 *
 * buildVoxelExaminer() returns a THREE.Group plus an animate(t) helper that
 * applies subtle idle motion (a gentle breathing bob and a slow head sway) so
 * the examiner feels alive without distracting from the marking.
 */

import * as THREE from "three";

/** A cheerful, saturated palette for the toon-shaded examiner. */
const PALETTE = {
  skin: 0xffc9a2,
  cap: 0x3b2a6b,
  capTop: 0x2a1e52,
  gown: 0x2f6fd6,
  gownDark: 0x2457ad,
  shirt: 0xfef8ef,
  hand: 0xffc9a2,
  eye: 0x2a2a3a,
  cheek: 0xff9e9e,
  tassel: 0xffd23f,
} as const;

/** The animated examiner returned to the scene. */
export interface VoxelExaminer {
  /** The whole character, ready to be added to the scene. */
  group: THREE.Group;
  /** Advance idle motion. `t` is elapsed seconds. */
  animate: (t: number) => void;
  /** Dispose every geometry/material this character owns. */
  dispose: () => void;
}

/**
 * A tiny helper that both builds a toon material and tracks it for disposal.
 */
function makeToon(
  color: number,
  bucket: THREE.Material[],
): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({ color });
  bucket.push(mat);
  return mat;
}

/**
 * Build the original voxel examiner. Everything is a BoxGeometry block grouped
 * under a single Group so the caller can position/scale the whole character at
 * once. Geometries and materials are tracked so dispose() frees them all.
 */
export function buildVoxelExaminer(): VoxelExaminer {
  const group = new THREE.Group();
  group.name = "voxel-examiner";

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  /** Add a box block at (x,y,z) with size (w,h,d) in the given material. */
  const block = (
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
  ): THREE.Mesh => {
    const geo = new THREE.BoxGeometry(w, h, d);
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const skinMat = makeToon(PALETTE.skin, materials);
  const capMat = makeToon(PALETTE.cap, materials);
  const capTopMat = makeToon(PALETTE.capTop, materials);
  const gownMat = makeToon(PALETTE.gown, materials);
  const gownDarkMat = makeToon(PALETTE.gownDark, materials);
  const shirtMat = makeToon(PALETTE.shirt, materials);
  const eyeMat = makeToon(PALETTE.eye, materials);
  const cheekMat = makeToon(PALETTE.cheek, materials);
  const tasselMat = makeToon(PALETTE.tassel, materials);

  // Torso: a chunky gown block with a lighter shirt panel down the front.
  block(group, 1.4, 1.6, 0.9, 0, 1.0, 0, gownMat);
  block(group, 0.5, 1.4, 0.1, 0, 1.05, 0.46, shirtMat);
  // Gown shoulders (a slightly darker cape edge for depth).
  block(group, 1.7, 0.4, 1.0, 0, 1.75, 0, gownDarkMat);

  // A head group so we can sway just the head during idle motion.
  const head = new THREE.Group();
  head.position.set(0, 2.35, 0);
  group.add(head);

  block(head, 1.0, 1.0, 1.0, 0, 0, 0, skinMat); // head cube
  // Eyes.
  block(head, 0.16, 0.22, 0.08, -0.24, 0.08, 0.5, eyeMat);
  block(head, 0.16, 0.22, 0.08, 0.24, 0.08, 0.5, eyeMat);
  // Rosy cheeks (cartoony warmth).
  block(head, 0.18, 0.12, 0.06, -0.34, -0.16, 0.49, cheekMat);
  block(head, 0.18, 0.12, 0.06, 0.34, -0.16, 0.49, cheekMat);

  // Mortarboard cap: a band plus a wide flat top plate, with a tassel.
  block(head, 1.05, 0.28, 1.05, 0, 0.62, 0, capMat);
  block(head, 1.5, 0.14, 1.5, 0, 0.82, 0, capTopMat);
  const tassel = block(head, 0.1, 0.5, 0.1, 0.6, 0.62, 0.6, tasselMat);
  tassel.name = "tassel";

  // Arms: upper arm blocks angled down toward the desk, with skin hands.
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.95, 1.4, 0.1);
  group.add(leftArm);
  block(leftArm, 0.4, 1.2, 0.4, 0, -0.5, 0, gownMat);
  block(leftArm, 0.42, 0.42, 0.42, 0, -1.15, 0.15, skinMat);

  // Right arm is the "marking" arm; give it its own group so it can wave a
  // little in idle motion as if the examiner is about to write.
  const rightArm = new THREE.Group();
  rightArm.position.set(0.95, 1.4, 0.1);
  group.add(rightArm);
  block(rightArm, 0.4, 1.2, 0.4, 0, -0.5, 0, gownMat);
  block(rightArm, 0.42, 0.42, 0.42, 0, -1.15, 0.15, skinMat);

  // The caller seats the character AFTER build (e.g. group.position.set(x, 0.3,
  // z)), so capture the seat height lazily on the first animate frame and bob
  // AROUND it instead of overwriting group.position.y with an absolute sine.
  // Without this the mount-time offset is discarded every frame and the
  // character sinks to y ~= 0.
  let baseY: number | undefined;

  const animate = (t: number): void => {
    if (baseY === undefined) baseY = group.position.y;
    // Gentle breathing bob for the whole character, bobbing around the seat
    // height rather than assigning an absolute y (preserves the mount offset).
    group.position.y = baseY + Math.sin(t * 1.6) * 0.03;
    // Slow head sway left/right and a tiny nod.
    head.rotation.y = Math.sin(t * 0.7) * 0.18;
    head.rotation.x = Math.sin(t * 1.1) * 0.05;
    // The marking arm lifts a touch, as if poised to write.
    rightArm.rotation.x = -0.2 + Math.sin(t * 1.3) * 0.08;
    // The tassel swings opposite the head sway.
    tassel.rotation.z = -Math.sin(t * 0.7) * 0.25;
  };

  const dispose = (): void => {
    for (const geo of geometries) geo.dispose();
    for (const mat of materials) mat.dispose();
  };

  return { group, animate, dispose };
}
