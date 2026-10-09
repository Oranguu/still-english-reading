# still-english-reading

一个运行在本机的英文阅读与学习工具。中文操作界面，支持 PDF、EPUB、Markdown；选中文字即可用本机 Codex 解析，继续追问，并保存到复习库。

## 启动

需要 **Node.js 22.13 或更新版本**，以及已使用 **ChatGPT 账号登录的近期版本 Codex CLI**（已在 0.155 系列验证）。阅读与复习不依赖 AI 登录；AI 功能使用登录账号已有的 Codex 额度，不需要填写 API Key。

保持以下目录关系（Git 仓库只放在 `tool` 内）：

```text
阅读工程/
├── source/             # 私人书籍，可放任意层级子文件夹
├── review/             # 私人复习数据，首次保存时创建
└── tool/               # 本仓库
```

macOS 双击 `start.command`；Windows 双击 `start.cmd`。首次启动安装依赖，随后构建并在浏览器打开本地页面。终端窗口需要保持运行，按 Ctrl+C 关闭服务。

也可在 `tool` 目录运行：

```sh
npm ci
npm run build
npm run launch
```

默认地址：<http://127.0.0.1:4173>。只启动服务、不打开浏览器可用 `npm start`。

将 `.pdf`、`.epub`、`.md` 或 `.markdown` 文件放入 `source` 后，在书库点击刷新。支持子目录。工具直接读取这些文件，不向云端上传整本书。

## 阅读和学习

- **书库**：按书名搜索、按格式筛选；继续上次阅读。
- **阅读**：原生 PDF 页面及文字选择层；EPUB 按阅读顺序加载章节；Markdown 保留标题、列表、表格等排版。已有目录自动导入，可跳转章节或页码。
- **AI 大纲**：书籍没有目录时，可根据有限的文字样本生成并保存大纲。它是辅助性提纲，不保证覆盖每个章节。图片型 PDF 禁用此功能；先在本地做 OCR 后再使用。
- **书签**：保存当前页面或章节位置；阅读进度自动保存。
- **划线解析**：选择英文文字后出现 AI 解析，可继续用中文追问。单次选择上限 6,000 字符，超限时缩小范围。仅请求时发送选中文字、有限上下文及有限追问记录给 Codex。
- **复习库**：收藏单词、短语、句子或 AI 解析；卡片默认折叠，展开后查看完整内容。可按类型、来源书籍和文本筛选，标记已复习或删除。

图片型 PDF 仍可正常看图阅读，但没有可选择的文字。DRM 加密 EPUB、需要密码的 PDF 不在当前支持范围内。EPUB 使用重排版阅读视图，不保留每一本书原有的出版商样式。

## 本地数据与隐私

| 内容           | 保存位置                                                 |
| -------------- | -------------------------------------------------------- |
| 原始书籍       | `../source/`                                             |
| 阅读进度、书签 | `../source/.still-english-reading/state.json`            |
| AI 生成的大纲  | `../source/.still-english-reading/<书籍ID>.outline.json` |
| 收藏与解析笔记 | `../review/items.json`                                   |
| 源码           | 当前 `tool` 仓库                                         |

源码仓库不包含书籍、解析、复习数据、账号凭据、真实电子邮件或个人密钥。默认私人数据位于仓库外；`.gitignore` 额外排除了常见凭据与数据目录。请勿把私人书籍放进 `tool`，也不要强制提交被忽略的文件。

备份时复制整个 `source` 和 `review` 文件夹即可。书籍 ID 来自相对路径；移动或重命名书籍后会被视为新书，旧学习数据保留在本地，原书签不会自动迁移。

AI 功能调用本机 Codex，复用 ChatGPT 登录状态。书籍片段会作为模型输入发送给 OpenAI；工具自身没有额外分析追踪或远程字体。AI 回复可能存在错误。界面显示的是 Codex 账号共享的限额窗口，不是可精确计算的剩余 token 数；其他 Codex 会话也会消耗该额度。额度不可用或耗尽时显示错误，阅读和已保存复习仍可使用。

服务仅监听本机回环地址，校验请求来源和 Host，拒绝跨站请求。电子书 HTML 会清理脚本与外部资源；书籍路径与 ZIP 资源经过校验。AI 在独立临时目录内运行，禁用动作工具，不赋予书籍内容操作本机的能力。

## 配置

无需创建配置文件。可按需设置环境变量：

| 变量               | 用途                       | 默认值                 |
| ------------------ | -------------------------- | ---------------------- |
| `PORT`             | 本地服务端口               | `4173`                 |
| `STILL_SOURCE_DIR` | 书籍目录的绝对路径         | `tool` 相邻的 `source` |
| `STILL_REVIEW_DIR` | 复习目录的绝对路径         | `tool` 相邻的 `review` |
| `STILL_CODEX_PATH` | Codex 可执行文件的绝对路径 | 自动检测               |

如使用自定义数据目录，请放在源码仓库外。

## 开发与验证

```sh
npm ci
npm run dev       # 前端 5173，后端 4173
npm run check     # TypeScript 检查
npm test          # 解析、存储、AI 桥接和 HTTP 安全测试
npm run build     # 生产构建
npx playwright install chromium
npm run test:e2e  # 浏览器端到端验证：使用临时测试书籍和模拟 AI，不消耗额度
```

技术组成：React、TypeScript、Vite、Express、PDF.js、JSZip、marked、sanitize-html；不需要数据库服务。依赖锁文件已提交，请使用 `npm ci` 安装一致版本。

Codex 接入依据 [OpenAI Codex app-server 文档](https://developers.openai.com/codex/app-server/) 和 [非交互运行文档](https://developers.openai.com/codex/noninteractive/)。Codex CLI 需在系统 PATH 中可用；macOS 也支持 Codex / ChatGPT 应用内置 CLI。
