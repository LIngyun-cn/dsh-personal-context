/**
 * Host entry for dsh-personal-context.
 *
 * One service backs three front doors:
 *   - the `/personal-context` session command used by the sidebar panel,
 *   - the `personal_context` tool used by the model,
 *   - a background listener that captures durable user statements per turn.
 */
import { PersonalContextService } from './lib/service.js'
import { randomId } from './lib/fsx.js'

export const name = 'personal-context'
export const inject = ['tools', 'systemPrompt', 'commands', 'webServer']

const TOOL_NAME = 'personal_context'
const COMMAND_NAME = 'personal-context'
const SESSION_API = '/personal-context/session'
const SESSION_CLIENT = 'dsh-personal-context'

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text ? JSON.parse(text) : {})
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

const ACTIONS = [
  'status',
  'overview',
  'context',
  'search',
  'archive',
  'archive_doc',
  'topics',
  'topic',
  'save',
  'update',
  'delete',
  'merge',
  'audit',
  'export',
  'backups',
  'restore',
  'doc',
  'reindex',
  'configure',
  'pause',
  'resume',
]

const PROMPT = [
  '## 个人上下文（personal_context 工具）',
  '',
  '用户的长期上下文保存在本机 Markdown 文件中，可通过 `personal_context` 工具读取与维护。',
  '',
  '- 在回答涉及用户背景、偏好、既有决定、项目历史的问题前，先用 `search` 或 `context` 检索；不要凭空猜测。',
  '- 如果用户在新会话时选择了「不导入任何上下文」或只选部分主题，遵从该选择；不要主动检索或补全未选择的主题（用户明确要求时除外）。',
  '- 当记忆里没有答案、但问题涉及较久以前的具体经历时，用 `archive` 检索本地历史会话档案；命中后可用 `archive_doc` 读取原文。',
  '- 对话中出现长期有价值的新事实、决定、偏好、目标或项目进展时，主动调用 `save`。`text` 用简洁的第三人称陈述，保留日期与来源；一次最多 1～2 条。',
  '- 严格区分性质：用户明确说的用 `fact`；用户偏好用 `preference`；用户明确做出的选择用 `decision`；你的推断只能用 `inference`，绝不能写成 `fact`。不确定是否长期有效时用 `question` 或先不记。',
  '- 不保存闲聊、临时情绪、一次性任务细节、密码、密钥、验证码、身份证或银行卡信息。',
  '- 新旧信息冲突时不要覆盖旧记录：保存新记录并在文本中说明“此前为……”，或向用户确认。',
  '- 工具报错时必须明确告诉用户“未保存成功”，不得假装已记录。',
].join('\n')

