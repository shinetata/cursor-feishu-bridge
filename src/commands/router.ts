/**
 * Slash command router.
 * Returns true if the text was handled as a command (don't forward to Agent).
 */
import { CardRenderer } from '../card/renderer.js';
import {
  clearSession,
  getSession,
  getSessionCwd,
  listWorkspaces,
  removeWorkspace,
  resolveWorkspace,
  saveWorkspace,
  setSession,
} from '../session/manager.js';
import { log } from '../core/logger.js';

export interface CommandContext {
  chatId: string;
  card: CardRenderer;
  /** Called when /stop is requested — stops the currently running AgentRun. */
  stopCurrentRun: () => Promise<void>;
}

export async function handleCommand(text: string, ctx: CommandContext): Promise<boolean> {
  const { chatId, card, stopCurrentRun } = ctx;
  const trimmed = text.trim();

  // ── /new  /reset ──────────────────────────────────────────────────────────
  if (/^\/(new|reset)$/i.test(trimmed)) {
    clearSession(chatId);
    await card.sendText(chatId, '会话已重置。下条消息将开启新的 Cursor Agent。');
    log.info('cmd', 'reset', { chatId });
    return true;
  }

  // ── /stop ─────────────────────────────────────────────────────────────────
  if (/^\/stop$/i.test(trimmed)) {
    await stopCurrentRun();
    await card.sendText(chatId, '已发送停止信号。');
    return true;
  }

  // ── /status ───────────────────────────────────────────────────────────────
  if (/^\/status$/i.test(trimmed)) {
    const session = getSession(chatId);
    const cwd = getSessionCwd(chatId);
    const lines = [
      `**工作区：** \`${cwd.replace(process.env.HOME ?? '', '~')}\``,
      session ? `**Agent ID：** \`${session.agentId}\`` : '**状态：** 无活跃会话',
    ];
    await card.sendText(chatId, lines.join('\n'));
    return true;
  }

  // ── /cd <path> ───────────────────────────────────────────────────────────
  const cdMatch = trimmed.match(/^\/cd\s+(.+)$/i);
  if (cdMatch) {
    const newCwd = cdMatch[1].trim().replace(/^~/, process.env.HOME ?? '~');
    clearSession(chatId);
    setSession(chatId, { agentId: '', cwd: newCwd, updatedAt: Date.now() });
    await card.sendText(chatId, `工作区已切换到 \`${newCwd}\`，会话已重置。`);
    return true;
  }

  // ── /ws list ─────────────────────────────────────────────────────────────
  if (/^\/ws\s+list$/i.test(trimmed)) {
    const ws = listWorkspaces();
    const entries = Object.entries(ws);
    if (entries.length === 0) {
      await card.sendText(chatId, '暂无命名工作区。使用 `/ws save <name>` 保存当前目录。');
    } else {
      const lines = entries.map(([k, v]) => `• **${k}** → \`${v.replace(process.env.HOME ?? '', '~')}\``);
      await card.sendText(chatId, '**命名工作区：**\n' + lines.join('\n'));
    }
    return true;
  }

  // ── /ws save <name> ──────────────────────────────────────────────────────
  const wsSaveMatch = trimmed.match(/^\/ws\s+save\s+(\S+)$/i);
  if (wsSaveMatch) {
    const name = wsSaveMatch[1];
    const cwd = getSessionCwd(chatId);
    saveWorkspace(name, cwd);
    await card.sendText(chatId, `工作区 **${name}** 已保存为 \`${cwd.replace(process.env.HOME ?? '', '~')}\`。`);
    return true;
  }

  // ── /ws use <name> ───────────────────────────────────────────────────────
  const wsUseMatch = trimmed.match(/^\/ws\s+use\s+(\S+)$/i);
  if (wsUseMatch) {
    const name = wsUseMatch[1];
    const resolved = resolveWorkspace(name);
    if (!resolved) {
      await card.sendText(chatId, `未找到工作区 **${name}**。使用 \`/ws list\` 查看可用列表。`);
    } else {
      clearSession(chatId);
      setSession(chatId, { agentId: '', cwd: resolved, updatedAt: Date.now() });
      await card.sendText(chatId, `已切换到工作区 **${name}** (\`${resolved.replace(process.env.HOME ?? '', '~')}\`)，会话已重置。`);
    }
    return true;
  }

  // ── /ws remove <name> ────────────────────────────────────────────────────
  const wsRemoveMatch = trimmed.match(/^\/ws\s+(?:remove|rm)\s+(\S+)$/i);
  if (wsRemoveMatch) {
    const name = wsRemoveMatch[1];
    removeWorkspace(name);
    await card.sendText(chatId, `工作区 **${name}** 已删除。`);
    return true;
  }

  // ── /help ─────────────────────────────────────────────────────────────────
  if (/^\/help$/i.test(trimmed)) {
    await card.sendText(chatId, [
      '**cursor-feishu-bridge 命令**',
      '',
      '`/new` `/reset` — 重置当前会话',
      '`/stop` — 停止正在运行的 Agent',
      '`/status` — 显示当前工作区和会话信息',
      '`/cd <path>` — 切换工作目录（重置会话）',
      '`/ws list` — 列出所有命名工作区',
      '`/ws save <name>` — 保存当前目录为命名工作区',
      '`/ws use <name>` — 切换到命名工作区',
      '`/ws remove <name>` — 删除命名工作区',
      '`/help` — 显示此帮助',
      '',
      '其他消息将直接转发给 Cursor Agent。',
    ].join('\n'));
    return true;
  }

  return false;
}
