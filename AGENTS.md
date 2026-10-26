# AGENTS.md

This file provides guidance to the AI agent when working with code in this repository.

## 修改流程

每次修改必须按以下顺序执行：
1. 先同步设计稿 `design-prototype.html`，使其体现本次修改的界面与交互。
2. 再按同步后的设计稿修改代码，保持实现与设计稿一致。
3. 最后在 `tests/` 中补全或更新相关测试，并运行测试验证。

## Project

Electron + React 19 + TypeScript desktop app (Electron Forge + Vite). ECharts for charts; exchange rate data fetched in the **main process** via Node.js `https` (not the renderer) to avoid Chromium 403 errors.

## Commands

```bash
pnpm start          # dev: launches Electron via electron-forge start
pnpm run make       # build distributable (Squirrel/ZIP/RPM/Deb)
pnpm run lint       # eslint . (flat config — eslint.config.mjs)
pnpm test           # vitest run (happy-dom environment)
pnpm run gen:icon   # regenerate assets/icons/icon.ico from assets/icons/icon.png
```

Unit tests live in `tests/` (sibling of `src/`, never colocated in `src/`), organized to mirror `src/`: component tests in `tests/components/`, logic tests in `tests/lib/` and `tests/context/`, shared mocks/fixtures in `tests/helpers.tsx`. They cover pure logic (format helpers, settings reducer/persistence, i18n interpolation) and all four components via @testing-library/react with a mocked `window.electronAPI` and mocked `echarts`; real API/ECharts rendering still needs manual verification by running the app.

## Setup / Gotchas

- Package manager is **pnpm** with `nodeLinker: hoisted` (see `pnpm-workspace.yaml`).
- Electron 42+ 不再提供 `postinstall` 来下载二进制：`node_modules/electron` 里没有 `scripts` 字段，二进制由 `require('electron')` 惰性下载（第一次 `pnpm start` / `electron-forge start` 时）或显式执行 `npx install-electron` 安装，装好后写下 `node_modules/electron/path.txt`。因此本项目没有 `postinstall` 钩子，也不需要手写解压脚本。若首次下载失败（GitHub 被墙），把 zip 预先放进 `@electron/get` 缓存，或设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 后再启动。
- `pnpm-workspace.yaml` overrides `@electron/node-gyp` with the local tarball `vendor/electron-node-gyp.tar.gz` because this network cannot git-fetch it. Never delete `vendor/` or the override — installs break without them.
- **`assets/icons/icon.ico` must contain BMP (DIB) frames, never PNG-compressed frames.** Squirrel.Windows' installer progress window loads that file with WPF (`AnimatedGifWindow` → `BitmapFrame.Create(setupIcon.ico)`), and WIC/WPF cannot decode PNG-in-ICO: it throws `System.IO.FileFormatException` on a background thread, `Update.exe` dies with `0xE0434352`, and `Setup.exe` then shows **"Installation has failed"** — while the app may actually be installed (or left half-written, since the crash can land mid-install). Only the non-silent (double-click) path is affected, so `Setup.exe --silent` looks healthy. Regenerate with `pnpm run gen:icon` (`scripts/generate-app-icon.mjs`, box-filtered from the 1024×1024 master); do not use tools that emit PNG frames for all sizes. `tests/iconAssets.test.ts` rejects PNG frames and asserts the committed file matches the generator output.
- **Windows 安装报 "There was an error while installing the application" 通常是环境残留，不是代码 bug。** Squirrel 的 `Update.exe` 在 `%LOCALAPPDATA%\finance_viewer` 半写目录、残留 `Squirrel.exe`/`Update.exe`/`finance-viewer.exe` 进程占用文件、或磁盘空间不足时抛异常并返回非 0，`Setup.exe` 只是笼统地显示 `Installation has failed`。修复办法是清理残留（命令见 `README.md` 的「安装失败排查」），不是改代码。排查时先看 `%LOCALAPPDATA%\SquirrelTemp\Squirrel-Install.log`（`Open Setup Log` 打开的是 `SquirrelSetup.log`，几乎没信息）；`Setup.exe` 的各条失败副标题见 `src/Setup/UpdateRunner.cpp` 的 `DisplayErrorMessage` 调用点。免安装兜底：`finance_viewer-<ver>-full.nupkg` 改名 `.zip` 解压后直接跑 `lib/net45/finance-viewer.exe`。
- `glob` is pinned in `devDependencies` on purpose. `forge.config.ts` statically imports every maker, and `@electron-forge/maker-squirrel` loads `electron-winstaller` → `@electron/asar@3` → `glob@7`. Under pnpm's `hoisted` layout the **win32** resolution drops `glob@7` (linux keeps it), so `electron-forge make` only fails on Windows with `Cannot find module 'glob'`. Keep the 7.x pin; `scripts/check-windows-makers.mjs` (run by `.github/workflows/windows-deps-guard.yml` on dependency changes) installs with `--os=win32 --cpu=x64` and requires every maker to catch regressions early.

## Architecture

Three separate Vite build targets (configured in `forge.config.ts`):
- **main** (`src/main.ts`) — Electron main process, built with `vite.main.config.mts`
- **preload** (`src/preload.ts`) — preload script, built with `vite.preload.config.mts`
- **renderer** (`src/renderer.tsx`) — React UI, built with `vite.renderer.config.mts` (only config with the React plugin)

The renderer accesses Electron globals `MAIN_WINDOW_VITE_DEV_SERVER_URL` and `MAIN_WINDOW_VITE_NAME` — declared globally in `src/env.d.ts` (along with `__APP_VERSION__` and `window.electronAPI`).

## IPC / Security

The preload exposes `window.electronAPI` via `contextBridge.exposeInMainWorld`. IPC handlers live in `src/main.ts` (`ipcMain.handle`). Do **not** set `contextIsolation: false` or `nodeIntegration: true` — FusesPlugin enforces strict security (ASAR-only, no RunAsNode).

## Code Style

- React function components with hooks; settings state lives in `src/context/SettingsContext.tsx` (Context + useReducer, persisted to localStorage); i18n via react-i18next (`src/i18n.ts`, locale files use single-brace `{key}` interpolation).
- `noImplicitAny: true` is enforced in tsconfig
- ESLint uses flat config (`eslint.config.mjs`) with `typescript-eslint` + `eslint-plugin-import-x` (electron ruleset). Lint covers `.ts`/`.tsx`/`.mjs`.
- `require()` in `src/main.ts` is intentional (ESLint rule `@typescript-eslint/no-require-imports` is disabled for that file).
- No formatter (no prettier/biome). ESLint is the only style gate — do not add a formatter or reformat files.

## Data / Services

- `src/exchangeRateService.ts` runs in the main process only — never import it from the renderer or preload.
- On API failure the service **throws** — there is no mock fallback. If you see data, it came from the real API.
- Baidu's risk control returns HTTP 403 `"hit risk"` for the default TLS ClientHello (OpenSSL 3.5 / Electron BoringSSL fingerprints carry a 1.2KB x25519mlkem768 post-quantum key share). Every request therefore sends `BROWSER_COOKIE` and `TLS_OPTIONS` (`ecdhCurve: 'X25519:P-256'`) — do not remove them without re-verifying against the live API. Note: the Electron main process uses BoringSSL, so group names must be BoringSSL-compatible (`P-256`, not OpenSSL-only `secp256r1` — that throws `Failed to set ECDH curve`). The `huilv_kline`/`huilv_minute`/sug/HK endpoints work with this; `quotation_fiveday_hk` intermittently 403s even from a browser (pre-existing, unrelated).