function textOfBlocks(data) {
  const blocks = Array.isArray(data?.content) ? data.content : []
  return blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

function parseCommandInput(rawInput) {
  const value = String(rawInput ?? '').trim()
  if (!value) return { action: 'status' }
  if (value.startsWith('{')) {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') throw new Error('参数必须是 JSON 对象')
    return parsed
  }
  const [action, ...rest] = value.split(/\s+/)
  const restText = rest.join(' ').trim()
  if (action === 'save' || action === 'update') return { action, text: restText }
  if (action === 'archive_doc') return { action, id: restText }
  return { action, query: restText }
}

export function apply(ctx, config = {}) {
  const service = new PersonalContextService(config)
  const ready = service.init().catch(async (error) => {
    await service._setError(error).catch(() => {})
    throw error
  })

  const safe = async (fn) => {
    try {
      return await fn()
    } catch (error) {
      await service._setError(error).catch(() => {})
      throw error
    }
  }

  const sessionPrompts = new Map()
  const promptKey = (sessionId) => String(sessionId ?? '').trim().replace(/^session-/, '')

  async function buildSessionPrompt(choice) {
    const settings = await service.getSettings()
    if (!settings.autoInject) return ''
    if (choice?.mode === 'none') return ''
    const options = { budget: settings.injectBudget }
    if (choice?.mode === 'topics' && Array.isArray(choice.topics) && choice.topics.length) {
      options.topics = choice.topics
    } else if (choice?.mode === 'recent') {
      options.recent = 12
    }
    const context = await service.context(options)
    if (!context.text) return ''
    return `<personal-context note="本次会话按用户选择加载的长期记忆，可能过期；与用户当前说法冲突时以当前说法为准">\n${context.text}\n</personal-context>`
  }

  ctx.effect(() => {
    void ready
      .then(() => service.maybeAudit())
      .catch((error) => service._setError(error).catch(() => {}))
    return () => {}
  })

  /* ------------------------------------------------ pre-session context API */

  const web = ctx.webServer
  if (web && typeof web.register === 'function') {
    ctx.effect(
      () =>
        web.register({
          kind: 'exact',
          path: SESSION_API,
          handler: async (req, res) => {
            try {
              if (req.headers['x-pc-client'] !== SESSION_CLIENT) {
                sendJson(res, 403, { ok: false, error: 'forbidden' })
                return
              }
              const origin = req.headers.origin
              if (origin) {
                const expected = new URL(web.getOrigin?.() ?? 'http://127.0.0.1').origin
                if (new URL(origin).origin !== expected) {
                  sendJson(res, 403, { ok: false, error: 'cross-origin request refused' })
                  return
                }
              }
              const url = new URL(req.url, 'http://127.0.0.1')
              if (req.method === 'GET') {
                const sessionId = url.searchParams.get('sessionId') ?? ''
                const [choice, index] = await Promise.all([service.getSessionChoice(sessionId), service.listTopics()])
                sendJson(res, 200, {
                  ok: true,
                  choice,
                  defaultMode: 'summary',
                  topics: index.topics.map((item) => ({
                    id: item.id,
                    title: item.title,
                    entries: item.entries ?? 0,
                  })),
                })
                return
              }
              if (req.method !== 'POST') {
                sendJson(res, 405, { ok: false, error: 'method not allowed' })
                return
              }
              const body = await readJsonBody(req)
              const choice = await service.setSessionChoice(body)
              const record = sessionPrompts.get(promptKey(body.sessionId))
              if (record) {
                record.rev = (record.rev ?? 0) + 1
                const rev = record.rev
                const text = await buildSessionPrompt(choice)
                if (record.rev === rev) record.text = text
                record.active = true
              }
              sendJson(res, 200, { ok: true, choice })
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              sendJson(res, 400, { ok: false, error: message })
            }
          },
        }),
      'personal-context session api',
    )
  }

  ctx.systemPrompt.section({
    name: 'personal-context',
    order: 40,
    text: () => PROMPT,
  })

  ctx.tools.register({
    name: TOOL_NAME,
    description:
      '读取或维护用户的长期个人上下文（背景、偏好、决定、项目历史）。先用 search/context 检索，再回答；记忆不够时用 archive 检索本地历史会话档案；出现长期有价值的信息时用 save 保存。不要保存秘密或闲聊。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ACTIONS, description: '操作类型' },
        query: { type: 'string', description: 'search/context/archive 的检索词' },
        id: { type: 'string', description: 'topic/update/delete/archive_doc 使用的主题 id、记录 id 或会话 id 前缀' },
        topic: { type: 'string', description: '主题 id；save 时可省略' },
        text: { type: 'string', description: 'save/update 的记录正文' },
        title: { type: 'string', description: '可选短标题' },
        kind: {
          type: 'string',
          enum: ['fact', 'preference', 'opinion', 'decision', 'idea', 'question', 'inference'],
          description: '记录性质；推测只能使用 inference',
        },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        status: { type: 'string', enum: ['current', 'open'], description: 'question 默认 open，其余默认 current' },
        sensitivity: {
          type: 'string',
          enum: ['normal', 'important', 'sensitive'],
          description: '敏感度标记；省略时继承主题。只影响展示，不改变注入行为',
        },
        createTopicTitle: { type: 'string', description: '主题不存在时用它创建新主题' },
        force: { type: 'boolean', description: 'merge 时忽略阈值' },
        limit: { type: 'number', description: 'search/archive 返回条数' },
        deep: { type: 'boolean', description: 'archive：同时全文检索历史会话原文（较慢）' },
        doc: { type: 'string', description: 'doc：master/index/readme/topic:<id>:agents|log' },
        budget: { type: 'number', description: 'context 的字符预算' },
        injectBudget: { type: 'number', description: 'configure：每次自动注入的字符预算（200-8000）' },
        mergeThreshold: { type: 'number', description: 'configure：日志条目达到多少条时建议合并（5-500）' },
        retention: { type: 'number', description: 'configure：原始备份保留份数上限（20-500）' },
        retentionDays: { type: 'number', description: 'configure：原始备份精确保留天数（30-3650），过期转为二级摘要' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const text = JSON.stringify(value, null, 2)
        return [{ type: 'text', text: text.length > 16000 ? `${text.slice(0, 16000)}\n…（截断）` : text }]
      },
    },
    execute: async (args) => {
      const { action, ...payload } = args ?? {}
      return safe(() => service.invoke(action, payload, { by: 'model' }))
    },
  })

  ctx.commands.register({
    name: COMMAND_NAME,
    description: '查看或维护个人上下文记忆（供侧栏面板使用）',
    input: { hint: '{"action":"status"}' },
    handler: async ({ agent, rawInput }) => {
      try {
        const payload = parseCommandInput(rawInput)
        const action = payload.action ?? 'status'
        delete payload.action
        const result = await service.invoke(action, payload, {
          by: 'user',
          sessionId: agent?.session?.id ?? '',
          workspace: agent?.session?.cwd ?? agent?.session?.header?.cwd ?? '',
        })
        return { kind: 'success', text: JSON.stringify({ ok: true, result }) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await service._setError(error).catch(() => {})
        return { kind: 'error', text: JSON.stringify({ ok: false, error: message }) }
      }
    },
  })

  /* -------------------------------------------------- background capture */

  const pending = new Map()
  const subagentSessions = new Set()

  const queueFor = (sessionId) => {
    if (!pending.has(sessionId)) pending.set(sessionId, [])
    return pending.get(sessionId)
  }

  const flush = async (sessionId, turn, workspace) => {
    const list = pending.get(sessionId)
    if (!list || list.length === 0) return
    pending.delete(sessionId)
    const text = list.join('\n')
    if (text.trim().length < 6) return
    try {
      await service.captureFromMessage({ text, sessionId, turn, workspace })
    } catch (error) {
      await service._setError(error).catch(() => {})
    }
  }

  ctx.on('session/event', (session, event) => {
    const sessionId = session?.id ?? ''
    if (!sessionId) return
    if (subagentSessions.has(sessionId)) return
    if (event?.type === 'user/message') {
      const data = event.data ?? {}
      const source = data.source?.kind
      if (source && source !== 'user') return
      if (!source && data.role && data.role !== 'user') return
      const text = textOfBlocks(data)
      if (!text || text.startsWith('/')) return
      queueFor(sessionId).push(text)
      return
    }
    if (event?.type === 'turn/end') {
      const turn = Number(event.data?.turn ?? 0)
      const workspace = typeof session.cwd === 'string' ? session.cwd : ''
      void flush(sessionId, turn, workspace)
    }
  })

  /* --------------------------------------------------- context injection */

  ctx.on('agent/created', (payload) => {
    const agent = payload?.agent ?? payload
    const source = payload?.source
    if (!agent) return
    if (source === 'subagent') {
      const sid = agent.session?.id
      if (sid) {
        subagentSessions.add(sid)
        if (subagentSessions.size > 500) {
          const oldest = subagentSessions.values().next().value
          subagentSessions.delete(oldest)
        }
      }
      return
    }
    const sessionId = agent.session?.id ?? ''
    if (!sessionId) return
    const key = promptKey(sessionId)
    const record = { active: true, text: '' }
    sessionPrompts.set(key, record)
    if (sessionPrompts.size > 200) {
      const oldest = sessionPrompts.keys().next().value
      sessionPrompts.delete(oldest)
    }
    let sectionReady = false
    try {
      agent.ctx.effect(() =>
        agent.ctx.systemPrompt.section({
          name: 'personal-context:session',
          order: 41,
          text: () => (record.active ? record.text : ''),
        }),
      )
      sectionReady = true
    } catch (error) {
      void service._setError(error).catch(() => {})
    }
    void ready
      .then(async () => {
        const choice = await service.getSessionChoice(sessionId)
        const rev = record.rev ?? 0
        const text = await buildSessionPrompt(choice)
        if (record.rev === rev) record.text = text
        if (!record.text) return
        service.state.injected = Number(service.state.injected ?? 0) + 1
        await service._saveState().catch(() => {})
        if (!sectionReady && typeof agent.inject === 'function') {
          agent.inject({
            id: randomId('msg'),
            role: 'user',
            content: [{ type: 'text', text: record.text }],
            source: { kind: 'personal-context' },
          })
        }
      })
      .catch((error) => service._setError(error).catch(() => {}))
  })

  return service
}
