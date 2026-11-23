/**
 * Web client for dsh-personal-context.
 *
 * The panel is a normal sidebar entry; every action goes through the
 * `/personal-context` session command so the UI and the model share one host
 * implementation. No client dependency beyond React.
 */
window.__ModuleLoader__.load({
  id: 'dsh-personal-context',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const NS = 'personal-context'
    const COMMAND = 'personal-context'
    const SESSION_URL = '/personal-context/session'
    const SESSION_CLIENT = 'dsh-personal-context'

    const ZH = {
      panel: '个人上下文',
      overview: '总览',
      topics: '主题',
      search: '搜索',
      settings: '设置',
      refresh: '刷新',
      paused: '已暂停',
      active: '记录中',
      pause: '暂停记录',
      resume: '恢复记录',
      topicsCount: '主题',
      entries: '当前记录',
      backupsCount: '备份',
      pendingMerge: '待整理',
      recent: '最近记录',
      noEntries: '还没有记录。正常对话即可，或在上方手动添加一条。',
      quickAdd: '记一条',
      addPlaceholder: '要长期记住的事实、决定或偏好……',
      kind: '性质',
      topicOptional: '主题（可留空）',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      merge: '整理',
      mergeAll: '整理所有达标主题',
      audit: '审计',
      export: '导出',
      exportDone: '已导出到',
      dataDir: '数据目录',
      threshold: '合并阈值（条）',
      injectBudget: '注入预算（字符）',
      retention: '备份保留份数',
      retentionDays: '原始备份保留天数',
      minScore: '自动捕获灵敏度',
      autoCapture: '自动捕获',
      autoInject: '新会话自动注入摘要',
      autoMerge: '达到阈值自动整理',
      autoAudit: '每 30 天自动审计',
      sensNote: '敏感度只影响面板标记，不改变自动注入行为。',
      saveSettings: '保存设置',
      settingsSaved: '设置已保存',
      backup: '备份',
      restore: '恢复',
      restoreConfirm: '恢复该备份会覆盖当前文档，继续？',
      restored: '已恢复',
      mergeDone: '已归档',
      mergeSkipped: '未达到阈值，已跳过',
      auditDone: '审计完成',
      searchPlaceholder: '搜索事实、决定、主题或历史……',
      searchEmpty: '没有找到相关记录。',
      results: '搜索结果',
      archive: '档案',
      archivePlaceholder: '搜索 640 个历史会话的标题或主题……',
      archiveEmpty: '没有找到历史会话。',
      archiveHint: '这是本地历史会话的全文档案。需要找具体细节时勾选“全文检索”，会扫描原文，稍慢。',
      deepSearch: '全文检索',
      archiveCount: '历史会话',
      archiveOpen: '读原文',
      archiveBack: '返回档案',
      archiveDoc: '会话原文',
      archiveTruncated: '（仅显示前 30,000 字）',
      openTopic: '打开主题',
      back: '返回',
      agents: '稳定概述',
      log: '动态日志',
      delete: '删除',
      deleteConfirm: '删除这条记录？原文会保留在 archive 中。',
      deleted: '已删除，原文已归档',
      edit: '编辑',
      editPrompt: '修改这条记录：',
      importPath: '从目录导入',
      import: '导入副本',
      importDone: '已导入到',
      mergeTopic: '整理该主题',
      forceMerge: '强制整理',
      noSession: '请先打开一个对话，面板通过会话命令访问记忆。',
      ctxHero: '记忆',
      ctxTitle: '本次会话加载哪些记忆？',
      ctxSubtitle: '先选择要带入对话的长期上下文；点「不导入」可完全跳过。不选择时默认加载主文档摘要。',
      ctxNone: '不导入任何上下文',
      ctxNoneHint: '本会话完全不注入长期记忆，也不会用摘要兜底；之后仍可在侧栏手动查看。',
      ctxCapture: '不记录',
      ctxCaptureActive: '不记录中',
      ctxCaptureOff: '不记录任何新记忆',
      ctxCaptureTitle: '本次会话记录',
      ctxCaptureSubtitle: '控制本会话是否把新信息写入长期记忆；与「加载哪些记忆」互不影响。',
      ctxCaptureOn: '记录新记忆',
      ctxCaptureOnHint: '自动捕获和模型工具写入正常；已有记忆仍可读取。',
      ctxCaptureOffHint: '自动捕获和模型写入停止；已有记录不会被删除。',
      ctxSummary: '摘要',
      ctxSummaryHint: '主文档 + 主题索引，最省 Token。',
      ctxTopics: '按主题',
      ctxTopicsHint: '只加载选定主题的稳定概述。',
      ctxTopicUnit: '个主题',
      ctxRecent: '最近记录',
      ctxRecentHint: '主文档 + 最近 12 条动态记录。',
      ctxCancel: '取消',
      ctxSave: '应用',
      ctxSaving: '保存中…',
      ctxLoadFail: '无法读取上下文选项',
      ctxSaveFail: '保存失败',
      ctxPickTopic: '至少选择一个主题',
      ctxCurrent: '当前',
      loading: '加载中…',
      error: '操作失败',
      retry: '重试',
      applyDir: '切换目录',
      dirChanged: '数据目录已切换',
      unknown: '未知',
      sensNormal: '普通',
      sensImportant: '重要',
      sensSensitive: '敏感',
      kindFact: '事实',
      kindPreference: '偏好',
      kindOpinion: '观点',
      kindDecision: '决定',
      kindIdea: '想法',
      kindQuestion: '待解决',
      kindInference: '推测',
    }

    const EN = {
      panel: 'Personal Context',
      overview: 'Overview',
      topics: 'Topics',
      search: 'Search',
      settings: 'Settings',
      refresh: 'Refresh',
      paused: 'Paused',
      active: 'Capturing',
      pause: 'Pause capture',
      resume: 'Resume capture',
      topicsCount: 'Topics',
      entries: 'Entries',
      backupsCount: 'Backups',
      pendingMerge: 'To merge',
      recent: 'Recent entries',
      noEntries: 'No entries yet. Chat normally, or add one above.',
      quickAdd: 'Add a memory',
      addPlaceholder: 'A durable fact, decision or preference…',
      kind: 'Kind',
      topicOptional: 'Topic (optional)',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      merge: 'Merge',
      mergeAll: 'Merge all ready topics',
      audit: 'Audit',
      export: 'Export',
      exportDone: 'Exported to',
      dataDir: 'Data directory',
      threshold: 'Merge threshold',
      injectBudget: 'Injection budget (chars)',
      retention: 'Backup retention',
      retentionDays: 'Exact backup days',
      minScore: 'Capture sensitivity',
      autoCapture: 'Automatic capture',
      autoInject: 'Inject summary into new sessions',
      autoMerge: 'Auto-merge at threshold',
      autoAudit: 'Audit every 30 days',
      sensNote: 'Sensitivity only adds UI labels; it does not change automatic injection.',
      saveSettings: 'Save settings',
      settingsSaved: 'Settings saved',
      backup: 'Backup',
      restore: 'Restore',
      restoreConfirm: 'Restoring overwrites current documents. Continue?',
      restored: 'Restored',
      mergeDone: 'Archived',
      mergeSkipped: 'Below threshold, skipped',
      auditDone: 'Audit complete',
      searchPlaceholder: 'Search facts, decisions, topics or history…',
      searchEmpty: 'No matching entries.',
      results: 'Results',
      archive: 'Archive',
      archivePlaceholder: 'Search titles and topics across historical sessions…',
      archiveEmpty: 'No archived sessions found.',
      archiveHint: 'Full-text archive of past conversations. Enable “Deep search” to scan transcripts; it is slower.',
      deepSearch: 'Deep search',
      archiveCount: 'Sessions',
      archiveOpen: 'Read',
      archiveBack: 'Back to archive',
      archiveDoc: 'Transcript',
      archiveTruncated: '(first 30,000 characters only)',
      openTopic: 'Open topic',
      back: 'Back',
      agents: 'Stable overview',
      log: 'Log',
      delete: 'Delete',
      deleteConfirm: 'Delete this entry? The original stays in archive.',
      deleted: 'Deleted and archived',
      edit: 'Edit',
      editPrompt: 'Edit this entry:',
      importPath: 'Import from directory',
      import: 'Import copy',
      importDone: 'Imported to',
      mergeTopic: 'Merge this topic',
      forceMerge: 'Force merge',
      noSession: 'Open a conversation first; the panel reaches memory through a session command.',
      ctxHero: 'Memory',
      ctxTitle: 'What should this conversation load?',
      ctxSubtitle: 'Pick the long-term context to carry in; use “No context” to skip it entirely. The summary is used when nothing is chosen.',
      ctxNone: 'Do not import any context',
      ctxNoneHint: 'Inject no long-term memory into this conversation; the summary fallback is disabled too.',
      ctxCapture: 'No recording',
      ctxCaptureActive: 'Not recording',
      ctxCaptureOff: 'Do not record any new memories',
      ctxCaptureTitle: 'Recording for this conversation',
      ctxCaptureSubtitle: 'Control whether new information is written to long-term memory; independent of which memories are loaded.',
      ctxCaptureOn: 'Record new memories',
      ctxCaptureOnHint: 'Automatic capture and model tool writes work normally; existing memories remain readable.',
      ctxCaptureOffHint: 'Automatic capture and model writes stop; existing records are not deleted.',
      ctxSummary: 'Summary',
      ctxSummaryHint: 'Master document + topic index, lowest token cost.',
      ctxTopics: 'Topics',
      ctxTopicsHint: 'Only the stable overview of selected topics.',
      ctxTopicUnit: 'topics',
      ctxRecent: 'Recent',
      ctxRecentHint: 'Master document + the 12 newest log entries.',
      ctxCancel: 'Cancel',
      ctxSave: 'Apply',
      ctxSaving: 'Saving…',
      ctxLoadFail: 'Could not load context options',
      ctxSaveFail: 'Could not save',
      ctxPickTopic: 'Select at least one topic',
      ctxCurrent: 'Current',
      loading: 'Loading…',
      error: 'Action failed',
      retry: 'Retry',
      applyDir: 'Switch directory',
      dirChanged: 'Data directory switched',
      unknown: 'Unknown',
      sensNormal: 'Normal',
      sensImportant: 'Important',
      sensSensitive: 'Sensitive',
      kindFact: 'Fact',
      kindPreference: 'Preference',
      kindOpinion: 'Opinion',
      kindDecision: 'Decision',
      kindIdea: 'Idea',
      kindQuestion: 'Open question',
      kindInference: 'Inference',
    }

    const C = {
      bg: 'var(--dsw-alias-card-fill, #17181c)',
      bgSoft: 'var(--dsw-alias-bg-layer-2, #232428)',
      text: 'var(--dsw-alias-label-primary, #f2f3f5)',
      muted: 'var(--dsw-alias-label-secondary, #cfd3d6)',
      faint: 'var(--dsw-alias-label-tertiary, #adb2b8)',
      border: 'var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.14))',
      accent: 'var(--dsw-alias-brand-primary-new-colorprimary-new-color, #5686fe)',
      accentSoft: 'var(--dsw-alias-state-business-tertiary, rgba(86, 134, 254, 0.16))',
      danger: 'var(--dsw-alias-state-error-primary, #f25a5a)',
      ok: 'var(--dsw-alias-state-success-primary, #22c55e)',
      warn: 'var(--dsw-alias-state-warn-label, #dd8629)',
    }

    const KIND_KEYS = {
      fact: 'kindFact',
      preference: 'kindPreference',
      opinion: 'kindOpinion',
      decision: 'kindDecision',
      idea: 'kindIdea',
      question: 'kindQuestion',
      inference: 'kindInference',
    }

    function humanDoc(value) {
      return String(value || '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    }

    function btnStyle(primary, small, danger) {
      if (primary) {
        return {
          padding: small ? '4px 10px' : '7px 14px',
          borderRadius: 7,
          border: '1px solid transparent',
          background: C.accent,
          color: '#fff',
          fontSize: small ? 12 : 13,
          cursor: 'pointer',
          fontWeight: 500,
        }
      }
      return {
        padding: small ? '3px 9px' : '6px 12px',
        borderRadius: 7,
        border: `1px solid ${danger ? 'rgba(214,69,69,.45)' : C.border}`,
        background: 'transparent',
        color: danger ? C.danger : C.text,
        fontSize: small ? 12 : 13,
        cursor: 'pointer',
      }
    }

    function Btn({ children, onClick, disabled, primary, small, danger }) {
      return h(
        'button',
        {
          type: 'button',
          onClick,
          disabled,
          style: { ...btnStyle(primary, small, danger), opacity: disabled ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer' },
        },
        children,
      )
    }

    function Badge({ kind, label }) {
      const color = kind === 'decision' ? C.ok : kind === 'question' ? C.warn : kind === 'inference' ? C.muted : C.accent
      return h(
        'span',
        {
          style: {
            display: 'inline-block',
            padding: '1px 7px',
            borderRadius: 20,
            fontSize: 11,
            lineHeight: '18px',
            color,
            background: kind === 'decision' ? 'rgba(47,158,107,.12)' : kind === 'question' ? 'rgba(185,128,31,.14)' : 'rgba(79,124,255,.12)',
            whiteSpace: 'nowrap',
          },
        },
        label,
      )
    }

    function SensBadge({ level, label }) {
      if (!level || level === 'normal') return null
      const sensitive = level === 'sensitive'
      return h(
        'span',
        {
          style: {
            display: 'inline-block',
            padding: '1px 6px',
            borderRadius: 20,
            fontSize: 10.5,
            lineHeight: '17px',
            color: sensitive ? C.danger : C.warn,
            background: sensitive ? 'rgba(220,80,80,.12)' : 'rgba(185,128,31,.14)',
            whiteSpace: 'nowrap',
          },
        },
        label,
      )
    }

    function Card({ children, style }) {
      return h(
        'div',
        {
          style: {
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: 14,
            background: C.bg,
            ...style,
          },
        },
        children,
      )
    }

    function Field({ label, hint, children }) {
      return h(
        'label',
        { style: { display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14, fontSize: 12, color: C.muted } },
        h('span', { style: { fontWeight: 500, color: C.text } }, label),
        children,
        hint ? h('span', { style: { color: C.faint, lineHeight: 1.5 } }, hint) : null,
      )
    }

    const inputStyle = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '6px 9px',
      borderRadius: 7,
      border: `1px solid ${C.border}`,
      background: C.bgSoft,
      color: C.text,
      fontSize: 13,
      fontFamily: 'inherit',
      outline: 'none',
    }

    function Panel(props) {
      const t = props.t
      const execute = props.execute
      const useSessions = props.useSessions
      const sessionId = (() => {
        if (props.sessionId) return props.sessionId
        if (props.session && props.session.id) return props.session.id
        if (typeof useSessions === 'function') {
          return useSessions((state) => {
            const sessions = state && state.byId ? Object.values(state.byId) : []
            const current = sessions.find((session) => (session && session.retainedBy && session.retainedBy.mainView ? session.retainedBy.mainView : 0) > 0)
            return current ? current.id : ''
          })
        }
        return ''
      })()

      const [tab, setTab] = useState('overview')
      const [snapshot, setSnapshot] = useState(null)
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [topic, setTopic] = useState(null)
      const [query, setQuery] = useState('')
      const [results, setResults] = useState(null)
      const [form, setForm] = useState({ text: '', kind: 'fact', topic: '' })
      const [draft, setDraft] = useState(null)
      const [importPath, setImportPath] = useState('')
      const [archiveQuery, setArchiveQuery] = useState('')
      const [archiveResult, setArchiveResult] = useState(null)
      const [archiveDoc, setArchiveDoc] = useState(null)
      const [deep, setDeep] = useState(false)

      const refresh = useCallback(async () => {
        if (!sessionId) {
          setSnapshot(null)
          return
        }
        setBusy('load')
        setError('')
        try {
          const data = await execute(sessionId, 'overview')
          setSnapshot(data)
          setDraft(data.settings)
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy('')
        }
      }, [sessionId, execute])

      useEffect(() => {
        void refresh()
      }, [refresh])

      const act = useCallback(
        async (label, action, payload, successText) => {
          if (!sessionId) return
          setBusy(label)
          setError('')
          setNotice('')
          try {
            const result = await execute(sessionId, action, payload)
            setNotice(typeof successText === 'function' ? successText(result) : successText || '')
            await refresh()
            return result
          } catch (err) {
            setError(err && err.message ? err.message : String(err))
            return null
          } finally {
            setBusy('')
          }
        },
        [sessionId, execute, refresh],
      )

      const openTopic = async (id) => {
        setBusy('topic')
        setError('')
        try {
          const data = await execute(sessionId, 'topic', { id })
          setTopic(data)
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy('')
        }
      }

      const submitSearch = async () => {
        if (!query.trim()) return
        setBusy('search')
        setError('')
        try {
          const data = await execute(sessionId, 'search', { query, limit: 20 })
          setResults(data)
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy('')
        }
      }

      const submitArchive = async () => {
        if (!archiveQuery.trim()) return
        setBusy('archive')
        setError('')
        try {
          const data = await execute(sessionId, 'archive', { query: archiveQuery, limit: 30, deep })
          setArchiveResult(data)
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy('')
        }
      }

      const openArchive = async (id) => {
        setBusy('archive-doc')
        setError('')
        try {
          setArchiveDoc(await execute(sessionId, 'archive_doc', { id }))
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy('')
        }
      }

      const saveEntry = async () => {
        if (!form.text.trim()) return
        const result = await act('save', 'save', {
          text: form.text,
          kind: form.kind,
          topic: form.topic.trim() || undefined,
          by: 'user',
        })
        if (result) setForm({ text: '', kind: 'fact', topic: '' })
      }

      const removeEntry = async (entry) => {
        if (!window.confirm(t('deleteConfirm'))) return
        const result = await act('delete', 'delete', { topic: topic.id, id: entry.id }, t('deleted'))
        if (result) await openTopic(topic.id)
      }

      const editEntry = async (entry) => {
        const next = window.prompt(t('editPrompt'), entry.text)
        if (next == null || !next.trim()) return
        await act('edit', 'update', { topic: topic.id, id: entry.id, text: next }, t('saved'))
        await openTopic(topic.id)
      }

      if (!sessionId) {
        return h(
          'div',
          { style: shellStyle },
          h('div', { style: headerStyle }, h('div', { style: { fontWeight: 600, fontSize: 14 } }, t('panel'))),
          h('div', { style: { padding: 24, color: C.muted, fontSize: 13, lineHeight: 1.7 } }, t('noSession')),
        )
      }

      if (!snapshot && busy) {
        return h(
          'div',
          { style: shellStyle },
          h('div', { style: headerStyle }, h('div', { style: { fontWeight: 600, fontSize: 14 } }, t('panel'))),
          h('div', { style: { padding: 24, color: C.muted, fontSize: 13 } }, t('loading')),
        )
      }

      const status = snapshot ? snapshot.status : null
      const topics = snapshot ? snapshot.topics : []
      const settings = snapshot ? snapshot.settings : {}
      const backups = snapshot ? snapshot.backups : []

      const tabs = [
        ['overview', t('overview')],
        ['topics', t('topics')],
        ['search', t('search')],
        ['archive', t('archive')],
        ['settings', t('settings')],
      ]

      return h(
        'div',
        { style: shellStyle },
        h(
          'div',
          { style: headerStyle },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
            h(BookIcon, { size: 18, active: true }),
            h('div', { style: { fontWeight: 600, fontSize: 14 } }, t('panel')),
            status
              ? h(
                  'span',
                  { style: { fontSize: 11, color: status.paused ? C.warn : C.ok, whiteSpace: 'nowrap' } },
                  `● ${status.paused ? t('paused') : t('active')}`,
                )
              : null,
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 6 } },
            status
              ? h(
                  Btn,
                  {
                    small: true,
                    onClick: () => act('pause', status.paused ? 'resume' : 'pause', {}, status.paused ? t('resume') : t('pause')),
                  },
                  status.paused ? t('resume') : t('pause'),
                )
              : null,
            h(Btn, { small: true, onClick: refresh, disabled: Boolean(busy) }, t('refresh')),
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 2, padding: '0 12px', borderBottom: `1px solid ${C.border}` } },
          tabs.map(([key, label]) =>
            h(
              'button',
              {
                key,
                type: 'button',
                onClick: () => {
                  setTab(key)
                  if (key !== 'topics') setTopic(null)
                },
                style: {
                  padding: '9px 10px',
                  border: 'none',
                  background: 'transparent',
                  color: tab === key ? C.accent : C.muted,
                  borderBottom: `2px solid ${tab === key ? C.accent : 'transparent'}`,
                  fontSize: 13,
                  cursor: 'pointer',
                  fontWeight: tab === key ? 600 : 400,
                },
              },
              label,
            ),
          ),
        ),
        error
          ? h(
              'div',
              {
                style: {
                  margin: '10px 14px 0',
                  padding: '8px 10px',
                  borderRadius: 7,
                  background: 'rgba(214,69,69,.1)',
                  color: C.danger,
                  fontSize: 12,
                  lineHeight: 1.6,
                  wordBreak: 'break-all',
                },
              },
              `${t('error')}：${error}`,
            )
          : null,
        notice
          ? h(
              'div',
              {
                style: {
                  margin: '10px 14px 0',
                  padding: '8px 10px',
                  borderRadius: 7,
                  background: 'rgba(47,158,107,.1)',
                  color: C.ok,
                  fontSize: 12,
                  lineHeight: 1.6,
                  wordBreak: 'break-all',
                },
              },
              notice,
            )
          : null,
        h(
          'div',
          { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: 14 } },
          tab === 'overview'
            ? h(Overview, {
                t,
                status,
                topics,
                busy,
                form,
                setForm,
                onSave: saveEntry,
                onMergeAll: () => act('merge', 'merge', {}, (result) => `${t('mergeDone')} ${result.merged.reduce((sum, item) => sum + item.archived, 0)}`),
                onAudit: () => act('audit', 'audit', {}, t('auditDone')),
                onExport: () => act('export', 'export', {}, (result) => `${t('exportDone')} ${result.path}`),
                onOpenTopic: (id) => {
                  setTab('topics')
                  void openTopic(id)
                },
              })
            : null,
          tab === 'topics'
            ? topic
              ? h(TopicView, {
                  t,
                  topic,
                  busy,
                  onBack: () => setTopic(null),
                  onMerge: () => act('merge', 'merge', { topic: topic.id, force: true }, (result) => `${t('mergeDone')} ${result.merged.reduce((sum, item) => sum + item.archived, 0)}`).then(() => openTopic(topic.id)),
                  onDelete: removeEntry,
                  onEdit: editEntry,
                })
              : h(TopicList, {
                  t,
                  topics,
                  busy,
                  onOpen: openTopic,
                })
            : null,
          tab === 'search'
            ? h(SearchView, { t, query, setQuery, results, busy, onSubmit: submitSearch, onOpenTopic: openTopic })
            : null,
          tab === 'archive'
            ? h(ArchiveView, {
                t,
                query: archiveQuery,
                setQuery: setArchiveQuery,
                result: archiveResult,
                doc: archiveDoc,
                deep,
                setDeep,
                busy,
                onSubmit: submitArchive,
                onOpen: openArchive,
                onBack: () => setArchiveDoc(null),
              })
            : null,
          tab === 'settings'
            ? h(SettingsView, {
                t,
                draft,
                setDraft,
                status,
                backups,
                busy,
                importPath,
                setImportPath,
                onSave: () => act('settings', 'configure', {
                  mergeThreshold: Number(draft.mergeThreshold),
                  injectBudget: Number(draft.injectBudget),
                  retention: Number(draft.retention),
                  retentionDays: Number(draft.retentionDays),
                  minScore: Number(draft.minScore),
                  autoCapture: Boolean(draft.autoCapture),
                  autoInject: Boolean(draft.autoInject),
                  autoMerge: Boolean(draft.autoMerge),
                  autoAudit: Boolean(draft.autoAudit),
                }, t('settingsSaved')),
                onDir: () => {
                  if (!window.confirm(`${t('dataDir')}: ${draft.dataDir}`)) return
                  act('dir', 'configure', { dataDir: draft.dataDir }, t('dirChanged'))
                },
                onRestore: (id) => {
                  if (!window.confirm(t('restoreConfirm'))) return
                  act('restore', 'restore', { id }, t('restored'))
                },
                onExport: () => act('export', 'export', {}, (result) => `${t('exportDone')} ${result.path}`),
                onImport: () => act('import', 'import', { sourceDir: importPath }, (result) => `${t('importDone')} ${result.path}`),
              })
            : null,
        ),
      )
    }

    function Overview({ t, status, topics, busy, form, setForm, onSave, onMergeAll, onAudit, onExport, onOpenTopic }) {
      if (!status) return h('div', { style: { color: C.muted, fontSize: 13 } }, t('loading'))
      const pending = status.pendingMerge || []
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        h(
          'div',
          { style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 } },
          h(Stat, { label: t('topicsCount'), value: status.topics }),
          h(Stat, { label: t('entries'), value: status.totalEntries }),
          h(Stat, { label: t('backupsCount'), value: status.backups }),
          h(Stat, { label: t('pendingMerge'), value: pending.length, warn: pending.length > 0 }),
        ),
        status.archive && status.archive.sessions > 0
          ? h('div', { style: { fontSize: 11.5, color: C.muted } }, `${t('archiveCount')}：${status.archive.sessions} · ${Math.round((status.archive.bytes || 0) / 1024 / 1024)} MB`)
          : null,
        h(
          Card,
          null,
          h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 8 } }, t('quickAdd')),
          h('textarea', {
            value: form.text,
            onChange: (event) => setForm({ ...form, text: event.target.value }),
            placeholder: t('addPlaceholder'),
            rows: 3,
            style: { ...inputStyle, resize: 'vertical', lineHeight: 1.6 },
          }),
          h(
            'div',
            { style: { display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' } },
            h(
              'select',
              {
                value: form.kind,
                onChange: (event) => setForm({ ...form, kind: event.target.value }),
                style: { ...inputStyle, width: 110 },
              },
              Object.keys(KIND_KEYS).map((kind) => h('option', { key: kind, value: kind }, t(KIND_KEYS[kind]))),
            ),
            h('input', {
              value: form.topic,
              onChange: (event) => setForm({ ...form, topic: event.target.value }),
              placeholder: t('topicOptional'),
              style: { ...inputStyle, width: 140 },
            }),
            h('div', { style: { flex: 1 } }),
            h(Btn, { primary: true, onClick: onSave, disabled: Boolean(busy) || !form.text.trim() }, busy === 'save' ? t('saving') : t('save')),
          ),
        ),
        pending.length > 0
          ? h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, background: 'rgba(185,128,31,.1)', color: C.warn, fontSize: 12 } },
              h('span', null, `${t('pendingMerge')}：${pending.join(', ')}`),
              h('div', { style: { flex: 1 } }),
              h(Btn, { small: true, onClick: onMergeAll, disabled: Boolean(busy) }, t('mergeAll')),
            )
          : null,
        h(
          'div',
          { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          h(Btn, { small: true, onClick: onMergeAll, disabled: Boolean(busy) }, t('mergeAll')),
          h(Btn, { small: true, onClick: onAudit, disabled: Boolean(busy) }, t('audit')),
          h(Btn, { small: true, onClick: onExport, disabled: Boolean(busy) }, t('export')),
        ),
        h(
          'div',
          null,
          h('div', { style: { fontSize: 13, fontWeight: 600, margin: '2px 0 8px' } }, t('recent')),
          status.recent && status.recent.length > 0
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                status.recent.map((entry) =>
                  h(
                    'div',
                    {
                      key: entry.id,
                      onClick: () => onOpenTopic(entry.topic),
                      style: {
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: `1px solid ${C.border}`,
                        cursor: 'pointer',
                        background: C.bg,
                      },
                    },
                    h(
                      'div',
                      { style: { display: 'flex', gap: 7, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' } },
                      h(Badge, { kind: entry.kind, label: t(KIND_KEYS[entry.kind] || 'unknown') }),
                      h('span', { style: { fontSize: 11, color: C.faint } }, String(entry.at).slice(0, 10)),
                      h('span', { style: { fontSize: 11, color: C.muted } }, entry.topicTitle),
                      h(SensBadge, {
                        level: entry.sensitivity,
                        label: t(entry.sensitivity === 'sensitive' ? 'sensSensitive' : 'sensImportant'),
                      }),
                    ),
                    h('div', { style: { fontSize: 12.5, lineHeight: 1.6, color: C.text, wordBreak: 'break-word' } }, entry.title),
                  ),
                ),
              )
            : h('div', { style: { color: C.muted, fontSize: 12.5, lineHeight: 1.7 } }, t('noEntries')),
        ),
        status.lastError
          ? h('div', { style: { fontSize: 11.5, color: C.danger, lineHeight: 1.6, wordBreak: 'break-all' } }, `${t('error')}：${status.lastError}`)
          : null,
        h('div', { style: { fontSize: 11, color: C.faint, wordBreak: 'break-all' } }, `${t('dataDir')}：${status.dataDir}`),
      )
    }

    function Stat({ label, value, warn }) {
      return h(
        'div',
        {
          style: {
            border: `1px solid ${C.border}`,
            borderRadius: 9,
            padding: '9px 10px',
            background: C.bg,
          },
        },
        h('div', { style: { fontSize: 18, fontWeight: 650, color: warn ? C.warn : C.text, lineHeight: 1.3 } }, String(value)),
        h('div', { style: { fontSize: 11, color: C.muted, marginTop: 2 } }, label),
      )
    }

    function TopicList({ t, topics, busy, onOpen }) {
      if (!topics || topics.length === 0) {
        return h('div', { style: { color: C.muted, fontSize: 13 } }, t('noEntries'))
      }
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 7 } },
        topics.map((topic) =>
          h(
            'div',
            {
              key: topic.id,
              onClick: () => onOpen(topic.id),
              style: {
                padding: '10px 12px',
                border: `1px solid ${C.border}`,
                borderRadius: 9,
                cursor: 'pointer',
                background: C.bg,
              },
            },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('div', { style: { fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, topic.title),
              h(SensBadge, {
                level: topic.sensitivity,
                label: t(topic.sensitivity === 'sensitive' ? 'sensSensitive' : 'sensImportant'),
              }),
              h('span', { style: { fontSize: 11, color: C.muted } }, `${topic.entries || 0} • ${t('log')}`),
            ),
            h(
              'div',
              { style: { fontSize: 11, color: C.faint, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              `${topic.id} · ${String(topic.updated || '').slice(0, 10)}${(topic.keywords || []).length ? ` · ${(topic.keywords || []).slice(0, 4).join('、')}` : ''}`,
            ),
          ),
        ),
      )
    }

    function TopicView({ t, topic, busy, onBack, onMerge, onDelete, onEdit }) {
      const entries = topic.log || []
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h(Btn, { small: true, onClick: onBack }, `← ${t('back')}`),
          h('div', { style: { fontSize: 14, fontWeight: 650, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, topic.title),
          h(SensBadge, {
            level: topic.sensitivity,
            label: t(topic.sensitivity === 'sensitive' ? 'sensSensitive' : 'sensImportant'),
          }),
          h(Btn, { small: true, onClick: onMerge, disabled: Boolean(busy) }, t('forceMerge')),
        ),
        h(
          'div',
          { style: { fontSize: 11, color: C.faint, wordBreak: 'break-all' } },
          `${topic.id} · 当前 ${topic.totals ? topic.totals.current : entries.length} · 归档 ${topic.totals ? topic.totals.archive : (topic.archive || []).length}`,
        ),
        h(
          Card,
          null,
          h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 6 } }, t('agents')),
          h(
            'pre',
            {
              style: {
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: 11.5,
                lineHeight: 1.65,
                color: C.text,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                maxHeight: 260,
                overflowY: 'auto',
              },
            },
            humanDoc(topic.agents),
          ),
        ),
        h(
          'div',
          null,
          h('div', { style: { fontSize: 12, fontWeight: 600, margin: '2px 0 7px' } }, t('log')),
          entries.length === 0
            ? h('div', { style: { color: C.muted, fontSize: 12.5 } }, t('noEntries'))
            : h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                entries
                  .slice()
                  .reverse()
                  .map((entry) =>
                    h(
                      'div',
                      { key: entry.id, style: { padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg } },
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4, flexWrap: 'wrap' } },
                        h(Badge, { kind: entry.kind, label: t(KIND_KEYS[entry.kind] || 'unknown') }),
                        h(SensBadge, {
                          level: entry.sensitivity,
                          label: t(entry.sensitivity === 'sensitive' ? 'sensSensitive' : 'sensImportant'),
                        }),
                        h('span', { style: { fontSize: 11, color: C.faint } }, String(entry.at).slice(0, 10)),
                        h('div', { style: { flex: 1 } }),
                        h(Btn, { small: true, onClick: () => onEdit(entry), disabled: Boolean(busy) }, t('edit')),
                        h(Btn, { small: true, danger: true, onClick: () => onDelete(entry), disabled: Boolean(busy) }, t('delete')),
                      ),
                      h('div', { style: { fontSize: 12.5, lineHeight: 1.65, color: C.text, wordBreak: 'break-word' } }, entry.text),
                      entry.source ? h('div', { style: { fontSize: 10.5, color: C.faint, marginTop: 5, wordBreak: 'break-all' } }, entry.source) : null,
                    ),
                  ),
              ),
        ),
      )
    }

    function SearchView({ t, query, setQuery, results, busy, onSubmit, onOpenTopic }) {
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h(
          'div',
          { style: { display: 'flex', gap: 7 } },
          h('input', {
            value: query,
            onChange: (event) => setQuery(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') onSubmit()
            },
            placeholder: t('searchPlaceholder'),
            style: inputStyle,
          }),
          h(Btn, { primary: true, onClick: onSubmit, disabled: Boolean(busy) }, t('search')),
        ),
        results
          ? results.results.length === 0
            ? h('div', { style: { color: C.muted, fontSize: 12.5 } }, t('searchEmpty'))
            : h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                h('div', { style: { fontSize: 12, color: C.muted } }, `${t('results')}：${results.results.length}`),
                results.results.map((item, index) =>
                  h(
                    'div',
                    {
                      key: `${item.topic}-${item.id}-${index}`,
                      style: { padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg },
                    },
                    h(
                      'div',
                      { style: { display: 'flex', gap: 7, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' } },
                      h(Badge, { kind: item.kind, label: item.kindLabel || item.kind }),
                      h(SensBadge, {
                        level: item.sensitivity,
                        label: t(item.sensitivity === 'sensitive' ? 'sensSensitive' : 'sensImportant'),
                      }),
                      h('span', { style: { fontSize: 11, color: C.faint } }, String(item.at || '').slice(0, 10)),
                      h(
                        'button',
                        {
                          type: 'button',
                          onClick: () => onOpenTopic(item.topic),
                          style: { border: 'none', background: 'transparent', color: C.accent, fontSize: 11, cursor: 'pointer', padding: 0 },
                        },
                        item.topicTitle,
                      ),
                    ),
                    h('div', { style: { fontSize: 12.5, lineHeight: 1.6, color: C.text, wordBreak: 'break-word' } }, item.snippet),
                  ),
                ),
              )
          : null,
      )
    }

    function ArchiveView({ t, query, setQuery, result, doc, deep, setDeep, busy, onSubmit, onOpen, onBack }) {
      if (doc) {
        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h(Btn, { onClick: onBack }, t('archiveBack')),
            h('div', { style: { fontSize: 13, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, doc.title),
            h('div', { style: { flex: 1 } }),
            h('span', { style: { fontSize: 11, color: C.faint } }, String(doc.at || '').slice(0, 10)),
          ),
          h('div', { style: { fontSize: 11, color: C.faint } }, `${doc.topic || ''} · ${doc.messages || 0} 条 · ${doc.chars || 0} 字${doc.truncated ? ' ' + t('archiveTruncated') : ''}`),
          h(
            'pre',
            {
              style: {
                margin: 0,
                padding: 12,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                background: C.bgSoft,
                color: C.text,
                fontSize: 12,
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 'calc(100vh - 280px)',
                overflowY: 'auto',
              },
            },
            doc.content,
          ),
        )
      }
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h(
          'div',
          { style: { display: 'flex', gap: 7 } },
          h('input', {
            value: query,
            onChange: (event) => setQuery(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') onSubmit()
            },
            placeholder: t('archivePlaceholder'),
            style: inputStyle,
          }),
          h(Btn, { primary: true, onClick: onSubmit, disabled: Boolean(busy) }, t('search')),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.muted, flexWrap: 'wrap' } },
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
            h('input', { type: 'checkbox', checked: deep, onChange: (event) => setDeep(event.target.checked) }),
            t('deepSearch'),
          ),
          h('span', null, t('archiveHint')),
        ),
        result
          ? result.results.length === 0
            ? h('div', { style: { color: C.muted, fontSize: 12.5 } }, t('archiveEmpty'))
            : h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                h('div', { style: { fontSize: 12, color: C.muted } }, `${t('archiveCount')}：${result.results.length}`),
                result.results.map((item) =>
                  h(
                    'div',
                    { key: item.id, style: { padding: '9px 11px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg } },
                    h(
                      'div',
                      { style: { display: 'flex', gap: 7, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' } },
                      h('span', { style: { fontSize: 11, color: C.faint } }, String(item.at || '').slice(0, 10)),
                      h('span', { style: { fontSize: 11, color: C.muted } }, item.topic || '其他'),
                      h('div', { style: { flex: 1 } }),
                      h(Btn, { small: true, onClick: () => onOpen(item.id) }, t('archiveOpen')),
                    ),
                    h('div', { style: { fontSize: 12.8, fontWeight: 600, marginBottom: 3, lineHeight: 1.55 } }, item.title),
                    h('div', { style: { fontSize: 12, color: C.muted, lineHeight: 1.6, wordBreak: 'break-word' } }, item.snippet),
                  ),
                ),
              )
          : null,
      )
    }

    function SettingsView({ t, draft, setDraft, status, backups, busy, importPath, setImportPath, onSave, onDir, onRestore, onExport, onImport }) {
      if (!draft) return h('div', { style: { color: C.muted, fontSize: 13 } }, t('loading'))
      const update = (key, value) => setDraft({ ...draft, [key]: value })
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        h(
          Card,
          null,
          h(
            'div',
            { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 } },
            h(Field, { label: t('threshold') }, h('input', { type: 'number', min: 5, max: 500, value: draft.mergeThreshold, onChange: (e) => update('mergeThreshold', e.target.value), style: inputStyle })),
            h(Field, { label: t('injectBudget') }, h('input', { type: 'number', min: 200, max: 8000, value: draft.injectBudget, onChange: (e) => update('injectBudget', e.target.value), style: inputStyle })),
            h(Field, { label: t('retention') }, h('input', { type: 'number', min: 20, max: 500, value: draft.retention, onChange: (e) => update('retention', e.target.value), style: inputStyle })),
            h(Field, { label: t('retentionDays') }, h('input', { type: 'number', min: 30, max: 3650, value: draft.retentionDays, onChange: (e) => update('retentionDays', e.target.value), style: inputStyle })),
            h(Field, { label: t('minScore') }, h('input', { type: 'number', min: 1, max: 10, value: draft.minScore, onChange: (e) => update('minScore', e.target.value), style: inputStyle })),
          ),
          h(
            'label',
            { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, marginBottom: 7, color: C.text } },
            h('input', { type: 'checkbox', checked: Boolean(draft.autoCapture), onChange: (e) => update('autoCapture', e.target.checked) }),
            t('autoCapture'),
          ),
          h(
            'label',
            { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, marginBottom: 7, color: C.text } },
            h('input', { type: 'checkbox', checked: Boolean(draft.autoInject), onChange: (e) => update('autoInject', e.target.checked) }),
            t('autoInject'),
          ),
          h(
            'label',
            { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, marginBottom: 7, color: C.text } },
            h('input', { type: 'checkbox', checked: Boolean(draft.autoMerge), onChange: (e) => update('autoMerge', e.target.checked) }),
            t('autoMerge'),
          ),
          h(
            'label',
            { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, marginBottom: 10, color: C.text } },
            h('input', { type: 'checkbox', checked: Boolean(draft.autoAudit), onChange: (e) => update('autoAudit', e.target.checked) }),
            t('autoAudit'),
          ),
          h('div', { style: { fontSize: 11.5, lineHeight: 1.6, color: C.faint, marginBottom: 10 } }, t('sensNote')),
          h(Btn, { primary: true, onClick: onSave, disabled: Boolean(busy) }, t('saveSettings')),
        ),
        h(
          Card,
          null,
          h(Field, { label: t('dataDir') }, h('input', { value: draft.dataDir || '', onChange: (e) => update('dataDir', e.target.value), style: inputStyle })),
          h(Btn, { small: true, onClick: onDir, disabled: Boolean(busy) }, t('applyDir')),
        ),
        h(
          Card,
          null,
          h('div', { style: { fontSize: 12.5, fontWeight: 600, marginBottom: 8 } }, t('backup')),
          backups.length === 0
            ? h('div', { style: { color: C.muted, fontSize: 12 } }, '—')
            : h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' } },
                backups.map((backup) =>
                  h(
                    'div',
                    { key: backup.id, style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5, color: C.muted } },
                    h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `${backup.label} · ${String(backup.at).replace('T', ' ').slice(0, 19)}`),
                    h(Btn, { small: true, onClick: () => onRestore(backup.id) }, t('restore')),
                  ),
                ),
              ),
        ),
        h(
          Card,
          null,
          h(
            'div',
            { style: { display: 'flex', gap: 8 } },
            h(Btn, { small: true, onClick: onExport, disabled: Boolean(busy) }, t('export')),
          ),
          h('div', { style: { height: 10 } }),
          h(Field, { label: t('importPath') }, h('input', { value: importPath, onChange: (e) => setImportPath(e.target.value), placeholder: 'D:\\backup\\Memory', style: inputStyle })),
          h(Btn, { small: true, onClick: onImport, disabled: Boolean(busy) || !importPath.trim() }, t('import')),
        ),
        status ? h('div', { style: { fontSize: 11, color: C.faint, wordBreak: 'break-all' } }, `v${status.version} · ${status.dataDir}`) : null,
      )
    }

    function BookIcon(props) {
      const size = props.size || 20
      const color = props.active ? 'currentColor' : 'currentColor'
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z' }),
        h('path', { d: 'M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5A2.5 2.5 0 0 1 20 21.5z' }),
        h('path', { d: 'M11 8h2' }),
      )
    }

    const shellStyle = {
      height: '100%',
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      background: C.bg,
      color: C.text,
      fontFamily: 'inherit',
    }

    const headerStyle = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      padding: '11px 14px',
      borderBottom: `1px solid ${C.border}`,
      minHeight: 46,
      boxSizing: 'border-box',
    }

    async function readContextChoice(sessionId) {
      const response = await fetch(`${SESSION_URL}?sessionId=${encodeURIComponent(sessionId)}`, {
        headers: { 'x-pc-client': SESSION_CLIENT },
        credentials: 'same-origin',
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data || data.ok !== true) {
        throw new Error((data && data.error) || 'context api failed')
      }
      return data
    }

    async function writeContextChoice(payload) {
      const response = await fetch(SESSION_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pc-client': SESSION_CLIENT },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data || data.ok !== true) {
        throw new Error((data && data.error) || 'context api failed')
      }
      return data
    }

    function HeroContext({ t, sessionId }) {
      const [open, setOpen] = useState(false)
      const [captureOpen, setCaptureOpen] = useState(false)
      const [choice, setChoice] = useState(null)
      const [mode, setMode] = useState('summary')
      const [capture, setCapture] = useState(true)
      const [captureDraft, setCaptureDraft] = useState(true)
      const [picked, setPicked] = useState([])
      const [topics, setTopics] = useState([])
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')

      const label = (() => {
        let base = t('ctxHero')
        if (choice) {
          if (choice.mode === 'none') base = `${t('ctxHero')} · ${t('ctxNone')}`
          else if (choice.mode === 'topics') base = `${t('ctxHero')} · ${choice.topics?.length ?? 0} ${t('ctxTopicUnit')}`
          else if (choice.mode === 'recent') base = `${t('ctxHero')} · ${t('ctxRecent')}`
          else base = `${t('ctxHero')} · ${t('ctxSummary')}`
        }
        return base
      })()

      const openChooser = async () => {
        setOpen(true)
        setCaptureOpen(false)
        setBusy(true)
        setError('')
        try {
          const data = await readContextChoice(sessionId)
          setTopics(Array.isArray(data.topics) ? data.topics : [])
          setChoice(data.choice ?? null)
          setMode(data.choice?.mode ?? data.defaultMode ?? 'summary')
          setPicked(Array.isArray(data.choice?.topics) ? data.choice.topics : [])
          setCapture(data.choice?.capture !== false)
          setCaptureDraft(data.choice?.capture !== false)
        } catch (err) {
          setError(`${t('ctxLoadFail')}：${err instanceof Error ? err.message : String(err)}`)
        } finally {
          setBusy(false)
        }
      }

      const openCapture = async () => {
        setCaptureOpen(true)
        setOpen(false)
        setBusy(true)
        setError('')
        try {
          const data = await readContextChoice(sessionId)
          setTopics(Array.isArray(data.topics) ? data.topics : [])
          setChoice(data.choice ?? null)
          setMode(data.choice?.mode ?? data.defaultMode ?? 'summary')
          setPicked(Array.isArray(data.choice?.topics) ? data.choice.topics : [])
          setCapture(data.choice?.capture !== false)
          setCaptureDraft(data.choice?.capture !== false)
        } catch (err) {
          setError(`${t('ctxLoadFail')}：${err instanceof Error ? err.message : String(err)}`)
        } finally {
          setBusy(false)
        }
      }

      const save = async () => {
        if (mode === 'topics' && picked.length === 0) {
          setError(t('ctxPickTopic'))
          return
        }
        setBusy(true)
        setError('')
        try {
          const data = await writeContextChoice({ sessionId, mode, topics: mode === 'topics' ? picked : [], capture })
          setChoice(data.choice ?? { mode, topics: mode === 'topics' ? picked : [], capture })
          setOpen(false)
        } catch (err) {
          setError(`${t('ctxSaveFail')}：${err instanceof Error ? err.message : String(err)}`)
        } finally {
          setBusy(false)
        }
      }

      const saveCapture = async () => {
        setBusy(true)
        setError('')
        try {
          const data = await writeContextChoice({
            sessionId,
            mode,
            topics: mode === 'topics' ? picked : [],
            capture: captureDraft,
          })
          setChoice(data.choice ?? { mode, topics: mode === 'topics' ? picked : [], capture: captureDraft })
          setCapture(captureDraft)
          setCaptureOpen(false)
        } catch (err) {
          setError(`${t('ctxSaveFail')}：${err instanceof Error ? err.message : String(err)}`)
        } finally {
          setBusy(false)
        }
      }

      const toggleTopic = (id) => {
        setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
      }

      if (!sessionId) return null

      const option = (value, title, hint) =>
        h(
          'button',
          {
            type: 'button',
            key: value,
            onClick: () => setMode(value),
            style: {
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '10px 12px',
              marginBottom: 8,
              borderRadius: 8,
              border: `1px solid ${mode === value ? C.accent : C.border}`,
              background: mode === value ? C.accentSoft : C.bgSoft,
              color: C.text,
              cursor: 'pointer',
              fontFamily: 'inherit',
            },
          },
          h('div', { style: { fontSize: 13, fontWeight: 600 } }, title),
          h('div', { style: { fontSize: 11, color: C.faint, marginTop: 2, lineHeight: 1.5 } }, hint),
        )

      const button = h(
        'button',
        {
          type: 'button',
          onClick: openChooser,
          title: t('ctxTitle'),
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '4px 9px',
            borderRadius: 6,
            border: `1px solid ${C.border}`,
            background: C.bgSoft,
            color: choice ? C.text : C.muted,
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          },
        },
        label,
      )

      const captureButton = h(
        'button',
        {
          type: 'button',
          onClick: openCapture,
          disabled: busy,
          title: t('ctxCaptureTitle'),
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            padding: '4px 9px',
            borderRadius: 6,
            border: `1px solid ${capture ? C.border : C.accent}`,
            background: capture ? 'transparent' : C.accentSoft,
            color: capture ? C.muted : C.accent,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
            fontSize: 11,
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          },
        },
        capture ? t('ctxCapture') : t('ctxCaptureActive'),
      )

      const controls = h(
        'div',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
        button,
        captureButton,
      )

      const captureOption = (value, title, hint) =>
        h(
          'button',
          {
            type: 'button',
            key: String(value),
            onClick: () => setCaptureDraft(value),
            style: {
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '10px 12px',
              marginBottom: 8,
              borderRadius: 8,
              border: `1px solid ${captureDraft === value ? C.accent : C.border}`,
              background: captureDraft === value ? C.accentSoft : C.bgSoft,
              color: C.text,
              cursor: 'pointer',
              fontFamily: 'inherit',
            },
          },
          h('div', { style: { fontSize: 13, fontWeight: 600 } }, title),
          h('div', { style: { fontSize: 11, color: C.faint, marginTop: 2, lineHeight: 1.5 } }, hint),
        )

      const captureModal = captureOpen
        ? h(
            'div',
            {
              onClick: () => setCaptureOpen(false),
              style: {
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0,0,0,.58)',
                padding: 16,
                boxSizing: 'border-box',
              },
            },
            h(
              'div',
              {
                onClick: (event) => event.stopPropagation(),
                style: {
                  width: 'min(520px, 94vw)',
                  maxHeight: '84vh',
                  overflow: 'auto',
                  background: C.bg,
                  color: C.text,
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  padding: 16,
                  boxShadow: '0 24px 80px rgba(0,0,0,.55)',
                  fontFamily: 'inherit',
                },
              },
              h('div', { style: { fontSize: 15, fontWeight: 700 } }, t('ctxCaptureTitle')),
              h(
                'div',
                { style: { fontSize: 12, color: C.muted, marginTop: 4, marginBottom: 12, lineHeight: 1.6 } },
                t('ctxCaptureSubtitle'),
              ),
              captureOption(true, t('ctxCaptureOn'), t('ctxCaptureOnHint')),
              captureOption(false, t('ctxCaptureOff'), t('ctxCaptureOffHint')),
              error
                ? h('div', { style: { color: C.danger, fontSize: 12, margin: '8px 0', lineHeight: 1.5 } }, error)
                : null,
              h(
                'div',
                { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 } },
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: () => setCaptureOpen(false),
                    style: {
                      padding: '7px 14px',
                      borderRadius: 7,
                      border: `1px solid ${C.border}`,
                      background: 'transparent',
                      color: C.muted,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    },
                  },
                  t('ctxCancel'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    disabled: busy,
                    onClick: saveCapture,
                    style: {
                      padding: '7px 16px',
                      borderRadius: 7,
                      border: 'none',
                      background: C.accent,
                      color: '#fff',
                      cursor: busy ? 'wait' : 'pointer',
                      opacity: busy ? 0.7 : 1,
                      fontFamily: 'inherit',
                    },
                  },
                  busy ? t('ctxSaving') : t('ctxSave'),
                ),
              ),
            ),
          )
        : null

      if (!open && !captureOpen) return controls
      if (!open) return h(React.Fragment, null, controls, captureModal)

      return h(
        React.Fragment,
        null,
        controls,
        h(
          'div',
          {
            onClick: () => setOpen(false),
            style: {
              position: 'fixed',
              inset: 0,
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,.58)',
              padding: 16,
              boxSizing: 'border-box',
            },
          },
          h(
            'div',
            {
              onClick: (event) => event.stopPropagation(),
              style: {
                width: 'min(560px, 94vw)',
                maxHeight: '84vh',
                overflow: 'auto',
                background: C.bg,
                color: C.text,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: 16,
                boxShadow: '0 24px 80px rgba(0,0,0,.55)',
                fontFamily: 'inherit',
              },
            },
            h('div', { style: { fontSize: 15, fontWeight: 700 } }, t('ctxTitle')),
            h('div', { style: { fontSize: 12, color: C.muted, marginTop: 4, marginBottom: 12, lineHeight: 1.6 } }, t('ctxSubtitle')),
            option('none', t('ctxNone'), t('ctxNoneHint')),
            option('summary', t('ctxSummary'), t('ctxSummaryHint')),
            option('topics', t('ctxTopics'), t('ctxTopicsHint')),
            option('recent', t('ctxRecent'), t('ctxRecentHint')),
            mode === 'topics'
              ? h(
                  'div',
                  { style: { display: 'flex', flexWrap: 'wrap', gap: 6, margin: '4px 0 10px' } },
                  topics.map((topic) =>
                    h(
                      'button',
                      {
                        type: 'button',
                        key: topic.id,
                        onClick: () => toggleTopic(topic.id),
                        style: {
                          padding: '5px 9px',
                          borderRadius: 999,
                          border: `1px solid ${picked.includes(topic.id) ? C.accent : C.border}`,
                          background: picked.includes(topic.id) ? C.accentSoft : 'transparent',
                          color: C.text,
                          cursor: 'pointer',
                          fontSize: 12,
                          fontFamily: 'inherit',
                        },
                      },
                      `${topic.title}${topic.entries ? ` · ${topic.entries}` : ''}`,
                    ),
                  ),
                )
              : null,
            error ? h('div', { style: { color: C.danger, fontSize: 12, margin: '8px 0', lineHeight: 1.5 } }, error) : null,
            h(
              'div',
              { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 } },
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => setOpen(false),
                  style: {
                    padding: '7px 14px',
                    borderRadius: 7,
                    border: `1px solid ${C.border}`,
                    background: 'transparent',
                    color: C.muted,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  },
                },
                t('ctxCancel'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  disabled: busy,
                  onClick: save,
                  style: {
                    padding: '7px 16px',
                    borderRadius: 7,
                    border: 'none',
                    background: C.accent,
                    color: '#fff',
                    cursor: busy ? 'wait' : 'pointer',
                    opacity: busy ? 0.7 : 1,
                    fontFamily: 'inherit',
                  },
                },
                busy ? t('ctxSaving') : t('ctxSave'),
              ),
            ),
          ),
        ),
      )
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'personal-context locale')
      const t = ctx.locale.bind(NS)

      const execute = async (sessionId, action, payload = {}) => {
        const line = `/${COMMAND} ${JSON.stringify({ action, ...payload })}`
        const response = await ctx.remote.commands.execute(sessionId, line, [])
        if (!response || response.ok !== true) {
          const message = response && response.error && response.error.message ? response.error.message : 'command failed'
          throw new Error(message)
        }
        const value = response.value || {}
        const result = value.result
        let text = ''
        if (typeof result === 'string') text = result
        else if (result && typeof result.text === 'string') text = result.text
        if (result && result.kind === 'error') {
          let message = text || 'command failed'
          try {
            const parsed = JSON.parse(text)
            if (parsed && parsed.error) message = parsed.error
          } catch {
            /* keep raw */
          }
          throw new Error(message)
        }
        try {
          const parsed = JSON.parse(text)
          if (!parsed.ok) throw new Error(parsed.error || 'command failed')
          return parsed.result
        } catch (error) {
          if (error instanceof SyntaxError) throw new Error(text || 'invalid command response')
          throw error
        }
      }

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: 'personal-context',
            order: 30,
            locale: NS,
            label: () => t('panel'),
          },
          BookIcon,
        ),
      )

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: 'personal-context',
            locale: NS,
            inject: () => ({ t, execute }),
          },
          Panel,
        ),
      )

      ctx.slots.inject('conversation.hero.options', () =>
        ctx.slots.register(
          {
            name: 'conversation.hero.options',
            id: 'personal-context-hero',
            order: 20,
            locale: NS,
            inject: () => ({ t }),
            label: () => t('ctxHero'),
          },
          HeroContext,
        ),
      )
    }

    return {
      inject: ['slots', 'remote', 'remote.commands', 'locale'],
      apply,
    }
  },
})
