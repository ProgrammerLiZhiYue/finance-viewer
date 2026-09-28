import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAIR_FLAGS } from '../src/types';
import type { NotifyArgs } from '../src/types';

type IpcHandler = (event: unknown, args: unknown) => unknown;

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>();
  const notificationOn = vi.fn<(event: string, listener: () => void) => void>();
  const notificationShow = vi.fn();
  const isSupported = vi.fn(() => true);
  const window = { show: vi.fn(), focus: vi.fn() };
  const getAllWindows = vi.fn(() => [window]);
  const Notification = Object.assign(vi.fn(function () {
    return { on: notificationOn, show: notificationShow };
  }), { isSupported });
  const services = {
    getExchangeRateData: vi.fn(),
    getRateSummary: vi.fn(),
    getHKStockMinuteData: vi.fn(),
    getHKStockFiveDayData: vi.fn(),
    getHKStockKLineData: vi.fn(),
    getHKStockSummary: vi.fn(),
    search: vi.fn(),
  };
  const electron = {
    app: {
      // Register lifecycle listeners without invoking ready/activate callbacks.
      on: vi.fn(),
      quit: vi.fn(),
      setAppUserModelId: vi.fn(),
      getAppPath: vi.fn(() => '/mock/finance-viewer'),
      isPackaged: false,
    },
    BrowserWindow: Object.assign(vi.fn(), { getAllWindows }),
    ipcMain: {
      handle: vi.fn((channel: string, handler: IpcHandler) => {
        handlers.set(channel, handler);
      }),
    },
    Notification,
    shell: { readShortcutLink: vi.fn(), writeShortcutLink: vi.fn() },
    Tray: vi.fn(),
    Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
    nativeImage: { createFromPath: vi.fn() },
    nativeTheme: { on: vi.fn(), shouldUseDarkColors: false },
  };
  return { handlers, notificationOn, notificationShow, isSupported, window, getAllWindows, Notification, services, electron };
});

vi.mock('electron', () => mocks.electron);
vi.mock('electron-squirrel-startup', () => ({ default: false }));
vi.mock('../src/exchangeRateService', () => mocks.services);

const validArgs: NotifyArgs = {
  pairCode: 'USDCNY',
  level: 'normal',
  title: 'Exchange rate alert',
  body: 'USDCNY reached the configured price.',
};

let sendNotification: IpcHandler;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.Notification.mockReset().mockImplementation(function () {
    return { on: mocks.notificationOn, show: mocks.notificationShow };
  });
  mocks.notificationOn.mockReset();
  mocks.notificationShow.mockReset();
  mocks.isSupported.mockReturnValue(true);
  mocks.getAllWindows.mockReturnValue([mocks.window]);
  vi.spyOn(console, 'error').mockImplementation(() => {});

  // Import the real module, but only invoke the captured notification IPC handler.
  await import('../src/main');
  const handler = mocks.handlers.get('send-notification');
  if (!handler) throw new Error('send-notification IPC handler was not registered');
  sendNotification = handler;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function expectRejected(args: unknown): void {
  expect(sendNotification({}, args)).toBe(false);
  expect(mocks.isSupported).not.toHaveBeenCalled();
  expect(mocks.Notification).not.toHaveBeenCalled();
  expect(mocks.notificationOn).not.toHaveBeenCalled();
  expect(mocks.notificationShow).not.toHaveBeenCalled();
}

