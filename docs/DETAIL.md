# 技术细节与设计说明

本文面向想理解、修改或二次开发插件的用户。使用说明见 [README.md](../README.md)。

## 1. 总体架构

```text
┌──────────────────────────── DSH Web (browser) ────────────────────────────┐
│  sidebar.panellist  id=personal-context   →   main  key=personal-context  │
│                    React 面板（总览/主题/搜索/设置）                       │
└───────────────────────────────────┬───────────────────────────────────────┘
                                    │ ctx.remote.commands.execute(sessionId,
                                    │   '/personal-context {json}')
┌───────────────────────────────────▼───────────────────────────────────────┐
│ Host 插件 dsh-personal-context                                            │
│                                                                           │
│  index.js                                                                 │
│   ├─ systemPrompt.section()   告知模型何时检索/保存                        │
│   ├─ ctx.tools.register        personal_context（agent 直接调用）          │
│   ├─ ctx.commands.register     /personal-context（UI 与人工入口）          │
│   ├─ session/event             user/message 收集，turn/end 落盘            │
│   └─ agent/created             agent.inject() 注入精简上下文               │
│                                                                           │
│  PersonalContextService  ← 唯一业务实现（面板/命令/工具共用）              │
│   ├─ 文档协议 documents.js   ← Markdown + 单行 JSON 注释                   │
│   ├─ 规则捕获 capture.js     ← 确定性、零成本                              │
│   ├─ 文件层 fsx.js           ← 原子写、路径包含、哈希/相似度               │
│   └─ 状态 settings.json / state.json                                       │
│                                                                           │
│  Memory/  ← 用户资产（纯 Markdown，可手改、可迁移）                        │
└───────────────────────────────────────────────────────────────────────────┘
```

### 为什么是 Host-only bundle

- 不需要构建、没有 npm 运行时依赖，安装即可用；
- 客户端只负责展示，所有数据操作在 Host 完成，避免浏览器直接碰文件系统；
- 记忆格式与 DSH 解耦：即使插件损坏，`Memory/` 仍可被任何编辑器或模型读取。

### 为什么用会话命令做 UI 通道

DSH 的自定义 Typert Remote namespace 需要生成贡献与构建工具链，纯 bundle 无法可靠声明；HTTP 命名路由又没有内建鉴权。会话命令 `ctx.commands.register` 是公开、稳定、已鉴权的通道：

```js
ctx.commands.register({
  name: 'personal-context',
  description: '...',
  input: { hint: '{action:...}' },
  handler: async ({ agent, rawInput }) => ({
    kind: 'success',
    text: JSON.stringify({ ok: true, result }),
  }),
})
```

客户端：

```js
ctx.remote.commands.execute(sessionId, `/personal-context ${JSON.stringify({ action, ...payload })}`, [])
// → { ok:true, value:{ commandId, result:{ kind, text } } }
```

代价是面板操作需要当前有会话；没有会话时显示提示（纯浏览可直接打开文件）。

唯一的例外是「新会话先选上下文」：空白会话还没有可执行的 agent，命令不可用。这个选择改由本机 JSON 路由 `/personal-context/session` 承载，带客户端标记 + 同源校验，只读写「本会话加载哪些上下文」，不暴露记忆内容。详见第 3 节。

## 2. 会话生命周期与自动捕获

DSH 没有「会话结束」Cordis 事件。可用的是 `session/event`（提交后触发）与 `turn/end` 数据事件，因此捕获按轮落盘：

```text
user/message (source.kind === 'user')
      │ 仅收集用户文本；跳过 / 开头的命令、子代理会话
      ▼
per-session buffer（按 turn 累积）
      │ turn/end
      ▼
captureFromMessage({ text, sessionId, turn, workspace })
      │ extractCandidates() 规则打分
      ▼
save({ by:'auto' })  → 去重 → 解析主题 → 备份 → 追加 LOG → 更新 INDEX
```

要点：

- **只读用户消息**。助手消息不进入自动捕获，防止模型推测污染用户事实；助手认为重要的结论由模型主动 `save`。
- **子代理不捕获**。`agent/created` 中 `source === 'subagent'` 的会话加入内存 Set，跳过来自委派任务的提示词。
- **失败可见**。`save` 失败会写入 `state.lastError` 并在面板显示；命令/工具返回 `{ok:false,error}`，不假装成功。
- **暂停语义**。`paused` 或 `autoCapture=false` 时 `captureFromMessage` 返回 `{skipped:true}`；手动与工具写入不受影响。
- **会话级不记录**。`sessionChoices[id].capture === false` 时，`flush` 与 `captureFromMessage` 都跳过；模型工具带 `sessionId` 的写操作在 `invoke` 入口被拒绝，读取仍允许。该状态只阻止新写入，不删除已有条目；侧栏手动保存不受影响。
- **没有「会话关闭」保证**：应用在轮次中途被强杀时，该轮可能未落盘；这是当前 DSH 生命周期的硬限制。

