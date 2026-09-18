/*
 * Grandmer - src/scene 3D paper + desk surface (FEAT-002).
 *
 * ORIGINAL, code-authored procedural geometry for the examiner's desk and the
 * sheet of paper the student's answer sits on. The paper is a thin box lying
 * flat on the desk, tilted slightly toward the camera so a screen-space lasso
 * drawn over it is well defined and every token has a knowable 3D world anchor.
 *
 * The paper exposes a small layout API so FEAT-003 can place token anchors on
 * its surface and project them to screen space (via src/game/projection.ts)
 * for the existing resolveLasso hit-test. This feature only builds the surface
 * and the anchor maths; it does not render token text yet.
 */

import * as THREE from "three";

/** Paper dimensions in world units (a portrait-ish answer sheet). */
export const PAPER_WIDTH = 4.2;
export const PAPER_HEIGHT = 5.6;
const PAPER_THICKNESS = 0.06;

/** Inner margin (world units) kept clear of paper edges when laying tokens. */
const PAPER_MARGIN = 0.5;

/** The paper + desk returned to the scene. */
export interface DeskAndPaper {
  /** The desk group (tabletop + the paper), added to the scene. */
  group: THREE.Group;
  /** The paper mesh, used as the raycast target for the cursor pen. */
  paperMesh: THREE.Mesh;
  /**
   * Convert a normalised paper coordinate (u,v in 0..1, origin top-left of the
   * sheet as the reader sees it) into a world-space anchor sitting just above
   * the paper surface. FEAT-003 uses this to place token anchors.
   */
  paperUvToWorld: (u: number, v: number, out?: THREE.Vector3) => THREE.Vector3;
  /** Dispose every geometry/material the desk owns. */
  dispose: () => void;
}

/**
 * Build the desk and paper. The desk sits at world origin; the paper rests on
 * top, tilted back a few degrees toward a camera that looks down the +Z axis.
 */
export function buildDeskAndPaper(): DeskAndPaper {
  const group = new THREE.Group();
  group.name = "desk-and-paper";

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  // Warm wooden desktop (toon shaded, saturated so it stays cartoony).
  const deskMat = new THREE.MeshToonMaterial({ color: 0xb5793f });
  const deskEdgeMat = new THREE.MeshToonMaterial({ color: 0x8a5a2b });
  const paperMat = new THREE.MeshToonMaterial({ color: 0xfdfcf5 });
  materials.push(deskMat, deskEdgeMat, paperMat);

  const deskTopGeo = new THREE.BoxGeometry(11, 0.5, 7);
  geometries.push(deskTopGeo);
  const deskTop = new THREE.Mesh(deskTopGeo, deskMat);
  deskTop.position.set(0, -0.25, 0);
  deskTop.receiveShadow = true;
  group.add(deskTop);

  // A darker front lip for a bit of chunky depth.
  const lipGeo = new THREE.BoxGeometry(11, 0.35, 0.5);
  geometries.push(lipGeo);
  const lip = new THREE.Mesh(lipGeo, deskEdgeMat);
  lip.position.set(0, -0.45, 3.5);
  group.add(lip);

  // The paper. It is centred on the desk and tilted back toward the camera.
  const paperGeo = new THREE.BoxGeometry(
    PAPER_WIDTH,
    PAPER_THICKNESS,
    PAPER_HEIGHT,
  );
  geometries.push(paperGeo);
  const paperMesh = new THREE.Mesh(paperGeo, paperMat);
  paperMesh.name = "answer-paper";
  paperMesh.position.set(0, 0.03, 0.4);
  // Lay the sheet flat, tilted a little so the top edge lifts toward camera.
  paperMesh.rotation.x = -0.12;
  paperMesh.receiveShadow = true;
  group.add(paperMesh);

  // Precompute the usable inner half-extents (paper local X and Z axes).
  const halfW = PAPER_WIDTH / 2 - PAPER_MARGIN;
  const halfH = PAPER_HEIGHT / 2 - PAPER_MARGIN;
  const surfaceLift = PAPER_THICKNESS / 2 + 0.02;

  const paperUvToWorld = (
    u: number,
    v: number,
    out?: THREE.Vector3,
  ): THREE.Vector3 => {
    const v3 = out ?? new THREE.Vector3();
    // u:0..1 left->right maps to local X -halfW..+halfW.
    // v:0..1 top->bottom maps to local Z -halfH..+halfH (top of sheet is -Z,
    // which lifts toward the camera because of the back tilt).
    const localX = (u - 0.5) * 2 * halfW;
    const localZ = (v - 0.5) * 2 * halfH;
    v3.set(localX, surfaceLift, localZ);
    // Local -> world through the paper mesh transform, then the group.
    paperMesh.localToWorld(v3);
    return v3;
  };

  const dispose = (): void => {
    for (const geo of geometries) geo.dispose();
    for (const mat of materials) mat.dispose();
  };

  // Ensure world matrices are current so paperUvToWorld works before render.
  group.updateMatrixWorld(true);

  return { group, paperMesh, paperUvToWorld, dispose };
}