describe('main send-notification IPC', () => {
  it('registers the handler without starting the app, services, or system notifications', () => {
    const registrations = mocks.electron.ipcMain.handle.mock.calls.filter(([channel]) => channel === 'send-notification');
    expect(registrations).toHaveLength(1);
    expect(mocks.electron.app.on).toHaveBeenCalledWith('ready', expect.any(Function));
    expect(mocks.electron.app.quit).not.toHaveBeenCalled();
    expect(mocks.electron.BrowserWindow).not.toHaveBeenCalled();
    expect(mocks.electron.Tray).not.toHaveBeenCalled();
    expect(mocks.electron.Menu.buildFromTemplate).not.toHaveBeenCalled();
    expect(mocks.electron.Menu.setApplicationMenu).not.toHaveBeenCalled();
    expect(mocks.electron.nativeImage.createFromPath).not.toHaveBeenCalled();
    expect(mocks.electron.shell.readShortcutLink).not.toHaveBeenCalled();
    expect(mocks.electron.shell.writeShortcutLink).not.toHaveBeenCalled();
    for (const service of Object.values(mocks.services)) expect(service).not.toHaveBeenCalled();
    expect(mocks.Notification).not.toHaveBeenCalled();
    expect(mocks.notificationShow).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'USDCNY'],
    ['number', 42],
    ['boolean', true],
    ['array', []],
    ['empty object', {}],
  ])('rejects %s arguments', (_label, args) => {
    expectRejected(args);
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['number', 123],
    ['empty', ''],
    ['unknown currency', 'INVALID'],
    ['lowercase currency', 'usdcny'],
    ['padded currency', ' USDCNY '],
    ['prototype toString', 'toString'],
    ['prototype constructor', 'constructor'],
    ['prototype __proto__', '__proto__'],
    ['prototype hasOwnProperty', 'hasOwnProperty'],
  ])('rejects a %s pairCode instead of accepting inherited PAIR_FLAGS properties', (_label, pairCode) => {
    expectRejected({ ...validArgs, pairCode });
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['number', 1],
    ['empty', ''],
    ['unknown', 'warning'],
    ['uppercase', 'NORMAL'],
    ['array', ['normal']],
    ['object', { level: 'normal' }],
  ])('rejects a %s level', (_label, level) => {
    expectRejected({ ...validArgs, level });
  });

  describe.each(['title', 'body'] as const)('%s validation', (field) => {
    it.each([
      ['missing', undefined],
      ['null', null],
      ['number', 123],
      ['object', {}],
      ['array', ['text']],
      ['empty string', ''],
      ['whitespace only', ' \t\r\n '],
    ])('rejects %s', (_label, value) => {
      expectRejected({ ...validArgs, [field]: value });
    });

    it('rejects a string one character above the limit', () => {
      const limit = field === 'title' ? 512 : 65_536;
      expectRejected({ ...validArgs, [field]: 'x'.repeat(limit + 1) });
    });
  });

  it('accepts title and body exactly at their length limits', () => {
    const args = { ...validArgs, title: 't'.repeat(512), body: 'b'.repeat(65_536) };
    expect(sendNotification({}, args)).toBe(true);
    expect(mocks.Notification).toHaveBeenCalledWith(expect.objectContaining({ title: args.title, body: args.body }));
    expect(mocks.notificationShow).toHaveBeenCalledTimes(1);
  });

  it.each(Object.keys(PAIR_FLAGS))('accepts the supported currency %s', (pairCode) => {
    expect(sendNotification({}, { ...validArgs, pairCode })).toBe(true);
    expect(mocks.Notification).toHaveBeenCalledTimes(1);
    expect(mocks.notificationShow).toHaveBeenCalledTimes(1);
  });

  it('returns false without constructing a notification when unsupported', () => {
    mocks.isSupported.mockReturnValue(false);
    expect(sendNotification({}, validArgs)).toBe(false);
    expect(mocks.isSupported).toHaveBeenCalledTimes(1);
    expect(mocks.Notification).not.toHaveBeenCalled();
    expect(mocks.notificationOn).not.toHaveBeenCalled();
    expect(mocks.notificationShow).not.toHaveBeenCalled();
  });

  it('returns false when the notification constructor throws', () => {
    const error = new Error('Notification construction failed');
    mocks.Notification.mockImplementationOnce(function () { throw error; });
    expect(sendNotification({}, validArgs)).toBe(false);
    expect(mocks.Notification).toHaveBeenCalledTimes(1);
    expect(mocks.notificationOn).not.toHaveBeenCalled();
    expect(mocks.notificationShow).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('Failed to submit notification:', error);
  });

  it('returns false when show throws and still allows the same notification to be retried', () => {
    const error = new Error('Notification show failed');
    mocks.notificationShow.mockImplementationOnce(() => { throw error; });
    expect(sendNotification({}, validArgs)).toBe(false);
    expect(mocks.notificationShow).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith('Failed to submit notification:', error);

    expect(sendNotification({}, validArgs)).toBe(true);
    expect(mocks.Notification).toHaveBeenCalledTimes(2);
    expect(mocks.notificationShow).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['normal', true],
    ['important', false],
    ['urgent', false],
  ] as const)('submits %s notifications with silent=%s', (level, silent) => {
    expect(sendNotification({}, { ...validArgs, level })).toBe(true);
    expect(mocks.isSupported).toHaveBeenCalledTimes(1);
    expect(mocks.Notification).toHaveBeenCalledTimes(1);
    expect(mocks.Notification).toHaveBeenCalledWith({
      title: validArgs.title,
      body: validArgs.body,
      icon: path.join('/mock/finance-viewer', 'assets', 'icons', 'icon.png'),
      silent,
    });
    expect(mocks.notificationOn).toHaveBeenCalledWith('click', expect.any(Function));
    expect(mocks.notificationShow).toHaveBeenCalledTimes(1);
    expect(mocks.window.show).not.toHaveBeenCalled();
    expect(mocks.window.focus).not.toHaveBeenCalled();
  });

  it.each(['normal', 'important', 'urgent'] as const)('does not apply a pair/level cooldown to consecutive %s submissions', (level) => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const args = { ...validArgs, level };
    // Deduplication belongs to the hook; the same IPC handler must submit every call.
    for (let i = 0; i < 3; i++) expect(sendNotification({}, args)).toBe(true);
    expect(mocks.Notification).toHaveBeenCalledTimes(3);
    expect(mocks.notificationShow).toHaveBeenCalledTimes(3);
  });

  it('shows then focuses the current window when the notification is clicked', () => {
    mocks.getAllWindows.mockReturnValue([]);
    expect(sendNotification({}, validArgs)).toBe(true);
    expect(mocks.getAllWindows).not.toHaveBeenCalled();
    const [event, onClick] = mocks.notificationOn.mock.calls[0];
    expect(event).toBe('click');

    mocks.getAllWindows.mockReturnValue([mocks.window]);
    onClick();
    expect(mocks.getAllWindows).toHaveBeenCalledTimes(1);
    expect(mocks.window.show).toHaveBeenCalledTimes(1);
    expect(mocks.window.focus).toHaveBeenCalledTimes(1);
    expect(mocks.window.show.mock.invocationCallOrder[0]).toBeLessThan(mocks.window.focus.mock.invocationCallOrder[0]);
  });

  it('does not throw when clicked with no open window', () => {
    expect(sendNotification({}, validArgs)).toBe(true);
    const [, onClick] = mocks.notificationOn.mock.calls[0];
    mocks.getAllWindows.mockReturnValue([]);
    expect(() => onClick()).not.toThrow();
    expect(mocks.getAllWindows).toHaveBeenCalledTimes(1);
    expect(mocks.window.show).not.toHaveBeenCalled();
    expect(mocks.window.focus).not.toHaveBeenCalled();
  });
});
