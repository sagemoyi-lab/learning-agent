# 自动门禁、锁定的运行时和依赖升级

> 来源：11-02 的外部审查（[报告](../../history/2026-11-audit/report.pdf)，括号里是报告的编号）。这一份不属于哪个单元，是所有单元共用的构建和测试底座，放在 core 下。修复顺序见 [PLAN](../../PLAN.md#6-开发路线)：依赖升级排在前面，门禁和真实流程回归排在最后一批。

## 问题

- **没有自动门禁（ENG-01）：** 仓库里没有持续集成，类型检查、测试、构建都靠手动跑。现有 427 项测试主要测服务和纯函数，传输、会话、模型都用假的（`tests/harness.ts` 直接调用各单元的 `apply`，绕过 DSH 的插件加载和组合包），没有 React 页面交互的测试。这次审查里切课、保存乱序、断线重连、键盘、后台标题这几类问题都在这个盲区。
- **DSH 的依赖只锁了顶层（ENG-02）：** `setup-dsh.sh` 用 `--before=2026-10-01` 装 DSH `0.2.0-rc.2`，但 `.tools/dsh` 的锁文件不进仓库，已安装时只比较 DSH 自己的版本号。两台机器可能装出不同的传递依赖。`package.json` 没写 `engines` 和 `packageManager`，README 的安装命令不是 `--frozen-lockfile`。
- **有已公开的依赖漏洞，没有定期检查（SEC-05）：** 运行时用到的 `zod` 4.6.5 有高危公告（修复版 4.6.6），`katex` 0.16.47 有低危公告；开发依赖的 `vite`、`vitest`、`tinypool` 有高危和严重公告（前提通常是开发服务器暴露在网络上，不等于产品可被远程利用）。DSH 的运行时另有 15 个受影响的依赖。两次扫描的数目不能相加。
- **支持范围不清楚（M11、M12）：** README 写了 Node 24、pnpm 11、Git Bash、Windows 脚本，但哪些组合真的验过没写。

## 方案

1. **先升级运行时依赖（SEC-05）：** `zod` 升到 4.6.6 以上，`katex` 按兼容性升级；跑类型检查、全部测试、构建，并在 3182 上看页面公式。开发依赖的 `vite`、`vitest` 升到各公告的修复版，做成单独的一次提交。之后每次改依赖都跑 `pnpm audit`，不可达的公告在提交说明里写理由和复查时间；不用 `audit fix --force`。
2. **锁定 DSH 的运行时（ENG-02）：** 把 `.tools/dsh` 的 `package.json` 和 `package-lock.json` 作为安装用的文件放进仓库（例如 `scripts/dsh/`），`setup-dsh.sh` 用 `npm ci` 安装并核对锁文件的指纹；已安装的和锁文件不一致时提示重装。`package.json` 写 `engines`（Node 24）和 `packageManager`（pnpm 的确切版本）。DSH 依赖的升级作为单独的一次提交，跑真实 DSH 的冒烟测试。
3. **最小的自动门禁（ENG-01）：** GitHub Actions 一个工作流：固定 Node 和 pnpm，`pnpm install --frozen-lockfile`、`sh scripts/setup-dsh.sh`、`pnpm typecheck`、`pnpm test`、`pnpm build`。不放任何密钥，自动测试不调用付费服务（现在的约定）。
4. **真实 DSH 的冒烟测试：** 用合成数据和假模型服务（`scripts/fake-openai.ts`）在一个临时目录启动 `dsh learning`，检查各插件加载、几个页面接口、一轮主老师对话的流式回复。先能在本机一条命令跑，再放进门禁。
5. **浏览器的高风险场景：** 用 `scripts/browser.ts` 的 Playwright 写几条：切课、保存失败和乱序、断线重连、50 条以上的聊天、键盘操作命令面板、后台标签改标题（对应 [页面状态](../../shell/proposals/2026-11-02-page-state.md) 和 [键盘与对比度](../../shell/proposals/2026-11-02-keyboard-and-contrast.md) 的验收）。
6. **支持范围（M11、M12）：** README 写明当前只支持本机单用户，列出验过的组合（Linux + Chromium 由助手验；Windows + Git Bash + Chrome 由你验）和没验过的（真手机、读屏软件）；把审查转成的回归测试和这些提案链在一起。

## 放弃的方案

- **为了覆盖率给每个样式和简单函数写测试：** 审查明确不建议；测试放在会坏、坏了代价大的地方。
- **门禁里调用真实模型：** 要密钥、要花钱、结果不稳定；真实模型的验收仍按现在的做法，在 3182 上用合成数据、你同意后跑。
- **把 DSH 改成 pnpm 工作区的依赖：** DSH 用 npm 的平铺布局装在 `.tools/dsh`，类型检查和测试都按这个路径找；改布局的代价大，锁定它的锁文件就够了。

## 验收标准

1. `pnpm audit` 和 DSH 目录的 `npm audit` 里，运行时可达的高危公告清零，剩下的都有理由和复查时间；升级后类型检查、全部测试、构建通过，3182 上公式、表格照常显示。
2. 两个干净目录（同一平台、同一工具版本）按 README 安装，得到相同的 DSH 依赖清单；改动 `.tools/dsh` 里的一个依赖后，`setup-dsh.sh` 能发现。
3. 推到 GitHub 后门禁自动运行并给出结果；故意弄坏一个插件的注入或一条测试，门禁失败。
4. 冒烟测试一条命令跑完，不需要任何密钥。
5. README 能找到支持范围。

## 风险

- GitHub Actions 的分钟数和 Node 24 镜像要确认可用；Linux 上跑通不代表 Windows 上的脚本没问题。
- 升级 `vitest` 跨大版本（3 → 4）可能要改测试配置，单独做、单独验。
