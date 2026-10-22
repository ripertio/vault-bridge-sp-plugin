import type { PluginNodeScriptError } from '@super-productivity/plugin-api';

/**
 * Self-update *notifier* (never an auto-updater — SP exposes no self-reinstall
 * API, so install stays manual).
 *
 * The latest release is read from the PUBLIC Codeberg API.
 *
 * Anonymous read of `releases/latest` returns HTTP 200 with `tag_name` /
 * `html_url` (verified) — no token needed.
 */
export const RELEASES_LATEST_URL =
  'https://codeberg.org/api/v1/repos/fpindado/sync-md-multi/releases/latest';

export interface UpdateInfo {
  /** Latest version, leading `v` stripped — e.g. "0.3.2". */
  latestVersion: string;
  /** Release page URL (from the API's `html_url`). */
  htmlUrl: string;
}

/**
 * Parse a version tag ("v0.3.2" / "0.3.2") into numeric components. Non-numeric
 * parts collapse to 0 so a malformed tag can never read as "newer".
 */
export const parseVersion = (tag: string): number[] =>
  tag
    .replace(/^v/i, '')
    .trim()
    .split('.')
    .map((p) => {
      const n = parseInt(p, 10);
      return Number.isFinite(n) ? n : 0;
    });

/** True when `latest` is strictly newer than `current`, compared component-wise. */
export const isNewerVersion = (latest: string, current: string): boolean => {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
};

const toErrorMessage = (err: string | PluginNodeScriptError | undefined): string | undefined =>
  err === undefined ? undefined : typeof err === 'string' ? err : err.message;

interface FetchResult {
  success: boolean;
  tagName?: string;
  htmlUrl?: string;
  error?: string;
}

/**
 * GET the latest release from Codeberg via a Node HTTPS request.
 *
 * The request runs through `executeNodeScript` (Node context, no CORS) rather
 * than an iframe `fetch()`, which the sandbox CSP blocks — same mechanism the
 * file watcher uses. A `User-Agent` header is sent because Codeberg sits behind
 * Cloudflare, which can 403 a header-less request.
 *
 * Any failure (no nodeExecution, non-200, timeout, parse error) resolves to
 * `null` — the caller treats "couldn't check" exactly like "no update", so a
 * flaky network never produces a false notification.
 */
export const fetchLatestRelease = async (): Promise<UpdateInfo | null> => {
  if (!PluginAPI.executeNodeScript) return null;

  let result;
  try {
    result = await PluginAPI.executeNodeScript({
      script: `
        const https = require('https');
        return new Promise((resolve) => {
          const req = https.get(args[0], {
            headers: { 'User-Agent': 'sync-md-multi', 'Accept': 'application/json' },
            timeout: 8000,
          }, (res) => {
            if (res.statusCode !== 200) {
              res.resume();
              return resolve({ success: false, error: 'HTTP ' + res.statusCode });
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
              try {
                const j = JSON.parse(body);
                resolve({ success: true, tagName: j.tag_name, htmlUrl: j.html_url });
              } catch (e) {
                resolve({ success: false, error: 'parse: ' + e.message });
              }
            });
          });
          req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'timeout' }); });
          req.on('error', (e) => resolve({ success: false, error: e.message }));
        });
      `,
      args: [RELEASES_LATEST_URL],
      timeout: 10000,
    });
  } catch {
    return null;
  }

  const r = result.result as FetchResult;
  if (!result.success || !r?.success || !r.tagName) {
    console.warn('[sync-md] update check failed:', r?.error ?? toErrorMessage(result.error));
    return null;
  }
  return {
    latestVersion: r.tagName.replace(/^v/i, '').trim(),
    htmlUrl: r.htmlUrl || '',
  };
};

/** Returns update info when a strictly-newer release exists, else `null`. */
export const checkForUpdate = async (currentVersion: string): Promise<UpdateInfo | null> => {
  const latest = await fetchLatestRelease();
  if (!latest) return null;
  return isNewerVersion(latest.latestVersion, currentVersion) ? latest : null;
};