### 规则捕获（capture.js）

`extractCandidates(rawText, { minScore=2 })`：

- 先排除：代码块、链接、问候/寒暄、纯问题（除非含显式记忆词）、秘密模式；
- 按线索词打分：偏好/决定 3 分，观点/想法/待解决/事实 2 分，含数字的事实 +1；
- 显式记忆词（`记住`、`记一下`、`remember`、`note that`）直接 8 分、`high` 置信度；
- 一条消息最多 3 条候选，每条截断到可读长度并生成短标题。

设计目标是**高精度、低打扰**：宁可漏记，也不把闲聊或推测写进长期记忆；语义层面的取舍交给模型工具。

### 去重

1. **精确**：规范化后哈希相同，或文本完全相同。
2. **近似**：字符二元组 Jaccard `similarity >= 0.92`，在每主题最近 250 条内比较。
3. **模型—自动跨通道**（`by === 'auto'` 时优先）：
   - 扫描最近 60 条、`by === 'model'`、20 分钟内；
   - 双方共享日期/数字 token；
   - 最长公共连续子串 `>= 4`。
   命中则返回 `{duplicate:true, near:true}`，避免「模型已存、规则又存一遍」。

日期会做 `2026年11月17日` ↔ `2026-11-17` 变体归一，因此跨格式仍能命中。

## 3. 检索与注入

### 新会话注入与「先选上下文」

新会话可能在用户还没说话时就已创建，`agent/created` 会先于选择发生，所以不能用一次性的 `agent.inject()` 决定内容。实现改为**每个 agent 注册一个动态系统提示段**：

```js
agent.ctx.systemPrompt.section({
  name: 'personal-context:session',
  order: 41,
  text: () => record.text,   // 每次组装提示词时读取当前选择
})
```

- `record.text` 由 `buildSessionPrompt(choice)` 生成；POST 选择后重新计算并带 revision 计数，避免与默认摘要的异步计算互相覆盖；
- 选择存 `state.json` 的 `sessionChoices`（键去掉 `session-` 前缀，最多 200 条），因此刷新、重开同一会话仍有效；
- 模式：`none` 不注入；`summary` 为 `MASTER` 摘要 + 主题索引；`topics` 追加所选主题的稳定概述；`recent` 追加最近 12 条日志；
- 会话选择另带独立的 `capture` 布尔值（默认 `true`）：为 `false` 时该会话不自动捕获，模型工具写入也会被拒绝；它不改变 `mode`，因此可以「导入上下文但不记录新内容」；
- 注入内容带 `<personal-context note="本次会话按用户选择加载的长期记忆…">` 包裹，模型知道这是背景资料，不是用户发言；
- 空库（MASTER 无内容、条目为 0、也没有档案）返回空文本，不注入；
- 该段在整个会话内持续存在，不只在第一轮；内容长度受 `injectBudget` 限制。

没有选择（旧会话、直接调用 API 之外的情况）时走 `summary`，与旧行为兼容。

选前 UI 需要一个不依赖命令通道的读写路径，因此 `index.js` 增加了本机 JSON 路由：

- `GET /personal-context/session?sessionId=…` 返回当前选择与可选主题；
- `POST /personal-context/session` 写入 `{sessionId,mode,topics,capture}`；`capture` 省略时沿用旧值，旧记录默认 `true`；
- 必须带 `x-pc-client: dsh-personal-context`（客户端标记，不是认证），并拒绝非同源 `Origin`；没有 CORS 头，跨站脚本无法读取响应或发请求；
- 该路由只管理「本会话加载哪些上下文」，不暴露记忆内容，也不改变长期文档。

插件把 `webServer` 声明为硬依赖；宿主没有该服务时插件不会激活，选择器也不会出现。面板与工具本身不依赖该路由，但当前 bundle 以 Web 端为主要目标。

### 主动检索

`search`：

- 查询按空白、`，、；` 分词；
- 每个词做日期变体扩展；
- 命中任一词即候选，按「命中词比例 + 文本相似度 + 时间衰减」排序；
- 同时扫描 `AGENTS.md` 的稳定段落（权重更高），避免只搜到流水日志；
- 返回主题、性质、日期、摘要、分数，限制条数。

