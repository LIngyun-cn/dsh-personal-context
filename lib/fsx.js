/** Small, dependency-free filesystem helpers with atomic writes and path containment. */
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

export async function exists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

export async function readText(target, fallback = '') {
  try {
    return await fs.readFile(target, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback
    throw error
  }
}

export async function readJson(target, fallback) {
  const text = await readText(target, '')
  if (text.trim().length === 0) return fallback
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

/** Write UTF-8 text through a same-directory temp file, fsync, and rename. */
export async function writeAtomic(target, text) {
  await ensureDir(path.dirname(target))
  const tmp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`,
  )
  let handle
  try {
    handle = await fs.open(tmp, 'w')
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } finally {
    if (handle) await handle.close()
  }
  try {
    await fs.rename(tmp, target)
  } catch (error) {
    // Windows can refuse replacement while a reader holds the target; retry once after unlink.
    if (error && (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'EEXIST')) {
      await fs.rm(target, { force: true })
      await fs.rename(tmp, target)
    } else {
      await fs.rm(tmp, { force: true })
      throw error
    }
  }
}

export async function writeJson(target, value) {
  await writeAtomic(target, `${JSON.stringify(value, null, 2)}\n`)
}

/** Version stamp used for optimistic concurrency checks. */
export async function fileStamp(target) {
  try {
    const stat = await fs.stat(target)
    const text = await fs.readFile(target, 'utf8')
    return `${stat.size}:${sha256(text)}`
  } catch (error) {
    if (error && error.code === 'ENOENT') return ''
    throw error
  }
}

/**
 * Write only when the file still matches the stamp captured before reading it.
 * This catches edits made outside the plugin (or by another process that does
 * not honour the lock) instead of silently overwriting them.
 */
export async function writeAtomicIfUnchanged(target, text, expectedStamp) {
  if (expectedStamp !== undefined && expectedStamp !== null) {
    const now = await fileStamp(target)
    if (now !== expectedStamp) {
      const error = new Error('文件已被另一个窗口修改，请刷新后重试')
      error.code = 'EPC_CONFLICT'
      throw error
    }
  }
  await writeAtomic(target, text)
}

/**
 * Cross-process advisory lock. `wx` creation is atomic on local filesystems.
 * A stale lock is broken after `staleMs` so a crashed process cannot block
 * the knowledge base forever.
 */
export async function acquireLock(root, { timeoutMs = 8000, staleMs = 30000 } = {}) {
  const lockPath = path.join(root, '.pc.lock')
  const token = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  const started = Date.now()
  await ensureDir(root)
  for (;;) {
    try {
      const handle = await fs.open(lockPath, 'wx')
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, at: Date.now() }), 'utf8')
      await handle.close()
      return async () => {
        try {
          const raw = await readText(lockPath, '')
          const value = raw ? JSON.parse(raw) : null
          if (value && value.token !== token) return
        } catch {
          return
        }
        await fs.rm(lockPath, { force: true }).catch(() => {})
      }
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error
      let stale = false
      try {
        const stat = await fs.stat(lockPath)
        stale = Date.now() - stat.mtimeMs > staleMs
      } catch {
        stale = true
      }
      if (stale) {
        await fs.rm(lockPath, { force: true }).catch(() => {})
        continue
      }
      if (Date.now() - started > timeoutMs) {
        const locked = new Error('另一个窗口正在写入，请稍后重试')
        locked.code = 'EPC_LOCKED'
        throw locked
      }
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
  }
}

/** True when `target` is the same as, or inside, `root`. Both must be absolute. */
export function inside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function safeJoin(root, ...parts) {
  const target = path.resolve(root, ...parts)
  if (!inside(root, target)) throw new Error(`path escapes the memory root: ${target}`)
  return target
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

export function shortHash(text, length = 12) {
  return sha256(text).slice(0, length)
}

export function randomId(prefix = 'e') {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`
}

export function pad(value) {
  return String(value).padStart(2, '0')
}

/** Local wall-clock stamp used for headings and folder names. */
export function localStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function compactStamp(date = new Date()) {
  return `${localDay(date).replaceAll('-', '')}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export function normalizeText(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Character-bigram Jaccard similarity; dependency-free and stable for mixed Chinese/English text. */
export function similarity(a, b) {
  const left = normalizeText(a)
  const right = normalizeText(b)
  if (left === right) return 1
  if (left.length < 2 || right.length < 2) return 0
  const grams = (value) => {
    const set = new Set()
    for (let i = 0; i < value.length - 1; i += 1) set.add(value.slice(i, i + 2))
    return set
  }
  const ga = grams(left)
  const gb = grams(right)
  let shared = 0
  for (const gram of ga) if (gb.has(gram)) shared += 1
  return shared / (ga.size + gb.size - shared)
}

export async function removeDirContents(dir) {
  await fs.rm(dir, { recursive: true, force: true })
  await ensureDir(dir)
}
