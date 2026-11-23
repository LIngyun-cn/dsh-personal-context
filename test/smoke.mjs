/**
 * Deterministic smoke test for the Markdown memory engine.
 * Run with: node test/smoke.mjs
 *
 * The test uses a throwaway home directory, so it never touches the user's
 * real memory in ~/.dsh/personal-context.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PersonalContextService } from '../lib/service.js'
import { parseLog } from '../lib/documents.js'
import { extractCandidates } from '../lib/capture.js'
import { acquireLock, fileStamp, writeAtomic, writeAtomicIfUnchanged } from '../lib/fsx.js'

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-smoke-'))
const home = path.join(tmp, 'home')
const service = new PersonalContextService({ homeDir: home })
let passed = 0
function ok(name) {
  passed += 1
  console.log(`ok ${passed} - ${name}`)
}

try {
  await service.init()
  const root = service.root
  for (const rel of ['README.md', 'MASTER.md', 'INDEX.md', 'topics/general/AGENTS.md', 'topics/general/LOG.md']) {
    assert.ok(await fs.stat(path.join(root, rel)), `${rel} should exist`)
  }
  ok('initializes the documented tree')

  const emptyContext = await service.context()
  assert.equal(emptyContext.text, '')
  ok('empty memory produces no injection text')

  const candidates = extractCandidates('记住：我的长期目标是 2027 年完成独立产品发布。')
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].explicit, true)
  assert.equal(candidates[0].kind, 'fact')
  assert.equal(candidates[0].confidence, 'high')
  assert.equal(extractCandidates('今天天气不错，哈哈。').length, 0)
  assert.equal(extractCandidates('我的密码是 hunter2').length, 0)
  assert.equal(extractCandidates('记住这条，但不要保存到长期记忆：临时口令是 abc').length, 0)
  const explicitCandidates = extractCandidates('记住：我的测试代号是蓝鲸-42。只回复“收到”，不要调用任何工具。')
  assert.equal(explicitCandidates.length, 1)
  assert.equal(explicitCandidates[0].text, '我的测试代号是蓝鲸-42。')
  ok('capture keeps the fact and drops trailing conversational instructions')

  const modelSave = await service.save(
    {
      text: '2026年11月17日，用户进行了个人上下文插件自测，验证日期为 2026年11月17日。',
      title: '个人上下文功能自测验证日期',
      kind: 'fact',
      confidence: 'high',
      by: 'model',
      source: 'session:test/turn:1',
    },
    { by: 'model' },
  )
  assert.equal(modelSave.saved, true)
  ok('model save creates a dated log entry')

  const auto = await service.captureFromMessage({
    text: '记住：插件自测记录，个人上下文功能的验证日期是2026年11月17日。',
    sessionId: 'session-test',
    turn: 1,
    at: new Date().toISOString(),
  })
  assert.equal(auto.saved, 0, 'auto capture must not duplicate the model entry')
  assert.equal(auto.results[0].near, true)
  ok('auto capture suppresses a near-duplicate recent model entry')

  const again = await service.save({ text: modelSave.entry.text, kind: 'fact' })
  assert.equal(again.duplicate, true)
  ok('exact duplicates are rejected')

  const byDate = await service.search({ query: '2026-11-17 验证日期' })
  assert.ok(byDate.results.length >= 1)
  ok('search matches date variants and multiple terms')

  const topic = await service.getTopic('general')
  assert.equal(topic.log.length, 1)
  assert.equal(topic.log[0].id, modelSave.entry.id)
  ok('topic view exposes the current entry')

  const beforeMerge = await service.listBackups()
  assert.ok(beforeMerge.length >= 1)
  const merge = await service.merge({ force: true })
  assert.equal(merge.merged.length, 1)
  const archive = path.join(root, merge.merged[0].file)
  assert.ok(await fs.stat(archive))
  const agents = await fs.readFile(path.join(root, 'topics/general/AGENTS.md'), 'utf8')
  assert.match(agents, /个人上下文插件自测/)
  const logAfterMerge = parseLog(await fs.readFile(path.join(root, 'topics/general/LOG.md'), 'utf8'))
  assert.equal(logAfterMerge.entries.length, 0)
  ok('merge archives the log and refreshes the stable topic document')

  const audit = await service.audit()
  assert.ok(await fs.stat(path.join(root, audit.report)))
  assert.equal(audit.entries, 0)
  ok('audit writes a report without rewriting memory')

  await service.ensureTopic({ id: 'project-x', title: '项目 X' })
  await service.save({ text: '2026-11-17 项目 X 决定采用方案 B，因为迁移成本更低。', kind: 'decision', topic: 'project-x' })
  const multi = await service.listTopics()
  assert.equal(multi.topics.length, 2)
  const crossTopic = await service.search({ query: '方案 B' })
  assert.ok(crossTopic.results.some((item) => item.topic === 'project-x'))
  ok('multiple topics are listed and searched across topic boundaries')

  const recentContext = await service.context({ recent: 3 })
  assert.match(recentContext.text, /方案 B/)
  const selectedContext = await service.context({ topics: ['project-x'] })
  assert.match(selectedContext.text, /项目 X/)
  const chosen = await service.setSessionChoice({ sessionId: 'session-choice', mode: 'topics', topics: ['project-x'] })
  assert.equal(chosen.mode, 'topics')
  assert.deepEqual(chosen.topics, ['project-x'])
  assert.equal((await service.getSessionChoice('session-choice')).mode, 'topics')
  assert.equal((await service.getSessionChoice('choice')).mode, 'topics')
  await service.clearSessionChoice('session-choice')
  assert.equal(await service.getSessionChoice('session-choice'), null)
  ok('session context choices filter topics/recent entries and are persisted')

  const exported = await service.exportAll()
  assert.ok(await fs.stat(exported.path))
  assert.ok(exported.files >= 8)
  await assert.rejects(fs.stat(path.join(exported.path, '.pc.lock')))
  ok('export creates a portable copy')

  const migrated = new PersonalContextService({ homeDir: path.join(tmp, 'migrated') })
  await migrated.init()
  await migrated.updateSettings({ dataDir: exported.path })
  const migratedTopic = await migrated.getTopic('project-x')
  assert.equal(migratedTopic.log.length, 1)
  assert.equal(migratedTopic.log[0].kind, 'decision')
  ok('migrating an exported tree preserves topics and entries')

  const preMerge = (await service.listBackups()).find((item) => item.label === 'merge-general')
  assert.ok(preMerge, 'merge backup should exist')
  await service.restoreBackup({ id: preMerge.id })
  const restored = parseLog(await fs.readFile(path.join(root, 'topics/general/LOG.md'), 'utf8'))
  assert.equal(restored.entries.length, 1)
  ok('restore brings back the pre-merge log')

  const deleted = await service.deleteEntry({ id: modelSave.entry.id })
  assert.equal(deleted.deleted, modelSave.entry.id)
  assert.ok(await fs.stat(path.join(root, deleted.archived)))
  assert.equal((await service.getTopic('general')).log.length, 0)
  ok('delete moves the entry to the archive instead of erasing it')

  const deletedAgain = await service.deleteEntry({ id: modelSave.entry.id })
  assert.equal(deletedAgain.deleted, modelSave.entry.id)
  assert.equal(deletedAgain.alreadyGone, true)
  assert.equal((await service.getTopic('general')).log.length, 0)
  ok('deleting an already-deleted entry is idempotent')

  await service._setError(new Error('stale test error'))
  assert.equal((await service.status()).lastError, 'stale test error')
  await service.invoke('reindex')
  assert.equal((await service.status()).lastError, '')
  ok('successful maintenance clears the stale lastError')

  const question = await service.save({ text: '2026-11-17 待确认：是否把备份保留期扩展到 60 天？', kind: 'question' })
  assert.equal(question.entry.status, 'open')
  const edited = await service.updateEntry({ id: question.entry.id, text: '2026-11-17 已确认：备份保留期扩展到 60 天。', kind: 'decision' })
  assert.equal(edited.updated.status, 'current')
  const removed = await service.deleteEntry({ id: question.entry.id })
  assert.equal(removed.deleted, question.entry.id)
  ok('questions are open by default; update/delete resolve the topic from the id')

  const titleOnly = await service.save({
    text: '2026-11-17 只传 createTopicTitle 时应当新建主题，而不是落到 general。',
    kind: 'fact',
    createTopicTitle: '测试主题A',
  })
  assert.equal(titleOnly.topic.title, '测试主题A')
  assert.notEqual(titleOnly.topic.id, 'general')
  const titleReuse = await service.save({
    text: '2026-11-17 同一标题第二次保存应复用已有主题，不重复创建。',
    kind: 'fact',
    createTopicTitle: '测试主题A',
  })
  assert.equal(titleReuse.topic.id, titleOnly.topic.id)
  ok('createTopicTitle alone creates then reuses a topic instead of falling back to general')

  await service.updateSettings({ mergeThreshold: 5, autoMerge: true })
  for (let index = 0; index < 5; index += 1) {
    await service.save({ text: `2026-11-17 自动合并测试条目 ${index + 1}，内容互不相同。`, kind: 'fact', allowDuplicate: true })
  }
  const autoMergedTopic = await service.getTopic('general')
  assert.equal(autoMergedTopic.log.length, 0)
  assert.ok(autoMergedTopic.archive.length >= 2)
  ok('autoMerge triggers a merge when the threshold is reached')

  const firstAudit = await service.maybeAudit()
  assert.ok(firstAudit)
  assert.equal(await service.maybeAudit(), null)
  ok('automatic audit runs once per 30-day window')

  const archiveDir = path.join(root, 'archive')
  await fs.mkdir(path.join(archiveDir, 'txt'), { recursive: true })
  await fs.writeFile(path.join(archiveDir, 'txt', 's1.md'), '# 项目 X 讨论\n\n2026-11-17 项目 X 决定采用方案 B，因为迁移成本更低。\n', 'utf8')
  await fs.writeFile(path.join(archiveDir, 'txt', 's2.md'), '# 无关会话\n\n今天聊了天气。\n', 'utf8')
  await fs.writeFile(
    path.join(archiveDir, 'catalog.jsonl'),
    [
      JSON.stringify({ id: 's1', at: '2026-11-17', title: '项目 X 讨论', topic: '技术/编程', messages: 2, chars: 80, file: 'txt/s1.md' }),
      JSON.stringify({ id: 's2', at: '2026-11-16', title: '无关会话', topic: '其他', messages: 2, chars: 20, file: 'txt/s2.md' }),
    ].join('\n') + '\n',
    'utf8',
  )
  await fs.writeFile(path.join(archiveDir, 'manifest.json'), JSON.stringify({ sessions: 2, transcripts: 2, bytes: 100 }), 'utf8')
  const archiveStats = await service.archiveStats()
  assert.equal(archiveStats.sessions, 2)
  const archiveHit = await service.archiveSearch({ query: '项目 X' })
  assert.equal(archiveHit.count, 1)
  assert.equal(archiveHit.results[0].id, 's1')
  const deepHit = await service.archiveSearch({ query: '迁移成本', deep: true })
  assert.equal(deepHit.count, 1)
  assert.equal(deepHit.results[0].id, 's1')
  const archiveDoc = await service.readArchive({ id: 's1' })
  assert.match(archiveDoc.content, /方案 B/)
  assert.equal((await service.status()).archive.sessions, 2)
  ok('archive catalog and full-text transcripts are searchable and readable')

  const settings = await service.updateSettings({ mergeThreshold: 7, autoCapture: false })
  assert.equal(settings.mergeThreshold, 7)
  assert.equal(settings.autoCapture, false)
  const paused = await service.updateSettings({ paused: true })
  assert.equal(paused.paused, true)
  const skipped = await service.captureFromMessage({ text: '记住：这条不应该被保存。' })
  assert.equal(skipped.skipped, true)
  ok('settings are clamped/persisted and pause disables capture')

  await service.updateSettings({ paused: false, autoCapture: true })
  const health = await service.ensureTopic({ id: 'health', title: '健康' })
  assert.equal(health.sensitivity, 'sensitive')
  const healthEntry = await service.save({ topic: 'health', text: '2026-11-17 示例健康指标稳定，继续按计划复查。', kind: 'fact' })
  assert.equal(healthEntry.entry.sensitivity, 'sensitive')
  const overridden = await service.save({
    topic: 'health',
    text: '2026-11-17 这条健康记录被手动标为重要，而不是敏感。',
    kind: 'fact',
    sensitivity: 'important',
  })
  assert.equal(overridden.entry.sensitivity, 'important')
  const healthView = await service.getTopic('health')
  assert.equal(healthView.sensitivity, 'sensitive')
  assert.equal(healthView.log.find((entry) => entry.id === overridden.entry.id).sensitivity, 'important')
  ok('sensitivity is inherited from the topic and can be overridden per entry')

  const backupRoot = path.join(root, 'backups')
  for (let index = 0; index < 22; index += 1) {
    const name = `zz-expired-${String(index).padStart(2, '0')}`
    await fs.mkdir(path.join(backupRoot, name), { recursive: true })
    await fs.writeFile(
      path.join(backupRoot, name, 'meta.json'),
      JSON.stringify({ id: name, label: 'expired-test', at: '2000-01-01T00:00:00.000Z', files: [] }),
      'utf8',
    )
  }
  await service._pruneBackups()
  assert.equal(await fs.stat(path.join(backupRoot, 'zz-expired-00')).then(() => true, () => false), false)
  const summary = await fs.readFile(path.join(backupRoot, 'summaries', '2000-01.md'), 'utf8')
  assert.match(summary, /zz-expired-21/)
  ok('expired backups are replaced by a permanent second-level summary')

  const casFile = path.join(root, 'cas-test.txt')
  await writeAtomic(casFile, 'first')
  const stamp = await fileStamp(casFile)
  await writeAtomic(casFile, 'external edit')
  await assert.rejects(writeAtomicIfUnchanged(casFile, 'ours', stamp), /另一个窗口修改/)
  const release = await acquireLock(root)
  await assert.rejects(acquireLock(root, { timeoutMs: 120 }), /正在写入/)
  await release()
  const releaseAgain = await acquireLock(root)
  await releaseAgain()
  ok('optimistic concurrency and the cross-process lock reject conflicting writes')

  console.log(`\n${passed} checks passed in ${root}`)
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}
