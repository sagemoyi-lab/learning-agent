# 外壳做深调研

> 2026-10-16 的调研记录，第 5 节是 11-01 补的。现在怎么运作、采用了哪些结论，以 [design.md](design.md) 为准；当时的代码核对、分批和验收草案、交接说明、给契约的补充建议已经删去，在 git 里能找到。
> 依据：你 10-12 的试用反馈（[throughts.md](../throughts.md)）、10-15 定下的方向、Obsidian 的帮助文档和插件接口、dockview 4.13 的源码和文档、本机 Chrome 实测，以及外壳和各单元的现有代码。

## 1. 结论与推荐取舍

| 问题 | 推荐项 | 不采用的做法及原因 |
|---|---|---|
| 点开页面放在哪 | 普通点击在当前标签打开；Ctrl+点击、中键在新标签打开；当前标签固定时另开一个标签（Obsidian 的做法） | 每个页面一个标签：标签越开越多，你试用时已经觉得冗余。VS Code 的"预览标签"（单击打开的标签会被下一次单击替换，编辑后才保留）：多一层规则，学习页面也没有"编辑"这个信号 |
| 后退和前进 | 每个标签有自己的历史；按钮放在页面顶部一行，和位置路径在一起（Obsidian 的视图标题栏）；Alt+←/→、鼠标侧键也能用 | 用浏览器的历史：浏览器只有一条历史，几个标签共用会错乱；而且 Firefox 不把鼠标侧键交给网页 |
| 切换标签记住位置 | 后台标签不卸载（dockview 的 `always` 渲染方式），滚动位置、展开状态和输入都还在 | 只记滚动的像素再恢复：页面数据是异步加载的，内容没出来时位置会被截断，展开状态和输入也会丢 |
| 后退前进记住位置 | 当前页前后的几页同样留着不卸载；更早的页面记下滚动位置，回来时等内容出来再滚过去 | 整条历史都留着：标签多了以后占用太大 |
| 打开很多标签 | 最近用过的 8 个标签留着不卸载，更早的只记位置；刷新页面后恢复的标签，第一次切过去才加载（Obsidian 1.7.2 的"延迟加载"） | 不设上限：知识图谱、原书 PDF 这类页面占用大 |
| 后台页面的刷新 | 不在前台的页面收到推送时不刷新，切回来时有变化再刷新一次 | 照常刷新：开几个标签，每次推送就多几倍请求 |
| 侧栏 | 常驻的图标栏 + 可展开的侧栏：点图标，侧栏显示这个功能的内容；再点一次收起，图标不动（VS Code 活动栏的做法） | Obsidian 把侧栏的标签图标放在侧栏顶部，收起后要先展开才能换内容；你要求"图标还在原位" |
| 出处原文 | 点出处在右侧栏看原文（右侧栏分"提问"和"出处"两个视图）；Ctrl+点击在新标签打开（NotebookLM 点引用在侧栏看原文；Logseq 用 Shift+点击把页面放进右侧栏） | Logseq 那样在右侧栏一张张叠起来：原书页面宽，叠起来太挤 |
| 新标签 | "+"打开的新标签显示"继续学习"和最近打开的页面（Obsidian 的新标签页列出新建、打开文件和最近文件） | 空白页 |
| 固定标签 | 右键菜单固定；固定的标签显示图钉、中键不会关掉它，从它里面点开的页面另开标签（Obsidian） | — |
| 回到顶部 | 再点一次当前标签，页面滚回顶部（手机应用的习惯，你提的要求） | — |
| 快捷键 | 只用浏览器不占用的：Alt+←/→、Ctrl K | Ctrl+T、Ctrl+W、Ctrl+Tab 被浏览器占用，网页拦不住；以后做桌面版（Electron）时再加 |

## 2. 查到的事实

