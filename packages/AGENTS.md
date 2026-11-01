# 开发约定：packages/

改 `packages/` 下的代码时，在[根目录的约定](../AGENTS.md)之外还要守这些规则。Claude 通过同目录的 [CLAUDE.md](CLAUDE.md) 读本文件。单元之间的服务、事件和数据归属见 [contracts.md](../docs/contracts.md)，界面的组件目录和截图方法见 `learning-ui-review` 技能。

## 单元与契约

- TypeScript + pnpm 工作区；DSH 锁定 `0.2.0-rc.2`。按本机这个版本的真实接口开发（`.tools/dsh/node_modules/@deepseek-ai/*/lib/types`），不凭印象。
- 单元不互相 import 业务代码，通过 `@learning-agent/contracts` 的服务、类型和事件协作。`kit` 只放共用的辅助代码，不做业务数据的主人。
- 服务名用 `learn*`，事件用 `learning/*`，接口用 `/api/learning/<单元>.<方法>` 精确路由。不接管 `/api` 的 RPC interceptor，它属于 DSH 网关。
- 每类数据只有一个真相来源，每张表和每个文件只有一个主人单元；跨单元修改要调用主人的服务。
- 课程 Markdown 只通过 `core` 写入并保留变更记录。先写盘，再发事件；出错时要向界面说明具体原因。
- 契约包会打进各单元，所以不用 `instanceof` 判断跨包的契约类。前端、后端分别做类型检查。

## 学习规则（在执行操作的代码里检查）

- 学习证据只追加，不修改、不删除；掌握状态由证据规则推算，可以重算。阅读、聊天、批注不直接证明掌握；帮助要记账。
- 练习题和测试预留题分开：摸底、小测、练习只用练习题池，阶段测试和模拟考只用测试预留题。讲义里不得出现习题、小测题或测试安排。
- 内容和题目必须有可追溯的出处，模型自己的知识不是出处；没有有效出处的讲义块标为待核实。阶段设计先写验收与测试蓝图，再写教学内容；蓝图只写考什么、怎么考，不写具体题目。
- 写给学习者看的文字（目标、路线、设计书、讲义、小结）不出现内部编号（`kn_`、`ck_` 等）；出处写成 `[《书名》p.页码](cite:片段ID)`。
- 图片经用户消息输入模型，当前中转不支持工具结果里的图片。手写判分前要学习者确认识别结果。一次性调用带图片用 `kit` 的 `complete()` 的 `images`。
- **交回主老师：** 学习者在页面上做完一件事（确认、交卷、点"完成"、加资料、新建课程），或后台任务结束（生成讲义、解析资料）时，由负责的单元发 `learning/handoff`（一句话，不写内部编号）。主老师自己调用工具做的事不发。要不要唤醒主老师由 `tutor` 按 `planner` 的下一步决定，单元不自己给老师的会话发消息。

## 设置项

- 会随部署变化、学习者可以改的选项，写成单元的 Config 字段并加 `.volatile()`（设置页改了不用重启就生效）。单元要在 `package.json` 的 `peerDependencies` 里声明 `@deepseek-ai/schemastery`，否则 DSH 加载时找不到它。
- 密钥不写进 Config，用 `kit` 的 `secret()` 按名称读取。
- 设置页（`settings` 单元）只读写 DSH 的设置、密钥、模型和插件服务，不读别的单元的业务字段。模型角色（`roleModel()`）自动列进"模型分工"；其他设置项由所属单元往 `learning.settings.services` 插槽登记一块，用 `SettingRow`、`Switch`、`SecretField`、`TestButton` 等共享控件。
- 选回默认值时保存为"未设置"：单元以后改了默认值，学习者自动跟上。

## 前端

- 图标用 lucide-react 的线条图标（`strokeWidth` 1.75），不用 emoji。左边的图标栏只显示图标，悬停显示 2–4 字的名称；设置这类工具入口放在图标栏底部（`placement: 'foot'`）。
- 页面数据用 `kit` 的 `useLoad`，默认收到任何 `learning/` 推送就刷新；只有刷新会打断用户（比如作答中）时才缩小范围。
- 页面用 `kit/client` 的页面骨架（`Page`、`PageHeader`、`Section` 等），控件用共享设计控件，样式由 `shell.css` 统一维护。不直接显示浏览器默认控件，不用 `window.confirm/alert/prompt`。要新控件先补进共享库，底层保留语义 HTML、键盘操作和无障碍属性。
- 颜色和字号只用 `shell.css` 的 `--la-*` 变量（字号是 9 档 `--la-fs-*`），不在页面里写死。颜色分浅色、深色两套，新变量两套都要给。字重只用 400、500、600。
- 难撤销的操作（重新生成、删除等）用 `ConfirmButton` 原地二次确认；只有图标的按钮要给 `aria-label` 和 `title`。
- `useLocalState` 只存界面偏好，不存学习数据。
- 改完界面，在 1440、1024、760 宽度和深浅两色下截图核对。

## 调用模型

- 一次性调用（判分、总结、写讲义）都走 `kit` 的 `complete()`：它拒绝出错、截断和空的回复，不会把不完整的内容存下来。
- `deepseek-flash` 先思考再作答，思考也算在 `maxTokens` 里。输出额度要留足（判分、总结 4000，讲义 16000），太小会表现为"空回复"或"截断"。学习者在 设置 › 模型 › 高级设置 里设的最大输出会压低这个额度（`complete()` 取两者中较小的）。
- 模型在 JSON 里写 LaTeX 常常不双写反斜杠（`\rho` 会变成回车加 `ho`）。工具参数和 `parseJsonReply` 已统一修复；新写解析 JSON 的地方要用这两个入口。
- 每个角色用哪个模型，是所属单元的设置项（`kit/settings` 的 `roleModel`，写作 `厂商/模型`），没设置时用 DSH 的默认模型。`complete()` 和 `selectSessionModel()` 每次调用时读取当前设置；新写一次性调用时，把所属角色的设置传给 `complete()`。
- 写或改角色提示词、工具说明、简报和进度通知时，按 `learning-prompts-tools` 技能做。

## 组合包与 profile

- 学习工作台是组合包 `@learning-agent/app`：单元和 Agent 预设写在 `packages/app/cordis.patch.yml`，改了要重启 DSH。新增单元要改这个文件、`packages/app/package.json` 和 `scripts/dev-profile.sh`，再运行 `sh scripts/dev-profile.sh`。
- 只有前端的包也要有一行和一个后端入口：DSH 加载每一行的后端入口后，才扫描前端模块。
- DSH 保存一项设置时，会把这一行的整份配置固定在学习者那一层。所以单元的插件行不带配置（默认值写在单元的 Config 里），设置也不放进预设这类带大段配置的行。
