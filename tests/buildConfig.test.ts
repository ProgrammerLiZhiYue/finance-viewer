import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Electron Forge 8 的 plugin-vite 把主进程与 preload 产物输出为 `.cjs`
// （即使 package.json 没有 "type": "module"，也统一用 CommonJS 后缀）。
// 这些断言防止入口路径退回旧的 `.js` 写法，从而在 pnpm start 时直接报错。
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  main: string;
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};
const mainSource = readFileSync('src/main.ts', 'utf8');
const forgeConfig = readFileSync('forge.config.ts', 'utf8');
const requireFromProject = createRequire(import.meta.url);

describe('Electron Forge 构建入口配置', () => {
  it('package.json 的 main 指向 plugin-vite 生成的 CommonJS 主进程包', () => {
    expect(pkg.main).toBe('.vite/build/main.cjs');
  });

  it('主进程加载 .cjs 后缀的 preload 脚本', () => {
    expect(mainSource).toContain("path.join(__dirname, 'preload.cjs')");
  });

  it('forge 引用的 Vite 配置使用 ESM 扩展名的真实文件', () => {
    const configs = [...forgeConfig.matchAll(/config: '([^']+)'/g)].map(match => match[1]);
    expect(configs).toHaveLength(3);

    const files = readdirSync('.');
    for (const config of configs) {
      // Vite 8 提示 ESM 语法写在 CJS 里会在未来版本失效，故统一使用 .mts
      expect(config).toMatch(/^vite\.(main|preload|renderer)\.config\.mts$/);
      expect(files).toContain(config);
    }
  });
});

describe('npm scripts', () => {
  it('不引用已删除的本地脚本', () => {
    // electron 42+ 的二进制由 require('electron') 惰性安装，项目不再需要
    // postinstall 里的手写解压脚本；这里兜底防止留下悬空引用。
    const referenced = Object.entries(pkg.scripts).flatMap(([name, command]) =>
      [...command.matchAll(/\bnode\s+(\S+\.(?:js|cjs|mjs))/g)].map(match => ({
        name,
        file: match[1],
      })),
    );

    for (const { name, file } of referenced) {
      expect(existsSync(file), `scripts.${name} 引用了不存在的文件 ${file}`).toBe(true);
    }
  });
});

// forge.config.ts 会静态 import 每个 maker，所以 Windows 打包前必须先能加载
// electron-winstaller -> @electron/asar@3 -> glob@7。pnpm 的 hoisted 布局在
// win32 解析下会丢掉 glob@7（linux 不会），打包时才报 Cannot find module 'glob'，
// 因此 glob 被显式钉在 devDependencies 里。
describe('Windows 打包依赖布局', () => {
  it('glob 被钉在 7.x（@electron/asar@3 需要的 API）', () => {
    expect(pkg.devDependencies.glob).toMatch(/^\^7\./);
  });

  it('electron-winstaller 内嵌的 @electron/asar 能解析到 glob@7', () => {
    const winstallerDir = path.dirname(requireFromProject.resolve('electron-winstaller/package.json'));
    const asarLibDir = path.join(winstallerDir, 'node_modules', '@electron', 'asar', 'lib');
    const globEntry = requireFromProject.resolve('glob', { paths: [asarLibDir] });
    const globPkg = JSON.parse(
      readFileSync(path.join(path.dirname(globEntry), 'package.json'), 'utf8'),
    ) as { version: string };
    expect(globPkg.version).toMatch(/^7\./);
  });

  it('electron-winstaller 可以正常加载', () => {
    expect(() => requireFromProject('electron-winstaller')).not.toThrow();
  });
});
