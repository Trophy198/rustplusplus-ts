const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setImmediate: nextTurn } = require('node:timers/promises');
const test = require('node:test');
const rp = require('rustplus-ts');
const Ws = require('ws');

const log = { info() {}, warn() {}, error() {}, child() { return this; } };
const guild = { serverInfoMap: { server: { requesterSteamId: '1', name: 'test', ip: 'local', port: '1' } },
    pairingDataMap: { server: {} }, generalSettings: {}, serverToView: null };
for (const id of ['1', '2', '3', '4']) guild.pairingDataMap.server[id] = { steamId: id, playerToken: 7, valid: true };
const index = require.resolve('../index.ts');
require.cache[index] = { id: index, loaded: true, exports: {
    log, config: { general: { serverPollingHandlerIntervalMs: 1000 } }, localeManager: {},
    guildInstanceManager: { getGuildInstance: () => guild, updateGuildInstance() {} },
    credentialsManager: { getCredentials: () => ({}) }, discordManager: { connectionStarted: [] }
} };
const { RustPlusInstance } = require('../src/managers/rustPlusManager');
const { RustPlusMapMarkers } = require('../src/structures/rustPlusMapMarkers');
const { RustPlusMap } = require('../src/structures/rustPlusMap');
const { Timer } = require('../src/utils/timer');
const views = require('../src/discordUtils/discordMessages');
const connected = require('../src/rustPlusEvents/connected');
const instance = () => new RustPlusInstance('guild', 'server');

test('map renders share one FIFO across servers and continue after a failed render', async t => {
    const first = new RustPlusMap({ serverId: 'first' }, rp.AppMap.create());
    const second = new RustPlusMap({ serverId: 'second' }, rp.AppMap.create());
    const gate = Promise.withResolvers();
    const starts = [];
    t.mock.method(RustPlusMap.prototype, 'renderImage', async function (grids) {
        starts.push([this.rpInstance.serverId, grids]);
        if (this === first && !grids) await gate.promise;
        if (this === second) throw new Error('bad map');
        return grids ? 'enhanced.png' : 'base.png';
    });

    const base = first.writeImage();
    const failed = assert.rejects(second.writeImage(true), /bad map/);
    const enhanced = first.writeImage(true);
    await nextTurn();
    assert.deepEqual(starts, [['first', false]]);
    gate.resolve();
    assert.equal(await base, 'base.png');
    await failed;
    assert.equal(await enhanced, 'enhanced.png');
    assert.deepEqual(starts, [['first', false], ['second', true], ['first', true]]);
});

test('a slow poll does not overlap the next five interval ticks', async t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const bot = instance();
    let requests = 0;
    bot.rustPlus.getInfoAsync = () => { requests++; return new Promise(() => {}); };
    bot.startServerPollingHandler();
    for (let i = 0; i < 5; i++) { t.mock.timers.tick(1000); await nextTurn(); }
    await bot.shutdown();
    t.diagnostic('info requests before first response: ' + requests);
    assert.equal(requests, 1);
});

test('startup validates each direct pairing and reuses fresh requester info for the first poll', async t => {
    const bot = instance();
    const ids = [];
    t.mock.method(views, 'sendServerMessage', async () => {});
    t.mock.method(views, 'sendInformationChannelMapMessage', async () => {});
    t.mock.method(RustPlusMap.prototype, 'writeImage', async () => '');
    bot.rustPlus.getInfoAsync = async id => {
        ids.push(id);
        return rp.AppResponse.create({ info: {} });
    };
    bot.rustPlus.getMapAsync = async () => rp.AppResponse.create({ map: {} });
    bot.rustPlus.getTimeAsync = () => new Promise(() => {});
    await connected.execute(bot);
    await nextTurn();
    await bot.shutdown();
    const requesterCalls = ids.filter(id => id === '1').length;
    t.diagnostic(`getInfo requests for 4 credentials: ${ids.length}, requester: ${requesterCalls}`);
    assert.deepEqual(ids.sort(), ['1', '2', '3', '4']);
});

test('concurrent startup installs one connection and one handler per event', async t => {
    const bot = instance();
    let connections = 0;
    bot.rustPlus.connect = async () => { connections++; };
    await Promise.all(Array.from({ length: 8 }, () => bot.startup()));
    const counts = bot.rustPlus.eventNames().map(name => bot.rustPlus.listenerCount(name));
    await bot.shutdown();
    t.diagnostic('connect calls: ' + connections + ', handlers per event: ' + Math.max(...counts));
    assert.equal(connections, 1);
    assert.deepEqual(counts, [1, 1, 1, 1, 1, 1]);
    assert.equal(bot.rustPlus.eventNames().length, 0);
});

