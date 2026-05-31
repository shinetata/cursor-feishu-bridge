# Installing cursor-feishu-bridge

> **This document is for AI Agents (Cursor, Claude Code, etc.).**
> The user only needs to: scan a QR code + paste a Cursor API key.
> Everything else is automated.

## User prompt

Users start by telling their AI Agent:

```
帮我安装 cursor-feishu-bridge：https://github.com/your-org/cursor-feishu-bridge/blob/main/INSTALL.md
```

---

## Error policy

On any non-zero exit: relay `stderr` to the user and stop. Do not retry unless a step below says otherwise.

---

## Step 1 — Check Node.js

```bash
node --version
```

Required: `v20` or later. If missing, tell the user to install from [nodejs.org](https://nodejs.org) and stop.

---

## Step 2 — Install

```bash
npm install -g cursor-feishu-bridge
```

---

## Step 3 — Create Feishu bot (QR scan)

Run this command **in the background** — it blocks until the user scans:

```bash
cursor-feishu-bridge feishu init --json
```

This command writes two NDJSON lines to stdout:

**Line 1** — QR code ready (appears within ~1s):
```json
{"status":"qr_ready","qr_url":"https://open.feishu.cn/xxx","expires_in":300}
```

When you see line 1:
- Extract `qr_url`
- Send it to the user as a clickable markdown link: `[点击此链接扫码创建机器人](QR_URL_HERE)`
- Tell the user: "用飞书 App 扫描此二维码，即可自动创建机器人并配置所有权限，无需手动设置"
- Wait for line 2 (may take up to 5 minutes)

**Line 2** — Scan complete:
```json
{"status":"complete","app_id":"cli_xxx","tenant":"feishu"}
```

When you see line 2, proceed to Step 4.

---

## Step 4 — Set Cursor API key

Tell the user:

> 请打开 [cursor.com/dashboard/integrations](https://cursor.com/dashboard/integrations)，点击 **"Create API Key"**，将生成的 Key 复制后粘贴给我

Wait for the user to provide the key, then run:

```bash
cursor-feishu-bridge cursor init --key <KEY_FROM_USER>
```

Expected output:
```json
{"status":"ok","model":"composer-2.5"}
```

If `status` is `error`, relay the message to the user and stop.

---

## Step 5 — Set default workspace

Ask the user:

> 你的默认项目目录是什么路径？（直接回车使用当前目录 `CWD`）

Replace `CWD` with the current working directory. If the user provides a path or accepts default, run:

```bash
cursor-feishu-bridge workspace set --path <PATH>
```

---

## Step 6 — Start

```bash
cursor-feishu-bridge start
```

Expected: daemon starts, outputs status.

---

## Step 7 — Verify

Tell the user:

> 安装完成！现在去飞书找到刚创建的机器人，私信任意内容（比如「你好」）测试一下

---

## Available commands (for reference)

```bash
cursor-feishu-bridge start        # Start as OS daemon (launchd/systemd)
cursor-feishu-bridge stop         # Stop daemon
cursor-feishu-bridge status       # Show daemon status
cursor-feishu-bridge run          # Foreground (debug)
cursor-feishu-bridge feishu init  # Re-run Feishu bot setup
cursor-feishu-bridge cursor init  # Re-set Cursor API key
```

## Feishu slash commands (after installation)

Users can send these to the bot:

| Command | Effect |
|---|---|
| `/ws save <name>` | Save current directory as named workspace |
| `/ws use <name>` | Switch to workspace |
| `/ws list` | List workspaces |
| `/new` | Reset session |
| `/stop` | Stop current Agent run |
| `/status` | Show current status |
| `/help` | Help |
