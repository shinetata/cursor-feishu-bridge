/**
 * Cross-platform OS service management.
 *
 * macOS  → launchd user agent  ~/Library/LaunchAgents/io.cursor-feishu-bridge.plist
 * Linux  → systemd user unit   ~/.config/systemd/user/cursor-feishu-bridge.service
 * Others → prints manual instructions
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync, spawnSync } from 'node:child_process';

const LABEL = 'io.cursor-feishu-bridge';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const SYSTEMD_DIR = path.join(os.homedir(), '.config', 'systemd', 'user');
const SYSTEMD_PATH = path.join(SYSTEMD_DIR, 'cursor-feishu-bridge.service');

function getBinaryPath(): string {
  try {
    return execSync('which cursor-feishu-bridge', { encoding: 'utf8' }).trim();
  } catch {
    // Fallback: resolve from current process (for development)
    return process.execPath + ' ' + path.join(process.cwd(), 'dist', 'cli.js');
  }
}

// ── macOS launchd ──────────────────────────────────────────────────────────

function macosInstall(): void {
  const bin = getBinaryPath();
  const logDir = path.join(os.homedir(), '.cursor-feishu', 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bin}</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${path.join(logDir, 'stdout.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(logDir, 'stderr.log')}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${os.homedir()}</string>
    <key>PATH</key>
    <string>${process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin'}</string>
  </dict>
</dict>
</plist>`;

  fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
  fs.writeFileSync(PLIST_PATH, plist, { mode: 0o644 });
  console.log(`✓ 已写入 ${PLIST_PATH}`);
}

function macosLoad(): void {
  spawnSync('launchctl', ['load', '-w', PLIST_PATH], { stdio: 'inherit' });
}

function macosUnload(): void {
  spawnSync('launchctl', ['unload', '-w', PLIST_PATH], { stdio: 'inherit' });
}

function macosStatus(): void {
  const result = spawnSync('launchctl', ['list', LABEL], { encoding: 'utf8' });
  if (result.stdout.includes(LABEL)) {
    console.log('✓ 守护进程运行中');
    console.log(result.stdout.trim());
  } else {
    console.log('✗ 守护进程未运行');
  }
}

// ── Linux systemd ──────────────────────────────────────────────────────────

function linuxInstall(): void {
  const bin = getBinaryPath();
  const service = `[Unit]
Description=cursor-feishu-bridge
After=network.target

[Service]
ExecStart=${bin} run
Restart=on-failure
RestartSec=5s
Environment=HOME=${os.homedir()}
Environment=PATH=${process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin'}

[Install]
WantedBy=default.target
`;
  fs.mkdirSync(SYSTEMD_DIR, { recursive: true });
  fs.writeFileSync(SYSTEMD_PATH, service);
  spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
  console.log(`✓ 已写入 ${SYSTEMD_PATH}`);
}

// ── Public API ─────────────────────────────────────────────────────────────

export function serviceStart(): void {
  const platform = os.platform();
  console.log('安装并启动守护进程...\n');

  if (platform === 'darwin') {
    macosInstall();
    macosLoad();
    console.log('\n✓ 守护进程已启动（开机自启已开启）');
    console.log(`  日志：~/.cursor-feishu/logs/stdout.log`);
  } else if (platform === 'linux') {
    linuxInstall();
    spawnSync('systemctl', ['--user', 'enable', '--now', 'cursor-feishu-bridge'], { stdio: 'inherit' });
    console.log('\n✓ 守护进程已启动');
  } else {
    console.log('⚠ 当前平台不支持自动守护进程安装。');
    console.log('  手动运行：cursor-feishu-bridge run');
  }
}

export function serviceStop(): void {
  const platform = os.platform();
  if (platform === 'darwin') {
    macosUnload();
    console.log('✓ 守护进程已停止');
  } else if (platform === 'linux') {
    spawnSync('systemctl', ['--user', 'stop', 'cursor-feishu-bridge'], { stdio: 'inherit' });
    console.log('✓ 守护进程已停止');
  } else {
    console.log('⚠ 请手动停止进程。');
  }
}

export function serviceStatus(): void {
  const platform = os.platform();
  if (platform === 'darwin') {
    macosStatus();
  } else if (platform === 'linux') {
    spawnSync('systemctl', ['--user', 'status', 'cursor-feishu-bridge'], { stdio: 'inherit' });
  } else {
    console.log('⚠ 不支持在此平台查询守护进程状态。');
  }
}

export function serviceUninstall(): void {
  const platform = os.platform();
  if (platform === 'darwin') {
    macosUnload();
    if (fs.existsSync(PLIST_PATH)) {
      fs.unlinkSync(PLIST_PATH);
      console.log(`✓ 已删除 ${PLIST_PATH}`);
    }
  } else if (platform === 'linux') {
    spawnSync('systemctl', ['--user', 'disable', '--now', 'cursor-feishu-bridge'], { stdio: 'inherit' });
    if (fs.existsSync(SYSTEMD_PATH)) {
      fs.unlinkSync(SYSTEMD_PATH);
    }
  }
  console.log('✓ 守护进程已卸载');
}
