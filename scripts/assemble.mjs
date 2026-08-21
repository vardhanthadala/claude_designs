// Collects all four projects into a single ./dist tree for static hosting:
//
//   dist/index.html   Laocoon      (root static file)
//   dist/apex/        APEX 95      (static, copied as-is)
//   dist/tunnel/      Nocturne     (vite build output)
//   dist/glowinn/     Glowinn      (vite build output)

import { cp, mkdir, rm, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')

const exists = async (p) => {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

const require_ = async (p, label) => {
  if (!(await exists(p))) {
    throw new Error(`Missing ${label}: ${p}\nDid the upstream build step run?`)
  }
}

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

// 1. Laocoon — the root page
await require_(join(root, 'index.html'), 'Laocoon index.html')
await cp(join(root, 'index.html'), join(dist, 'index.html'))

// 2. apex — plain static, no build step
await require_(join(root, 'apex'), 'apex/')
await cp(join(root, 'apex'), join(dist, 'apex'), { recursive: true })

// 3 + 4. the two vite builds
for (const name of ['tunnel', 'glowinn']) {
  const out = join(root, name, 'dist')
  await require_(out, `${name} build output`)
  await cp(out, join(dist, name), { recursive: true })
}

console.log('assembled -> dist/  (index.html, apex/, tunnel/, glowinn/)')
