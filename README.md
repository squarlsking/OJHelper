# OJ Batch Review Helper | 深圳大学C++助教审查辅助脚本

一键批量标记已审查，解放机械化点击，保护手腕健康。

## 📋 项目介绍

这是一个为深圳大学C++编程课程助教设计的 **Tampermonkey 用户脚本**，用于在OJ（Online Judge）后台管理系统中实现**批量一键标记已审查**功能。

### 🎯 主要功能

- ✅ **一键批量审查**：自动批量标记可见的待审查项目为已阅
- ⚡ **智能延迟控制**：合理的扫描和点击延迟，确保页面稳定加载
- 📄 **自动翻页**：支持自动翻页继续审查下一批题目
- 🛡️ **数据安全**：脚本默认匹配内部IP，支持离线使用
- 🖱️ **手腕友好**：显著减少重复机械点击，降低手部炎症风险

## 🚀 快速开始

### 前置要求
- 浏览器已安装 **Tampermonkey** 扩展 ([Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobblbi) | [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/))
- 具有访问深圳大学OJ后台权限

### 安装步骤

1. **打开 Tampermonkey 管理面板** → 创建新脚本
2. **复制本项目中的 `oj-batch-reviewed.user.js` 文件内容**
3. **粘贴到Tampermonkey编辑器并保存**
4. 访问OJ审查页面，脚本自动激活

### 💻 使用方法

1. 登录深圳大学OJ后台系统
2. 进入 **题目批阅页面** (`/admin#/contest/review`)
3. 页面加载完成后，**点击"一键审查"按钮**
4. 脚本自动依次点击各项目的【批阅】按钮
5. 在弹出的详情页自动点击【标记为已阅】完成审查
6. 支持自动翻页，继续处理下一页

## ⚙️ 配置说明

脚本包含以下可自定义配置项：

| 参数 | 默认值 | 说明 |
|------|-------|------|
| `scanDelayMs` | 500 | 页面扫描延迟（毫秒） |
| `clickDelayMs` | 650 | 点击间隔延迟（毫秒） |
| `settleDelayMs` | 900 | 页面稳定延迟（毫秒） |
| `maxClicks` | 200 | 单次最大点击数 |
| `autoNextPage` | true | 是否自动翻页 |
| `maxAutoPages` | 50 | 自动翻页最大页数 |

## 📺 效果演示

项目 `assets/` 目录中包含：
- **`效果视频.mp4`** - 脚本运行效果视频演示
- **`一件人工审查替换脚本.png`** - 如需在生产网络中使用，参考此图片中的脚本头部配置修改

## 🔐 网络使用说明

### ⚠️ 重要安全提示

### 若需在其他网络环境使用

请参考 `assets/一件人工审查替换脚本.png` 中的说明，修改脚本头部的 `@match` 规则：

```javascript
// ==UserScript==
// @match        *://your-oj-domain/admin*
// @match        *://your-oj-domain/admin/*
// ==/UserScript==
```

## 📝 工作原理

1. **页面匹配**：监听OJ后台审查页面
2. **元素扫描**：定期扫描页面中待审查的题目列表
3. **自动点击**：模拟用户点击【批阅】按钮，打开详情页
4. **确认操作**：在详情页自动点击【标记为已阅】确认
5. **循环处理**：重复上述过程，支持自动翻页

## 🛠️ 技术栈

- **脚本类型**：Tampermonkey User Script
- **开发语言**：JavaScript
- **兼容浏览器**：Chrome, Firefox, Edge 等支持Tampermonkey的浏览器

## 📄 许可证

MIT License - 自由开源，可自由修改和使用

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 💬 相关说明

- 脚本需要在 **Tampermonkey** 中运行
- 建议在非繁忙时段运行，确保服务器稳定
- 如遇到页面加载异常，可调整延迟参数重新运行

---

**致谢**：感谢深圳大学计算机与软件学院！🎓

> 💪 让我们一起保护助教的手腕健康！
