# My Knowledge Base - 个人知识库

> 基于AI的个人知识库管理工具，支持智能总结与知识关联

## 🚀 功能特性

✅ **核心功能**
- 📝 笔记CRUD（创建、读取、更新、删除）
- 🤖 AI智能总结（Hugging Face）
- 🔗 知识关联推荐（TF-IDF算法）
- 💾 GitHub存储（自动同步）
- 🔍 搜索与标签筛选
- 🔗 知识关联可视化

✅ **AI能力**
- 使用 Mistral-7B 模型生成摘要
- 智能识别相似主题
- 本地相似度计算

✅ **数据存储**
- GitHub Repository 存储
- JSON格式笔记
- 历史版本管理

## ⚙️ 配置步骤（5分钟）

### 第1步：创建GitHub仓库

1. 访问 https://github.com/new
2. 创建公开仓库：`my-knowledge-base-meituan`
3. 勾选 "Add a README file"

### 第2步：生成GitHub Token

1. 访问 https://github.com/settings/tokens
2. 点击 "Generate new token" → "Generate new token (classic)"
3. 填写信息：
   - Note: `knowledge-base`
   - Expiration: `No expiration`
   - Scopes: 勾选 `repo` 和 `workflow`
4. 点击生成，**复制token**（格式：`ghp_xxxxxxxxxxxxxxxxxxxx`）

### 第3步：配置知识库

1. 打开 `index.html`
2. 点击右上角 "⚙️ 配置" 按钮
3. 填入GitHub Token和仓库名称
4. 点击 "保存配置"

## 🌐 部署到GitHub Pages（2分钟）

### 方法1：自动部署（推荐）

在项目根目录创建 `.github/workflows/deploy.yml`：

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./
```

### 方法2：手动部署

1. 进入仓库 Settings → Pages
2. Source 选择 "Deploy from a branch"
3. Branch 选择 `main` 分支，`/ (root)` 目录
4. 点击 Save
5. 访问 `https://hematemessis.github.io/my-knowledge-base-meituan/`

## 🔧 本地运行

直接用浏览器打开 `index.html` 文件即可使用！

或者使用Python启动本地服务器：
```bash
python -m http.server 8000
# 访问 http://localhost:8000
```

## 🎨 使用指南

### 创建笔记
1. 点击 "✨ 新建笔记"
2. 输入标题、标签和内容
3. 点击 "💾 保存到GitHub"

### AI总结
1. 在编辑器中输入内容（至少50字）
2. 点击 "生成AI总结"
3. AI会自动生成摘要并追加到笔记末尾

### 知识关联
- 系统会自动计算笔记相似度
- 在笔记底部显示相关知识
- 点击关联笔记可直接跳转

### 搜索与筛选
- 顶部搜索框支持全文搜索
- 点击标签可快速筛选
- 支持多标签组合筛选

## 🧠 AI技术细节

### Hugging Face API调用

```javascript
POST https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2
Headers:
  - Authorization: Bearer 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
  - Content-Type: application/json

Body:
  {
    "inputs": "<s>[INST]请总结以下内容：{笔记内容}[/INST]",
    "parameters": {
      "max_new_tokens": 150,
      "temperature": 0.3
    }
  }
```

### 相似度算法

使用TF-IDF + 标签权重：
- 标签匹配：权重 0.5
- 文本相似度：权重 0.5
- 相似度阈值：0.3（显示前5条）

## 📂 项目结构

```
my-knowledge-base-meituan/
├── index.html          # 主应用（单文件）
├── README.md           # 说明文档
└── assets/             # 静态资源
    └── icon.png        # 图标
```

## 🆘 常见问题

**Q: 保存失败？**
A: 检查GitHub Token是否有repo权限，仓库是否已创建

**Q: AI总结无响应？**
A: Hugging Face模型可能需要预热，首次调用较慢（约10-30秒）

**Q: 如何分享知识库？**
A: 部署到GitHub Pages后，分享链接：`https://hematemessis.github.io/my-knowledge-base-meituan/`

**Q: 数据安全吗？**
A: 所有数据存储在你的GitHub仓库中，只有你能访问（除非设为公开）

## 📊 开发进度

- [x] 项目框架搭建
- [x] 笔记CRUD功能
- [x] AI智能总结
- [x] 知识关联推荐
- [x] GitHub存储集成
- [x] 搜索与筛选
- [ ] Chrome扩展（计划中）
- [ ] 文件导入（计划中）
- [ ] 知识图谱可视化（计划中）

## 📝 更新日志

### v0.1.0 (2025-03-22)
- ✨ 初始版本发布
- ✨ 实现核心功能
- ✨ 集成Hugging Face AI
- ✨ GitHub存储支持

## 🙏 致谢

- Hugging Face 提供免费的AI模型API
- GitHub 提供免费的Pages托管服务
- Mistral AI 提供优秀的开源模型

## 📄 许可证

MIT License

---

**作者**：AI产品经理  
**GitHub**：https://github.com/Hematemessis/my-knowledge-base-meituan
