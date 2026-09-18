/*
 * Grandmer - src/scene 3D environment (FEAT-002).
 *
 * Loads the vendored CC0 HDRI ("lythwood_room" from Poly Haven, 1k) as the
 * scene's image-based lighting AND visible background, so the setting behind
 * the desk is a PROPER 3D environment sourced from a real online asset rather
 * than a flat plane. The .hdr file is bundled by Vite (imported as a URL) so
 * the static build stays self-contained.
 *
 * The HDRI gives the scene realistic bounce light; the models in front of it
 * (desk, paper, voxel examiner, pen) stay toon shaded so the overall vibe
 * reads warm and cartoony rather than photoreal. Tone mapping is kept soft so
 * the room looks bright and friendly.
 */

import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

// Vendored CC0 room HDRI. Vite resolves this to a bundled URL.
import roomHdrUrl from "./assets/lythwood_room_1k.hdr";

/** Handle to the loaded environment so it can be disposed. */
export interface SceneEnvironment {
  /** Dispose the generated PMREM texture and the source HDRI texture. */
  dispose: () => void;
}

/**
 * Load the HDRI and apply it as scene.environment + scene.background. Returns a
 * disposer. Loading is asynchronous; the scene renders with plain lighting
 * until the texture arrives, then upgrades to image-based lighting.
 *
 * @param scene    the THREE.Scene to light.
 * @param renderer the renderer, used to build the PMREM environment texture.
 */
export function loadEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
): SceneEnvironment {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  let envTexture: THREE.Texture | null = null;
  let hdrTexture: THREE.Texture | null = null;
  let disposed = false;

  const loader = new RGBELoader();
  loader.load(
    roomHdrUrl,
    (texture) => {
      hdrTexture = texture;
      texture.mapping = THREE.EquirectangularReflectionMapping;
      const target = pmrem.fromEquirectangular(texture);
      envTexture = target.texture;
      if (disposed) {
        // Loaded after teardown: free immediately and bail.
        envTexture.dispose();
        hdrTexture.dispose();
        return;
      }
      scene.environment = envTexture;
      scene.background = envTexture;
      // The PMREM generator is no longer needed once the env map exists.
      pmrem.dispose();
    },
    undefined,
    () => {
      // On any load error fall back to a warm solid background so the scene is
      // still bright and readable; the models keep their own lighting.
      if (!disposed) scene.background = new THREE.Color(0xf3e6c8);
      pmrem.dispose();
    },
  );

  const dispose = (): void => {
    disposed = true;
    scene.environment = null;
    scene.background = null;
    if (envTexture) envTexture.dispose();
    if (hdrTexture) hdrTexture.dispose();
    // Safe to call twice; guards internally in three.
    pmrem.dispose();
  };

  return { dispose };
}
