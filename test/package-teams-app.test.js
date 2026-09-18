import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('Teams 앱 패키지는 앱 ID와 두 아이콘만 포함한다', () => {
  const directory = mkdtempSync(join(tmpdir(), 'teambi-agent-package-'));
  try {
    cpSync(join(process.cwd(), 'appPackage'), join(directory, 'appPackage'), { recursive: true });
    mkdirSync(join(directory, 'scripts'));
    cpSync(join(process.cwd(), 'scripts/package-teams-app.sh'), join(directory, 'scripts/package-teams-app.sh'));
    writeFileSync(join(directory, '.env'), 'MicrosoftAppId=app-id\n');
    const result = spawnSync('bash', ['scripts/package-teams-app.sh'], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const archive = result.stdout.match(/dist\/[^\s]+\.zip/)?.[0];
    assert.ok(archive);
    const listed = spawnSync('unzip', ['-Z1', archive], { cwd: directory, encoding: 'utf8' });
    assert.deepEqual(listed.stdout.trim().split('\n').sort(), ['color.png', 'manifest.json', 'outline.png']);
    const manifest = spawnSync('unzip', ['-p', archive, 'manifest.json'], { cwd: directory, encoding: 'utf8' });
    const parsed = JSON.parse(manifest.stdout);
    assert.equal(parsed.id, 'app-id');
    assert.deepEqual(parsed.bots[0].scopes, ['groupChat']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
