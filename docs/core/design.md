# 核心（core）

> 代码：[`packages/core`](../../packages/core) · 接口：[`packages/contracts/src/core.ts`](../../packages/contracts/src/core.ts) · 契约：[contracts.md](../contracts.md)

## 概要

核心不管教学，只管所有单元共用的底层：数据库和各单元的升级脚本、课程和它对应的 DSH 工作区、课程文件的读写和变更日志、会话归属、学习证据日志、修改提案的存放，以及页面调用的接口和变更推送。别的单元都经 `learnCore` 用这些能力；最小学习流程（`tests/flow.test.ts`）每一步都经过这里。核心只存提案，不处理提案（处理归 [tutor](../tutor/design.md)）。

## 数据库和升级

- 全局一个 SQLite 数据库（Node 自带的 `node:sqlite`），在数据根目录的 `.learning/learning.db`。数据根目录默认 `文档/学习库`，环境变量 `LEARNING_HOME` 可以改。
- 每个单元只碰以自己名字开头的表；升级脚本由单元自己提供，启动时经 `db.migrate(unit, steps)` 执行，可以重复调用。
- `db.transaction(fn)` 把一组写入放进一个事务，嵌套调用并入外层的事务。
- 每个学习库持有进程运行锁，备份和第二个服务实例不能同时打开它；程序异常退出后只回收确认已退出进程的锁。单元迁移前用 `VACUUM INTO` 留下完整数据库快照，失败信息给出快照路径；库版本比代码新时拒绝迁移。

## 备份和恢复

`pnpm backup` 在 DSH 停止时导出 SQLite 快照、学习库文件、DSH 会话和附件、工作区登记，清单记录代码提交、迁移版本和各文件的 SHA-256。密钥、WAL、运行锁不复制。恢复先校验全部文件和数据库完整性，再发布到空目标；会话通过锁定 DSH 的公开存储接口在新目录重建，ID、事件和继承关系保留，工作目录与工作区路径按新学习库重定位，原备份不变。操作见 [development.md](../development.md#备份和恢复)。

## 课程和工作区

- `courses.create` 建课程文件夹、把它登记为 DSH 工作区、写 `course.md`，然后发 `learning/course-created` 和一句 `learning/handoff`。
- 课程的状态有进行中、已结课、归档。`courses.setStatus` 改状态并发 `learning/course-updated`：curriculum 写完课程报告时标为已结课，结课后又加了阶段时改回进行中。

## 课程文件和变更日志

- 课程文件只经 `files.write`、`files.append` 写入。每次写入记一条变更（谁改的、大改还是小改、修改前后的全文、对应的提案），写盘成功后发 `learning/doc-changed`。
- `write` 的 `ifHash`：文件当前的内容指纹不是它就不写，报 `learning/core/conflict`；`null` 表示只在文件不存在时写。讲义生成和修改靠它不覆盖期间的修改。
- `files.read` 按内容指纹发现在应用外面改过的文件，记成一次学习者的修改，不会悄悄丢失。
- 数据库记录的修改由主人单元自己做，再用 `changes.record` 记下前后快照；变更可以带课程和操作组（knowledge 的结构修改），`changes.list` 能按操作组过滤，`get` 读单条。
- `changes.revert` 把一次文件变更的修改前内容写回，记成一次新的变更。知识结构的撤销由 knowledge 自己做。

## 会话归属

DSH 的会话头里不能存我们的信息，所以每个会话属于哪门课、哪个阶段、什么角色（主老师、侧边会话），打开时在哪个页面、选中了什么，记在核心的表里。先 `sessions.link` 登记，再用我们生成的 ID 建会话，不会有孤儿会话；结束时 `sessions.close`。

## 证据日志和提案

- `log.append` 追加一条学习证据，提交后发 `learning/logged`。日志只增不减。
- `log.query` 默认按 ID 从旧到新；`after`（不含这条）按 ID 一页一页读完整个日志，单次最多 10 万条；`newest` 新的在前，配合 `limit` 取最近几条。`log.count()` 是日志条数，读的一方据此知道有没有漏掉记录。
- 提案存在核心：`proposals.create` 发 `learning/proposal-created`；`proposals.decide` 记下结论、对应的变更和写给学习者的说明（`note`），提交后发 `learning/proposal-decided`。

## 页面接口和推送

- `api.endpoint` 在 `/api/learning/<单元>.<方法>` 注册一个精确路由，挂在 DSH 已认证的通道上，沿用 DSH 的 RPC 信封；请求用契约的数据格式校验。不拦截整个 `/api`，那属于 DSH 的网关。
- 出错时返回 `{ code, message, details }`：处理函数抛 `LearningApiError` 选错误码；校验失败是 `learning/invalid-input`，`message` 把各条说明连成一句话，`details.issues` 是原始结果。
- 推送通道 `/api/learning/feed`（服务端持续推送）把契约里的 `FEED_EVENTS` 自动转给打开的页面；单元可以用 `feed.publish` 推别的消息（如讲义的生成进度）。

## 数据与接口

- **服务：** `learnCore`（`dataRoot`、`api`、`feed`、`db`、`courses`、`files`、`changes`、`sessions`、`log`、`proposals`），定义在 [`core.ts`](../../packages/contracts/src/core.ts)。
- **页面接口：** `core.courses`、`core.createCourse`、`core.changes`。
- **事件：** `learning/course-created`、`course-updated`、`doc-changed`、`logged`、`proposal-created`、`proposal-decided`、`change-applied`。

## 关键决定

- **学习证据只追加、不修改；掌握状态由规则推算、可以重算**（10-03，你确认）：符合"只有作答能证明掌握"；`learner` 最后才做深，规则会改，重算比迁移数据可靠。
- **你要读的放 Markdown，状态和要查询的放数据库，每类只存一份**（10-03，你确认）。
- **学习数据放在 `文档/学习库`，和代码仓库分开，可以用 Obsidian 打开**（10-03，你确认）：教材、照片、学习记录都不会进代码仓库。
- **TypeScript + pnpm 工作区，各单元只依赖契约包；这个单元叫 `core` 而不是 `store`**（10-03，你确认）：它除了存储，还负责接口、推送和会话归属。
- **数据库用 Node 自带的 `node:sqlite`**（10-03，阶段 0 调研）：DSH 的存储也用它，中文全文检索实测可用，可以加载向量扩展。
- **接口用精确路由，不拦截 `/api`，暂不用 DSH 的类型化接口生成**（10-03，阶段 0 验证）：拦截 `/api` 会挤掉 DSH 的网关。

## 已知限制与以后再做

- 备份恢复仅在 Linux 上验证；Windows 文件占用行为仍需本机试用。恢复库内 `.dsh-home` 只放会话、附件与工作区，不带插件安装或密钥，启动前需安装 learning profile；设置 `DSH_HOME` 指向它。历史消息正文里的绝对路径不改写，已有文件引用可能仍指向旧地址。旧版本程序没有运行锁，升级后先停止所有旧实例。
- 文件回退只有服务（`changes.revert`），没有通用的页面入口；知识模型页有它自己的整组撤销。
- 以后再做：出错时把课程、任务、提交、会话和服务串成一条本机诊断记录（导出时去掉密钥和教材原文）；大 PDF、多门课的知识图、长会话和长讲义的性能预算，按 `learning-perf` 先测再定。两项来自 11-02 审查的 M07、M10（[记录](../history/2026-11-audit/README.md)）。
