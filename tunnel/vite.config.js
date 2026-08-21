import { defineConfig } from 'vite'

// Deployed under /tunnel/ on the shared static host, so asset URLs must be
// prefixed to match.
export default defineConfig({ base: '/tunnel/' })
