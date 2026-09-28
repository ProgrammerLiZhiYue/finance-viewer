import { app, BrowserWindow, ipcMain, Notification, shell, Tray, Menu, nativeImage, nativeTheme } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import { getExchangeRateData, getRateSummary, getHKStockMinuteData, getHKStockFiveDayData, getHKStockKLineData, getHKStockSummary, search } from './exchangeRateService';
import { PAIR_FLAGS } from './types';
import type { Period, KLinePeriod, CurrencyPair, Locale, HKStockCode, NotifyArgs } from './types';

// ---------- 主进程国际化 ----------

const i18nMessages: Record<Locale, Record<string, string>> = {
  zh: {
    appTitle: '外汇查看器',
    trayShow: '显示主窗口',
    traySettings: '设置',
    trayQuit: '退出',
    menuFile: '文件',
    menuView: '视图',
    menuSettings: '设置',
    menuQuit: '退出',
    menuReload: '刷新',
    menuDevTools: '开发者工具',
    menuResetZoom: '重置缩放',
    menuZoomIn: '放大',
    menuZoomOut: '缩小',
    menuFullscreen: '全屏',
  },
  en: {
    appTitle: 'Exchange Rate Viewer',
    trayShow: 'Show Window',
    traySettings: 'Settings',
    trayQuit: 'Quit',
    menuFile: 'File',
    menuView: 'View',
    menuSettings: 'Settings',
    menuQuit: 'Quit',
    menuReload: 'Reload',
    menuDevTools: 'Developer Tools',
    menuResetZoom: 'Reset Zoom',
    menuZoomIn: 'Zoom In',
    menuZoomOut: 'Zoom Out',
    menuFullscreen: 'Fullscreen',
  },
  ja: {
    appTitle: '為替レートビューア',
    trayShow: 'ウィンドウを表示',
    traySettings: '設定',
    trayQuit: '終了',
    menuFile: 'ファイル',
    menuView: '表示',
    menuSettings: '設定',
    menuQuit: '終了',
    menuReload: '再読み込み',
    menuDevTools: '開発者ツール',
    menuResetZoom: 'ズームをリセット',
    menuZoomIn: '拡大',
    menuZoomOut: '縮小',
    menuFullscreen: '全画面',
  },
};

let currentLocale: Locale = 'zh';

function t(key: string): string {
  return i18nMessages[currentLocale]?.[key] ?? i18nMessages.zh[key] ?? key;
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Windows 上必须设置 AppUserModelId，否则系统不会显示通知
const APP_ID = 'com.finance-viewer.app';
app.setAppUserModelId(APP_ID);

/**
 * Windows Toast 通知需要一个带有匹配 appUserModelId 的开始菜单快捷方式。
 * 在开发模式下 electron-forge 不会自动创建这个快捷方式，所以手动创建一个。
 */
function findLnkFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findLnkFiles(fullPath));
      } else if (entry.name.endsWith('.lnk')) {
        results.push(fullPath);
      }
    }
  } catch { /* ignore permission errors */ }
  return results;
}

function ensureStartMenuShortcut(): void {
  if (process.platform !== 'win32') return;
  const appData = process.env.APPDATA;
  if (!appData) return;

  const shortcutDir = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const target = process.execPath;

  const shortcutDetails = {
    target,
    appUserModelId: APP_ID,
    toastActivatorClsid: '{6D8C5275-7B2E-42B0-9E3E-7F3EB25A2C0A}',
  };

  // Search all shortcuts in Programs (including subdirectories) for one pointing to our exe
  const allLnkFiles = findLnkFiles(shortcutDir);
  let matched = false;

  for (const lnkPath of allLnkFiles) {
    try {
      const details = shell.readShortcutLink(lnkPath);
      if (details.target === target) {
        shell.writeShortcutLink(lnkPath, 'update', shortcutDetails);
        console.log('[notify] 已更新开始菜单快捷方式:', lnkPath);
        matched = true;
        break;
      }
    } catch { /* skip unreadable shortcuts */ }
  }

  if (!matched) {
    const shortcutPath = path.join(shortcutDir, `${app.getName()}.lnk`);
    shell.writeShortcutLink(shortcutPath, 'create', shortcutDetails);
    console.log('[notify] 已创建开始菜单快捷方式:', shortcutPath);
  }
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

/** 获取 assets/icons 目录下图标文件的绝对路径 */
function getIconPath(filename: string): string {
  if (app.isPackaged) {
    // 打包后图标通过 extraResource 复制到 resources/icons/ 目录
    return path.join(process.resourcesPath, 'icons', filename);
  }
  return path.join(app.getAppPath(), 'assets', 'icons', filename);
}

/** 加载托盘图标（优先 @2x 高清图） */
function loadTrayIcon(): Electron.NativeImage {
  const iconPath = getIconPath('tray-icon.png');
  const icon2xPath = getIconPath('tray-icon@2x.png');
  const icon = nativeImage.createFromPath(iconPath);
  if (fs.existsSync(icon2xPath)) {
    icon.addRepresentation({
      scaleFactor: 2.0,
      buffer: fs.readFileSync(icon2xPath),
    });
  }
  return icon;
}

function createTray(win: BrowserWindow): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
  const icon = loadTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip(t('appTitle'));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: t('trayShow'),
      click: () => {
        win.show();
        win.focus();
      },
    },
    {
      label: t('traySettings'),
      click: () => {
        win.webContents.send('navigate-to-settings');
        win.show();
        win.focus();
      },
    },
    { type: 'separator' },
    {
      label: t('trayQuit'),
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // 双击托盘图标恢复窗口
  tray.on('double-click', () => {
    win.show();
    win.focus();
  });
}

function createAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: t('menuFile'),
      submenu: [
        {
          label: t('menuSettings'),
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
            if (win) {
              win.webContents.send('navigate-to-settings');
              win.show();
              win.focus();
            }
          },
        },
        { type: 'separator' },
        {
          label: t('menuQuit'),
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: t('menuView'),
      submenu: [
        { role: 'reload', label: t('menuReload') },
        { role: 'toggleDevTools', label: t('menuDevTools') },
        { type: 'separator' },
        { role: 'resetZoom', label: t('menuResetZoom') },
        { role: 'zoomIn', label: t('menuZoomIn') },
        { role: 'zoomOut', label: t('menuZoomOut') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('menuFullscreen') },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    title: t('appTitle'),
    width: 1120,
    height: 720,
    frame: false,
    icon: getIconPath(process.platform === 'win32' ? 'icon.ico' : 'icon-256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // 拦截关闭事件，最小化到托盘而非退出
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open the DevTools in development mode only.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools();
  }

  // 如果是开机自启动（带 --hidden 参数），启动时隐藏窗口到托盘
  const isAutoLaunch = process.argv.includes('--hidden');
  if (isAutoLaunch) {
    mainWindow.hide();
  }

  // 创建应用菜单栏
  createAppMenu();

  // 创建系统托盘
  createTray(mainWindow);
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
// IPC: 获取汇率数据
ipcMain.handle('get-exchange-rate', (_event, pairCode: CurrencyPair, period: Period) => {
  return getExchangeRateData(pairCode, period);
});

ipcMain.handle('get-rate-summary', (_event, pairCode: CurrencyPair) => {
  return getRateSummary(pairCode);
});

ipcMain.handle('get-hk-stock-minute', (_event, stockCode: HKStockCode) => {
  return getHKStockMinuteData(stockCode);
});

ipcMain.handle('get-hk-stock-fiveday', (_event, stockCode: HKStockCode) => {
  return getHKStockFiveDayData(stockCode);
});

ipcMain.handle('get-hk-stock-kline', (_event, stockCode: HKStockCode, period: KLinePeriod) => {
  return getHKStockKLineData(stockCode, period);
});

ipcMain.handle('get-hk-stock-summary', (_event, stockCode: HKStockCode) => {
  return getHKStockSummary(stockCode);
});

ipcMain.handle('search', (_event, query: string) => {
  return search(query);
});

// ---------- 开机自启动 ----------

ipcMain.handle('get-auto-launch', () => {
  const settings = app.getLoginItemSettings();
  return settings.openAtLogin;
});

ipcMain.handle('set-auto-launch', (_event, enable: boolean) => {
  app.setLoginItemSettings({
    openAtLogin: enable,
    // Windows 下使用 path + args 方式，支持 --hidden 参数
    path: process.execPath,
    args: enable ? ['--hidden'] : [],
  });
  console.log(`[auto-launch] 开机自启动已${enable ? '启用' : '禁用'}`);
  return true;
});

// ---------- 系统主题 ----------

ipcMain.handle('get-system-theme', () => {
  return nativeTheme.shouldUseDarkColors;
});

nativeTheme.on('updated', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send('system-theme-changed', nativeTheme.shouldUseDarkColors);
  }
});

// ---------- 语言设置 ----------

ipcMain.handle('set-locale', (_event, locale: Locale) => {
  currentLocale = locale;
  // 重新创建菜单以应用新语言
  createAppMenu();
  // 更新托盘菜单
  const win = BrowserWindow.getAllWindows()[0];
  if (win && tray) {
    createTray(win);
  }
  console.log(`[i18n] 语言已切换为: ${locale}`);
  return true;
});

// ---------- 窗口控制 ----------

ipcMain.handle('window-close', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.hide();
  }
});

ipcMain.handle('window-minimize', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.minimize();
});

ipcMain.handle('window-maximize', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }
});

ipcMain.handle('get-platform', () => {
  const p = process.platform;
  if (p === 'win32') return 'windows';
  if (p === 'darwin') return 'macos';
  return 'linux';
});

// ---------- 通知系统 ----------

ipcMain.handle('send-notification', (_event, args: unknown) => {
  if (!args || typeof args !== 'object') return false;
  const candidate = args as Record<string, unknown>;
  if (typeof candidate.pairCode !== 'string' || !Object.hasOwn(PAIR_FLAGS, candidate.pairCode)
    || !['normal', 'important', 'urgent'].includes(candidate.level as string)
    || typeof candidate.title !== 'string' || !candidate.title.trim() || candidate.title.length > 512
    || typeof candidate.body !== 'string' || !candidate.body.trim() || candidate.body.length > 65_536
    || !Notification.isSupported()) return false;
  const { level, title, body } = args as NotifyArgs;
  try {
    const notification = new Notification({ title, body, icon: getIconPath('icon.png'), silent: level === 'normal' });
    notification.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) { win.show(); win.focus(); }
    });
    notification.show();
    return true;
  } catch (error) {
    console.error('Failed to submit notification:', error);
    return false;
  }
});

app.on('ready', () => {
  ensureStartMenuShortcut();
  createWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
