/**
 * Human-readable Markdown document protocol.
 *
 * Every machine field lives in a single-line JSON HTML comment, so the files
 * stay comfortable to read and edit by hand while remaining reliably parseable.
 */

export const DOC_VERSION = 1
export const MASTER_SECTIONS = ['个人背景', '思考与决策习惯', '长期目标', '交流偏好', '其他稳定信息']
export const AGENT_SECTIONS = ['背景', '当前状态', '重要结论', '待解决', '历史']
export const KINDS = ['fact', 'preference', 'opinion', 'decision', 'idea', 'question', 'inference']

export const KIND_LABELS = {
  fact: '事实',
  preference: '偏好',
  opinion: '观点',
  decision: '决定',
  idea: '想法',
  question: '待解决',
  inference: '推测',
}

export const SENSITIVITIES = ['normal', 'important', 'sensitive']
export const SENSITIVITY_LABELS = {
  normal: '普通',
  important: '重要',
  sensitive: '敏感',
}

const MASTER_MARKER = 'pc:master'
const INDEX_MARKER = 'pc:index'
const TOPIC_MARKER = 'pc:topic'
const LOG_MARKER = 'pc:log'

function marker(name, value) {
  return `<!-- ${name} ${JSON.stringify(value)} -->`
}

function metaOf(text, name) {
  const pattern = new RegExp(`<!-- ${name} (\\{[\\s\\S]*?\\}) -->`)
  const match = String(text ?? '').match(pattern)
  if (!match) return undefined
  try {
    return JSON.parse(match[1])
  } catch {
    return undefined
  }
}

export function parseMaster(text) {
  return {
    meta: metaOf(text, MASTER_MARKER) ?? {},
    sections: parseSections(text),
  }
}

export function renderMaster(meta, sections) {
  const body = MASTER_SECTIONS
    .map((name) => `## ${name}\n\n${(sections[name] ?? '').trim()}\n`)
    .join('\n')
  return [
    '# 用户主文档',
    '',
    '> 记录相对稳定的个人背景、思考与决策习惯、长期目标和交流偏好。',
    '> 本文件只做有依据的追加，不因新信息覆盖旧记录；由「个人上下文」插件自动维护，也可手工编辑。',
    '',
    marker(MASTER_MARKER, { version: DOC_VERSION, updated: meta.updated ?? new Date().toISOString() }),
    '',
    body,
  ].join('\n')
}

export function parseAgents(text) {
  return {
    meta: metaOf(text, TOPIC_MARKER) ?? {},
    sections: parseSections(text),
  }
}

export function renderAgents(topic, sections) {
  const body = AGENT_SECTIONS
    .map((name) => `## ${name}\n\n${(sections[name] ?? '').trim()}\n`)
    .join('\n')
  return [
    `# ${topic.title}`,
    '',
    '> 本主题的稳定概述：背景、当前状态、重要结论与待解决事项。',
    '> 日常变化追加到 `LOG.md`；合并时由插件归纳更新本文件，历史仍保留在日志与归档中。',
    '',
    marker(TOPIC_MARKER, {
      version: DOC_VERSION,
      id: topic.id,
      title: topic.title,
      workspace: topic.workspace ?? '',
      created: topic.created ?? new Date().toISOString(),
      updated: topic.updated ?? new Date().toISOString(),
      mergedAt: topic.mergedAt ?? '',
      archived: topic.archived ?? 0,
      sensitivity: SENSITIVITIES.includes(topic.sensitivity) ? topic.sensitivity : 'normal',
    }),
    '',
    body,
  ].join('\n')
}

export function parseIndex(text) {
  return metaOf(text, INDEX_MARKER) ?? { version: DOC_VERSION, topics: [] }
}

export function renderIndex(meta, topics) {
  const lines = [
    '# 主题索引',
    '',
    '> 所有主题的检索入口。机器可读字段位于下方注释中，请勿手工删除。',
    '',
    marker(INDEX_MARKER, { version: DOC_VERSION, updated: meta.updated ?? new Date().toISOString(), topics }),
    '',
    '## 主题',
    '',
  ]
  if (topics.length === 0) {
    lines.push('_尚无主题。_', '')
  }
  for (const topic of topics) {
    lines.push(
      `### ${topic.title}`,
      '',
      `- id：\`${topic.id}\``,
      `- 路径：\`topics/${topic.id}/\``,
      `- 条目：${topic.entries ?? 0}（已归档 ${topic.archived ?? 0}）`,
      `- 敏感度：${SENSITIVITY_LABELS[topic.sensitivity] ?? SENSITIVITY_LABELS.normal}`,
      `- 更新：${topic.updated ?? ''}`,
      `- 关键词：${(topic.keywords ?? []).join('、') || '—'}`,
      '',
    )
  }
  return lines.join('\n')
}

