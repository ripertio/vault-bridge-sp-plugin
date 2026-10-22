// Simple logger helper for the Vault Bridge plugin
// Uses PluginAPI.log when available, otherwise falls back to console.*

const _fallbackLog = {
  critical: (...args: unknown[]) => console.error('[vault-bridge]', ...args),
  err: (...args: unknown[]) => console.error('[vault-bridge]', ...args),
  error: (...args: unknown[]) => console.error('[vault-bridge]', ...args),
  log: (...args: unknown[]) => console.log('[vault-bridge]', ...args),
  normal: (...args: unknown[]) => console.log('[vault-bridge]', ...args),
  info: (...args: unknown[]) => console.info('[vault-bridge]', ...args),
  verbose: (...args: unknown[]) => console.log('[vault-bridge]', ...args),
  debug: (...args: unknown[]) => console.debug('[vault-bridge]', ...args),
  warn: (...args: unknown[]) => console.warn('[vault-bridge]', ...args),
};

export const log =
  (typeof PluginAPI !== 'undefined' && PluginAPI.log) || _fallbackLog;
