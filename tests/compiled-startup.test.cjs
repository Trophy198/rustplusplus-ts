const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('production starts from compiled files and discovers its commands, events and assets', t => {
    const root = path.resolve(__dirname, '..');
    const app = fs.mkdtempSync(path.join(os.tmpdir(), 'rustplusplus-deploy-'));
    t.after(() => fs.rmSync(app, { recursive: true, force: true }));
    fs.mkdirSync(path.join(app, 'dist'));
    fs.copyFileSync(path.join(root, 'dist/index.js'), path.join(app, 'dist/index.js'));
    fs.cpSync(path.join(root, 'dist/src'), path.join(app, 'dist/src'), { recursive: true });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(app, 'node_modules'), 'junction');
    const entry = require('../package.json').main;
    const args = ['--require', path.join(__dirname, 'fixtures/offline-login.cjs'), entry];
    const result = spawnSync(process.execPath, args, {
        cwd: app,
        env: { ...process.env, NODE_OPTIONS: '', RPP_DISCORD_CLIENT_ID: '1', RPP_DISCORD_TOKEN: 'offline' },
        encoding: 'utf8',
        timeout: 30_000
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Compiled startup verified/);
});
