/**
 * Ensure the Cursor SDK can find its ripgrep binary.
 *
 * The SDK resolves ripgrep from `process.env.CURSOR_RIPGREP_PATH` first, then
 * falls back to auto-locating its platform package (`@cursor/sdk-<plat>-<arch>`).
 * In a bundled / globally-installed context the auto-location fails, so file
 * search tools log "Ripgrep path not configured" and silently degrade.
 *
 * We resolve the bundled binary ourselves and export it via the env var, which
 * the SDK reads when it initializes its search subsystem.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { log } from '../../core/logger.js';

let configured = false;

export function ensureRipgrep(): void {
  if (configured) return;
  configured = true;

  const existing = process.env['CURSOR_RIPGREP_PATH'];
  if (existing && existsSync(existing)) return;

  try {
    const require = createRequire(import.meta.url);
    const pkg = `@cursor/sdk-${process.platform}-${process.arch}`;
    const bin = process.platform === 'win32' ? 'rg.exe' : 'rg';
    const pkgJson = require.resolve(`${pkg}/package.json`);
    const rgPath = path.join(path.dirname(pkgJson), 'bin', bin);

    if (existsSync(rgPath)) {
      process.env['CURSOR_RIPGREP_PATH'] = rgPath;
      log.info('cursor-sdk', 'ripgrep-configured', { rgPath });
    } else {
      log.warn('cursor-sdk', 'ripgrep-not-found', { rgPath });
    }
  } catch (err) {
    log.warn('cursor-sdk', 'ripgrep-resolve-failed', { err: String(err) });
  }
}
