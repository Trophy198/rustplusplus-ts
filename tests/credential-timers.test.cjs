const assert = require('node:assert/strict');
const test = require('node:test');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const index = require.resolve('../index.ts');
const context = { log: { info() {}, warn() {}, error() {} }, config: { discord: {} } };
require.cache[index] = { id: index, loaded: true, exports: context };
const { CredentialsManager } = require('../src/managers/credentialsManager');
const views = require('../src/discordUtils/discordMessages');

function manager(t) {
    const dir = mkdtempSync(join(tmpdir(), 'rustplus-credential-test-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return new CredentialsManager(dir);
}

test('ready looks up each Discord owner once while handling each credential separately', async t => {
    const cm = manager(t);
    for (let i = 0; i < 32; i++) cm.credentialsMap[i] = { discordUserId: 'owner' + i % 4 };
    context.credentialsManager = cm;
    const pairings = Object.fromEntries(Object.keys(cm.credentialsMap).map(id => [id, { steamId: id }]));
    const guilds = { primary: { serverInfoMap: {}, pairingDataMap: { server: { ...pairings } } },
        secondary: { serverInfoMap: {}, pairingDataMap: { server: { ...pairings } } } };
    context.guildInstanceManager = { getGuildInstanceGuildIds: () => Object.keys(guilds),
        getGuildInstance: id => guilds[id], updateGuildInstance() {} };
    const expirations = t.mock.method(cm, 'scheduleExpireTimeout', () => {});
    const dm = {
        client: { guilds: { cache: new Map() } }, getGuildIds: async () => Object.keys(guilds),
        registerGlobalSlashCommands: async () => {},
        getGuildIdsForUser: t.mock.fn(async id => id === 'owner0' ? ['primary', 'secondary'] : ['primary'])
    };
    await require('../src/discordEvents/ready').execute(dm);
    t.diagnostic('guild membership lookups for 32 credentials / 4 owners: ' + dm.getGuildIdsForUser.mock.callCount());
    assert.equal(dm.getGuildIdsForUser.mock.callCount(), 4);
    assert.equal(expirations.mock.callCount(), 32);
    assert.equal(Object.keys(guilds.primary.pairingDataMap.server).length, 32);
    assert.deepEqual(Object.keys(guilds.secondary.pairingDataMap.server),
        Object.keys(pairings).filter(id => Number(id) % 4 === 0));
});

test('an old expiration notification cannot cancel the refreshed credential timer', async t => {
    const cm = manager(t);
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
    const send = Promise.withResolvers();
    t.mock.method(views, 'sendCredentialsExpiredMessage', () => send.promise);
    cm.credentialsMap.A = { expireDate: 1 };
    cm.scheduleExpireTimeout('A', {});
    cm.credentialsMap.A = { expireDate: 120 };
    cm.scheduleExpireTimeout('A', {});
    send.resolve();
    await nextTurn();
    assert.equal(cm.expirationTimeoutIds.size, 1);
    cm.cancelExpireTimeout('A');
});

test('long credential expiry schedules at most one timer up to the Node timeout limit', async t => {
    const cm = manager(t);
    const max = 2147483647;
    const now = 100000;
    const expiry = 40 * 86400000;
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
    const schedule = t.mock.method(global, 'setTimeout');
    const send = t.mock.method(views, 'sendCredentialsExpiredMessage', async () => {});
    t.mock.method(cm, 'updateCredentials', () => true);
    cm.credentialsMap.A = { expireDate: (now + expiry) / 1000 };
    cm.scheduleExpireTimeout('A', {});
    assert.equal(schedule.mock.calls[0].arguments[1], max);
    t.mock.timers.tick(max);
    assert.equal(cm.expirationTimeoutIds.size, 1);
    assert.equal(send.mock.callCount(), 0);
    t.mock.timers.tick(expiry + 5000 - max);
    await nextTurn();
    assert.equal(send.mock.callCount(), 1);
    assert.equal(cm.expirationTimeoutIds.size, 0);
});
