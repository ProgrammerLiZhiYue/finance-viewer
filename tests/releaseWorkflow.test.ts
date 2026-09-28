import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

interface Step {
  name: string;
  uses?: string;
  if?: string;
  env?: Record<string, string>;
  run?: string;
  with?: Record<string, string | boolean | number>;
}

interface Job {
  needs?: string;
  if?: string;
  permissions?: Record<string, string>;
  defaults?: { run: { shell: string } };
  strategy?: {
    'fail-fast': boolean;
    matrix: { include: { os: string; platform: string; arch: string; command: string }[] };
  };
  steps: Step[];
}

const requireFromProject = createRequire(import.meta.url);
const requireFromEslint = createRequire(requireFromProject.resolve('eslint/package.json'));
const yaml = requireFromEslint('js-yaml') as { load: (source: string) => unknown };
const workflow = yaml.load(readFileSync('.github/workflows/release.yml', 'utf8')) as {
  on: { push: { tags: string[] }; workflow_dispatch: null };
  permissions: Record<string, string>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: { build: Job; release: Job };
};
const { build, release } = workflow.jobs;
const step = (job: Job, name: string) => job.steps.find(item => item.name === name)!;
const releaseScript = String(step(release, 'Publish installers to the tag release').with!.script);

function execute(script: string, bindings: Record<string, unknown>): Promise<void> {
  const run = new Function(...Object.keys(bindings), `return (async () => {\n${script}\n})();`);
  return run(...Object.values(bindings));
}

const installers = [
  'finance-viewer-windows-x64/squirrel.windows/x64/外汇查看器 Setup.exe',
  'finance-viewer-windows-x64/squirrel.windows/x64/finance_viewer-1.0.0-full.nupkg',
  'finance-viewer-windows-x64/squirrel.windows/x64/RELEASES',
  'finance-viewer-macos-x64/zip/darwin/x64/finance-viewer-darwin-x64-1.0.0.zip',
  'finance-viewer-macos-arm64/zip/darwin/arm64/finance-viewer-darwin-arm64-1.0.0.zip',
  'finance-viewer-linux-x64/deb/x64/finance-viewer_1.0.0_amd64.deb',
  'finance-viewer-linux-x64/rpm/x64/finance-viewer-1.0.0.x86_64.rpm',
];

function publication(files = installers, version = '1.0.0') {
  const paths = files.map(file => path.join('release-artifacts', ...file.split('/')));
  const upload = vi.fn();
  const pages: { id: number; draft: boolean; tag_name: string }[][] = [];
  const paginate = { iterator: vi.fn(async function* () {
    for (const data of pages) yield { data };
  }) };
  const git = {
    getRef: vi.fn().mockResolvedValue({ data: { object: { type: 'commit', sha: 'built-commit' } } }),
    getTag: vi.fn().mockResolvedValue({ data: { object: { type: 'commit', sha: 'built-commit' } } }),
  };
  const repos = {
    getReleaseByTag: vi.fn().mockRejectedValue({ status: 404 }),
    listReleases: vi.fn(),
    createRelease: vi.fn().mockResolvedValue({ data: { id: 10, draft: true } }),
    updateRelease: vi.fn().mockResolvedValue({ data: { id: 10, draft: false } }),
  };
  const bindings = {
    require: (name: string) => {
      if (name === 'node:path') return path;
      if (name === 'node:child_process') return { execFileSync: upload };
      if (name === 'node:fs') return {
        readFileSync: () => JSON.stringify({ version }),
        readdirSync: (directory: string) => {
          const prefix = directory + path.sep;
          const names = paths.filter(file => file.startsWith(prefix))
            .map(file => file.slice(prefix.length).split(path.sep)[0]);
          return [...new Set(names)].map(name => ({
            name,
            isDirectory: () => paths.some(file => file.startsWith(path.join(directory, name) + path.sep)),
          }));
        },
      };
      throw new Error(`Unexpected require: ${name}`);
    },
    github: { rest: { git, repos }, paginate },
    context: { repo: { owner: 'owner', repo: 'finance-viewer' }, sha: 'built-commit' },
    core: { info: vi.fn() },
    process: { env: { TAG_NAME: `v${version}` } },
  };
  return { bindings, git, repos, upload, paths, pages, paginate, run: () => execute(releaseScript, bindings) };
}

