/**
 * Assemble the packaged desktop app tree into `staging/` for electron-builder.
 *
 * The desktop entry is not self-contained: it boots the composed web tree from
 * `node_modules` (bundle patches, frontend dist, agent presets, native
 * modules). A pnpm deploy materializes exactly that production closure —
 * every workspace dependency copied out with its shipped `files`, plus a
 * regular `node_modules` electron-builder can pack into asar.
 *
 * Deploy leaves some links pointing outside the staged tree (vendored
 * packages, hoisted store entries). Each unique external target is copied ONCE
 * into `node_modules/.dsh-staged-mirror/<hash>` with its own symlinks
 * preserved, every escaping link is rewritten to the mirror, and the pass
 * repeats to a fixpoint. Links resolving into this app's own directory are
 * peer-linkage artifacts nothing imports at runtime, so they are removed.
 * Dangling links cannot load at runtime and are removed too. The final
 * verification fails loud if anything still escapes.
 *
 * Not part of the TypeScript pipeline: plain ESM so packaging works before
 * any typecheck and adds no gate surface.
 */

import { execSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = realpathSync(dirname(dirname(fileURLToPath(import.meta.url))))
const staging = join(appRoot, 'staging')

rmSync(staging, { recursive: true, force: true })

// --legacy: this workspace does not opt into injected workspace packages;
// legacy deploy still materializes the full production closure we need.
execSync(`pnpm deploy --legacy --prod --filter @deepseek-ai/dsh-desktop ${JSON.stringify(staging)}`, {
  cwd: appRoot,
  stdio: 'inherit',
})
const stagingReal = realpathSync(staging)

const isInside = (root, path) => {
  const rel = relative(root, path)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** Rebase symlinks after their containing tree moves to a mirror directory. */
function rebaseCopiedLinks(sourceRoot, destinationRoot, source = sourceRoot) {
  let entries
  try {
    entries = readdirSync(source, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const sourcePath = join(source, entry.name)
    const destinationPath = join(destinationRoot, relative(sourceRoot, sourcePath))
    if (entry.isSymbolicLink()) {
      let resolved
      try {
        resolved = realpathSync(sourcePath)
      } catch {
        continue
      }
      const rebased = isInside(sourceRoot, resolved)
        ? join(destinationRoot, relative(sourceRoot, resolved))
        : resolved
      rmSync(destinationPath)
      symlinkSync(relative(dirname(destinationPath), rebased), destinationPath)
    } else if (entry.isDirectory()) {
      rebaseCopiedLinks(sourceRoot, destinationRoot, sourcePath)
    }
  }
}

/** Every symlink under `dir`: `{ path, resolved | null }`, null = dangling. */
function* links(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isSymbolicLink()) {
      let resolved = null
      try {
        resolved = realpathSync(path)
      } catch {
        /* dangling: kept null so the caller can prune it */
      }
      yield { path, resolved }
    } else if (entry.isDirectory()) {
      yield* links(path)
    }
  }
}

const escapes = () => {
  const found = []
  for (const link of links(staging)) {
    if (link.resolved === null) found.push({ ...link, dangling: true })
    else if (!isInside(stagingReal, link.resolved)) found.push({ ...link, dangling: false })
  }
  return found
}

const MIRROR = join(staging, 'node_modules', '.dsh-staged-mirror')
let prunedDangling = 0
let prunedSelfLinks = 0

for (let pass = 0; ; pass += 1) {
  if (pass >= 8) throw new Error('staging repair did not converge')
  const found = escapes()
  if (found.length === 0) break

  // Group by unique external target so each source tree is copied once.
  const byTarget = new Map()
  for (const link of found) {
    if (link.dangling) {
      rmSync(link.path)
      prunedDangling += 1
      continue
    }
    if (isInside(appRoot, link.resolved)) {
      // Peer-linkage back into the app shell itself: nothing imports the
      // packaged entry package from inside node_modules.
      rmSync(link.path)
      prunedSelfLinks += 1
      continue
    }
    const list = byTarget.get(link.resolved) ?? []
    list.push(link.path)
    byTarget.set(link.resolved, list)
  }

  for (const [target, paths] of byTarget) {
    const id = createHash('sha1').update(target).digest('hex').slice(0, 16)
    const mirrorDir = join(MIRROR, id)
    if (!existsSync(mirrorDir)) {
      mkdirSync(mirrorDir, { recursive: true })
      // Preserve links during the copy, then rebase them from their source
      // location so relative workspace links retain their original targets.
      cpSync(target, mirrorDir, { recursive: true, verbatimSymlinks: true })
      rebaseCopiedLinks(target, mirrorDir)
    }
    for (const path of paths) {
      const suffix = realpathSync(path).slice(target.length)
      const linked = join(mirrorDir, suffix)
      const rel = relative(dirname(path), linked)
      rmSync(path)
      symlinkSync(rel, path)
    }
  }
}

// Final proof: nothing may point outside the staged tree, nothing may dangle.
const remaining = escapes()
if (remaining.length !== 0) {
  throw new Error(`staged tree still has ${remaining.length} unresolved symlink(s)`)
}
console.log(`pruned ${prunedDangling} dangling and ${prunedSelfLinks} self-referential link(s)`)
console.log(`staged packaged app at ${staging}`)