test('shutdown cancels all map marker timers', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const bot = instance();
    const markers = new RustPlusMapMarkers(bot, rp.AppMapMarkers.create());
    bot.rpMapMarkers = markers;
    let fired = 0;
    const fire = () => { fired++; };
    for (const timers of [markers.cargoShipEgressTimeoutIds, markers.cargoShipEgressAfterHarbor1TimeoutIds,
        markers.cargoShipEgressAfterHarbor2TimeoutIds]) {
        const timer = new Timer(fire, 100);
        timers[1] = timer;
        timer.start();
    }
    markers.cargoShipLockedCrateSpawnIntervalIds[1] = setInterval(fire, 100);
    markers.cargoShipUndockingNotificationTimeoutIds[1] = setTimeout(fire, 100);
    markers.travellingVendorLeavingNotificationTimeoutIds[1] = setTimeout(fire, 100);
    markers.oilRigLockedCrateUnlockedMetaData[1] = { timeoutId: setTimeout(fire, 100) };
    await bot.shutdown();
    t.mock.timers.tick(100);
    t.diagnostic('marker callbacks after shutdown: ' + fired);
    assert.equal(fired, 0);
});

test('disconnect releases unanswered callbacks and settles async requests before timeout', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const client = new rp.RustPlus('local', '1');
    client.ws = Object.assign(new EventEmitter(), { readyState: Ws.OPEN, send() {}, terminate() {} });
    let settled = 0;
    for (let i = 0; i < 20; i++) {
        client.sendRequest({ getInfo: {} }, '1', 7, () => {});
        client.sendRequestAsync({ getInfo: {} }, '1', 7, 180000).then(result => {
            assert.ok(result instanceof Error);
            settled++;
        });
    }
    await client.disconnect();
    await nextTurn();
    const pending = client.seqCallbacks instanceof Map ? client.seqCallbacks.size :
        Object.keys(client.seqCallbacks).length;
    t.diagnostic('retained response callbacks: ' + pending + ', settled before timeout: ' + settled);
    assert.equal(pending, 0);
    assert.equal(settled, 20);
});

test('an error response ends this poll and the next scheduled tick can recover', async t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const bot = instance();
    let infoCalls = 0, timeCalls = 0;
    bot.rustPlus.getInfoAsync = async () => ++infoCalls === 1 ?
        new Error('offline') : rp.AppResponse.create({ info: {} });
    bot.rustPlus.getTimeAsync = async () => { timeCalls++; return new Error('fixture'); };
    bot.startServerPollingHandler();
    await nextTurn();
    assert.equal(timeCalls, 0);
    t.mock.timers.tick(1000);
    await nextTurn();
    assert.equal(infoCalls, 2);
    assert.equal(timeCalls, 1);
    await bot.shutdown();
});

test('a late map response after shutdown cannot restart polling', async t => {
    const bot = instance();
    const map = Promise.withResolvers();
    const entered = Promise.withResolvers();
    bot.rustPlus.getInfoAsync = async () => rp.AppResponse.create({ info: {} });
    bot.rustPlus.getMapAsync = () => { entered.resolve(); return map.promise; };
    const write = t.mock.method(RustPlusMap.prototype, 'writeImage', async () => '');
    const setup = bot.setupRequesting();
    await entered.promise;
    await bot.shutdown();
    map.resolve(rp.AppResponse.create({ map: {} }));
    await setup;
    assert.equal(write.mock.callCount(), 0);
    assert.equal(bot.serverPollingHandlerIntervalId, undefined);
    assert.equal(bot.rpMap, null);
});

test('twenty disconnect/retry cycles keep one handler and shutdown cancels the final retry', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const bot = instance();
    bot.rustPlus.connect = async () => {};
    t.mock.method(views, 'sendServerMessage', async () => {});
    await bot.startup();
    for (let i = 0; i < 20; i++) {
        assert.equal(bot.rustPlus.listenerCount('disconnected'), 1);
        bot.rustPlus.emit('disconnected');
        assert.equal(bot.rustPlus.eventNames().length, 0);
        t.mock.timers.tick(bot.reconnectTimeoutSeconds * 1000);
        await nextTurn();
    }
    const sent = Promise.withResolvers();
    // A slow Discord update for the first disconnect must not revive a removed server.
    bot.connectionStatus = require('../src/managers/rustPlusManager').ConnectionStatus.Connected;
    views.sendServerMessage.mock.mockImplementation(() => sent.promise);
    bot.rustPlus.emit('disconnected');
    await bot.shutdown();
    sent.resolve();
    await nextTurn();
    t.mock.timers.tick(86400000);
    await nextTurn();
    assert.equal(bot.reconnectTimeoutId, undefined);
    assert.equal(bot.rustPlus.eventNames().length, 0);
});

test('rate-limited requests wake on refill and are cancelled on disconnect', async () => {
    const client = new rp.RustPlus('local', '1');
    client.ws = Object.assign(new EventEmitter(), { readyState: Ws.OPEN, terminate() {} });
    client.tokens.connection = 0;
    const refill = client.consumeTokens('1', 1, true);
    client.replenishTask();
    assert.equal(await refill, rp.ConsumeTokensError.NoError);
    client.tokens.connection = 0;
    const interrupted = client.getInfoAsync('2', 7);
    await client.disconnect();
    assert.equal(await interrupted, rp.ConsumeTokensError.Disconnected);
    assert.equal(client.tokenWaiters.size, 0);
});
