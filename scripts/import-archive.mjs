#!/usr/bin/env node
/**
 * Import a conversation archive into a personal-context memory tree.
 *
 * The archive layer is generic:
 *   dataset/sessions.jsonl   one JSON object per session
 *   dataset/txt/<id>.md      transcript for that session
 *   dataset/INDEX.md         optional table mapping session id -> topic
 *
 * The curated layer is opt-in and comes from a seed JSON file:
 *   {
 *     "master": { "个人背景": ["..."], "交流偏好": ["..."] },
 *     "topics": [{
 *       "id": "project-x", "title": "项目 X", "aliases": ["old-id"],
 *       "background": "...", "state": "...",
 *       "conclusions": ["..."], "pending": ["..."],
 *       "entries": [["fact", "2026-01-01", "..."], {"kind": "decision", "at": "2026-01-02", "text": "..."}]
 *     }]
 *   }
 *
 * Usage:
 *   node scripts/import-archive.mjs --source ./data --home ~/.dsh/personal-context
 *   node scripts/import-archive.mjs --source ./data --seed ./seed.json
 *   node scripts/import-archive.mjs --source ./data --dry-run
 */
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PersonalContextService } from '../lib/service.js'
import { parseAgents, parseLog, parseMaster, renderAgents, renderLog, renderMaster } from '../lib/documents.js'
import { normalizeText, shortHash, writeAtomic } from '../lib/fsx.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const arg = (name, fallback = '') => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const DRY = args.includes('--dry-run')
const SOURCE = path.resolve(arg('--source', path.resolve(here, '..')))
const HOME = path.resolve(
  arg('--home', path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE || '.', '.dsh'), 'personal-context')),
)
const DATASET = path.join(SOURCE, 'dataset')
const INDEX = path.join(DATASET, 'INDEX.md')
const SEED_PATH = arg('--seed')

const stripBom = (text) => String(text).replace(/^\uFEFF/, '')

function parseIndex(text) {
  const topics = new Map()
  for (const raw of stripBom(text).split(/\r?\n/)) {
    const line = raw.trim()
    const link = /\[txt\]\(([^)]+)\)/.exec(line)
    if (!link) continue
    const cells = line.slice(0, line.indexOf('[txt]')).split('|').map((cell) => cell.trim()).filter(Boolean)
    const id = path.basename(link[1], '.md')
    const topic = cells[cells.length - 1]
    if (id && topic) topics.set(id, topic)
  }
  return topics
}

function parseSessions(text) {
  const rows = []
  for (const line of stripBom(text).split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line)
      if (!row.session_id) continue
      rows.push({
        id: row.session_id,
        at: String(row.inserted_at || '').slice(0, 10),
        title: row.title || '(无标题)',
        messages: Number(row.message_count || 0),
        chars: Number(row.chars || 0),
        file: `txt/${row.session_id}.md`,
      })
    } catch {
      // skip damaged line
    }
  }
  return rows
}

function normalizeSections(value = {}) {
  const out = {}
  for (const [section, content] of Object.entries(value)) {
    const text = Array.isArray(content) ? content.join('\n') : String(content ?? '')
    if (text.trim()) out[section] = text.trim()
  }
  return out
}

