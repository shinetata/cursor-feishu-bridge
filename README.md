# cursor-feishu-bridge

通过飞书 / Lark 远程操控 Cursor Agent。

## 安装方式

### 方式一：让 AI Agent 帮你安装（推荐）

对你的 Cursor / Claude Code / 任意 AI Agent 说一句话：

```
帮我安装 cursor-feishu-bridge：https://github.com/your-org/cursor-feishu-bridge/blob/main/INSTALL.md
```

Agent 会自动执行全部步骤，你只需要：

1. 扫一个二维码（创建飞书机器人）
2. 粘贴一个 Cursor API Key

**无需关心任何技术细节。**

---

### 方式二：手动安装

```bash
npm install -g cursor-feishu-bridge
cursor-feishu-bridge setup
```

---

## 日常使用

```bash
cursor-feishu-bridge start    # 安装为后台守护进程（开机自启）
cursor-feishu-bridge stop     # 停止
cursor-feishu-bridge status   # 查看状态
cursor-feishu-bridge run      # 前台运行（调试）
```

## 飞书内命令

| 命令 | 说明 |
|---|---|
| 任意消息 | 发给 Cursor Agent，流式回复 |
| `/new` | 重置会话 |
| `/ws save <name>` | 保存当前目录为命名工作区 |
| `/ws use <name>` | 切换工作区 |
| `/ws list` | 查看所有工作区 |
| `/stop` | 中断当前 Agent 运行 |
| `/status` | 查看当前状态 |
| `/help` | 帮助 |

## 数据目录

| 路径 | 内容 |
|---|---|
| `~/.cursor-feishu/config.json` | 凭证配置（权限 600） |
| `~/.cursor-feishu/sessions.json` | 会话记录 |
| `~/.cursor-feishu/workspaces.json` | 命名工作区 |

## 环境变量（可覆盖 config 文件）

```bash
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
CURSOR_API_KEY=cursor_xxx
DEFAULT_CWD=/path/to/project
CURSOR_MODEL=composer-2.5
```

## License

MIT
