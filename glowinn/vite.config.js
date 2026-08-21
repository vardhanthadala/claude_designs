import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Deployed under /glowinn/ on the shared static host, so asset URLs must be
// prefixed to match.
export default defineConfig({ base: '/glowinn/', plugins: [react()] })
