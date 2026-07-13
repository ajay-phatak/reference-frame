// Vite ?raw imports (bundled as strings by electron-vite at build time).
declare module '*.md?raw' {
  const content: string
  export default content
}
