import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { log } from '../core/logger.js';

const DATA_DIR = path.join(os.homedir(), '.cursor-feishu');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const WORKSPACES_FILE = path.join(DATA_DIR, 'workspaces.json');

/**
 * One entry per Feishu chat (p2p DM or group topic).
 */
export interface Session {
  /** Cursor agentId — passed to Agent.resume() on next message. */
  agentId: string;
  /** Absolute path of the working directory. */
  cwd: string;
  /** Named workspace key (if set). */
  workspace?: string;
  updatedAt: number;
}

/** Named workspace map: name → absolute cwd path. */
type WorkspaceMap = Record<string, string>;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
}

// ─── Sessions ────────────────────────────────────────────────────────────────

function loadSessions(): Map<string, Session> {
  const raw = readJson<Record<string, Session>>(SESSIONS_FILE, {});
  return new Map(Object.entries(raw));
}

function saveSessions(map: Map<string, Session>) {
  writeJson(SESSIONS_FILE, Object.fromEntries(map));
}

export function getSession(chatId: string): Session | undefined {
  return loadSessions().get(chatId);
}

export function setSession(chatId: string, session: Session) {
  const map = loadSessions();
  map.set(chatId, { ...session, updatedAt: Date.now() });
  saveSessions(map);
  log.info('session', 'set', { chatId, agentId: session.agentId, cwd: session.cwd });
}

export function clearSession(chatId: string) {
  const map = loadSessions();
  map.delete(chatId);
  saveSessions(map);
  log.info('session', 'clear', { chatId });
}

/**
 * Update agentId after a run completes (done event carries nextSessionId).
 */
export function updateAgentId(chatId: string, nextAgentId: string) {
  const map = loadSessions();
  const existing = map.get(chatId);
  if (!existing) return;
  map.set(chatId, { ...existing, agentId: nextAgentId, updatedAt: Date.now() });
  saveSessions(map);
}

// ─── Workspaces ───────────────────────────────────────────────────────────────

export function listWorkspaces(): WorkspaceMap {
  return readJson<WorkspaceMap>(WORKSPACES_FILE, {});
}

export function saveWorkspace(name: string, cwd: string) {
  const ws = listWorkspaces();
  ws[name] = cwd;
  writeJson(WORKSPACES_FILE, ws);
}

export function removeWorkspace(name: string) {
  const ws = listWorkspaces();
  delete ws[name];
  writeJson(WORKSPACES_FILE, ws);
}

export function resolveWorkspace(name: string): string | undefined {
  return listWorkspaces()[name];
}

// ─── Default cwd ─────────────────────────────────────────────────────────────

export function getDefaultCwd(): string {
  return process.env.DEFAULT_CWD ?? process.cwd();
}

export function getSessionCwd(chatId: string): string {
  return getSession(chatId)?.cwd ?? getDefaultCwd();
}
