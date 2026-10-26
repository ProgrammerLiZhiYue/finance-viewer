# finance-viewer

外汇牌价查看器（Electron + React + TypeScript）。

## 下载

安装包发布在 [GitHub Releases](https://github.com/ProgrammerLiZhiYue/finance-viewer/releases)。

| 平台 | 文件 | 说明 |
| --- | --- | --- |
| Windows | `finance-viewer-<ver>.Setup.exe` | Squirrel 安装器，装到 `%LOCALAPPDATA%\finance_viewer`，带开始菜单/桌面快捷方式 |
| Windows | `finance_viewer-<ver>-full.nupkg` | 免安装：改名为 `.zip` 后解压，运行 `lib\net45\finance-viewer.exe` |
| macOS | `.dmg` / `.zip` | |
| Linux | `.deb` / `.rpm` | |

## 安装失败排查（Windows）

`Installation has failed` 是 Squirrel `Setup.exe` 的通用标题，具体原因看副标题：

- **`There was an error while installing the application. Check the setup log...`**
  `Update.exe` 返回了非 0——绝大多数是**上一次安装的残留**（`%LOCALAPPDATA%\finance_viewer` 半写目录、残留 `Squirrel.exe` / `Update.exe` / `finance-viewer.exe` 进程占着文件、或磁盘空间不足）。先彻底清理再重装：

  ```powershell
  Get-Process finance-viewer,Squirrel,Update -ErrorAction SilentlyContinue | Stop-Process -Force
  Remove-Item "$env:LOCALAPPDATA\finance_viewer" -Recurse -Force
  Remove-Item "$env:LOCALAPPDATA\SquirrelTemp" -Recurse -Force
  ```

  详细日志在 `%LOCALAPPDATA%\SquirrelTemp\Squirrel-Install.log`（对话框里的 `Open Setup Log` 打开的是 `SquirrelSetup.log`，信息更少）。
- **`Please re-run this installer as a normal user instead of "Run as Administrator"`**：不要右键「以管理员身份运行」。
- **`Unable to write to <path> - IT policies may be restricting access to this folder`**：权限或组策略限制。
- **`Failed to extract installer`**：解压失败，通常是磁盘空间不足或杀毒软件拦截。

万一安装器仍然装不上，用上表的 `.nupkg` 免安装包可以直接运行。

## 开发

```bash
pnpm install
pnpm start     # 开发
pnpm test      # vitest
pnpm run lint
pnpm run make  # 打包
```

更多约定见 [AGENTS.md](AGENTS.md)。
