# My Knowledge Base - 个人知识库

当前主要开发版本是 **[Knowledge Context V2](./v2/README.md)**：面向个人项目复盘和长期上下文积累的本地知识库，提供资料问答、可追溯引用、用户确认后的长期记忆，以及文件搜索和紫灰色工作台 UI。

## 从 V2 开始

需要 Node.js 24 和 pnpm。在仓库目录中运行：

```powershell
cd v2
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
# 在 .env.local 中填写模型配置；默认不需要 PostgreSQL。
pnpm dev
```

打开 <http://127.0.0.1:3000>。生产构建：`pnpm build`，启动：`pnpm start`。

- [使用与配置说明](./v2/README.md)
- [项目介绍、产品设计、技术路径与 AI 协作复盘](./docs/PROJECT_REVIEW.md)
- [架构与实现边界](./v2/ARCHITECTURE.md)
- [资料问答验收记录](./v2/docs/M2-ACCEPTANCE.md)
- [新版 UI 与验证记录](./v2/docs/ui-refresh-20260913.md)

**边界：**V2 目前是本机单用户产品，检索采用关键词匹配而非向量检索；引用可追溯不等于事实审核全部通过。资料默认留在本机，问答所需内容会发送给配置的模型服务。没有登录隔离，不应直接暴露到公网。GitHub 发布的是代码，不包含个人资料、数据库或密钥，也不等于上线了公开可用的 AI 服务。

## V1（保留的早期版本）

仓库根目录的 `index.html` 与 `server.mjs` 是早期版本，提供笔记管理、文件导入、本地相关笔记推荐，以及可选的服务端 AI 总结、标签和知识库问答。以下说明适用于 V1；新用户请优先使用上面的 V2。

> 安全提醒：早期版本曾把 Hugging Face Token 写入前端和 README。新版已经移除该密钥，但旧 Token 仍可能存在于 Git 历史或旧部署缓存中，必须前往 [Hugging Face Token 设置](https://huggingface.co/settings/tokens)立即吊销并重新创建。

## 当前能力

- 笔记创建、编辑、删除、全文搜索和标签筛选
- 浏览器本地持久化（`localStorage`）
- JSON 备份导入和导出
- PDF、DOCX 文本导入
- 根据标题、正文和标签计算本地相关笔记
- 服务端 AI 总结、标签、对话和规划模式
- 问答时从本地笔记中检索相关片段并提供给 AI
- 桌面端和移动端响应式布局
- 未保存修改提醒和损坏数据恢复

## 重要边界

- 当前数据默认只保存在当前浏览器，不会自动同步到 GitHub。
- 相关笔记和问答检索使用轻量文本相似度，不是向量数据库或完整 RAG。
- PDF 最多读取前 20 页，单次导入内容最多保留约 10 万字符。
- PDF/DOCX 解析组件从固定版本的 jsDelivr CDN 加载；离线时文件导入不可用。
- GitHub Pages 只能托管前端，不能安全保存 AI Token，因此 AI 会降级为本地摘要和标签。

## 快速使用

只使用本地笔记功能：

```powershell
python -m http.server 8000
```

然后访问 <http://127.0.0.1:8000>。

### 启用安全 AI 服务

需要 Node.js 20 或更高版本。Token 只设置在服务端环境变量中，不会发送到浏览器源码。

PowerShell：

```powershell
$env:HF_TOKEN="你的新Token"
$env:HF_MODEL="Qwen/Qwen3-32B"
npm start
```

然后访问 <http://127.0.0.1:8000>。

也可以参考 `.env.example` 配置部署平台的环境变量。项目不会自动读取 `.env` 文件，避免为了一个小项目引入额外依赖；本地可直接使用系统环境变量，托管平台则在控制台中设置 Secret。

## 架构

```text
浏览器
  ├─ localStorage：笔记数据
  ├─ 本地相似度：相关笔记与检索
  └─ POST /api/ai
          │
          ▼
server.mjs
  ├─ 环境变量中的 HF_TOKEN
  ├─ 请求大小限制与简单限流
  └─ Hugging Face Inference Providers
```

服务端使用 Hugging Face 当前的 OpenAI 兼容路由：

```text
POST https://router.huggingface.co/v1/chat/completions
```

默认模型可以通过 `HF_MODEL` 覆盖。模型是否可用取决于 Hugging Face 账户和 Inference Provider 配置。

## 部署说明

### 仅部署静态前端

可以继续使用 GitHub Pages。笔记、搜索、导入导出和本地相关笔记可用；AI 请求会安全失败并自动使用本地摘要或标签。

### 部署完整版本

选择支持 Node.js 20 和环境变量的托管平台，启动命令设为：

```text
npm start
```

在平台中配置：

- `HF_TOKEN`：重新创建的 Hugging Face Token
- `HF_MODEL`：可选，默认 `Qwen/Qwen3-32B`
- `PORT`：通常由托管平台自动注入
- `HOST`：托管平台通常设为 `0.0.0.0`，本机默认 `127.0.0.1`

不要把 Token 写入 HTML、JavaScript、README、GitHub Actions 输出或任何 `NEXT_PUBLIC_*` / `VITE_*` 前端变量。

## 数据与隐私

- 笔记保存在当前站点域名对应的浏览器存储中。
- 清除浏览器站点数据会删除笔记，请定期使用左上角“导出备份”。
- 只有在主动使用 AI 对话、总结或标签时，相关文本才会发送给本项目的 `/api/ai`，再由服务端转发给模型提供商。
- 不建议在公开 GitHub 仓库中保存私人笔记明文。

## 后续路线

- IndexedDB 或数据库存储，以及账号同步
- 文档切片、Embedding、向量检索和逐条来源引用
- 多文档工作区与权限控制
- 自动化测试和端到端测试
- 将第三方解析依赖改为自托管构建产物

## License

MIT
