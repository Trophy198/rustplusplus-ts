const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function deployment(t) {
    const root = path.resolve(__dirname, '..');
    const app = fs.mkdtempSync(path.join(os.tmpdir(), 'rustplusplus-deploy-'));
    t.after(() => fs.rmSync(app, { recursive: true, force: true }));
    fs.cpSync(path.join(root, 'dist'), path.join(app, 'dist'), { recursive: true });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(app, 'node_modules'), 'junction');
    const envPath = path.join(app, '.env');
    function start(env = {}, cwd = app, offlineLogin = false) {
        const args = offlineLogin ? ['--require', path.join(__dirname, 'fixtures/offline-login.cjs')] : [];
        args.push(path.join(app, require('../package.json').main));
        const cleanEnv = { ...process.env, NODE_OPTIONS: '' };
        delete cleanEnv.RPP_DISCORD_CLIENT_ID;
        delete cleanEnv.RPP_DISCORD_TOKEN;
        const result = spawnSync(process.execPath, args, {
            cwd, env: { ...cleanEnv, ...env }, encoding: 'utf8', timeout: 30_000
        });
        assert.ifError(result.error);
        return result;
    }
    return { app, envPath, start };
}

test('production starts from compiled files and discovers its commands, events and assets', t => {
    const { envPath, start } = deployment(t);
    const result = start({ RPP_DISCORD_CLIENT_ID: '1', RPP_DISCORD_TOKEN: 'offline' }, undefined, true);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Compiled startup verified/);
    assert.equal(fs.existsSync(envPath), false);
});

test('first launch creates a private template, explains missing values and preserves edits on restart', t => {
    const { app, envPath, start } = deployment(t);
    const otherCwd = path.join(app, 'work');
    fs.mkdirSync(otherCwd);
    const first = start({}, otherCwd);
    assert.equal(first.status, 1);
    assert.match(first.stderr, /RPP_DISCORD_CLIENT_ID and RPP_DISCORD_TOKEN/);
    assert.ok(first.stderr.includes(envPath));
    assert.equal(fs.existsSync(path.join(otherCwd, '.env')), false);
    const template = fs.readFileSync(path.join(__dirname, '../scripts/.env.template'), 'utf8');
    assert.equal(fs.readFileSync(envPath, 'utf8'), template);
    if (process.platform !== 'win32') assert.equal(fs.statSync(envPath).mode & 0o077, 0);

    const partial = '# customized\nRPP_DISCORD_CLIENT_ID=1\n';
    fs.writeFileSync(envPath, partial);
    const second = start();
    assert.equal(second.status, 1);
    assert.match(second.stderr, /Set RPP_DISCORD_TOKEN in/);
    assert.equal(fs.readFileSync(envPath, 'utf8'), partial);

    const completed = partial + 'RPP_DISCORD_TOKEN=offline\n';
    fs.writeFileSync(envPath, completed);
    const third = start({}, app, true);
    assert.equal(third.status, 0, third.stdout + third.stderr);
    assert.match(third.stdout, /Compiled startup verified/);
    assert.equal(fs.readFileSync(envPath, 'utf8'), completed);
});
