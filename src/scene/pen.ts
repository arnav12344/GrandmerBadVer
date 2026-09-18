/*
 * Grandmer - src/scene 3D pen (FEAT-002).
 *
 * ORIGINAL, code-authored procedural pen geometry (a cylinder body, a coloured
 * grip band, a conical nib, and a tiny cap clip). No downloaded model is used.
 * The pen is styled to match the cartoony palette (bright toon shading) and is
 * meant to FOLLOW THE CURSOR: each frame the scene raycasts the pointer onto
 * the paper surface and asks the pen to point its nib at that world position.
 *
 * FEAT-003 will use the nib's world position (getNibWorldPosition) as the ink
 * source when it lays down the lasso stroke; this feature only makes the pen
 * hover-track the cursor.
 */

import * as THREE from "three";

/** The pen returned to the scene. */
export interface Pen {
  /** The whole pen, ready to be added to the scene. */
  group: THREE.Group;
  /**
   * Point the pen at a world-space target on the paper (the raycast hit). The
   * pen is held at a natural writing tilt with the nib resting near `target`.
   */
  pointAt: (target: THREE.Vector3) => void;
  /** World-space position of the nib tip (ink source for FEAT-003). */
  getNibWorldPosition: (out?: THREE.Vector3) => THREE.Vector3;
  /** Dispose every geometry/material this pen owns. */
  dispose: () => void;
}

/** Length of the pen body from nib to cap, in world units. */
const PEN_LENGTH = 1.5;

/**
 * Build the procedural pen. The pen is modelled pointing DOWN its local -Y
 * axis: the nib sits at local y = -PEN_LENGTH/2 and the cap at +PEN_LENGTH/2.
 * pointAt() rotates the whole group so that local -Y aims from a hover point
 * above the paper down toward the target, giving a natural held-pen tilt.
 */
export function buildPen(): Pen {
  const group = new THREE.Group();
  group.name = "cursor-pen";

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const bodyMat = new THREE.MeshToonMaterial({ color: 0xd7263d });
  const gripMat = new THREE.MeshToonMaterial({ color: 0x1b2a4a });
  const nibMat = new THREE.MeshToonMaterial({ color: 0xf4c430 });
  const capMat = new THREE.MeshToonMaterial({ color: 0xf4f4f4 });
  materials.push(bodyMat, gripMat, nibMat, capMat);

  // Body: a tall thin cylinder centred on the origin.
  const bodyLen = PEN_LENGTH * 0.72;
  const bodyGeo = new THREE.CylinderGeometry(0.09, 0.08, bodyLen, 12);
  geometries.push(bodyGeo);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;
  group.add(body);

  // Grip band near the nib end.
  const gripGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.22, 12);
  geometries.push(gripGeo);
  const grip = new THREE.Mesh(gripGeo, gripMat);
  grip.position.y = -bodyLen / 2 + 0.11;
  grip.castShadow = true;
  group.add(grip);

  // Nib: a small cone pointing down (-Y), tip at -PEN_LENGTH/2.
  const nibLen = PEN_LENGTH * 0.16;
  const nibGeo = new THREE.ConeGeometry(0.09, nibLen, 12);
  geometries.push(nibGeo);
  const nib = new THREE.Mesh(nibGeo, nibMat);
  // Cone points +Y by default; flip so its tip points -Y.
  nib.rotation.x = Math.PI;
  nib.position.y = -bodyLen / 2 - nibLen / 2;
  nib.castShadow = true;
  group.add(nib);

  // Cap clip at the top for a bit of character.
  const capGeo = new THREE.BoxGeometry(0.05, 0.35, 0.08);
  geometries.push(capGeo);
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.set(0.11, bodyLen / 2 - 0.1, 0);
  group.add(cap);

  // Local-space position of the nib tip (bottom of the group).
  const nibLocal = new THREE.Vector3(0, -PEN_LENGTH / 2, 0);

  // Reusable temporaries so pointAt allocates nothing per frame.
  const holdPoint = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const rotatedNib = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const negY = new THREE.Vector3(0, -1, 0);

  const pointAt = (target: THREE.Vector3): void => {
    // The examiner holds the pen up and to the right of the tip. Build a hover
    // point offset above/right of the target and aim the nib down toward it.
    holdPoint.set(target.x + 0.6, target.y + 1.7, target.z + 0.6);
    dir.subVectors(target, holdPoint).normalize();
    // Rotate local -Y to face `dir` (natural held-pen tilt).
    quat.setFromUnitVectors(negY, dir);
    group.quaternion.copy(quat);

    // Position the group so the nib tip lands exactly on the target: rotate the
    // local nib offset by the same quaternion, then place the group origin.
    rotatedNib.copy(nibLocal).applyQuaternion(quat);
    group.position.set(
      target.x - rotatedNib.x,
      target.y - rotatedNib.y,
      target.z - rotatedNib.z,
    );
  };

  const getNibWorldPosition = (out?: THREE.Vector3): THREE.Vector3 => {
    const v = out ?? new THREE.Vector3();
    v.copy(nibLocal);
    group.localToWorld(v);
    return v;
  };

  const dispose = (): void => {
    for (const geo of geometries) geo.dispose();
    for (const mat of materials) mat.dispose();
  };

  return { group, pointAt, getNibWorldPosition, dispose };
}
