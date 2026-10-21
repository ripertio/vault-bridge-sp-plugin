/**
 * Security regression test for the config UI (src/ui/index.html).
 *
 * The panel runs inside Super Productivity's sandboxed iframe, which has
 * `allow-scripts` and — because this plugin requests `nodeExecution` — a bridge
 * that exposes `executeNodeScript`. Any dynamic value rendered via `innerHTML`
 * (project titles, configured paths, binding IDs, timestamps, filesystem entry
 * names, error strings) would therefore let HTML/event-handler markup execute
 * and escalate to arbitrary machine access once the user has approved
 * nodeExecution.
 *
 * These tests load the *real* index.html in jsdom with a PluginAPI whose values
 * are HTML-shaped, run the actual render paths, and assert every dynamic value
 * lands as text (no injected element nodes, no <img>/<script>).
 */
import { TextEncoder, TextDecoder } from 'util';
// jsdom's URL machinery needs these globals, which jest's jsdom environment
// does not expose by default — polyfill them before requiring jsdom.
/* eslint-disable @typescript-eslint/no-explicit-any */
if (!(global as any).TextEncoder) (global as any).TextEncoder = TextEncoder;
if (!(global as any).TextDecoder) (global as any).TextDecoder = TextDecoder;
/* eslint-enable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JSDOM } = require('jsdom');
import * as fs from 'fs';
import * as path from 'path';

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// A payload that, if inserted via innerHTML, creates an <img> whose onerror
// would run script. We detect the injection structurally (an element node was
// created) rather than relying on onerror firing under jsdom.
const XSS = '<img src=x onerror="window.__pwned = true">';

interface StubApi {
  [k: string]: unknown;
}

// The device-local config the (simulated) background serves over the message
// bridge. HTML-shaped values so the render paths are exercised with hostile input.
function makeConfig(): Record<string, unknown> {
  return {
    version: 2,
    bindings: [{ id: 'b1', projectId: 'p1', filePath: `/tmp/${XSS}.md` }],
    _lastSynced: {},
    _cachedProjects: [{ id: 'p1', title: XSS }],
  };
}

function makePluginApi(overrides: StubApi = {}): StubApi {
  return {
    getAllProjects: async () => [{ id: 'p1', title: XSS }],
    registerHook: () => {},
    executeNodeScript: async () => ({
      result: {
        success: true,
        items: [],
        currentPath: '/',
        parentPath: null,
        homePath: '/',
      },
    }),
    ...overrides,
  };
}

async function flush(dom: { window: Window }, predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('UI did not reach the expected state in time');
}

async function loadUi(
  api: StubApi,
  config: Record<string, unknown> = makeConfig(),
): Promise<{ window: any }> {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window: any) {
      window.PluginAPI = api;
      // Simulate the background's onMessage bridge (v0.4.0): config now lives in
      // the background, and the iframe reads/writes it via postMessage. In jsdom
      // the top window is its own parent, so the iframe's window.parent.postMessage
      // lands here. Reply with a PLUGIN_MESSAGE_RESPONSE on `result` (the envelope
      // shape the real SP host uses).
      window.addEventListener('message', (event: any) => {
        const d = event.data;
        if (!d || d.type !== 'PLUGIN_MESSAGE') return;
        const msg = d.message || {};
        let result: unknown;
        if (msg.type === 'getConfig') result = { success: true, config };
        else if (msg.type === 'getProjects')
          result = { success: true, projects: (config as any)._cachedProjects };
        else result = { success: true };
        window.postMessage(
          { type: 'PLUGIN_MESSAGE_RESPONSE', messageId: d.messageId, result },
          '*',
        );
      });
    },
  });
  await flush(dom, () => dom.window.document.getElementById('projectsDir') !== null);
  return dom;
}

describe('config UI — no HTML injection from dynamic values', () => {
  it('renders raw filesystem entry names as text in the file browser', async () => {
    const api = makePluginApi({
      executeNodeScript: async () => ({
        result: {
          success: true,
          items: [{ name: `${XSS}.md`, isDir: false, path: `/tmp/${XSS}.md` }],
          currentPath: '/tmp',
          parentPath: '/',
          homePath: '/home',
        },
      }),
    });
    const dom = await loadUi(api);
    const doc = dom.window.document;

    doc.getElementById('vaultPathBrowse').click();
    await flush(dom, () => Boolean(doc.querySelector('#fbList .fb-item')));

    const fbList = doc.getElementById('fbList');
    expect(fbList.querySelectorAll('img, script').length).toBe(0);
    expect(dom.window.__pwned).toBeUndefined();

    const item = fbList.querySelector('.fb-item');
    const nameSpan = item.children[1]; // [0] is the icon span, [1] the name
    expect(nameSpan.textContent).toBe(`${XSS}.md`);
    expect(nameSpan.querySelectorAll('*').length).toBe(0);
  });

  it('renders a file-browser error string as text (no markup execution)', async () => {
    const api = makePluginApi({
      executeNodeScript: async () => ({
        result: { success: false, error: XSS },
      }),
    });
    const dom = await loadUi(api);
    const doc = dom.window.document;

    doc.getElementById('vaultPathBrowse').click();
    await flush(dom, () => Boolean(doc.querySelector('#fbList .fb-error')));

    const fbList = doc.getElementById('fbList');
    expect(fbList.querySelectorAll('img, script').length).toBe(0);
    expect(dom.window.__pwned).toBeUndefined();

    const err = fbList.querySelector('.fb-error');
    expect(err.textContent).toContain(XSS);
    expect(err.querySelectorAll('*').length).toBe(0);
  });
});
