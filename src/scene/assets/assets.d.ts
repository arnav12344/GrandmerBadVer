/*
 * Ambient module declarations for vendored 3D assets imported as URLs by Vite.
 * Vite turns these imports into bundled asset URLs at build time; this tells
 * TypeScript the import resolves to a string path.
 */

declare module "*.hdr" {
  const url: string;
  export default url;
}

declare module "*.glb" {
  const url: string;
  export default url;
}

declare module "*.gltf" {
  const url: string;
  export default url;
}
