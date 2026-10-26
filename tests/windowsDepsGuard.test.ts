import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// forge.config.ts 静态 import 所有 maker，因此依赖布局一旦在 win32 下变化，
// 只有 Windows 的发布任务才会在 "Loading configuration" 阶段失败。这个
// workflow 用 `pnpm install --os=win32 --cpu=x64` 在 Linux runner 上模拟，
// 所以能提前在 PR 阶段发现问题。
interface GuardStep {
  uses?: string;
  run?: string;
}

const requireFromProject = createRequire(import.meta.url);
const requireFromEslint = createRequire(requireFromProject.resolve('eslint/package.json'));
const yaml = requireFromEslint('js-yaml') as { load: (source: string) => unknown };

const workflow = yaml.load(
  readFileSync('.github/workflows/windows-deps-guard.yml', 'utf8'),
) as {
  on: { pull_request: { paths: string[] }; workflow_dispatch: null };
  jobs: { makers: { 'runs-on': string; steps: GuardStep[] } };
};

describe('Windows 依赖布局守卫 workflow', () => {
  it('在依赖或 forge 配置变更时触发', () => {
    expect(workflow.on.pull_request.paths).toEqual(
      expect.arrayContaining([
        'package.json',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        'forge.config.ts',
        'scripts/check-windows-makers.mjs',
      ]),
    );
  });

  it('在非 Windows runner 上执行 win32 模拟检查', () => {
    expect(workflow.jobs.makers['runs-on']).toMatch(/^ubuntu-/);

    const commands = workflow.jobs.makers.steps
      .map(step => step.run)
      .filter((run): run is string => typeof run === 'string');
    expect(commands.join('\n')).toContain('node scripts/check-windows-makers.mjs');
  });
});