**Obsidian**
- 点链接在当前标签打开；Ctrl+点击在新标签打开，Ctrl+Alt+点击在新的分屏打开；固定的标签里点链接，总是另开标签。（[帮助：标签页](https://obsidian.md/help/tabs)）
- 插件接口把点击事件翻译成"在哪打开"：Ctrl/⌘ 或中键是新标签，Ctrl+Alt 是分屏（`Keymap.isModEvent`）。`getLeaf(false)` 复用当前可以跳转的标签；文件列表这类视图声明自己"不用于跳转"，不会被别的页面替换（`View.navigation`）。
- 每个视图把滚动位置这类"临时状态"交给历史保存，后退时还原（`getEphemeralState` / `setEphemeralState`）；视图里的变化要不要进历史由视图决定（`ViewStateResult.history`）。
- 1.7.2 起，启动时恢复的后台标签先放占位，切过去才真正加载（`WorkspaceLeaf.isDeferred`、[延迟加载说明](https://docs.obsidian.md/plugins/guides/defer-views)）。
- 侧栏里每个功能是一个只显示图标的标签，悬停显示名称；侧栏可以收起和展开。（[帮助：侧栏](https://obsidian.md/help/sidebar)）

**dockview（本项目用 4.13.1）**
- 默认的 `onlyWhenVisible` 把看不见的标签页从页面上拿掉，滚动位置这类状态随之丢失；`always` 让它们留在页面上、隐藏起来，组件也不卸载。可以给单个标签设，也可以用 `defaultRenderer` 设默认值。（[文档](https://dockview.dev/docs/core/panels/rendering)）
- 留在后台的组件照常运行：动画、定时器、请求都在继续，需要自己暂停。
- 源码里隐藏用的是 `display: none`；更新标签参数时新参数和旧参数合并。

**Chrome 实测（`.scratch/shell/hide-scroll.ts`）**
- 一个滚动区设为 `display: none` 再显示，外层和内层的滚动位置都还原（隐藏期间读到的是 0）。`visibility: hidden`、`content-visibility: hidden` 也一样。所以后台标签不卸载，就能记住位置。
- 鼠标侧键：Chrome 在 `mouseup` 时执行后退和前进，网页在这时阻止默认行为就能接管；Firefox 不把侧键交给网页（[Mozilla bug 1720538](https://bugzilla.mozilla.org/show_bug.cgi?id=1720538)、[讨论](https://discourse.mozilla.org/t/firefox-mouse-back-forward-buttons-do-not-reliably-reach-page-javascript/148988)）。

**Logseq 的右侧栏**：Shift+点击页面或块，把它放进右侧栏；新的放在最上面，一张张叠下去。（[社区说明](https://discuss.logseq.com/t/how-to-work-with-logseqs-right-hand-sidebar/8461)）

## 4. 对已定方向的细化

- **主界面的"首页"图标直接打开首页**（课程卡片和今日待办），不另做课程列表的侧栏：课程切换已经在图标栏最上面，再列一遍是重复。
- **图标栏只显示图标，悬停显示名称**（你说"正常只有图标"）。侧栏打开时，侧栏顶部写着这个功能的名称。
- **"资料"和"知识模型"的侧栏内容**分别在资料库、知识图谱那两批做；这一批点这两个图标先直接打开页面。
- **测试进行中锁定主区**仍不在这一批。

## 5. 手机上的布局（11-01）

> 你 11-01 的要求："给项目前端做一个移动端响应式布局的适配"。依据：下面的公开资料、本机 headless Chromium 的触屏模拟（390 像素宽）实测，以及外壳的现有代码。

**现状（390 像素宽、触屏模拟）：** 页面内容大多已经按容器宽度排好（页面骨架、卡片、表单都有 `@container` 规则），问题集中在外壳：

- 图标栏常驻占去 48 像素，主区只剩 342 像素，低于分屏时每栏 360 像素的下限；
- 标签栏里一个标签不到 100 像素，标题看不出来，右边的"搜索"变成一个空框（窄主区的 `@container` 规则写在 `.la-command` 前面，被后面的宽度盖掉了）；
- 状态栏的几条文字叠在一起；
- 右侧栏离左边留着图标栏，不是满屏；从图标栏去别的页面，右侧栏还盖在上面；
- 讲义里用手指选中文字后不出"提问 / 批注"浮条：浮条靠 `mouseup` 触发，长按选字和拖动选区手柄都不产生 `mouseup`；
- 按钮 28–32 像素、列表行 28 像素，手指点着吃力；输入框 14 像素，iOS Safari 聚焦时会自动放大页面。

**查到的做法：**

| 问题 | 做法 | 出处 |
|---|---|---|
| 多宽算手机 | 宽度小于 600 像素是"紧凑"窗口，用底部导航栏；600–840 用侧边的导航栏（即我们的图标栏） | Android 开发文档 [自适应导航](https://developer.android.com/develop/ui/compose/layouts/adaptive/build-adaptive-navigation)、[窗口大小类别](https://dev.to/tkuenneth/about-window-size-class-libraries-5c5m) |
| 底部导航放几个 | 二到五个主要去处，更多的放进"更多"或侧边栏 | [SAP Fiori 的 M3 导航栏说明](https://www.sap.com/design-system/fiori-design-android/v26-1/components/m3-standard-components/navigation-bar/usage) |
| 标签和图标栏怎么放 | Obsidian 手机版没有图标栏，底部导航栏是后退、前进、搜索、标签数（方框里一个数字，点开切换或新建标签）和菜单；图标栏的功能收在菜单里 | [Obsidian 帮助：手机版](https://obsidian.md/help/mobile) |
| 输入框被放大 | iOS Safari 对小于 16 像素的输入框聚焦时放大页面；输入框始终用 16 像素，不用 `maximum-scale` 禁止缩放（会妨碍需要放大的人） | [Squirrelscan：输入框放大](https://docs.squirrelscan.com/rules/mobile/input-zoom)、[West Wind 的实测](https://weblog.west-wind.com/posts/2023/Apr/17/Preventing-iOS-Textbox-Auto-Zooming-and-ViewPort-Sizing) |
| 能点的大小 | WCAG 2.2 的最低要求是 24×24 像素（2.5.8），建议 44×44（2.5.5）；Apple 的建议也是 44 点 | WCAG 2.2、Apple 人机界面指南 |

**DSH 页面的 viewport：** DSH 的 `index.html` 已经写了 `width=device-width, initial-scale=1`，手机浏览器按真实宽度排版，不用我们改。
