import { boundFilesPresent, listProjectEntries } from '../project-entries';
import { assertRealPathInside, listExistingFiles, listSubfolders } from '../../helper/file-utils';

jest.mock('../../helper/file-utils', () => ({
  assertRealPathInside: jest.fn(),
  listExistingFiles: jest.fn(),
  listSubfolders: jest.fn(),
}));

const mockedSubfolders = listSubfolders as jest.MockedFunction<typeof listSubfolders>;
const mockedExisting = listExistingFiles as jest.MockedFunction<typeof listExistingFiles>;
const mockedRealPath = assertRealPathInside as jest.MockedFunction<typeof assertRealPathInside>;

const VAULT = '/vault';
const ABS = '/vault/Projects';

describe('boundFilesPresent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRealPath.mockResolvedValue(undefined);
  });

  it('returns only the bound files that exist', async () => {
    mockedExisting.mockResolvedValue(['Inbox/backlog.md']);
    const present = await boundFilesPresent(VAULT, ABS, {
      'Inbox/backlog.md': 'p1',
      'Gone/x.md': 'p2',
    });
    expect(present).toEqual(['Inbox/backlog.md']);
  });

  it('skips files whose real path leaves the vault', async () => {
    mockedExisting.mockResolvedValue(['Inbox/backlog.md']);
    mockedRealPath.mockRejectedValue(new Error('outside'));
    expect(await boundFilesPresent(VAULT, ABS, { 'Inbox/backlog.md': 'p1' })).toEqual([]);
  });

  it('ignores binds that are not .md files inside the projects folder', async () => {
    expect(
      await boundFilesPresent(VAULT, ABS, {
        '../escape.md': 'p1',
        'notes.txt': 'p2',
      }),
    ).toEqual([]);
    expect(mockedExisting).not.toHaveBeenCalled();
  });
});

describe('listProjectEntries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRealPath.mockResolvedValue(undefined);
  });

  it('returns the sub-folders and the bound files together', async () => {
    mockedSubfolders.mockResolvedValue(['Alpha', 'Beta']);
    mockedExisting.mockResolvedValue(['Inbox/backlog.md']);
    expect(await listProjectEntries(VAULT, ABS, { 'Inbox/backlog.md': 'p1' })).toEqual([
      'Alpha',
      'Beta',
      'Inbox/backlog.md',
    ]);
  });

  it('keeps a bound file when there are no sub-folders', async () => {
    mockedSubfolders.mockResolvedValue([]);
    mockedExisting.mockResolvedValue(['Inbox/backlog.md']);
    expect(await listProjectEntries(VAULT, ABS, { 'Inbox/backlog.md': 'p1' })).toEqual(['Inbox/backlog.md']);
  });

  it('returns only sub-folders when there are no binds', async () => {
    mockedSubfolders.mockResolvedValue(['Alpha']);
    expect(await listProjectEntries(VAULT, ABS, {})).toEqual(['Alpha']);
    expect(mockedExisting).not.toHaveBeenCalled();
  });
});