export function parseLog(text) {
  const entries = []
  const logMeta = metaOf(text, LOG_MARKER) ?? {}
  const chunks = String(text ?? '').split(/\n(?=### \[)/)
  for (const chunk of chunks) {
    if (!chunk.startsWith('### [')) continue
    const meta = metaOf(chunk, 'pc:entry')
    if (!meta) continue
    const heading = chunk.match(/^### \[([a-z]+)\]\s*(.*)\n([\s\S]*?)(?=<!-- pc:entry|$)/)
    if (!heading) continue
    const body = heading[3].replace(/\n+$/, '').trim()
    entries.push({
      id: meta.id,
      kind: meta.kind ?? heading[1],
      title: meta.title ?? heading[2].trim(),
      text: body.length > 0 ? body : meta.title ?? heading[2].trim(),
      at: meta.at ?? new Date().toISOString(),
      source: meta.source ?? '',
      by: meta.by ?? 'unknown',
      confidence: meta.confidence ?? 'medium',
      status: meta.status ?? 'current',
      sensitivity: meta.sensitivity ?? '',
      hash: meta.hash ?? '',
    })
  }
  return { meta: logMeta, entries }
}

export function renderLog(topic, entries) {
  const lines = [
    `# ${topic.title} · 动态日志`,
    '',
    '> 按时间追加；每条记录都带日期、性质与来源。合并后旧日志移入 `archive/`。',
    '',
    marker(LOG_MARKER, { version: DOC_VERSION, topic: topic.id, updated: new Date().toISOString() }),
    '',
  ]
  let lastDay = ''
  for (const entry of entries) {
    const day = String(entry.at ?? '').slice(0, 10)
    if (day !== lastDay) {
      lines.push(`## ${day}`, '')
      lastDay = day
    }
    lines.push(
      `### [${entry.kind}] ${oneLine(entry.title)}`,
      '',
      sanitizeBody(entry.text),
      '',
      marker('pc:entry', {
        id: entry.id,
        kind: entry.kind,
        title: oneLine(entry.title),
        at: entry.at,
        source: entry.source ?? '',
        by: entry.by ?? 'unknown',
        confidence: entry.confidence ?? 'medium',
        status: entry.status ?? 'current',
        ...(entry.sensitivity ? { sensitivity: entry.sensitivity } : {}),
        hash: entry.hash ?? '',
      }),
      '',
    )
  }
  return `${lines.join('\n').trimEnd()}\n`
}

export function renderLogHeader(topic) {
  return [
    `# ${topic.title} · 动态日志`,
    '',
    '> 按时间追加的新事实、新决定和重要变化。',
    '',
    marker(LOG_MARKER, { version: DOC_VERSION, topic: topic.id, updated: new Date().toISOString() }),
    '',
  ].join('\n')
}

export function renderDeletedArchive(topic, deleted) {
  const lines = [
    `# ${topic.title} · 已删除记录`,
    '',
    '> 用户主动删除的条目保留在此处，避免误删造成信息不可恢复。',
    '',
  ]
  for (const item of deleted) {
    lines.push(
      `### ${oneLine(item.title)}`,
      '',
      `删除时间：${item.deletedAt}`,
      '',
      sanitizeBody(item.text),
      '',
      '---',
      '',
    )
  }
  return lines.join('\n')
}

export function parseSections(text) {
  const sections = {}
  const pattern = /^## (.+)$/gm
  const matches = [...String(text ?? '').matchAll(pattern)]
  for (let i = 0; i < matches.length; i += 1) {
    const name = matches[i][1].trim()
    const start = matches[i].index + matches[i][0].length
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length
    sections[name] = text.slice(start, end).trim()
  }
  return sections
}

export function appendBullet(sectionText, line) {
  const body = String(sectionText ?? '').trim()
  if (!body) return `- ${line}`
  return `${body}\n- ${line}`
}

export function oneLine(text, limit = 120) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}

export function sanitizeBody(text) {
  return String(text ?? '')
    .replaceAll('-->', '—>')
    .replace(/<!--\s*pc:entry/g, '<! -- pc:entry')
    .trim()
}

export function bulletLines(sectionText) {
  return String(sectionText ?? '')
    .split('\n')
    .map((line) => line.replace(/^-\s*/, '').trim())
    .filter(Boolean)
}
