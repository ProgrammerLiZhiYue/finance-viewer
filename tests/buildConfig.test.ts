import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Electron Forge 8 的 plugin-vite 把主进程与 preload 产物输出为 `.cjs`
// （即使 package.json 没有 "type": "module"，也统一用 CommonJS 后缀）。
// 这些断言防止入口路径退回旧的 `.js` 写法，从而在 pnpm start 时直接报错。
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  main: string;
  scripts: Record<string, string>;
};
const mainSource = readFileSync('src/main.ts', 'utf8');
const forgeConfig = readFileSync('forge.config.ts', 'utf8');

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