`context({query})` 会把最相关的 6 条并入注入文本，适合模型在回答前做一次低成本检索。

### 历史档案层

`Memory/archive/` 是只读的全量历史会话，不参与合并，也不进入每轮注入：

- `catalog.jsonl`：每行 `{id,at,title,topic,messages,chars,file}`，用于标题/主题快速检索；
- `manifest.json`：`{version,source,importedAt,sessions,transcripts,bytes}`；
- `txt/<id>.md`：完整会话原文，按 id 定位。

`archive` action 先查 catalog：对标题、主题、摘要做分词与相似度排序，分数 `matched*4 + similarity*3 + log10(chars)`；`deep:true` 时再逐文件扫描全文，命中首个词的位置并截取摘要。扫描全部会话后统一排序、截断到 `limit`，避免「先命中先返回」的偏置。`archive_doc` 用 id 前缀定位文件，经 `safeJoin` 校验后读取，最多返回 30,000 字并标记 `truncated`。

`context()` 会在末尾附加一行档案统计（会话数、MB），让模型知道还有原文可查；空库判断也把「有档案」视为非空。档案不占用 `injectBudget`，只有显式检索时才读取。

### Token 成本

- 插件自身不调用 LLM；
- 每轮自动捕获是纯正则/字符串运算；
- 新会话注入默认 ≤1200 字符；
- 工具结果 JSON 在 `index.js` 中截断到 16 KB；
- 深度检索由模型按需发起，避免每轮加载整库。

## 4. Markdown 协议

文件全部 UTF-8、LF/CRLF 均可解析。机器字段是单行 HTML 注释，正文可手改。

### 文件与标记

| 文件 | 标记 | 作用 |
| --- | --- | --- |
| `MASTER.md` | `<!-- pc:master {...} -->` | 全局画像，按节组织 |
| `INDEX.md` | `<!-- pc:index {...} -->` | 主题索引 |
| `topics/<id>/AGENTS.md` | `<!-- pc:topic {...} -->` | 主题稳定文档 |
| `topics/<id>/LOG.md` | `<!-- pc:log {...} -->` + 每条 `<!-- pc:entry {...} -->` | 动态日志 |

`MASTER_SECTIONS`：个人背景、思考与决策习惯、长期目标、交流偏好、其他稳定信息。

`AGENT_SECTIONS`：背景、当前状态、重要结论、待解决、历史。

`KINDS`：`fact`、`preference`、`opinion`、`decision`、`idea`、`question`、`inference`，对应中文标签「事实/偏好/观点/决定/想法/待解决/推测」。

`entry` 字段：

```json
{
  "id": "e_xxx",
  "kind": "decision",
  "title": "采用方案 B",
  "at": "2026-11-17T14:02:11.000Z",
  "source": "session:65a8c3f5/turn:3",
  "by": "model",
  "confidence": "high",
  "status": "current",
  "sensitivity": "normal",
  "hash": "..."
}
```

`status`：`current`（当前有效）、`open`（待解决）、`superseded`（已被修正）、`archived`（归档）。旧记录不删除；观点变化时新增记录并在正文写「此前为……」。
`sensitivity`：`normal` / `important` / `sensitive`，可省略；省略时由 `getTopic` 用主题默认值补齐。`AGENTS.md` 与 `INDEX.md` 的 `pc:topic` / `pc:index` 也保存主题级 `sensitivity`。旧库首次以 0.4.0 启动时，`_ensureTree` 会只为缺少该字段的主题补写元数据，不改写 LOG 正文。
默认规则在 `service.js` `defaultSensitivity(id,title)`：健康/身体/家庭/情绪/消费/兴趣 → `sensitive`，与 AI 的关系 → `important`，其余 `normal`。该字段只用于展示，不参与 `context()` 的筛选。

`sanitizeBody` 会把正文里的 `-->` 和 `<!-- pc:entry` 转义，防止破坏注释边界。

## 5. 合并算法

触发：`merge({topic?, force?})`。未指定主题时对所有主题执行；`force` 忽略阈值。

对每个主题：

