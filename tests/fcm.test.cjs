const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setImmediate: tick, setTimeout: sleep } = require('node:timers/promises');
const tls = require('node:tls');
const test = require('node:test');
const receiverRequire = require('node:module').createRequire(require.resolve('@liamcottle/push-receiver/src/client'));
const protobuf = receiverRequire('protobufjs');
const Receiver = require('@liamcottle/push-receiver/src/client');
const { kMCSVersion, kLoginResponseTag, kDataMessageStanzaTag } = require('@liamcottle/push-receiver/src/constants');

test('two credentials receive only their subscriptions through replacement, removal and a late check-in', async t => {
    const root = await protobuf.load(require.resolve('@liamcottle/push-receiver/src/mcs.proto'));
    const login = root.lookupType('mcs_proto.LoginRequest');
    const data = root.lookupType('mcs_proto.DataMessageStanza');
    const sockets = new Map();
    const accounts = ['76561198000000001', '76561198000000002'];
    const credentials = Object.fromEntries(accounts.map((steamId, i) => [steamId, {
        discordUserId: 'user' + i, gcm: { androidId: '100000000' + i, securityToken: 'token' + i }
    }]));
    const guilds = accounts.map((steamId, i) => ({
        newsReceiver: steamId, generalSettings: { language: 'en' },
        guildChannelIds: { activity: 'channel' + i, servers: null },
        serverInfoMap: {}, pairingDataMap: {}, serverToView: null
    }));
    const sent = [];
    const dm = {
        getGuildIdsForUser: async () => ['0', '1'],
        sendUpdateMessage: async (guild, content, channel) => sent.push([channel, content.embeds[0].data.description])
    };
    const index = require.resolve('../index.ts');
    // Everything between the two I/O boundaries uses the actual receiver and the bot's dispatch code.
    require.cache[index] = { id: index, loaded: true, exports: {
        log: { info() {}, warn() {}, error() {} },
        localeManager: { getIntl: (_, key) => key },
        guildInstanceManager: { getGuildInstance: id => guilds[Number(id)], updateGuildInstance() {} },
        rustPlusManager: { getInstance: () => null },
        discordManager: dm, credentialsManager: {
            getCredentials: id => credentials[id], getCredentialSteamIds: () => accounts
        }
    } };
    t.after(() => delete require.cache[index]);
    let waitForCheckIn = null, entered;
    t.mock.method(Receiver.prototype, '_checkIn', () => {
        if (entered) entered();
        return waitForCheckIn || Promise.resolve();
    });
    t.mock.method(tls, 'connect', (_options, connected) => {
        const socket = new EventEmitter();
        socket.destroy = () => { socket.destroyed = true; };
        socket.write = frame => {
            const req = login.decodeDelimited(frame.subarray(2));
            sockets.set(req.user, socket);
            const index = req.user.at(-1);
            assert.equal(req.authToken, 'token' + index);
        };
        setImmediate(() => { if (!socket.destroyed) connected(); });
        return socket;
    });
    const { FcmListenerManager } = require('../src/managers/fcmListenerManager');
    const views = require('../src/discordUtils/discordMessages');
    t.mock.method(views, 'sendServerMessage', async () => {});
    t.mock.method(require('../src/utils/validationUtils'), 'isValidImageUrl', async () => false);
    const manager = new FcmListenerManager(dm);
    t.after(() => accounts.forEach(id => manager.stopListener(id)));
    async function connected(androidId) {
        for (let i = 0; i < 200 && !sockets.has(androidId); i++) await sleep(5);
        const socket = sockets.get(androidId);
        assert.ok(socket, 'expected a logged-in receiver for ' + androidId);
        socket.emit('data', Buffer.from([kMCSVersion, kLoginResponseTag, 0]));
        return socket;
    }
    function frame(socket, persistentId, message, channelId, body) {
        const appData = Object.entries({ channelId, title: 'news', message, body: JSON.stringify(body) })
            .map(([key, value]) => ({ key, value }));
        const bytes = data.encodeDelimited({
            from: 'rust', category: 'rust', id: persistentId, token: 'fixture', appData, persistentId,
            ttl: 60, sent: Date.now()
        }).finish();
        socket.emit('data', Buffer.concat([Buffer.from([kDataMessageStanzaTag]), bytes]));
    }
    function notify(socket, id, message, playerId) {
        frame(socket, id, message, 'news', { type: 'news', url: 'https://rust.facepunch.com/', playerId });
    }
    const [first, second] = await Promise.all(['1000000000', '1000000001'].map(connected));
    assert.notEqual(first, second);
    const id = '12345678-aaaa-bbbb-cccc-123456789012';
    for (const [i, socket] of [first, second].entries()) {
        frame(socket, 'server', 'pair', 'pairing', {
            type: 'server', id, playerId: accounts[i], playerToken: String(100 + i),
            name: 'Server', desc: '', img: '', logo: '', url: ''
        });
    }
    await tick();
    for (const guild of guilds) {
        const key = 'relay-' + id;
        assert.equal(guild.serverInfoMap[key].relayServerId, id);
        assert.equal(guild.pairingDataMap[key][accounts[0]].playerToken, 100);
        assert.equal(guild.pairingDataMap[key][accounts[1]].playerToken, 101);
    }
    notify(first, 'shared-id', 'A');
    notify(second, 'shared-id', 'B');
    notify(first, 'shared-id', 'duplicate');
    notify(first, 'wrong-account', 'wrong', accounts[1]);
    await tick();
    assert.deepEqual(sent, [['channel0', 'A'], ['channel1', 'B']]);

    // Exercise the receiver's own retry after losing A's TLS stream.
    sockets.delete('1000000000');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    first.emit('close');
    t.mock.timers.tick(2000);
    t.mock.timers.reset();
    const retried = await connected('1000000000');
    assert.notEqual(retried, first);
    assert.equal(first.eventNames().length, 0);
    assert.equal(second.listenerCount('data'), 1);
    assert.equal(retried.listenerCount('data'), 1);
    notify(retried, 'retried', 'reconnected A');
    await tick();
    assert.deepEqual(sent.pop(), ['channel0', 'reconnected A']);

    credentials[accounts[0]].gcm = { androidId: '1000000002', securityToken: 'token2' };
    manager.startListener(accounts[0]);
    const replacement = await connected('1000000002');
    assert.ok(first.destroyed);
    assert.equal(retried.eventNames().length, 0);
    notify(first, 'old', 'stale');
    notify(second, 'still-B', 'B active');
    notify(replacement, 'new-A', 'A replaced');
    await tick();
    assert.deepEqual(sent.slice(2), [['channel1', 'B active'], ['channel0', 'A replaced']]);

    let finish;
    waitForCheckIn = new Promise(resolve => { finish = resolve; });
    const checking = new Promise(resolve => { entered = resolve; });
    credentials[accounts[0]].gcm = { androidId: '1000000003', securityToken: 'token3' };
    manager.startListener(accounts[0]);
    await checking;
    manager.stopListener(accounts[0]);
    finish();
    await tick();
    notify(replacement, 'after-stop', 'removed');
    notify(second, 'after-stop', 'only B');
    await tick();
    assert.deepEqual(sent.slice(4), [['channel1', 'only B']]);
    assert.equal(sockets.get('1000000002'), replacement);
    assert.equal(sockets.has('1000000003'), false);
    assert.equal(replacement.destroyed, true);
    assert.equal(manager.isListenerActive(accounts[0]), false);
    assert.equal(manager.isListenerActive(accounts[1]), true);
});
