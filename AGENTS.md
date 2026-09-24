# Repository Guidelines

## Project Overview

Yiipu 的 GreasyFork 用户脚本集合：根目录每个 `*.user.js` 都是一个独立发布的脚本，通过 `@updateURL`/`@downloadURL` 指向 `raw.githubusercontent.com/Yiipu/greasyfork/main/<file>` 供脚本管理器安装与自动更新。无构建系统、无 `package.json`、无依赖。

## Architecture & Data Flow

- 脚本自包含：IIFE + `"use strict"`，在浏览器脚本管理器中直接运行，可用 `GM_*` API。
- 唯一自动化管线：push 到 `main` 触发 GitHub Actions（`.github/workflows/update-readme.yml`）运行 `.github/scripts/updateReadme.js`，扫描所有 `*.user.js` 的 `@name`/`@description`，重写 `README.md` 中 `<!-- AUTO-SCRIPTS-START/END -->` 区块并自动提交。
- 因此 README 清单区不要手改：改脚本 meta 后推送即可，机器人重新生成。本地可用 `node .github/scripts/updateReadme.js` 预览。

## Development Commands

```bash
node .github/scripts/updateReadme.js   # 从脚本 meta 重新生成 README 清单
```

## Code Conventions & Common Patterns

新增脚本遵循既有 meta 契约（任一现有脚本即为模板）：

- 必填：`@name` / `@description`（中文，机器人会原样引用进 README）、`@namespace https://github.com/Yiipu`、`@author Yiipu`、`@version`、`@match`、`@license GPL3`、`@updateURL` / `@downloadURL`（指向 main 分支原始链接，文件名必须与实际一致）。
- `GM_xmlhttpRequest` 必须配 `@connect` 声明目标域名；文件下载用 `GM_download`；菜单入口用 `GM_registerMenuCommand`。
- 状态持久化用 `localStorage`，键名提为顶层 `const`；敏感信息仅存本地，并在 `@description` 中标注明文风险。
- UI 文案与注释用中文。

## Runtime/Tooling Preferences

- 目标环境：浏览器 + 用户脚本管理器，不依赖 Node/框架。
- README 生成器仅用 Node 内置模块（CI 为 Node 18）。
- 许可证 GPL3（`LICENSE`），新增脚本沿用。

## Testing & QA

无自动化测试。验证方式：装入脚本管理器，在 `@match` 站点手动执行主流程并观察控制台。提交前确认：

1. meta 字段齐全，`@updateURL`/`@downloadURL` 文件名与实际文件一致；
2. `@description` 准确（直接进入 README）；
3. 所有外发请求域名已在 `@connect` 声明。
