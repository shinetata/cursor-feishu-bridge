/**
 * Feishu app auto-registration via QR code.
 *
 * Uses @larksuiteoapi/node-sdk's registerApp() which:
 *   1. Generates a QR code URL
 *   2. Polls for the scan
 *   3. Automatically creates the PersonalAgent app with all required permissions
 *   4. Returns client_id + client_secret
 *
 * The user only needs to scan with Feishu — no manual config in the console.
 *
 * JSON mode (for AI agents):
 *   Outputs two NDJSON lines to stdout — no interactive prompts:
 *   Line 1 (when QR ready):  {"status":"qr_ready","qr_url":"...","expires_in":N}
 *   Line 2 (when complete):  {"status":"complete","app_id":"cli_xxx","tenant":"feishu"}
 */
import { registerApp } from '@larksuiteoapi/node-sdk';
import qrcode from 'qrcode-terminal';
import type { FeishuConfig } from '../config/store.js';

/** Interactive mode — shows QR code in terminal (for humans). */
export async function setupFeishu(): Promise<FeishuConfig> {
  console.log('\n[1/3] 创建飞书机器人');
  console.log('─'.repeat(48));
  console.log('请用飞书 App 扫描以下二维码，自动创建机器人：\n');

  const result = await registerApp({
    source: 'cursor-feishu-bridge',
    onQRCodeReady: (info) => {
      qrcode.generate(info.url, { small: true });
      const mins = Math.max(1, Math.round(info.expireIn / 60));
      console.log(`\n  二维码有效期：约 ${mins} 分钟`);
      console.log(`  也可直接打开：${info.url}\n`);
    },
    onStatusChange: (info) => {
      if (info.status === 'domain_switched') {
        console.log('  ↳ 识别到国际版（Lark），已切换域名。');
      }
    },
  });

  const tenant = (result.user_info?.tenant_brand ?? 'feishu') as 'feishu' | 'lark';
  console.log(`\n✓ 飞书机器人已创建`);
  console.log(`  App ID: ${result.client_id}`);
  console.log(`  类型：${tenant === 'lark' ? '国际版 Lark' : '飞书'}\n`);

  return {
    appId: result.client_id,
    appSecret: result.client_secret,
    tenant,
  };
}

/**
 * JSON / Agent mode — no interactive prompts.
 * Writes two NDJSON lines to stdout, then resolves with the config.
 *
 * Line 1 (written as soon as QR is ready):
 *   {"status":"qr_ready","qr_url":"...","expires_in":300}
 *
 * Line 2 (written after scan completes):
 *   {"status":"complete","app_id":"cli_xxx","tenant":"feishu"}
 */
export async function setupFeishuJson(): Promise<FeishuConfig> {
  const result = await registerApp({
    source: 'cursor-feishu-bridge',
    onQRCodeReady: (info) => {
      process.stdout.write(JSON.stringify({
        status: 'qr_ready',
        qr_url: info.url,
        expires_in: info.expireIn ?? 300,
      }) + '\n');
    },
    onStatusChange: (info) => {
      if (info.status === 'domain_switched') {
        process.stderr.write(JSON.stringify({ status: 'domain_switched' }) + '\n');
      }
    },
  });

  const tenant = (result.user_info?.tenant_brand ?? 'feishu') as 'feishu' | 'lark';
  process.stdout.write(JSON.stringify({
    status: 'complete',
    app_id: result.client_id,
    tenant,
  }) + '\n');

  return {
    appId: result.client_id,
    appSecret: result.client_secret,
    tenant,
  };
}
