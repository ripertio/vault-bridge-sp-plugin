import {
  parseVersion,
  isNewerVersion,
  checkForUpdate,
  fetchLatestRelease,
} from '../update-check';

describe('parseVersion', () => {
  it('strips a leading v and splits into numeric components', () => {
    expect(parseVersion('v0.3.2')).toEqual([0, 3, 2]);
    expect(parseVersion('0.3.2')).toEqual([0, 3, 2]);
    expect(parseVersion('V1.2.3')).toEqual([1, 2, 3]);
  });

  it('collapses non-numeric parts to 0 (a malformed tag can never read as newer)', () => {
    expect(parseVersion('0.x.2')).toEqual([0, 0, 2]);
    expect(parseVersion('garbage')).toEqual([0]);
  });
});

describe('isNewerVersion', () => {
  it('is false for equal versions', () => {
    expect(isNewerVersion('0.3.2', '0.3.2')).toBe(false);
    expect(isNewerVersion('v0.3.2', '0.3.2')).toBe(false);
  });

  it('is false when latest is older', () => {
    expect(isNewerVersion('0.3.1', '0.3.2')).toBe(false);
    expect(isNewerVersion('0.2.9', '0.3.0')).toBe(false);
    expect(isNewerVersion('0.9.9', '1.0.0')).toBe(false);
  });

  it('is true when latest is strictly newer', () => {
    expect(isNewerVersion('0.3.2', '0.3.1')).toBe(true);
    expect(isNewerVersion('0.4.0', '0.3.9')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
  });

  it('handles differing component lengths', () => {
    expect(isNewerVersion('0.3', '0.3.0')).toBe(false);
    expect(isNewerVersion('0.3.1', '0.3')).toBe(true);
    expect(isNewerVersion('0.3', '0.3.1')).toBe(false);
  });
});

describe('fetchLatestRelease / checkForUpdate', () => {
  const api = () => (global as unknown as { PluginAPI: { executeNodeScript: jest.Mock } }).PluginAPI;
  let original: jest.Mock;

  beforeEach(() => {
    original = api().executeNodeScript;
  });
  afterEach(() => {
    api().executeNodeScript = original;
    jest.restoreAllMocks();
  });

  it('returns update info when the node fetch succeeds', async () => {
    api().executeNodeScript = jest.fn(async () => ({
      success: true,
      result: {
        success: true,
        tagName: 'v0.3.2',
        htmlUrl: 'https://github.com/ripertio/vault-bridge-sp-plugin/releases/tag/v0.3.2',
      },
    }));
    const info = await fetchLatestRelease();
    expect(info).toEqual({
      latestVersion: '0.3.2',
      htmlUrl: 'https://github.com/ripertio/vault-bridge-sp-plugin/releases/tag/v0.3.2',
    });
  });

  it('returns null when the node script reports failure', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    api().executeNodeScript = jest.fn(async () => ({
      success: true,
      result: { success: false, error: 'HTTP 500' },
    }));
    expect(await fetchLatestRelease()).toBeNull();
  });

  it('returns null when executeNodeScript throws', async () => {
    api().executeNodeScript = jest.fn(async () => {
      throw new Error('boom');
    });
    expect(await fetchLatestRelease()).toBeNull();
  });

  it('checkForUpdate returns info only when the release is strictly newer', async () => {
    const makeApi = (tag: string) =>
      jest.fn(async () => ({
        success: true,
        result: {
          success: true,
          tagName: tag,
          htmlUrl: 'https://github.com/ripertio/vault-bridge-sp-plugin/releases/latest',
        },
      }));

    api().executeNodeScript = makeApi('v0.3.3');
    expect(await checkForUpdate('0.3.2')).not.toBeNull();

    api().executeNodeScript = makeApi('v0.3.2');
    expect(await checkForUpdate('0.3.2')).toBeNull();

    api().executeNodeScript = makeApi('v0.3.1');
    expect(await checkForUpdate('0.3.2')).toBeNull();
  });

  it('checkForUpdate returns null when the network check fails', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    api().executeNodeScript = jest.fn(async () => ({
      success: false,
      result: undefined,
      error: 'node unavailable',
    }));
    expect(await checkForUpdate('0.3.2')).toBeNull();
  });
});