1. 读取 LOG 全部条目；不足 `mergeThreshold` 且未 force → 跳过并报告；
2. 备份 `INDEX/AGENTS/LOG/MASTER`；
3. 把完整旧日志写入 `archive/LOG-<day>-<seq>.md`（保留原文、时间、来源、性质）；
4. 用确定性规则重建 AGENTS：
   - 背景：保留人工维护的内容，没有则写占位；
   - 当前状态：最近 120 天内 fact/preference/decision/question，最多 16 条；
   - 重要结论：decision，最多 12 条；
   - 待解决：`status=open` 的 question，最多 10 条；
   - 历史：保留旧历史尾部 40 条 + 本次合并说明 + 超过 180 天的决定；
5. LOG 重置为只有头部；
6. INDEX 更新 `entries:0`、`archived += n`、关键词；
7. 返回 `{merged:[{topic,archived,file}], skipped}`。

合并是**显式或阈值触发**的，不会在每轮对话里自动重写大文件；这符合「高频追加、低频改写」。当 `autoMerge` 开启且某次保存使 LOG 达到 `mergeThreshold` 时，`save()` 会在释放写锁后对该主题调用一次 `merge()`；失败只记录 `state.lastError`，不影响记录本身已落盘。

## 6. 审计

`audit()` 遍历所有主题：
- 完全重复：同 hash；
- 过期：`status=current` 且 `at` 超过 180 天；
- 潜在冲突：两两相似度 ≥0.5，且一方含否定词（`不/没/无/未/停止/放弃/不再/never/not/...`）另一方不含；
- 结构问题：INDEX 中的主题无目录、目录未登记 INDEX。

报告写到 `reports/audit-<day>-<rand>.md`，包含统计、冲突对照、重复候选、过期条目、结构问题。审计**只报告**，不自动删除或改写；无法判断的冲突交给用户。

`maybeAudit()` 在插件启动时执行：`autoAudit` 开启且 `state.lastAuditAt` 距今 ≥30 天（或从未审计）时跑一次 `audit()`，成功后更新 `lastAuditAt`。因此「每月审计」不依赖常驻定时器，而是在每次加载插件时补齐。

## 7. 备份、恢复、导出、导入

- 备份目录：`backups/<compactstamp>-<label>-<hash>/`，含 `meta.json {id,label,at,files}` 与 `files/<相对路径>`。
- 每次 `save/merge/delete/update/restore` 前自动备份。`retention`（默认 120）限制份数，`retentionDays`（默认 180 天）限制精确保留窗口。
- 清理策略 `_pruneBackups()`：按 `meta.at` 从旧到新扫描；超出份数或超过天数的备份先调用 `_summarizeBackup()` 写入 `backups/summaries/<YYYY-MM>.md`，内容含备份 id、时间、标签、每个文件的字符数与哈希、LOG 条目的日期/性质/标题/id；写入成功后才 `fs.rm` 原始目录。摘要不参与清理，永久保留。
- 恢复到窗口内的备份：先备份当前文件（`pre-restore`），再把快照文件复制回去；非法 id（含 `..`、路径分隔符）直接拒绝。
- 导出：复制整树（跳过 `exports/` 与符号链接）到 `exports/personal-context-<stamp>/`，写 `manifest.json`。
- 导入：要求源目录含 `MASTER.md`，复制到 `imports/import-<stamp>/`，返回切换 `dataDir` 的提示；不直接覆盖当前库。

## 8. 并发、原子性与安全

- `_locked(fn)` 先走进程内 Promise 链，再获取 `Memory/.pc.lock`；锁文件用 `fs.open(..., 'wx')` 原子创建，内含 pid/token/时间，释放时校验 token，避免误删别人的锁。持锁超过 30 秒视为陈旧锁并自动清除；8 秒拿不到锁返回 `EPC_LOCKED`「另一个窗口正在写入，请稍后重试」。
- `writeAtomic`：同目录临时文件 → `writeFile` → `fsync` → `rename`；Windows 上 `EPERM/EACCES/EEXIST` 会先 unlink 重试。
- 关键 RMW 路径（LOG/INDEX/MASTER/merge/delete/update）在读取时记录 `fileStamp = size:sha256`，写入前用 `writeAtomicIfUnchanged` 再比一次；不一致抛 `EPC_CONFLICT`「文件已被另一个窗口修改，请刷新后重试」，避免覆盖外部编辑。
- 路径：主题 id 仅 `[a-zA-Z0-9_-]+`；`safeJoin(root, ...parts)` 做 `path.relative` 包含检查；备份/恢复逐文件校验。
- 符号链接：导出与导入跳过 symlink，避免复制到库外。
- 秘密过滤是正则兜底，不保证完备；文档明确提示不要把敏感内容写进对话。
- 记忆与备份不加密，依赖操作系统账户与磁盘权限。

