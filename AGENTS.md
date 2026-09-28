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
```

Unit tests live in `tests/` (sibling of `src/`, never colocated in `src/`), organized to mirror `src/`: component tests in `tests/components/`, logic tests in `tests/lib/` and `tests/context/`, shared mocks/fixtures in `tests/helpers.tsx`. They cover pure logic (format helpers, settings reducer/persistence, i18n interpolation) and all four components via @testing-library/react with a mocked `window.electronAPI` and mocked `echarts`; real API/ECharts rendering still needs manual verification by running the app.

## Setup / Gotchas

- Package manager is **pnpm** with `nodeLinker: hoisted` (see `pnpm-workspace.yaml`).
- `postinstall` runs `fix-electron.js`, which patches `extract-zip` for Node.js v22+ compatibility and manually extracts the electron binary from cache if `path.txt` is missing. If `pnpm install` succeeds but `pnpm start` fails with a missing electron binary, re-run `node fix-electron.js`.
- `pnpm-workspace.yaml` overrides `@electron/node-gyp` with the local tarball `vendor/electron-node-gyp.tar.gz` because this network cannot git-fetch it. Never delete `vendor/` or the override — installs break without them.

## Architecture

Three separate Vite build targets (configured in `forge.config.ts`):
- **main** (`src/main.ts`) — Electron main process, built with `vite.main.config.ts`
- **preload** (`src/preload.ts`) — preload script, built with `vite.preload.config.ts`
- **renderer** (`src/renderer.tsx`) — React UI, built with `vite.renderer.config.ts` (only config with the React plugin)

The renderer accesses Electron globals `MAIN_WINDOW_VITE_DEV_SERVER_URL` and `MAIN_WINDOW_VITE_NAME` — declared globally in `src/env.d.ts` (along with `__APP_VERSION__` and `window.electronAPI`).

## IPC / Security

The preload exposes `window.electronAPI` via `contextBridge.exposeInMainWorld`. IPC handlers live in `src/main.ts` (`ipcMain.handle`). Do **not** set `contextIsolation: false` or `nodeIntegration: true` — FusesPlugin enforces strict security (ASAR-only, no RunAsNode).

## Code Style

- React function components with hooks; settings state lives in `src/context/SettingsContext.tsx` (Context + useReducer, persisted to localStorage); i18n via react-i18next (`src/i18n.ts`, locale files use single-brace `{key}` interpolation).
- `noImplicitAny: true` is enforced in tsconfig
- ESLint uses flat config (`eslint.config.mjs`) with `typescript-eslint` + `eslint-plugin-import-x` (electron ruleset). Lint covers `.ts`/`.tsx`/`.mjs`.
- `require()` in `src/main.ts` and `fix-electron.js` is intentional (ESLint rule `@typescript-eslint/no-require-imports` is disabled for those files).
- No formatter (no prettier/biome). ESLint is the only style gate — do not add a formatter or reformat files.

## Data / Services

- `src/exchangeRateService.ts` runs in the main process only — never import it from the renderer or preload.
- On API failure the service **throws** — there is no mock fallback. If you see data, it came from the real API.
- Baidu's risk control returns HTTP 403 `"hit risk"` for the default TLS ClientHello (OpenSSL 3.5 / Electron BoringSSL fingerprints carry a 1.2KB x25519mlkem768 post-quantum key share). Every request therefore sends `BROWSER_COOKIE` and `TLS_OPTIONS` (`ecdhCurve: 'X25519:P-256'`) — do not remove them without re-verifying against the live API. Note: the Electron main process uses BoringSSL, so group names must be BoringSSL-compatible (`P-256`, not OpenSSL-only `secp256r1` — that throws `Failed to set ECDH curve`). The `huilv_kline`/`huilv_minute`/sug/HK endpoints work with this; `quotation_fiveday_hk` intermittently 403s even from a browser (pre-existing, unrelated).