describe('release workflow configuration', () => {
  it('runs for version tags or manual dispatch and only publishes tags', () => {
    expect(workflow.on).toEqual({ push: { tags: ['v*'] }, workflow_dispatch: null });
    expect(release.if).toBe("github.ref_type == 'tag' && startsWith(github.ref_name, 'v')");
    expect(release.needs).toBe('build');
    expect(workflow.concurrency).toEqual({ group: 'release-${{ github.ref }}', 'cancel-in-progress': false });
  });

  it('only grants write access to the release job', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(build.permissions).toBeUndefined();
    expect(release.permissions).toEqual({ contents: 'write' });
    for (const job of [build, release]) {
      expect(step(job, 'Checkout').with!['persist-credentials']).toBe(false);
    }
    expect(release.steps.some(item => item.run?.includes('pnpm'))).toBe(false);
  });

  it('uses four native build targets and explicit architecture', () => {
    expect(build.strategy).toEqual({
      'fail-fast': false,
      matrix: { include: [
        { os: 'windows-latest', platform: 'windows', arch: 'x64', command: 'make:win' },
        { os: 'macos-15-intel', platform: 'macos', arch: 'x64', command: 'make:mac' },
        { os: 'macos-15', platform: 'macos', arch: 'arm64', command: 'make:mac' },
        { os: 'ubuntu-24.04', platform: 'linux', arch: 'x64', command: 'make:linux' },
      ] },
    });
    expect(step(build, 'Build installers').run).toContain('pnpm run "$BUILD_COMMAND" --arch "$BUILD_ARCH"');
    expect(build.defaults!.run.shell).toBe('bash');
  });

  it('installs Node 24 before pnpm and Electron after the extraction patch', () => {
    const names = build.steps.map(item => item.name);
    expect(step(build, 'Setup Node.js').with!['node-version']).toBe('24');
    expect(names.indexOf('Setup Node.js')).toBeLessThan(names.indexOf('Setup pnpm'));
    expect(step(build, 'Setup pnpm').with).not.toHaveProperty('version');
    expect(step(build, 'Install dependencies').run).toBe('pnpm install --frozen-lockfile');
    expect(step(build, 'Install dependencies').env).toEqual({ ELECTRON_SKIP_BINARY_DOWNLOAD: '1' });
    const install = step(build, 'Install Electron after the extraction patch');
    expect(install.run).toContain('node node_modules/electron/install.js');
    expect(install.run).toContain("accessSync(require('electron'))");
    expect(install.env).toBeUndefined();
    expect(names.indexOf('Install dependencies')).toBeLessThan(names.indexOf(install.name));
    expect(names.indexOf(install.name)).toBeLessThan(names.indexOf('Check code'));
    expect(names.indexOf('Check code')).toBeLessThan(names.indexOf('Build installers'));
  });

  it('supplies Linux packaging tools and generates the macOS icon', () => {
    expect(step(build, 'Install Linux packaging tools').if).toBe("runner.os == 'Linux'");
    expect(step(build, 'Install Linux packaging tools').run).toContain('fakeroot rpm');
    expect(step(build, 'Generate macOS icon').if).toBe("runner.os == 'macOS'");
    expect(step(build, 'Generate macOS icon').run).toContain('iconutil -c icns');
    expect(readFileSync('forge.config.ts', 'utf8')).toMatch(/executableName:\s*'finance-viewer'/);
  });

  it('retains distinct artifacts with all installer formats', () => {
    const upload = step(build, 'Upload build artifacts').with!;
    expect(upload.name).toBe('finance-viewer-${{ matrix.platform }}-${{ matrix.arch }}');
    expect(upload['if-no-files-found']).toBe('error');
    expect(upload.overwrite).toBe(true);
    for (const glob of ['*.exe', '*.msi', '*.nupkg', 'RELEASES', '*.zip', '*.deb', '*.rpm']) {
      expect(upload.path).toContain(glob);
    }
    expect(step(release, 'Download all installers').with).toEqual({
      pattern: 'finance-viewer-*', path: 'release-artifacts',
    });
  });

  it.each([
    ['branch', 'master', true],
    ['tag', 'v1.0.0', true],
    ['tag', 'v9.0.0', false],
    ['tag', '1.0.0', false],
    ['tag', 'v1.0.0; echo unsafe', false],
  ])('validates %s %s before building', async (type, tag, valid) => {
    const script = step(build, 'Validate release tag').run!.match(/node <<'NODE'\n([\s\S]*?)\nNODE/)![1];
    const result = execute(script, {
      require: () => ({ version: '1.0.0' }),
      process: { env: { REF_TYPE: type, TAG_NAME: tag } },
    });
    if (valid) await expect(result).resolves.toBeUndefined();
    else await expect(result).rejects.toThrow('Release tag must match');
  });
});