## 9. 故障语义

| 场景 | 行为 |
| --- | --- |
| 保存失败（磁盘/权限） | 抛错 → 命令返回 `{ok:false,error}`，工具报错，`state.lastError` 记录，面板显示「未保存成功」 |
| 外部编辑冲突 | `EPC_CONFLICT`，不覆盖对方内容；提示刷新后重试 |
| 另一进程持锁 | `EPC_LOCKED`，等待 8 秒后失败；不写入 |
| 捕获失败 | 不阻塞对话；错误进 `state.lastError`；下一轮继续尝试 |
| 主题不存在 | `createTopicTitle` 存在则创建；否则回退 `general` |
| 备份 id 非法 | 拒绝，不触碰文件 |
| 空库 | `context()` 返回空串，不注入 |
| 无活动会话 | 面板提示先打开会话；命令本身需要有 agent |

## 10. 扩展点

- **新增记录性质**：在 `documents.js` 的 `KINDS/KIND_LABELS` 增加，并调整 UI 下拉与捕获线索。
- **新增稳定文档节**：改 `MASTER_SECTIONS` / `AGENT_SECTIONS`，解析器按标题读取，旧文件缺节会自动补。
- **换存储后端**：`PersonalContextService` 的文件方法集中在 `_p()/file()/topicDir()/writeAtomic`；替换为数据库时保持公开方法不变即可，Markdown 仍可作为导出格式。
- **接 LLM 抽取（可选）**：目前刻意不接；如需，应在 `captureFromMessage` 前增加可配置的 `ctx.llm.stream` 调用，并保留规则兜底与「推测只能 inference」约束。成本与延迟需自行评估。
- **新 UI 动作**：在 `service.invoke` 增加 action，并在 `client.js` 调用同一 action；不要复制业务逻辑。

## 11. 验证记录（本次实现）

- `node test/smoke.mjs`：31 项断言全部通过（初始化、空库、捕获过滤、模型写入、近似/精确去重、检索、合并、审计、多主题跨主题检索、会话选择过滤主题/最近记录/不导入、会话不记录默认/继承/自动捕获与模型写入拦截/恢复、导出、迁移、恢复、删除归档、重复删除幂等、成功操作清理旧错误、question 默认 open、自动合并、自动审计、敏感度继承/覆盖、过期备份二级摘要、并发锁/冲突检测、档案索引/全文检索/原文读取、配置/暂停）。
- 真机：侧栏入口、暗色主题、总览/主题/搜索/档案/设置五页、手动保存、编辑、删除归档、暂停/恢复、备份列表、搜索空态、设置保存均验证。
- 档案导入：使用 640 会话的本地数据集验证，catalog 行数与 `dataset/txt` 文件数一致；`archive` 标题检索与 `deep` 全文检索通过，`archive_doc` 原文前 30,000 字可读。
- 真机：一轮用户消息触发 `personal_context save` + `turn/end` 自动捕获；近似去重修复后不再产生重复条目。最终一轮「记住：……只回复收到」验证了：模型未调用工具时，自动捕获仍写入 `fact`，且句末指令不会被并入事实正文。
- 启动时 `autoAudit` 自动生成空库审计报告（0 冲突/0 重复/0 过期/0 结构问题），并写入 `state.lastAuditAt`。
- 文件检查：LOG/INDEX/MASTER 的 UTF-8 内容、机器注释、备份目录结构均符合协议。

- 真机：新会话「记忆」选择器四模式均验证。`按主题` 选两个示例主题后，第一轮和后续轮次模型都只能看到这两个主题的稳定概述；`不导入任何上下文` 时模型回答「无」；`最近记录` 注入 12 条上限内的日志。
- 真机：会话选择通过 `/personal-context/session` 写入，刷新后仍在；GET 无客户端标记 / 跨源 Origin 均 403；同源带标记可读回。

## 12. 版本

`0.4.0`。协议版本 `DOC_VERSION = 1`；`INDEX` 的 `version` 字段用于未来迁移。变更协议时应递增并在 `_ensureTree` 中提供向后兼容读取。0.2.0 新增历史档案层（archive、archive_doc、档案页、导入脚本）；0.3.0 新增新会话「先选上下文」选择器、按会话的动态系统提示注入与本机 JSON 路由；0.4.0 新增主题/记录敏感度标记、180 天 + 120 份的备份保留与永久二级摘要、跨进程锁和写入前版本校验。`settings.version` 从 1 迁移到 2 时，仅调整备份保留默认值，不改写既有记忆正文。