function seedEntry(topic, raw) {
  const row = Array.isArray(raw)
    ? { kind: raw[0], at: raw[1], text: raw[2] }
    : raw && typeof raw === 'object'
      ? raw
      : null
  if (!row || !row.text) return null
  const kind = String(row.kind || 'fact')
  const at = String(row.at || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
  const text = String(row.text).trim()
  if (!text) return null
  return {
    id: shortHash(`seed:${kind}:${at}:${text}`, 14),
    kind,
    title: String(row.title || (text.length > 64 ? `${text.slice(0, 63)}…` : text)),
    text,
    at: `${at}T08:00:00.000Z`,
    source: String(row.source || topic.source || 'seed'),
    by: 'import',
    confidence: ['high', 'medium', 'low'].includes(row.confidence) ? row.confidence : 'high',
    status: row.status === 'open' || (!row.status && kind === 'question') ? 'open' : 'current',
    sensitivity: ['normal', 'important', 'sensitive'].includes(row.sensitivity) ? row.sensitivity : undefined,
    hash: shortHash(normalizeText(text)),
  }
}

async function loadSeed() {
  if (!SEED_PATH) return { master: {}, topics: [] }
  const parsed = JSON.parse(stripBom(await readFile(path.resolve(SEED_PATH), 'utf8')))
  const topics = Array.isArray(parsed.topics) ? parsed.topics : []
  for (const topic of topics) {
    if (!topic || !topic.id) throw new Error('seed topic requires an id')
    if (!/^[a-zA-Z0-9_-]+$/.test(topic.id)) throw new Error(`invalid topic id: ${topic.id}`)
  }
  return { master: normalizeSections(parsed.master || {}), topics }
}

async function main() {
  const seed = await loadSeed()
  const indexText = await readFile(INDEX, 'utf8').catch(() => '')
  const topicById = parseIndex(indexText)
  const sessionsText = await readFile(path.join(DATASET, 'sessions.jsonl'), 'utf8')
  const rows = parseSessions(sessionsText)
  if (rows.length === 0) throw new Error(`No sessions parsed from ${DATASET}`)
  for (const row of rows) row.topic = topicById.get(row.id) || '其他'

  const archiveDir = path.join(HOME, 'Memory', 'archive')
  console.log(`source: ${SOURCE}`)
  console.log(`home:   ${HOME}`)
  console.log(`sessions parsed: ${rows.length}`)
  if (DRY) {
    console.log(`would copy ${rows.length} transcripts to ${archiveDir}`)
    console.log(`seed: ${seed.topics.length} topics, ${Object.keys(seed.master).length} master sections`)
    return
  }

  const service = new PersonalContextService({ homeDir: HOME })
  await service.init()
  await mkdir(path.join(archiveDir, 'txt'), { recursive: true })

  let copied = 0
  let bytes = 0
  const catalog = []
  for (const row of rows) {
    const from = path.join(DATASET, row.file)
    const to = path.join(archiveDir, 'txt', `${row.id}.md`)
    try {
      const info = await stat(from)
      await cp(from, to, { force: true })
      copied += 1
      bytes += info.size
    } catch {
      console.warn(`missing transcript: ${row.file}`)
      continue
    }
    catalog.push({
      id: row.id,
      at: row.at,
      title: row.title,
      topic: row.topic,
      messages: row.messages,
      chars: row.chars,
      file: `txt/${row.id}.md`,
    })
  }
  await writeFile(path.join(archiveDir, 'catalog.jsonl'), catalog.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
  await writeFile(
    path.join(archiveDir, 'manifest.json'),
    JSON.stringify(
      {
        version: 1,
        source: SOURCE,
        importedAt: new Date().toISOString(),
        sessions: catalog.length,
        transcripts: copied,
        bytes,
        generator: 'scripts/import-archive.mjs',
      },
      null,
      2,
    ),
    'utf8',
  )

  const now = new Date().toISOString()
  if (Object.keys(seed.master).length > 0) {
    const masterPath = path.join(service.root, 'MASTER.md')
    let existingMaster = { sections: {} }
    try {
      existingMaster = parseMaster(await readFile(masterPath, 'utf8'))
    } catch {
      // first import
    }
    const mergedMaster = {}
    for (const [section, text] of Object.entries(seed.master)) {
      const old = String(existingMaster.sections?.[section] ?? '').trim()
      const next = String(text ?? '').trim()
      mergedMaster[section] = old && next && !old.includes(next) ? `${old}\n\n${next}` : old || next
    }
    await writeAtomic(masterPath, renderMaster({ updated: now }, mergedMaster))
  }

  for (const topic of seed.topics) {
    const created = await service.ensureTopic({ id: topic.id, title: topic.title || topic.id })
    const targetDir = service.topicDir(topic.id)
    const sourceDirs = [targetDir, ...(topic.aliases || []).map((id) => service.topicDir(id))]
    const seen = new Set()
    const combined = []
    for (const dir of sourceDirs) {
      try {
        const parsed = parseLog(await readFile(path.join(dir, 'LOG.md'), 'utf8'))
        for (const row of parsed.entries) {
          const key = normalizeText(row.text)
          if (!key || seen.has(key)) continue
          seen.add(key)
          combined.push(row)
        }
      } catch {
        // topic has no log yet
      }
    }
    for (const raw of topic.entries || []) {
      const row = seedEntry(topic, raw)
      if (!row) continue
      const key = normalizeText(row.text)
      if (seen.has(key)) continue
      seen.add(key)
      combined.push(row)
    }
    combined.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
    await writeAtomic(path.join(targetDir, 'LOG.md'), renderLog(created, combined))

    const agentsPath = path.join(targetDir, 'AGENTS.md')
    let oldSections = {}
    try {
      oldSections = parseAgents(await readFile(agentsPath, 'utf8')).sections || {}
    } catch {
      // first import
    }
    const nextSections = {
      背景: topic.background,
      当前状态: topic.state,
      重要结论: (topic.conclusions || []).map((line) => `- ${line}`).join('\n'),
      待解决: (topic.pending || []).map((line) => `- ${line}`).join('\n'),
      历史: '由 `scripts/import-archive.mjs` 从 seed 首次导入。',
    }
    const agentsSections = {}
    for (const [section, text] of Object.entries(nextSections)) {
      const old = String(oldSections[section] ?? '').trim()
      const next = String(text ?? '').trim()
      if (!old && !next) continue
      agentsSections[section] = old && next && !old.includes(next) ? `${old}\n\n${next}` : old || next
    }
    await writeAtomic(agentsPath, renderAgents({ ...created, updated: now }, agentsSections))

    for (const alias of topic.aliases || []) {
      if (alias !== topic.id) await rm(service.topicDir(alias), { recursive: true, force: true })
    }
    console.log(`seeded topic: ${topic.id} (${combined.length} entries)`)
  }

  const reindexed = await service.reindex()
  console.log(`archive copied: ${copied} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`)
  console.log(`catalog rows: ${catalog.length}`)
  console.log(`reindexed topics: ${reindexed.topics}`)
  console.log('done.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