describe('release publication', () => {
  it('creates a draft and publishes only after all attachments upload', async () => {
    const test = publication();
    await test.run();
    expect(test.repos.createRelease).toHaveBeenCalledWith(expect.objectContaining({
      tag_name: 'v1.0.0', target_commitish: 'built-commit', draft: true, prerelease: false,
      generate_release_notes: true,
    }));
    expect(test.upload).toHaveBeenCalledWith('gh', [
      'release', 'upload', 'v1.0.0', ...test.paths, '--clobber',
    ], { stdio: 'inherit' });
    expect(test.repos.updateRelease).toHaveBeenCalledWith(expect.objectContaining({
      release_id: 10, draft: false, prerelease: false,
    }));
    expect(test.upload.mock.invocationCallOrder[0]).toBeLessThan(test.repos.updateRelease.mock.invocationCallOrder[0]);
  });

  it('supports annotated tags and prerelease versions', async () => {
    const test = publication(installers, '1.0.0-beta.1');
    test.git.getRef.mockResolvedValue({ data: { object: { type: 'tag', sha: 'tag-object' } } });
    await test.run();
    expect(test.git.getTag).toHaveBeenCalledWith(expect.objectContaining({ tag_sha: 'tag-object' }));
    expect(test.repos.createRelease).toHaveBeenCalledWith(expect.objectContaining({ prerelease: true }));
  });

  it('updates an existing release without creating another release', async () => {
    const test = publication();
    test.repos.getReleaseByTag.mockResolvedValue({ data: { id: 20 } });
    await test.run();
    expect(test.repos.createRelease).not.toHaveBeenCalled();
    expect(test.repos.updateRelease).toHaveBeenCalledWith(expect.objectContaining({ release_id: 20 }));
  });

  it('resumes an interrupted draft upload across release pages', async () => {
    const test = publication();
    test.pages.push(
      [{ id: 30, draft: true, tag_name: 'v2.0.0' }],
      [{ id: 21, draft: true, tag_name: 'v1.0.0' }],
    );
    await test.run();
    expect(test.paginate.iterator).toHaveBeenCalledWith(test.repos.listReleases, expect.objectContaining({ per_page: 100 }));
    expect(test.repos.createRelease).not.toHaveBeenCalled();
    expect(test.upload).toHaveBeenCalled();
    expect(test.repos.updateRelease).toHaveBeenCalledWith(expect.objectContaining({ release_id: 21, draft: false }));
  });

  it.each(installers)('rejects missing artifact %s before publishing', async missing => {
    const test = publication(installers.filter(file => file !== missing));
    await expect(test.run()).rejects.toThrow('Missing installer');
    expect(test.repos.createRelease).not.toHaveBeenCalled();
    expect(test.upload).not.toHaveBeenCalled();
  });

  it('rejects duplicate attachment names', async () => {
    const test = publication([...installers, 'other/RELEASES']);
    await expect(test.run()).rejects.toThrow('Duplicate release asset names');
    expect(test.upload).not.toHaveBeenCalled();
  });

  it('rejects a moved tag or a mismatched version', async () => {
    const moved = publication();
    moved.git.getRef.mockResolvedValue({ data: { object: { type: 'commit', sha: 'different-commit' } } });
    await expect(moved.run()).rejects.toThrow('Tag no longer points');
    expect(moved.upload).not.toHaveBeenCalled();
    const mismatch = publication();
    mismatch.bindings.process.env.TAG_NAME = 'v2.0.0';
    await expect(mismatch.run()).rejects.toThrow('Tag does not match');
    expect(mismatch.git.getRef).not.toHaveBeenCalled();
  });

  it('does not treat permission errors as a missing release', async () => {
    const test = publication();
    test.repos.getReleaseByTag.mockRejectedValue({ status: 403 });
    await expect(test.run()).rejects.toEqual({ status: 403 });
    expect(test.repos.createRelease).not.toHaveBeenCalled();
  });

  it('leaves a new release in draft when uploading fails', async () => {
    const test = publication();
    test.upload.mockImplementation(() => { throw new Error('Upload failed'); });
    await expect(test.run()).rejects.toThrow('Upload failed');
    expect(test.repos.updateRelease).not.toHaveBeenCalled();
  });

  it('does not overwrite an immutable release', async () => {
    const test = publication();
    test.repos.getReleaseByTag.mockResolvedValue({ data: { id: 20, immutable: true } });
    await expect(test.run()).rejects.toThrow('Release is immutable');
    expect(test.upload).not.toHaveBeenCalled();
    expect(test.repos.updateRelease).not.toHaveBeenCalled();
  });
});
