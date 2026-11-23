/** Deterministic, dependency-free extraction of durable user statements. */

const EXPLICIT = /(记住|记一下|记下来|记下|别忘了|别忘记|remember that|remember this|please remember|note that|keep in mind)/i
const SENSITIVE = /(密码|口令|password|passwd|api[\s_-]?key|secret|access[\s_-]?token|私钥|身份证|银行卡|信用卡|验证码|cvv|手机号|护照号)/i
const NEGATIVE = /(不要(记住|记录|保存|记)|别(记住|记录|保存|记)|不用记|无需记|忘记这(件|条|个)|删除(这条|记忆)|forget (this|that)|do not (remember|save) (this|that))/i
const QUESTION = /[?？]\s*$|^(怎么|如何|为什么|为何|是否|能否|可不可以|什么时候|哪里|谁)/
const TRANSIENT = /(作业|考试|测验|题目|这道题|这个题|帮我|帮忙|写一下|写个|翻译|总结一下|生成|解释一下|今天|明天|今晚|本周|这次|现在|刚刚)/i

const CUES = [
  {
    kind: 'preference',
    score: 3,
    pattern: /(我(更|最)?(喜欢|偏好|偏爱|习惯|通常|总是|一般|不喜欢|讨厌|倾向于|常用|爱用)|我的(习惯|偏好|风格|原则)|my preference|i prefer|i usually|i always|i hate|i like|i tend to)/i,
  },
  {
    kind: 'decision',
    score: 3,
    pattern: /(我(已经)?(决定|确定|选择|选定|采用|改用|放弃|不再|从此|以后都|打算用|要求|规定)|我们(决定|确定|选择|采用)|we decided|i decided|i(?:'| a)m going with|from now on|going forward|i will use|i won't use)/i,
  },
  {
    kind: 'opinion',
    score: 2,
    pattern: /(我(认为|觉得|相信|判断|的看法|的观点|感觉)|在我看来|in my (view|opinion)|i think|i believe|i feel)/i,
  },
  {
    kind: 'idea',
    score: 2,
    pattern: /(我的?(目标|计划|打算|希望|想要|愿景|长期方向)|我准备|我考虑|待办|下一步|里程碑|deadline|截止日期|my goal|i plan to|i want to|i hope to|next step)/i,
  },
  {
    kind: 'question',
    score: 2,
    pattern: /(待解决|尚未解决|还没想好|需要确认|待确认|open question|todo|tbd|不确定是否)/i,
  },
  {
    kind: 'fact',
    score: 2,
    pattern: /(我叫|我的名字|我住|我来自|我的(工作|职业|项目|团队|公司|设备|系统|环境)|毕业于|位于|版本是|数据是)/i,
  },
  {
    kind: 'fact',
    score: 1,
    pattern: /(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}|\d{1,3}%|\d+(\.\d+)?\s*(个|条|次|人|天|周|月|年|GB|MB|KB|ms|s|分钟|小时))/i,
  },
]

const MAX_SEGMENTS = 8
const MAX_CANDIDATES = 3

function stripNoise(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitSegments(text) {
  const lines = String(text ?? '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
  const segments = []
  for (const line of lines) {
    for (const part of line.split(/(?<=[。！；;!?])\s*/)) {
      const value = part.trim()
      if (value) segments.push(value)
    }
  }
  return segments.slice(0, MAX_SEGMENTS)
}

function cleanExplicit(segment) {
  return segment
    .replace(/^(请|麻烦)?\s*(记住|记一下|记下来|记下|别忘了|别忘记|remember that|remember this|please remember|note that|keep in mind)[：:，,\s-]*/i, '')
    .trim()
}

function classify(segment) {
  for (const cue of CUES) {
    if (cue.pattern.test(segment)) return { kind: cue.kind, score: cue.score }
  }
  return { kind: 'fact', score: 0 }
}

/**
 * Extract at most three durable statements from one user message.
 * Questions, code, secrets and pleasantries are ignored; only the user's own
 * words are ever candidates, never assistant prose.
 */
export function extractCandidates(rawText, options = {}) {
  const minScore = Number.isFinite(options.minScore) ? options.minScore : 2
  const text = stripNoise(rawText)
  if (text.length < 6) return []
  if (SENSITIVE.test(text)) return []
  if (NEGATIVE.test(text)) return []
  if (/^```/.test(String(rawText ?? '').trim())) return []

  const explicitAll = EXPLICIT.test(text)
  const results = []
  for (const original of splitSegments(text)) {
    let segment = original.trim()
    if (segment.length < 8 || segment.length > 800) continue
    const explicit = EXPLICIT.test(segment)
    if (explicit) segment = cleanExplicit(segment)
    if (segment.length < 6) continue
    if (QUESTION.test(segment) && !explicit) continue
    if (/^(你好|您好|谢谢|多谢|再见|早上好|晚上好|hi|hello|thanks|thank you|ok|okay|嗯|好的)[!！。.\s]*$/i.test(segment)) continue

    const cue = classify(segment)
    const score = explicit ? Math.max(cue.score, 8) : cue.score
    if (score < minScore) continue
    if (!explicit && cue.score <= 2 && TRANSIENT.test(segment)) continue
    if (SENSITIVE.test(segment)) continue

    results.push({
      text: segment,
      title: segment.length > 60 ? `${segment.slice(0, 59)}…` : segment,
      kind: explicit && cue.score === 0 ? 'fact' : cue.kind,
      score,
      confidence: explicit || score >= 4 ? 'high' : 'medium',
      explicit,
    })
    if (results.length >= MAX_CANDIDATES * 2) break
  }

  const deduped = []
  for (const candidate of results) {
    const duplicate = deduped.some((existing) => {
      const a = existing.text.toLowerCase()
      const b = candidate.text.toLowerCase()
      return a === b || a.includes(b) || b.includes(a)
    })
    if (!duplicate) deduped.push(candidate)
    if (deduped.length >= MAX_CANDIDATES) break
  }
  return deduped
}

export function looksProfileFact(text) {
  return /(我叫|我的名字|我在.+工作|我住|我来自|毕业于|我的职业|我的工作)/.test(String(text ?? ''))
}

export function looksThinkingHabit(text) {
  return /(我(通常|习惯|倾向|喜欢|讨厌|重视|优先|总是|一般)|我的原则|我倾向)/.test(String(text ?? ''))
}
