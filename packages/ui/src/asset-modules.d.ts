/** Vite's `?url` suffix resolves an asset to its served URL. */
declare module "*?url" {
  const url: string;
  export default url;
}
