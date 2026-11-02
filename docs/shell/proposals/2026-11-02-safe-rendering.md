# 页面不执行资料、网页和模型输出里的代码

> 来源：11-02 的外部审查（[报告](../../history/2026-11-audit/report.pdf)，SEC-01）。修复顺序见 [PLAN](../../PLAN.md#6-开发路线)，这一项排在最前面。

## 问题

共享的 Markdown 渲染（[`html.ts`](../../../packages/shell/src/client/html.ts)、[`markdown.tsx`](../../../packages/shell/src/client/markdown.tsx)）把 Marked 的输出直接用 `dangerouslySetInnerHTML` 放进页面：

- Marked 原样保留 Markdown 里的 HTML，`<img src=x onerror=…>` 的事件属性留着；
- 普通链接的 `href` 只转义、不检查协议，`[例子](javascript:…)` 留着；
- 讲义正文、讲义块、行内内容、资料悬停预览都走这里，内容来自模型回复、资料解析结果、网页正文（纯文本网页和 Exa 的副本直接当 Markdown）。

审查在真实 Chromium 里用一段合成内容执行了一个无害的页面标记，没有外传数据。同源脚本能以你的身份调用所有学习接口（DSH 的同源检查和签名 cookie 挡不住同源脚本）；外部图片也会在你没点的时候联网。Marked 官方说明它不负责净化 HTML，这一层要由我们做。

## 方案

1. **在唯一的渲染出口净化：** `toHtml`、`toInlineHtml` 的结果交给成熟的 HTML 净化库（候选 DOMPurify，开工前确认版本和对 KaTeX 输出的配置）再放进页面。只放行需要的标签和属性：KaTeX 的 MathML 和 `span` 类名、表格、`details`/`summary`（折叠引文）、我们的出处标签和图的 `data-*` 属性；去掉所有事件属性、`script`、`style`、`iframe`、`object`、`form` 这类标签。
2. **链接只放行安全的协议：** `http`、`https`、`mailto` 和我们自己的 `cite:`；其他（`javascript:`、`data:`、`vbscript:`）当纯文字显示。外部链接保持新窗口打开、`rel="noreferrer noopener"`。
3. **外部图片不自动加载：** 资料和讲义里只有 `cite:` 的图（我们自己从 PDF 裁的）直接显示；外部地址的图显示成一个链接，点了才打开。
4. **纵深防御：** 查 DSH 的页面能不能加内容安全策略（CSP，用 nonce 或 hash 限制脚本来源）；能加就加，不能加写进外壳的已知限制。
5. 检查别的直接插 HTML 的地方（`dangerouslySetInnerHTML`、`innerHTML`），都改走这个出口。

## 放弃的方案

- **用正则删掉 HTML 标签：** 编码、换行、实体的变体太多，正则挡不全。
- **关掉 Marked 的 HTML 支持：** 资料解析结果里有合法的表格 HTML；而且链接协议的问题照样在。
- **只对网页来源的内容净化：** 模型回复和 PDF 解析结果同样可能带 HTML，出口统一净化最简单。

## 验收标准

1. 浏览器回归覆盖：`img onerror`、`svg onload`、`javascript:` 链接、实体和换行编码的变体、原始 HTML、纯文本网页和 Exa 副本、资料悬停预览；没有任何一个执行，也没有发出外部请求。
2. 公式（行内、独立）、出处标签和悬停、表格横向滚动、折叠引文、裁出的图照常显示，按 `learning-ui-review` 在三种宽度和深浅两色下截图核对。
3. 在 3182 的真实页面上核对响应头里的 CSP（有或没有都在提交说明里写明）。
4. `pnpm typecheck`、`pnpm test`（含 `tests/flow.test.ts`）、`pnpm build` 通过。

## 风险

- 净化配置太严会把 KaTeX 或表格弄坏，太松又漏；用现有讲义和资料的合成样例做一组渲染快照对比。
- 净化库增加前端包体积（DOMPurify 约 20 KB），可以接受。
