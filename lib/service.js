/**
 * PersonalContextService — the single implementation behind the sidebar panel,
 * the `/personal-context` session command and the `personal_context` agent tool.
 *
 * The Markdown tree is the product; every derived structure is rebuilt from it.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  acquireLock,
  compactStamp,
  ensureDir,
  exists,
  fileStamp,
  localDay,
  localStamp,
  normalizeText,
  randomId,
  readJson,
  readText,
  safeJoin,
  shortHash,
  similarity,
  writeAtomic,
  writeAtomicIfUnchanged,
  writeJson,
} from './fsx.js'
import {
  AGENT_SECTIONS,
  KIND_LABELS,
  KINDS,
  MASTER_SECTIONS,
  SENSITIVITIES,
  SENSITIVITY_LABELS,
  bulletLines,
  oneLine,
  parseAgents,
  parseIndex,
  parseLog,
  parseMaster,
  renderAgents,
  renderDeletedArchive,
  renderIndex,
  renderLog,
  renderLogHeader,
  renderMaster,
} from './documents.js'
import { extractCandidates, looksProfileFact, looksThinkingHabit } from './capture.js'

const VERSION = '0.4.0'
const DEFAULT_HOME = path.join(os.homedir(), '.dsh', 'personal-context')
const DAY = 24 * 60 * 60 * 1000
const WRITE_ACTIONS = new Set(['save', 'update', 'delete', 'merge', 'audit', 'export', 'import', 'restore', 'configure', 'pause', 'resume', 'reindex'])
const SESSION_WRITE_ACTIONS = new Set(['save', 'update', 'delete', 'merge', 'import', 'restore', 'configure', 'pause', 'resume', 'reindex'])

function searchTerms(query) {
  return [...new Set(String(query ?? '').trim().split(/[\s,，、;；]+/).filter(Boolean))]
}

function termVariants(term) {
  const value = normalizeText(term)
  const out = new Set([value])
  const cn = value.match(/^(\d{4})\s*[-年/.]\s*(\d{1,2})\s*[-月/.]\s*(\d{1,2})\s*日?$/)
  if (cn) out.add(`${cn[1]}-${cn[2].padStart(2, '0')}-${cn[3].padStart(2, '0')}`)
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) out.add(`${iso[1]}年${Number(iso[2])}月${Number(iso[3])}日`)
  return [...out]
}

function keyTokens(text) {
  const out = new Set()
  for (const match of String(text ?? '').matchAll(/\d{4}\s*[-年/.]\s*\d{1,2}\s*[-月/.]\s*\d{1,2}\s*日?/g)) {
    const value = match[0].replace(/[年月/.]/g, '-').replace(/日/g, '').replace(/-+/g, '-').replace(/-$/, '')
    out.add(value)
  }
  for (const match of String(text ?? '').matchAll(/\b\d{2,}\b/g)) out.add(match[0])
  return out
}

function longestCommonRun(a, b, cap = 600) {
  const left = normalizeText(a).slice(0, cap)
  const right = normalizeText(b).slice(0, cap)
  if (!left || !right) return 0
  let best = 0
  let previous = new Array(right.length + 1).fill(0)
  for (let i = 1; i <= left.length; i += 1) {
    const current = new Array(right.length + 1).fill(0)
    for (let j = 1; j <= right.length; j += 1) {
      if (left[i - 1] === right[j - 1]) {
        current[j] = previous[j - 1] + 1
        if (current[j] > best) best = current[j]
      }
    }
    previous = current
  }
  return best
}

const README = [
  '# 个人上下文 · 管理协议',
  '',
  '这个目录保存用户的长期上下文资产，由 DSH「个人上下文」插件维护。',
  '所有内容均为 Markdown，可直接阅读、编辑、备份和迁移；不依赖任何模型或平台。',
  '',
  '## 文件职责',
  '',
  '- `MASTER.md`：相对稳定的个人背景、思考与决策习惯、长期目标、交流偏好。只做有依据的追加。',
  '- `INDEX.md`：主题索引，记录每个主题的路径、条目数、关键词与更新时间。',
  '- `topics/<id>/AGENTS.md`：该主题的稳定概述、当前状态、重要结论与待解决事项；元数据可带敏感度。',
  '- `topics/<id>/LOG.md`：按时间追加的原始记录，每条都带日期、性质、来源和置信度。',
  '- `topics/<id>/archive/`：合并后的旧日志与已删除条目，避免主文档无限膨胀。',
  '- `reports/`：审计报告与冲突清单。',
  '- `backups/`：每次写入前的版本快照；超过 180 天或 120 份的原始快照会先写二级摘要再删除，摘要永久保留。',
  '- `exports/`：导出副本。',
  '',
  '## 记录规则',
  '',
  '1. 高频追加、低频改写：日常只追加 `LOG.md`；达到阈值后才归纳到 `AGENTS.md` 并归档旧日志。',
  '2. 每条记录必须带日期；不得用新记录直接覆盖旧记录。观点变化时追加新记录并标注修正。',
  '3. 区分性质：事实 / 偏好 / 观点 / 决定 / 想法 / 待解决 / 推测。模型推测不得写成用户事实。',
  '4. 机器字段位于 `<!-- pc:... -->` 注释中，请保留；正文可自由编辑。',
  '5. 插件默认不调用大模型：规则负责捕获，模型通过工具写入语义判断，成本为零。',
  '',
  '## 恢复',
  '',
  '面板「备份」页可恢复保留窗口内的精确快照；超过 180 天的备份只能查 `backups/summaries/` 的二级摘要。也可直接把 `backups/<id>/files/` 下的文件复制回本目录。',
  '',
].join('\n')

function defaultSettings(config = {}) {
  return {
    version: 2,
    dataDir: typeof config.dataDir === 'string' && config.dataDir ? path.resolve(config.dataDir) : '',
    mergeThreshold: Number(config.mergeThreshold ?? 40),
    injectBudget: Number(config.injectBudget ?? 1200),
    retention: Number(config.retention ?? 120),
    retentionDays: Number(config.retentionDays ?? 180),
    minScore: Number(config.minScore ?? 2),
    autoCapture: config.autoCapture !== false,
    autoInject: config.autoInject !== false,
    autoMerge: config.autoMerge !== false,
    autoAudit: config.autoAudit !== false,
    paused: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function slugify(value) {
  const ascii = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  if (ascii.length >= 2) return ascii
  return `t-${shortHash(String(value ?? 'topic'), 8)}`
}

function defaultSensitivity(id, title = '') {
  const haystack = `${id} ${title}`.toLowerCase()
  if (/(health|健康|身体|医疗|眼|病)/.test(haystack)) return 'sensitive'
  if (/(family|家庭|情绪|情感|父母|家人)/.test(haystack)) return 'sensitive'
  if (/(money|消费|兴趣|财务|花费|手办)/.test(haystack)) return 'sensitive'
  if (/(ai-relation|与 ai 的关系|与ai的关系|ai 关系)/.test(haystack)) return 'important'
  return 'normal'
}

function recencyScore(iso) {
  const time = Date.parse(iso ?? '')
  if (!Number.isFinite(time)) return 0
  const days = Math.max(0, (Date.now() - time) / DAY)
  return Math.max(0, 1.2 - days / 365)
}

function isoOrNow(value) {
  const time = Date.parse(String(value ?? ''))
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString()
}

export class PersonalContextService {
  constructor(config = {}) {
    this.config = config
    this.homeDir = path.resolve(config.homeDir || DEFAULT_HOME)
    this.settings = null
    this.state = null
    this._ready = null
    this._chain = Promise.resolve()
    this._mutations = 0
  }

  /* ------------------------------------------------------------ lifecycle */

  async init() {
    if (!this._ready) this._ready = this._init()
    await this._ready
    return this
  }

  async _init() {
    await ensureDir(this.homeDir)
    const defaults = defaultSettings(this.config)
    const stored = await readJson(path.join(this.homeDir, 'settings.json'), {})
    this.settings = { ...defaults, ...stored }
    // v1 allowed 30 backups with no age summary; v2 keeps a 180-day exact
    // restore window and a permanent second-level summary for older copies.
    if (Number(stored.version ?? 1) < 2) {
      this.settings.retention = 120
      this.settings.retentionDays = 180
    }
    this.settings.version = 2
    if (!this.settings.dataDir) this.settings.dataDir = path.join(this.homeDir, 'Memory')
    this.settings.dataDir = path.resolve(this.settings.dataDir)
    this.state = (await readJson(this.stateFile, null)) ?? {
      version: 1,
      createdAt: new Date().toISOString(),
      lastError: '',
      lastErrorAt: '',
      lastCaptureAt: '',
      lastAuditAt: '',
      captures: 0,
      injected: 0,
      sessionChoices: {},
    }
    await this._ensureTree()
  }

  async _ensureTree() {
    const root = this.settings.dataDir
    await ensureDir(root)
    for (const dir of ['topics', 'backups', 'exports', 'reports']) {
      await ensureDir(path.join(root, dir))
    }
    if (!(await exists(this.file('README.md')))) await writeAtomic(this.file('README.md'), README)
    if (!(await exists(this.file('MASTER.md')))) {
      await writeAtomic(this.file('MASTER.md'), renderMaster({ updated: new Date().toISOString() }, {}))
    }
    if (!(await exists(this.file('INDEX.md')))) await writeAtomic(this.file('INDEX.md'), renderIndex({}, []))
    const index = parseIndex(await readText(this.file('INDEX.md'), ''))
    if (!Array.isArray(index.topics) || index.topics.length === 0) {
      await this._createTopicLocked({ id: 'general', title: '通用', workspace: '' })
    }
    let current = await this._readIndex()
    let changed = false
    for (const topic of current.topics) {
      if (SENSITIVITIES.includes(topic.sensitivity)) continue
      const agentsPath = path.join(this.topicDir(topic.id), 'AGENTS.md')
      const parsed = parseAgents(await readText(agentsPath, ''))
      const sensitivity = defaultSensitivity(topic.id, topic.title)
      await writeAtomic(
        agentsPath,
        renderAgents(
          {
            ...parsed.meta,
            id: topic.id,
            title: topic.title,
            sensitivity,
            created: topic.created,
            updated: topic.updated,
          },
          parsed.sections,
        ),
      )
      topic.sensitivity = sensitivity
      changed = true
    }
    if (changed) {
      await writeAtomic(
        this.file('INDEX.md'),
        renderIndex({ updated: current.updated ?? new Date().toISOString() }, current.topics),
      )
    }
    await this._saveSettings()
  }

  /* --------------------------------------------------------------- paths */

  get root() {
    return this.settings.dataDir
  }

  get stateFile() {
    return path.join(this.homeDir, 'state.json')
  }

  file(...parts) {
    return safeJoin(this.root, ...parts)
  }

  topicDir(id) {
    if (!/^[a-zA-Z0-9_-]+$/.test(String(id ?? ''))) throw new Error('非法主题 id')
    return safeJoin(this.root, 'topics', id)
  }

  _p() {
    return {
      master: this.file('MASTER.md'),
      index: this.file('INDEX.md'),
      topics: this.file('topics'),
      backups: this.file('backups'),
      exports: this.file('exports'),
      reports: this.file('reports'),
    }
  }

  /* ------------------------------------------------------------- settings */

  async getSettings() {
    await this.init()
    return { ...this.settings }
  }

  async updateSettings(patch = {}) {
    await this.init()
    return this._locked(async () => {
      const next = { ...this.settings }
      if ('mergeThreshold' in patch) next.mergeThreshold = clampInt(patch.mergeThreshold, 5, 500, next.mergeThreshold)
      if ('injectBudget' in patch) next.injectBudget = clampInt(patch.injectBudget, 200, 8000, next.injectBudget)
      if ('retention' in patch) next.retention = clampInt(patch.retention, 20, 500, next.retention)
      if ('retentionDays' in patch) next.retentionDays = clampInt(patch.retentionDays, 30, 3650, next.retentionDays)
      if ('minScore' in patch) next.minScore = clampInt(patch.minScore, 1, 10, next.minScore)
      if ('autoCapture' in patch) next.autoCapture = Boolean(patch.autoCapture)
      if ('autoInject' in patch) next.autoInject = Boolean(patch.autoInject)
      if ('autoMerge' in patch) next.autoMerge = Boolean(patch.autoMerge)
      if ('autoAudit' in patch) next.autoAudit = Boolean(patch.autoAudit)
      if ('paused' in patch) next.paused = Boolean(patch.paused)
      if ('dataDir' in patch && patch.dataDir) {
        const dir = path.resolve(String(patch.dataDir))
        if (!path.isAbsolute(dir)) throw new Error('数据目录必须是绝对路径')
        next.dataDir = dir
      }
      next.updatedAt = new Date().toISOString()
      this.settings = next
      await this._saveSettings()
      this._ready = this._init()
      await this._ready
      return { ...this.settings }
    })
  }

  async _saveSettings() {
    await writeJson(path.join(this.homeDir, 'settings.json'), this.settings)
  }

  /**
   * Per-session context choice made on the New Session screen, before the
   * first message exists. The host reads it when the agent is created.
   */
  async getSessionChoice(sessionId) {
    await this.init()
    const key = String(sessionId ?? '').trim().replace(/^session-/, '')
    if (!key) return null
    const choices = this.state.sessionChoices ?? {}
    const choice = choices[key] ?? choices[`session-${key}`]
    return choice ? { ...choice, capture: choice.capture !== false } : null
  }

  async isSessionCaptureEnabled(sessionId) {
    if (!String(sessionId ?? '').trim()) return true
    const choice = await this.getSessionChoice(sessionId)
    return choice?.capture !== false
  }

  async setSessionChoice({ sessionId, mode = 'summary', topics = [], capture } = {}) {
    await this.init()
    const key = String(sessionId ?? '').trim().replace(/^session-/, '')
    if (!key) throw new Error('缺少 sessionId')
    if (capture !== undefined && typeof capture !== 'boolean') throw new Error('capture 必须是布尔值')
    const allowed = ['none', 'summary', 'topics', 'recent']
    if (!allowed.includes(mode)) throw new Error(`未知的上下文模式：${mode}`)
    const index = await this._readIndex()
    const known = new Set(index.topics.map((item) => item.id))
    const picked = (Array.isArray(topics) ? topics : [])
      .map((item) => String(item ?? '').trim())
      .filter((item, position, list) => known.has(item) && list.indexOf(item) === position)
      .slice(0, 12)
    if (mode === 'topics' && picked.length === 0) throw new Error('按主题加载时至少选择一个主题')
    return this._locked(async () => {
      if (!this.state.sessionChoices || typeof this.state.sessionChoices !== 'object') this.state.sessionChoices = {}
      const previous = this.state.sessionChoices[key] ?? this.state.sessionChoices[`session-${key}`]
      const nextCapture = capture ?? (previous?.capture !== false)
      delete this.state.sessionChoices[`session-${key}`]
      this.state.sessionChoices[key] = {
        mode,
        topics: mode === 'topics' ? picked : [],
        capture: nextCapture,
        at: new Date().toISOString(),
      }
      const keys = Object.keys(this.state.sessionChoices)
      if (keys.length > 200) {
        keys
          .sort((a, b) => Date.parse(this.state.sessionChoices[a]?.at ?? 0) - Date.parse(this.state.sessionChoices[b]?.at ?? 0))
          .slice(0, keys.length - 200)
          .forEach((old) => delete this.state.sessionChoices[old])
      }
      await this._saveState()
      return { ...this.state.sessionChoices[key] }
    })
  }

  async clearSessionChoice(sessionId) {
    await this.init()
    const key = String(sessionId ?? '').trim().replace(/^session-/, '')
    if (!key || !(this.state.sessionChoices?.[key] || this.state.sessionChoices?.[`session-${key}`])) return false
    return this._locked(async () => {
      delete this.state.sessionChoices[key]
      delete this.state.sessionChoices[`session-${key}`]
      await this._saveState()
      return true
    })
  }

  async _saveState() {
    this.state.updatedAt = new Date().toISOString()
    await writeJson(this.stateFile, this.state)
  }

  async _setError(error) {
    this.state.lastError = error instanceof Error ? error.message : String(error)
    this.state.lastErrorAt = new Date().toISOString()
    await this._saveState().catch(() => {})
  }

  async _clearError() {
    if (!this.state.lastError) return
    this.state.lastError = ''
    this.state.lastErrorAt = ''
    await this._saveState().catch(() => {})
  }

  /* --------------------------------------------------------------- locking */

  _locked(fn) {
    const run = this._chain.then(async () => {
      const release = await acquireLock(this.root)
      try {
        return await fn()
      } finally {
        await release()
      }
    })
    this._chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /* --------------------------------------------------------------- topics */

  async _readIndex() {
    const parsed = parseIndex(await readText(this._p().index, ''))
    if (!Array.isArray(parsed.topics)) parsed.topics = []
    return parsed
  }

  async _topicMeta(id) {
    const dir = this.topicDir(id)
    const text = await readText(path.join(dir, 'AGENTS.md'), '')
    const meta = parseAgents(text).meta
    return {
      id,
      title: meta.title || id,
      workspace: meta.workspace || '',
      created: meta.created || '',
      updated: meta.updated || '',
      archived: meta.archived || 0,
      sensitivity: SENSITIVITIES.includes(meta.sensitivity)
        ? meta.sensitivity
        : defaultSensitivity(id, meta.title || id),
    }
  }

  async listTopics() {
    await this.init()
    return this._readIndex()
  }

  /** One command round-trip for the panel's initial render. */
  async overview() {
    await this.init()
    const status = await this.status()
    const index = await this._readIndex()
    const backups = await this.listBackups()
    return {
      status,
      topics: index.topics,
      settings: { ...this.settings },
      backups,
    }
  }

  async getTopic(id) {
    await this.init()
    const meta = await this._topicMeta(id)
    const dir = this.topicDir(id)
    const logText = await readText(path.join(dir, 'LOG.md'), '')
    const entries = parseLog(logText).entries
    const archive = await this._listDir(path.join(dir, 'archive'))
    return {
      ...meta,
      agents: await readText(path.join(dir, 'AGENTS.md'), ''),
      log: entries.slice(-120).map((entry) => ({
        ...entry,
        sensitivity: SENSITIVITIES.includes(entry.sensitivity) ? entry.sensitivity : meta.sensitivity,
      })),
      totals: { current: entries.length, archive: archive.length },
      archive,
    }
  }

  async _listDir(dir) {
    try {
      const names = await fs.readdir(dir)
      return names.sort()
    } catch {
      return []
    }
  }

  async _createTopicLocked({ id, title, workspace = '' }) {
    const index = await this._readIndex()
    const finalTitle = oneLine(title || '未命名主题', 80)
    let finalId = id ? String(id) : slugify(finalTitle)
    if (!/^[a-zA-Z0-9_-]+$/.test(finalId)) finalId = slugify(finalTitle)
    if (index.topics.some((topic) => topic.id === finalId)) return index.topics.find((topic) => topic.id === finalId)
    const now = new Date().toISOString()
    const topic = {
      id: finalId,
      title: finalTitle,
      workspace,
      created: now,
      updated: now,
      entries: 0,
      archived: 0,
      keywords: [],
      sensitivity: defaultSensitivity(finalId, finalTitle),
    }
    const dir = this.topicDir(finalId)
    await ensureDir(path.join(dir, 'archive'))
    await writeAtomic(path.join(dir, 'AGENTS.md'), renderAgents(topic, {}))
    await writeAtomic(path.join(dir, 'LOG.md'), renderLogHeader(topic))
    index.topics.push(topic)
    index.updated = now
    await writeAtomic(this._p().index, renderIndex(index, index.topics))
    return topic
  }

  async ensureTopic({ title, id, workspace = '' }) {
    await this.init()
    return this._locked(() => this._createTopicLocked({ id, title, workspace }))
  }

  async _updateIndex(topicId, patch = {}) {
    const indexPath = this._p().index
    const stamp = await fileStamp(indexPath)
    const index = parseIndex(await readText(indexPath, ''))
    const topic = index.topics.find((item) => item.id === topicId)
    if (!topic) return
    Object.assign(topic, patch, { updated: new Date().toISOString() })
    index.updated = new Date().toISOString()
    await writeAtomicIfUnchanged(indexPath, renderIndex(index, index.topics), stamp)
  }

  async reindex() {
    await this.init()
    return this._locked(async () => {
      const names = await this._listDir(this._p().topics)
      const topics = []
      for (const id of names) {
        if (!/^[a-zA-Z0-9_-]+$/.test(id)) continue
        const meta = await this._topicMeta(id)
        const log = parseLog(await readText(path.join(this.topicDir(id), 'LOG.md'), '')).entries
        const archive = await this._listDir(path.join(this.topicDir(id), 'archive'))
        topics.push({
          id,
          title: meta.title,
          workspace: meta.workspace,
          created: meta.created,
          updated: meta.updated || new Date().toISOString(),
          entries: log.length,
          archived: archive.length,
          keywords: meta.keywords ?? [],
          sensitivity: meta.sensitivity,
        })
      }
      topics.sort((a, b) => String(b.updated).localeCompare(String(a.updated)))
      await writeAtomic(this._p().index, renderIndex({}, topics))
      return { topics: topics.length }
    })
  }

  /* -------------------------------------------------------------- capture */

  async save(input = {}, meta = {}) {
    await this.init()
    const result = await this._locked(() => this._saveLocked(input, meta))
    if (result.saved && result.mergeSuggested && this.settings.autoMerge) {
      try {
        const merged = await this.merge({ topic: result.topic.id })
        result.merged = merged.merged
      } catch (error) {
        await this._setError(error)
      }
    }
    return result
  }

  async _saveLocked(input = {}, meta = {}) {
    const text = String(input.text ?? '').trim()
    if (text.length < 2) throw new Error('记录内容为空')
    if (text.length > 8000) throw new Error('单条记录过长（上限 8000 字）')
    const kind = KINDS.includes(input.kind) ? input.kind : 'fact'
    const confidence = ['high', 'medium', 'low'].includes(input.confidence) ? input.confidence : 'medium'
    const by = ['auto', 'model', 'user', 'import'].includes(input.by) ? input.by : meta.by || 'user'
    const at = isoOrNow(input.at)

    if (by === 'auto') {
      const near = await this._findNearDuplicate(text)
      if (near) return { duplicate: true, near: true, topic: near.topic, entry: near.entry }
    }

    const duplicate = await this._findDuplicate(text)
    if (duplicate && input.allowDuplicate !== true) {
      return { duplicate: true, topic: duplicate.topic, entry: duplicate.entry }
    }

    const topic = await this._resolveTopicLocked({ topic: input.topic, text, workspace: meta.workspace, createTitle: input.createTopicTitle })
    const sensitivity = SENSITIVITIES.includes(input.sensitivity)
      ? input.sensitivity
      : SENSITIVITIES.includes(topic.sensitivity)
        ? topic.sensitivity
        : defaultSensitivity(topic.id, topic.title)
    const entry = {
      id: randomId('e'),
      kind,
      title: oneLine(input.title || text, 100),
      text,
      at,
      source: oneLine(input.source || meta.source || '', 120),
      by,
      confidence: looksProfileFact(text) ? 'high' : confidence,
      status: input.status === 'open' || (!input.status && kind === 'question') ? 'open' : 'current',
      sensitivity,
      hash: shortHash(normalizeText(text)),
    }

    const logPath = path.join(this.topicDir(topic.id), 'LOG.md')
    const logText = await readText(logPath, '')
    const logStamp = await fileStamp(logPath)

    await this._backupLocked(`save-${topic.id}`, [
      'INDEX.md',
      `topics/${topic.id}/LOG.md`,
      `topics/${topic.id}/AGENTS.md`,
      'MASTER.md',
    ])

    const parsed = parseLog(logText)
    parsed.entries.push(entry)
    await writeAtomicIfUnchanged(logPath, renderLog(topic, parsed.entries), logStamp)
    await this._updateIndex(topic.id, { entries: parsed.entries.length })

    const masterSection = this._masterSectionFor(entry)
    if (masterSection && (by !== 'auto' || entry.confidence === 'high')) {
      await this._appendMasterLocked(entry, masterSection)
    }

    this.state.captures = Number(this.state.captures ?? 0) + 1
    this.state.lastCaptureAt = new Date().toISOString()
    await this._saveState()

    const count = parsed.entries.length
    return {
      saved: true,
      topic: { id: topic.id, title: topic.title },
      entry,
      logCount: count,
      mergeSuggested: count >= this.settings.mergeThreshold,
    }
  }

  async captureFromMessage({ text, sessionId = '', turn = 0, workspace = '', at } = {}) {
    await this.init()
    if (this.settings.paused || !this.settings.autoCapture) return { skipped: true, reason: 'disabled' }
    if (!(await this.isSessionCaptureEnabled(sessionId))) return { skipped: true, reason: 'session-capture-off' }
    const candidates = extractCandidates(text, { minScore: this.settings.minScore })
    if (candidates.length === 0) return { saved: 0 }
    const results = []
    for (const candidate of candidates) {
      try {
        const saved = await this.save(
          {
            text: candidate.text,
            title: candidate.title,
            kind: candidate.kind,
            confidence: candidate.confidence,
            by: 'auto',
            at,
            source: sessionId ? `session:${String(sessionId).replace(/^session-?/, '').slice(0, 8)}/turn:${turn}` : '',
          },
          { workspace, by: 'auto' },
        )
        results.push(saved)
      } catch (error) {
        results.push({ error: error instanceof Error ? error.message : String(error) })
      }
    }
    const savedCount = results.filter((item) => item.saved).length
    return { saved: savedCount, results }
  }

  async _findDuplicate(text) {
    const normalized = normalizeText(text)
    const hash = shortHash(normalized)
    const index = await this._readIndex()
    for (const topic of index.topics) {
      const entries = parseLog(await readText(path.join(this.topicDir(topic.id), 'LOG.md'), '')).entries
      for (const entry of entries.slice(-250)) {
        if (entry.hash === hash || normalizeText(entry.text) === normalized) {
          return { topic: topic.id, entry }
        }
        if (similarity(entry.text, text) >= 0.92) return { topic: topic.id, entry }
      }
    }
    return null
  }

  /**
   * Auto-capture runs after the model has had its chance to save the same
   * statement. A model entry from the last 20 minutes that shares a date or a
   * number and a meaningful text run is treated as the same fact.
   */
  async _findNearDuplicate(text) {
    const index = await this._readIndex()
    const mine = keyTokens(text)
    for (const topic of index.topics) {
      const entries = parseLog(await readText(path.join(this.topicDir(topic.id), 'LOG.md'), '')).entries
      for (const entry of entries.slice(-60).reverse()) {
        if (entry.by !== 'model') continue
        const age = Date.now() - Date.parse(entry.at)
        if (!(age >= 0 && age < 20 * 60 * 1000)) continue
        const theirs = keyTokens(entry.text)
        let shared = false
        for (const token of mine) if (theirs.has(token)) shared = true
        if (!shared) continue
        if (longestCommonRun(entry.text, text) >= 4) return { topic: topic.id, entry }
      }
    }
    return null
  }

  async _resolveTopicLocked({ topic, text, workspace = '', createTitle = '' }) {
    const index = await this._readIndex()
    if (topic) {
      const found = index.topics.find((item) => item.id === topic)
      if (found) return found
      if (createTitle) return this._createTopicLocked({ id: String(topic), title: createTitle, workspace })
    }
    if (createTitle) {
      const wanted = String(createTitle).trim()
      if (wanted) {
        const same = index.topics.find((item) => item.title === wanted)
        if (same) return same
        return this._createTopicLocked({ id: '', title: wanted, workspace })
      }
    }
    if (workspace) {
      const matches = index.topics.filter((item) => item.workspace && item.workspace === workspace)
      if (matches.length === 1) return matches[0]
    }
    let best = null
    let bestScore = 0
    const haystack = normalizeText(text)
    for (const item of index.topics) {
      if (item.id === 'general') continue
      let score = 0
      if (haystack.includes(normalizeText(item.title)) && item.title.length >= 2) score += 3
      for (const keyword of item.keywords ?? []) {
        if (keyword && haystack.includes(normalizeText(keyword))) score += 2
      }
      if (score > bestScore) {
        best = item
        bestScore = score
      }
    }
    if (best) return best
    const general = index.topics.find((item) => item.id === 'general')
    return general ?? this._createTopicLocked({ id: 'general', title: '通用', workspace: '' })
  }

  _masterSectionFor(entry) {
    if (looksProfileFact(entry.text)) return '个人背景'
    if (looksThinkingHabit(entry.text)) return '思考与决策习惯'
    if (entry.kind === 'preference') return '交流偏好'
    if (entry.kind === 'idea' && /(目标|长期|计划|愿景|方向)/.test(entry.text)) return '长期目标'
    return null
  }

  async _appendMasterLocked(entry, sectionName) {
    const masterPath = this._p().master
    const stamp = await fileStamp(masterPath)
    const text = await readText(masterPath, '')
    const parsed = parseMaster(text)
    const current = parsed.sections[sectionName] ?? ''
    if (bulletLines(current).some((line) => normalizeText(line).includes(normalizeText(entry.text).slice(0, 40)))) return false
    const day = String(entry.at).slice(0, 10)
    const line = `${day} ${oneLine(entry.text, 220)}`
    parsed.sections[sectionName] = current ? `${current.trim()}\n- ${line}` : `- ${line}`
    await writeAtomicIfUnchanged(masterPath, renderMaster({ updated: new Date().toISOString() }, parsed.sections), stamp)
    return true
  }

  /* -------------------------------------------------------------- query */

  async status() {
    await this.init()
    const index = await this._readIndex()
    let totalEntries = 0
    let recent = []
    for (const topic of index.topics) {
      const entries = parseLog(await readText(path.join(this.topicDir(topic.id), 'LOG.md'), '')).entries
      totalEntries += entries.length
      recent = recent.concat(entries.map((entry) => ({
        ...entry,
        topic: topic.id,
        topicTitle: topic.title,
        sensitivity: SENSITIVITIES.includes(entry.sensitivity) ? entry.sensitivity : topic.sensitivity,
      })))
    }
    recent.sort((a, b) => String(b.at).localeCompare(String(a.at)))
    const backups = await this.listBackups()
    const archive = await this.archiveStats()
    return {
      version: VERSION,
      dataDir: this.root,
      paused: this.settings.paused,
      autoCapture: this.settings.autoCapture,
      autoInject: this.settings.autoInject,
      autoMerge: this.settings.autoMerge,
      autoAudit: this.settings.autoAudit,
      mergeThreshold: this.settings.mergeThreshold,
      injectBudget: this.settings.injectBudget,
      retention: this.settings.retention,
      retentionDays: this.settings.retentionDays,
      minScore: this.settings.minScore,
      topics: index.topics.length,
      totalEntries,
      pendingMerge: index.topics.filter((topic) => (topic.entries ?? 0) >= this.settings.mergeThreshold).map((topic) => topic.id),
      recent: recent.slice(0, 8),
      backups: backups.length,
      archive,
      lastError: this.state.lastError,
      lastErrorAt: this.state.lastErrorAt,
      lastCaptureAt: this.state.lastCaptureAt,
      docs: {
        master: (await readText(this._p().master, '')).length,
        index: (await readText(this._p().index, '')).length,
      },
    }
  }

  _archiveDir() {
    return path.join(this.root, 'archive')
  }

  async archiveStats() {
    await this.init()
    const manifest = await readJson(path.join(this._archiveDir(), 'manifest.json'), null)
    let sessions = Number(manifest?.sessions ?? 0)
    if (!sessions) {
      const text = await readText(path.join(this._archiveDir(), 'catalog.jsonl'), '')
      sessions = text.split(/\r?\n/).filter(Boolean).length
    }
    return {
      sessions,
      importedAt: manifest?.importedAt ?? '',
      source: manifest?.source ?? '',
      bytes: Number(manifest?.bytes ?? 0),
      transcripts: Number(manifest?.transcripts ?? 0),
    }
  }

  async _readCatalog() {
    const text = await readText(path.join(this._archiveDir(), 'catalog.jsonl'), '')
    const rows = []
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const row = JSON.parse(line)
        if (row?.id && row?.title) rows.push(row)
      } catch {
        // ignore a damaged line; the catalog is derived and can be re-imported
      }
    }
    return rows
  }

  async archiveSearch({ query = '', topic = '', limit = 12, deep = false } = {}) {
    await this.init()
    const needle = String(query).trim()
    if (needle.length < 1) return { query: needle, count: 0, results: [] }
    const terms = searchTerms(needle).map((term) => termVariants(term))
    if (terms.length === 0) return { query: needle, count: 0, results: [] }
    let rows = await this._readCatalog()
    if (topic) rows = rows.filter((row) => row.topic === topic)
    const candidates = []
    for (const row of rows) {
      const haystack = normalizeText(`${row.title}\n${row.topic ?? ''}\n${row.summary ?? ''}`)
      let matched = 0
      for (const variants of terms) if (variants.some((variant) => haystack.includes(variant))) matched += 1
      const sim = similarity(row.title, needle)
      candidates.push({ row, matched, sim, score: matched * 4 + sim * 3 + (row.chars ? Math.log10(row.chars) : 0) })
    }
    const results = []
    if (deep) {
      for (const candidate of candidates) {
        const row = candidate.row
        const file = safeJoin(this._archiveDir(), row.file ?? `txt/${row.id}.md`)
        const content = await readText(file, '')
        const lower = normalizeText(content)
        let at = -1
        for (const variants of terms) {
          for (const variant of variants) {
            const index = lower.indexOf(variant)
            if (index >= 0 && (at < 0 || index < at)) at = index
          }
        }
        if (at < 0) continue
        const start = Math.max(0, at - 80)
        results.push({
          source: 'archive',
          id: row.id,
          title: row.title,
          topic: row.topic ?? '',
          at: row.at ?? '',
          messages: row.messages ?? 0,
          chars: row.chars ?? 0,
          file: row.file ?? `txt/${row.id}.md`,
          snippet: oneLine(content.slice(start, start + 260), 260),
          score: candidate.matched * 4 + candidate.sim * 3 + 5,
        })
      }
      results.sort((a, b) => b.score - a.score)
      results.splice(clampInt(limit, 1, 50, 12))
    } else {
      for (const candidate of candidates.filter((item) => item.matched > 0 || item.sim >= 0.2).sort((a, b) => b.score - a.score).slice(0, 20)) {
        const row = candidate.row
        results.push({
          source: 'archive',
          id: row.id,
          title: row.title,
          topic: row.topic ?? '',
          at: row.at ?? '',
          messages: row.messages ?? 0,
          chars: row.chars ?? 0,
          file: row.file ?? `txt/${row.id}.md`,
          snippet: row.summary ? oneLine(row.summary, 260) : oneLine(row.title, 260),
          score: candidate.score,
        })
        if (results.length >= clampInt(limit, 1, 50, 12)) break
      }
    }
    return { query: needle, count: results.length, results }
  }

  async readArchive({ id } = {}) {
    await this.init()
    const rows = await this._readCatalog()
    const row = rows.find((item) => String(item.id).startsWith(String(id)))
    if (!row) throw new Error('档案会话不存在')
    const file = safeJoin(this._archiveDir(), row.file ?? `txt/${row.id}.md`)
    const content = await readText(file, '')
    return { ...row, content: content.slice(0, 30000), truncated: content.length > 30000 }
  }

  async search({ query = '', topic = '', limit = 12, includeArchive = true, deep = false } = {}) {
    await this.init()
    const needle = String(query).trim()
    if (needle.length < 1) return { query: needle, results: [] }
    const index = await this._readIndex()
    const topics = topic ? index.topics.filter((item) => item.id === topic) : index.topics
    const terms = searchTerms(needle).map((term) => termVariants(term))
    if (terms.length === 0) return { query: needle, results: [] }
    const results = []
    for (const item of topics) {
      const dir = this.topicDir(item.id)
      const entries = parseLog(await readText(path.join(dir, 'LOG.md'), '')).entries
      for (const entry of entries) {
        const haystack = normalizeText(`${entry.title}\n${entry.text}`)
        let matched = 0
        for (const variants of terms) if (variants.some((variant) => haystack.includes(variant))) matched += 1
        const sim = similarity(entry.text, needle)
        if (matched === 0 && sim < 0.18) continue
        results.push({
          topic: item.id,
          topicTitle: item.title,
          id: entry.id,
          kind: entry.kind,
          kindLabel: KIND_LABELS[entry.kind] ?? entry.kind,
          title: entry.title,
          snippet: oneLine(entry.text, 260),
          at: entry.at,
          status: entry.status,
          sensitivity: SENSITIVITIES.includes(entry.sensitivity) ? entry.sensitivity : item.sensitivity,
          score: (matched === 0 ? 0 : (matched / terms.length) * 6 + (matched === terms.length ? 2 : 0)) + sim * 4 + recencyScore(entry.at),
        })
      }
      const agents = parseAgents(await readText(path.join(dir, 'AGENTS.md'), ''))
      for (const section of AGENT_SECTIONS) {
        for (const line of bulletLines(agents.sections[section] ?? '')) {
          const haystack = normalizeText(line)
          let matched = 0
          for (const variants of terms) if (variants.some((variant) => haystack.includes(variant))) matched += 1
          if (matched === 0) continue
          results.push({
            topic: item.id,
            topicTitle: item.title,
            id: `agents-${shortHash(line, 8)}`,
            kind: 'summary',
            kindLabel: section,
            title: section,
            snippet: oneLine(line, 260),
            at: agents.meta.updated ?? '',
            status: 'current',
            score: 4 + matched + recencyScore(agents.meta.updated),
          })
        }
      }
    }
    results.sort((a, b) => b.score - a.score)
    const archive = includeArchive
      ? (await this.archiveSearch({ query: needle, topic, limit: 6, deep })).results
      : []
    return { query: needle, results: results.slice(0, clampInt(limit, 1, 50, 12)), archive }
  }

  async context({ query = '', budget, topics = [], recent = 0 } = {}) {
    await this.init()
    const maxChars = clampInt(budget ?? this.settings.injectBudget, 200, 8000, this.settings.injectBudget)
    const index = await this._readIndex()
    const master = parseMaster(await readText(this._p().master, ''))
    const totalEntries = index.topics.reduce((sum, item) => sum + Number(item.entries ?? 0), 0)
    const hasMaster = MASTER_SECTIONS.some((section) => String(master.sections[section] ?? '').trim())
    const archive = await this.archiveStats()
    if (!hasMaster && totalEntries === 0 && !archive.sessions) return { text: '', chars: 0, topics: index.topics.length, budget: maxChars }
    const lines = []
    lines.push('# 个人上下文')
    lines.push('')
    lines.push('来自用户自己的长期记忆文件。仅在相关时使用；与当前用户明确说法冲突时，以当前说法为准并提示更新。')
    lines.push('')
    lines.push('## 用户主文档（摘要）')
    for (const section of MASTER_SECTIONS) {
      const body = (master.sections[section] ?? '').trim()
      if (!body) continue
      lines.push(`### ${section}`)
      lines.push(oneLine(body.replace(/\n+/g, '；'), 360))
      lines.push('')
    }
    lines.push('## 主题索引')
    for (const topic of index.topics) {
      lines.push(`- ${topic.title} (id: ${topic.id}) · ${topic.entries ?? 0} 条 · 更新 ${String(topic.updated ?? '').slice(0, 10)}`)
    }
    lines.push('')
    const wanted = new Set(
      (Array.isArray(topics) ? topics : [])
        .map((item) => String(item ?? '').trim())
        .filter(Boolean),
    )
    if (wanted.size > 0) {
      lines.push('## 选定主题')
      for (const topic of index.topics.filter((item) => wanted.has(item.id))) {
        const parsed = parseAgents(await readText(path.join(this.topicDir(topic.id), 'AGENTS.md'), ''))
        lines.push(`### ${topic.title}`)
        for (const section of ['背景', '当前状态', '重要结论', '待解决']) {
          const body = String(parsed.sections[section] ?? '').trim()
          if (!body) continue
          lines.push(`- **${section}**：${oneLine(body.replace(/\n+/g, '；'), 260)}`)
        }
        lines.push('')
      }
    }
    if (Number(recent) > 0) {
      const picked = []
      for (const topic of index.topics) {
        const parsed = parseLog(await readText(path.join(this.topicDir(topic.id), 'LOG.md'), ''))
        for (const entry of parsed.entries) picked.push({ ...entry, topicTitle: topic.title })
      }
      picked.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      if (picked.length > 0) {
        lines.push('## 最近记录')
        for (const entry of picked.slice(0, Math.min(Number(recent), 30))) {
          lines.push(`- ${String(entry.at).slice(0, 10)} [${KIND_LABELS[entry.kind] ?? entry.kind}] ${entry.title}：${oneLine(entry.text, 160)}`)
        }
        lines.push('')
      }
    }
    if (query) {
      const found = await this.search({ query, limit: 6 })
      if (found.results.length > 0) {
        lines.push('## 与当前问题最相关的记录')
        for (const item of found.results) {
          lines.push(`- [${item.topicTitle}] ${String(item.at).slice(0, 10)} ${item.kindLabel}：${item.snippet}`)
        }
        lines.push('')
      }
    }
    if (archive.sessions > 0) {
      lines.push(`本地历史档案：${archive.sessions} 个历史会话、约 ${Math.round(archive.bytes / 1024 / 1024)} MB 原文可检索（personal_context action: archive）。`)
      lines.push('')
    }
    lines.push('需要更多细节时，调用 personal_context 工具（action: search / topic / context / archive）。')
    let text = lines.join('\n').trim()
    if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n…（已按预算截断）`
    return { text, chars: text.length, topics: index.topics.length, budget: maxChars }
  }

  /* --------------------------------------------------------------- merge */

  async merge({ topic = '', force = false } = {}) {
    await this.init()
    return this._locked(async () => {
      const index = await this._readIndex()
      const targets = topic ? index.topics.filter((item) => item.id === topic) : index.topics
      if (topic && targets.length === 0) throw new Error(`主题不存在：${topic}`)
      const merged = []
      const skipped = []
      for (const item of targets) {
        const logPath = path.join(this.topicDir(item.id), 'LOG.md')
        const logText = await readText(logPath, '')
        const logStamp = await fileStamp(logPath)
        const entries = parseLog(logText).entries
        if (!force && entries.length < this.settings.mergeThreshold) {
          skipped.push({ topic: item.id, entries: entries.length, threshold: this.settings.mergeThreshold })
          continue
        }
        if (entries.length === 0) {
          skipped.push({ topic: item.id, entries: 0, threshold: this.settings.mergeThreshold })
          continue
        }
        const dir = this.topicDir(item.id)
        await this._backupLocked(`merge-${item.id}`, ['INDEX.md', `topics/${item.id}/AGENTS.md`, `topics/${item.id}/LOG.md`, 'MASTER.md'])
        const seq = (await this._listDir(path.join(dir, 'archive'))).filter((name) => name.startsWith('LOG-')).length + 1
        const archiveName = `LOG-${localDay()}-${String(seq).padStart(2, '0')}.md`
        const header = `# ${item.title} · 归档日志 ${localDay()}\n\n> 合并归档，保留全部原始记录。\n\n`
        const archiveBody = entries.map((entry) => {
          return [`### [${entry.kind}] ${entry.title}`, '', entry.text, '', `记录时间：${entry.at}　来源：${entry.source || '—'}　性质：${KIND_LABELS[entry.kind] ?? entry.kind}`, '', '---', ''].join('\n')
        })
        await writeAtomic(path.join(dir, 'archive', archiveName), `${header}${archiveBody.join('\n')}`)

        const meta = await this._topicMeta(item.id)
        const agentsParsed = parseAgents(await readText(path.join(dir, 'AGENTS.md'), ''))
        const next = {
          ...meta,
          id: item.id,
          title: item.title,
          updated: new Date().toISOString(),
          mergedAt: new Date().toISOString(),
          archived: (meta.archived ?? 0) + entries.length,
          sensitivity: meta.sensitivity,
        }
        const sections = this._mergeSections(item, entries, agentsParsed.sections, archiveName)
        await writeAtomic(path.join(dir, 'AGENTS.md'), renderAgents(next, sections))
        await writeAtomicIfUnchanged(logPath, renderLogHeader(next), logStamp)
        await this._updateIndex(item.id, { entries: 0, archived: next.archived, keywords: this._keywords(entries, item.keywords) })
        merged.push({ topic: item.id, archived: entries.length, file: `topics/${item.id}/archive/${archiveName}` })
      }
      return { merged, skipped }
    })
  }

  _mergeSections(topic, entries, existing, archiveName) {
    const now = Date.now()
    const recent = entries.filter((entry) => now - Date.parse(entry.at) <= 120 * DAY)
    const format = (entry) => `- ${String(entry.at).slice(0, 10)} [${KIND_LABELS[entry.kind] ?? entry.kind}] ${oneLine(entry.text, 200)}`
    const take = (list, limit) => {
      const seen = new Set()
      const rows = []
      for (const entry of [...list].reverse()) {
        const key = normalizeText(entry.text).slice(0, 80)
        if (seen.has(key)) continue
        seen.add(key)
        rows.push(format(entry))
        if (rows.length >= limit) break
      }
      return rows.reverse()
    }

    const currentState = take(
      recent.filter((entry) => ['decision', 'preference', 'fact', 'question'].includes(entry.kind)),
      16,
    )
    const conclusions = take(entries.filter((entry) => entry.kind === 'decision'), 12)
    const open = take(entries.filter((entry) => entry.kind === 'question' && entry.status === 'open'), 10)
    const staleDecisions = entries.filter(
      (entry) => entry.kind === 'decision' && entry.status === 'current' && now - Date.parse(entry.at) > 180 * DAY,
    )
    const history = bulletLines(existing['历史'] ?? '').slice(-40)
    history.push(`- ${localDay()}：合并归档 ${entries.length} 条原始日志（archive/${archiveName}）`)
    for (const entry of staleDecisions.slice(0, 40)) {
      history.push(`- ${String(entry.at).slice(0, 10)} 历史决定：${oneLine(entry.text, 160)}`)
    }

    return {
      背景: (existing['背景'] ?? '').trim() || '（待补充：主题的范围、参与者与目标）',
      当前状态: currentState.length > 0 ? currentState.join('\n') : '（暂无近期记录）',
      重要结论: conclusions.length > 0 ? conclusions.join('\n') : '（暂无）',
      待解决: open.length > 0 ? open.join('\n') : '（暂无）',
      历史: history.join('\n'),
    }
  }

  /* --------------------------------------------------------------- audit */

  async audit() {
    await this.init()
    const index = await this._readIndex()
    const duplicateGroups = []
    const stale = []
    const conflicts = []
    const issues = []
    const all = []
    for (const topic of index.topics) {
      const dir = this.topicDir(topic.id)
      const entries = parseLog(await readText(path.join(dir, 'LOG.md'), '')).entries
      for (const entry of entries) all.push({ ...entry, topic: topic.id, topicTitle: topic.title })
      const seen = new Map()
      for (const entry of entries) {
        const key = entry.hash || shortHash(normalizeText(entry.text))
        if (seen.has(key)) duplicateGroups.push({ topic: topic.id, a: seen.get(key), b: entry })
        else seen.set(key, entry)
      }
      for (const entry of entries) {
        if (entry.status === 'current' && Date.now() - Date.parse(entry.at) > 180 * DAY) stale.push(entry)
      }
      const dirs = await this._listDir(this._p().topics)
      for (const id of dirs) {
        if (!index.topics.some((item) => item.id === id)) issues.push(`目录 ${id} 未登记在 INDEX`)
      }
      for (const item of index.topics) {
        if (!dirs.includes(item.id)) issues.push(`INDEX 中的 ${item.id} 没有对应目录`)
      }
    }
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        const a = all[i]
        const b = all[j]
        const sim = similarity(a.text, b.text)
        if (sim < 0.5) continue
        const na = /(不|没|无|未|停止|放弃|不再|never|not|no longer|stop)/.test(a.text)
        const nb = /(不|没|无|未|停止|放弃|不再|never|not|no longer|stop)/.test(b.text)
        if (na !== nb) conflicts.push({ a, b, sim })
        if (conflicts.length > 30) break
      }
    }
    const reportPath = this.file('reports', `audit-${localDay()}-${String(Date.now()).slice(-4)}.md`)
    const lines = [
      `# 记忆审计报告 ${localDay()}`,
      '',
      `- 主题：${index.topics.length}`,
      `- 当前日志条目：${all.length}`,
      `- 重复候选：${duplicateGroups.length}`,
      `- 超过 180 天仍标记为当前的条目：${stale.length}`,
      `- 可能冲突：${conflicts.length}`,
      `- 结构问题：${issues.length}`,
      '',
      '## 可能冲突（需用户确认，不自动改写）',
      '',
    ]
    for (const item of conflicts.slice(0, 20)) {
      lines.push(`- **${item.a.topicTitle}** / ${String(item.a.at).slice(0, 10)}：${oneLine(item.a.text, 160)}`)
      lines.push(`  - 对照 ${String(item.b.at).slice(0, 10)}：${oneLine(item.b.text, 160)}`)
    }
    if (conflicts.length === 0) lines.push('_未发现。_')
    lines.push('', '## 重复候选', '')
    for (const item of duplicateGroups.slice(0, 20)) lines.push(`- ${item.topic}：${oneLine(item.a.title, 80)}`)
    if (duplicateGroups.length === 0) lines.push('_未发现。_')
    lines.push('', '## 过期但未标记', '')
    for (const entry of stale.slice(0, 20)) lines.push(`- ${String(entry.at).slice(0, 10)} ${oneLine(entry.text, 140)}`)
    if (stale.length === 0) lines.push('_未发现。_')
    lines.push('', '## 结构问题', '')
    for (const issue of issues) lines.push(`- ${issue}`)
    if (issues.length === 0) lines.push('_未发现。_')
    await writeAtomic(reportPath, lines.join('\n'))
    return {
      report: path.relative(this.root, reportPath).replaceAll('\\', '/'),
      topics: index.topics.length,
      entries: all.length,
      duplicates: duplicateGroups.length,
      stale: stale.length,
      conflicts: conflicts.length,
      issues,
    }
  }

  async maybeAudit() {
    await this.init()
    if (!this.settings.autoAudit) return null
    const last = Date.parse(this.state.lastAuditAt ?? '')
    if (Number.isFinite(last) && Date.now() - last < 30 * DAY) return null
    const report = await this.audit()
    this.state.lastAuditAt = new Date().toISOString()
    await this._saveState()
    return report
  }

  /* ------------------------------------------------------------- backups */

  async _backupLocked(label, relPaths) {
    const stamp = compactStamp()
    const id = `${stamp}-${slugify(label)}-${shortHash(`${label}${Math.random()}`, 4)}`
    const dir = path.join(this._p().backups, id)
    const filesDir = path.join(dir, 'files')
    const copied = []
    for (const rel of relPaths) {
      const source = safeJoin(this.root, rel)
      if (!(await exists(source))) continue
      const target = path.join(filesDir, rel)
      await ensureDir(path.dirname(target))
      await fs.copyFile(source, target)
      copied.push(rel)
    }
    if (copied.length === 0) return null
    await writeJson(path.join(dir, 'meta.json'), { id, label, at: new Date().toISOString(), files: copied })
    await this._pruneBackups()
    return id
  }

  async _pruneBackups() {
    const root = this._p().backups
    const names = (await this._listDir(root)).filter((name) => !name.startsWith('.') && name !== 'summaries')
    const rows = []
    for (const name of names) {
      const meta = await readJson(path.join(root, name, 'meta.json'), null)
      if (meta) rows.push({ name, meta })
    }
    rows.sort((a, b) => String(a.meta.at).localeCompare(String(b.meta.at)))
    const keep = Math.max(1, Number(this.settings.retention) || 120)
    const cutoff = Date.now() - Math.max(1, Number(this.settings.retentionDays) || 180) * DAY
    const excess = Math.max(0, rows.length - keep)
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      const expired = Date.parse(row.meta.at) < cutoff
      const overCount = index < excess
      if (!expired && !overCount) continue
      try {
        await this._summarizeBackup(row)
        await fs.rm(path.join(root, row.name), { recursive: true, force: true })
      } catch (error) {
        await this._setError(error)
        // Keep the raw backup this round; it will be retried on the next save.
      }
    }
  }

  /** Permanent, deterministic digest written before an expired backup is deleted. */
  async _summarizeBackup({ name, meta }) {
    const dir = path.join(this._p().backups, name)
    const month = String(meta.at).slice(0, 7)
    const target = path.join(this._p().backups, 'summaries', `${month}.md`)
    const previous = await readText(target, '')
    if (previous.includes(`\`${meta.id ?? name}\``)) return
    const files = []
    let logLines = []
    for (const rel of meta.files ?? []) {
      const file = path.join(dir, 'files', rel)
      if (!(await exists(file))) continue
      const text = await readText(file, '')
      files.push(`- \`${rel}\` · ${text.length} 字符 · ${shortHash(text, 12)}`)
      if (rel.endsWith('LOG.md')) {
        const entries = parseLog(text).entries
        for (const entry of entries.slice(-60)) {
          logLines.push(`  - ${String(entry.at).slice(0, 10)} [${entry.kind}] ${oneLine(entry.title, 80)}（${entry.id}）`)
        }
      }
    }
    const header = previous.trim()
      ? ''
      : `# 备份二次总结 ${month}\n\n> 由插件自动生成。超过保留期或超出份数上限的原始备份已删除，此处保留可检索的二级摘要。\n\n`
    const block = [
      `## ${meta.at} · \`${meta.id ?? name}\``,
      `- 标签：${meta.label ?? '—'}`,
      `- 文件：${(meta.files ?? []).length} 个`,
      ...files,
      ...(logLines.length ? ['- 日志条目：', ...logLines] : []),
      '',
    ].join('\n')
    await ensureDir(path.dirname(target))
    await writeAtomic(target, `${previous}${header}${block}\n`)
  }

  async listBackups() {
    await this.init()
    const names = (await this._listDir(this._p().backups))
      .filter((name) => !name.startsWith('.') && name !== 'summaries')
      .reverse()
    const rows = []
    for (const name of names.slice(0, 100)) {
      const meta = await readJson(path.join(this._p().backups, name, 'meta.json'), null)
      if (meta) rows.push(meta)
    }
    return rows
  }

  async restoreBackup({ id } = {}) {
    await this.init()
    if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('备份 id 非法')
    return this._locked(async () => {
      const dir = path.join(this._p().backups, id)
      const meta = await readJson(path.join(dir, 'meta.json'), null)
      if (!meta) throw new Error('备份不存在')
      await this._backupLocked('pre-restore', meta.files)
      for (const rel of meta.files) {
        const source = path.join(dir, 'files', rel)
        if (!(await exists(source))) continue
        const target = safeJoin(this.root, rel)
        await ensureDir(path.dirname(target))
        await fs.copyFile(source, target)
      }
      return { restored: meta.files, from: id }
    })
  }

  /* --------------------------------------------------------- import/export */

  async exportAll() {
    await this.init()
    return this._locked(async () => {
      const stamp = compactStamp()
      const dest = path.join(this._p().exports, `personal-context-${stamp}`)
      await ensureDir(dest)
      let files = 0
      const walk = async (source, target, rel = '') => {
        await ensureDir(target)
        const rows = await fs.readdir(source, { withFileTypes: true })
        for (const row of rows) {
          if (rel === '' && row.name === 'exports') continue
          if (row.name === '.pc.lock') continue
          if (row.isSymbolicLink()) continue
          const nextRel = rel ? `${rel}/${row.name}` : row.name
          if (row.isDirectory()) await walk(path.join(source, row.name), path.join(target, row.name), nextRel)
          else if (row.isFile()) {
            await fs.copyFile(path.join(source, row.name), path.join(target, row.name))
            files += 1
          }
        }
      }
      await walk(this.root, dest)
      const index = await this._readIndex()
      await writeJson(path.join(dest, 'manifest.json'), {
        product: 'dsh-personal-context',
        version: VERSION,
        exportedAt: new Date().toISOString(),
        topics: index.topics.length,
        files,
      })
      return { path: dest, files }
    })
  }

  async importTree({ sourceDir } = {}) {
    await this.init()
    if (!sourceDir) throw new Error('缺少导入目录')
    const source = path.resolve(String(sourceDir))
    if (!(await exists(path.join(source, 'MASTER.md')))) throw new Error('导入目录缺少 MASTER.md')
    return this._locked(async () => {
      const dest = this.file('imports', `import-${compactStamp()}`)
      await ensureDir(dest)
      let files = 0
      const walk = async (from, to) => {
        await ensureDir(to)
        for (const row of await fs.readdir(from, { withFileTypes: true })) {
          if (row.isSymbolicLink()) continue
          if (row.isDirectory()) await walk(path.join(from, row.name), path.join(to, row.name))
          else if (row.isFile()) {
            await fs.copyFile(path.join(from, row.name), path.join(to, row.name))
            files += 1
          }
        }
      }
      await walk(source, dest)
      return { path: dest, files, hint: `将数据目录切换为 ${dest} 即可使用这份知识库` }
    })
  }

  /* -------------------------------------------------------------- editing */

  async _locateEntry(id) {
    const index = await this._readIndex()
    for (const item of index.topics) {
      const entries = parseLog(await readText(path.join(this.topicDir(item.id), 'LOG.md'), '')).entries
      const entry = entries.find((candidate) => candidate.id === id)
      if (entry) return { topic: item.id, entry }
    }
    return null
  }

  async deleteEntry({ topic, id, reason = '' } = {}) {
    await this.init()
    if (!id) throw new Error('记录不存在，或没有指定主题')
    return this._locked(async () => {
      const located = topic ? null : await this._locateEntry(id)
      const target = topic || located?.topic
      if (!target) return { deleted: id, alreadyGone: true }
      const dir = this.topicDir(target)
      const logPath = path.join(dir, 'LOG.md')
      const logText = await readText(logPath, '')
      const logStamp = await fileStamp(logPath)
      const parsed = parseLog(logText)
      const entry = parsed.entries.find((item) => item.id === id) || (located?.topic === target ? located.entry : null)
      if (!entry) return { deleted: id, alreadyGone: true }
      await this._backupLocked(`delete-${target}`, ['INDEX.md', `topics/${target}/LOG.md`, `topics/${target}/AGENTS.md`])
      const deletedPath = path.join(dir, 'archive', `deleted-${localDay()}-${String(Date.now()).slice(-4)}.md`)
      const block = renderDeletedArchive({ title: target }, [{ title: entry.title, text: `${entry.text}${reason ? `\n\n删除原因：${reason}` : ''}`, deletedAt: new Date().toISOString() }])
      await writeAtomic(deletedPath, block)
      parsed.entries = parsed.entries.filter((item) => item.id !== id)
      const meta = await this._topicMeta(target)
      await writeAtomicIfUnchanged(logPath, renderLog({ ...meta, title: meta.title }, parsed.entries), logStamp)
      await this._updateIndex(target, { entries: parsed.entries.length })
      return { deleted: id, archived: path.relative(this.root, deletedPath).replaceAll('\\', '/') }
    })
  }

  async updateEntry({ topic, id, text, kind, status, sensitivity } = {}) {
    await this.init()
    return this._locked(async () => {
      const located = topic ? null : await this._locateEntry(id)
      const target = topic || located?.topic
      if (!target) throw new Error('记录不存在，或没有指定主题')
      const logPath = path.join(this.topicDir(target), 'LOG.md')
      const logText = await readText(logPath, '')
      const logStamp = await fileStamp(logPath)
      const parsed = parseLog(logText)
      const entry = parsed.entries.find((item) => item.id === id) || (located?.topic === target ? located.entry : null)
      if (!entry) throw new Error('记录不存在')
      await this._backupLocked(`edit-${target}`, ['INDEX.md', `topics/${target}/LOG.md`])
      if (typeof text === 'string' && text.trim()) {
        entry.text = text.trim().slice(0, 8000)
        entry.title = oneLine(entry.text, 100)
        entry.hash = shortHash(normalizeText(entry.text))
      }
      if (KINDS.includes(kind)) {
        entry.kind = kind
        if (entry.status === 'open' && kind !== 'question') entry.status = 'current'
      }
      if (['current', 'open', 'superseded', 'archived'].includes(status)) entry.status = status
      if (SENSITIVITIES.includes(sensitivity)) entry.sensitivity = sensitivity
      entry.editedAt = new Date().toISOString()
      const meta = await this._topicMeta(target)
      await writeAtomicIfUnchanged(logPath, renderLog({ ...meta, title: meta.title }, parsed.entries), logStamp)
      return { updated: entry }
    })
  }

  /* ----------------------------------------------------------------- docs */

  async readDoc({ doc } = {}) {
    await this.init()
    const key = String(doc ?? '')
    if (key === 'master') return { doc: key, text: await readText(this._p().master, '') }
    if (key === 'index') return { doc: key, text: await readText(this._p().index, '') }
    if (key === 'readme') return { doc: key, text: await readText(this.file('README.md'), '') }
    const match = key.match(/^topic:([a-zA-Z0-9_-]+):(agents|log)$/)
    if (match) {
      const file = path.join(this.topicDir(match[1]), match[2] === 'agents' ? 'AGENTS.md' : 'LOG.md')
      return { doc: key, text: await readText(file, '') }
    }
    throw new Error('未知文档')
  }

  _keywords(entries, existing = []) {
    const counts = new Map()
    for (const entry of entries.slice(-120)) {
      for (const word of String(entry.text).match(/[A-Za-z][A-Za-z0-9_-]{2,20}|[\u4e00-\u9fa5]{2,8}/g) ?? []) {
        if (word.length < 2) continue
        counts.set(word, (counts.get(word) ?? 0) + 1)
      }
    }
    const merged = new Map(existing.map((word) => [word, 2]))
    for (const [word, count] of counts) merged.set(word, (merged.get(word) ?? 0) + count)
    return [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([word]) => word)
  }

  /* -------------------------------------------------------------- actions */

  async invoke(action, payload = {}, meta = {}) {
    if (
      meta.by === 'model' &&
      meta.sessionId &&
      SESSION_WRITE_ACTIONS.has(action) &&
      !(await this.isSessionCaptureEnabled(meta.sessionId))
    ) {
      throw new Error('本次会话已关闭记忆写入')
    }
    const result = await this._invoke(action, payload, meta)
    if (WRITE_ACTIONS.has(action)) await this._clearError()
    return result
  }

  async _invoke(action, payload = {}, meta = {}) {
    switch (action) {
      case 'status':
        return this.status()
      case 'overview':
        return this.overview()
      case 'topics':
        return this.listTopics()
      case 'topic':
        return this.getTopic(payload.id)
      case 'search':
        return this.search(payload)
      case 'archive':
        return this.archiveSearch(payload)
      case 'archive_doc':
        return this.readArchive(payload)
      case 'context':
        return this.context(payload)
      case 'save':
        return this.save(payload, meta)
      case 'update':
        return this.updateEntry(payload)
      case 'delete':
        return this.deleteEntry(payload)
      case 'merge':
        return this.merge(payload)
      case 'audit':
        return this.audit()
      case 'export':
        return this.exportAll()
      case 'import':
        return this.importTree(payload)
      case 'backups':
        return this.listBackups()
      case 'restore':
        return this.restoreBackup(payload)
      case 'settings':
        return this.getSettings()
      case 'configure':
        return this.updateSettings(payload)
      case 'pause':
        return this.updateSettings({ paused: true })
      case 'resume':
        return this.updateSettings({ paused: false })
      case 'doc':
        return this.readDoc(payload)
      case 'reindex':
        return this.reindex()
      default:
        throw new Error(`未知操作：${action}`)
    }
  }
}
