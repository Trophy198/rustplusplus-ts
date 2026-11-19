const assert = require('node:assert/strict');
const { once } = require('node:events');
const { setTimeout: sleep } = require('node:timers/promises');
const test = require('node:test');
const Ws = require('ws');

// Route only the relay hostname to the local test server. Keep its account-bound handshake and binary frames.
let relayEndpoint;
require.cache[require.resolve('ws')].exports = class extends Ws {
    constructor(url, ...args) {
        super(url.startsWith('wss://companion-rust.facepunch.com/') ? relayEndpoint : url, ...args);
    }
};
const rp = require('rustplus-ts');
const discordjs = require('discord.js');
const index = require.resolve('../dist/index.js');
const log = { child() { return this; }, info() {}, warn() {}, error() {} };
const accounts = ['76561198000000001', '76561198000000002'];
const credentials = Object.fromEntries(accounts.map((id, i) =>
    [id, { discordUserId: String(i), rustplusAuthToken: 'fixture.' + i }]));
const guilds = new Map();
const dm = { connectionStarted: [], validPermissions: interaction => interaction.allowed };
const app = { log, discordManager: dm, config: { general: { serverPollingHandlerIntervalMs: 60000 } },
    guildInstanceManager: { getGuildInstance: id => guilds.get(id), updateGuildInstance() {} },
    credentialsManager: { getCredentials: id => credentials[id], getCredentialSteamIds: () => [] } };
require.cache[index] = { id: index, loaded: true, exports: app };
const { LocaleManager } = require('../dist/src/managers/localeManager');
const { RustPlusManager, ConnectionStatus } = require('../dist/src/managers/rustPlusManager');
const { FcmListenerManager } = require('../dist/src/managers/fcmListenerManager');
const { isValidSmartSwitchConfig } = require('../dist/src/managers/guildInstanceManager');
const { buttonHandler } = require('../dist/src/handlers/buttonHandler');
const views = require('../dist/src/discordUtils/discordMessages');
app.localeManager = new LocaleManager();
app.rustPlusManager = new RustPlusManager();
const fcm = new FcmListenerManager(dm);

const light = '18446744073709551615';
const pump = '9007199254740993';
async function until(check) {
    const end = Date.now() + 6000;
    while (!check() && Date.now() < end) await sleep(5);
    assert.ok(check(), 'timed out waiting for ' + check.toString());
}

async function setup(t, relay = false) {
    const ws = new Ws.Server({ host: '127.0.0.1', port: 0 });
    await once(ws, 'listening');
    const port = String(ws.address().port);
    const guildId = 'guild-' + port;
    const channel = 'switches-' + port;
    const serverId = relay ? 'relay-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' : '127.0.0.1-' + port;
    relayEndpoint = 'ws://127.0.0.1:' + port;
    const guild = { generalSettings: { language: 'en', inGameChatCommandPrefix: '!' },
        guildChannelIds: { servers: null, smartSwitches: channel }, serverInfoMap: {}, pairingDataMap: {},
        serverToView: null };
    guilds.set(guildId, guild);
    const cards = new Map();
    const requests = [];
    const states = new Map([[light, false], [pump, true]]);
    const owners = new Map([[light, accounts[0]], [pump, accounts[1]]]);
    const sim = { socket: null, hold: false, failWrite: false, pending: null };
    const send = (socket, message) => socket.send(rp.AppMessage.toBinary(rp.AppMessage.create(message)));
    ws.on('connection', socket => {
        sim.socket = socket;
        socket.on('message', bytes => {
            const request = rp.AppRequest.fromBinary(bytes);
            let body;
            if (request.getInfo) body = { info: {} };
            else if (request.getEntityInfo || request.setEntityValue) {
                const { entityId, playerId } = request;
                requests.push(request);
                const owner = owners.get(entityId);
                assert.equal(playerId, owner);
                assert.equal(request.playerToken, 100 + accounts.indexOf(owner));
                if (request.getEntityInfo) {
                    body = { entityInfo: { type: rp.AppEntityType.Switch, payload: { value: states.get(entityId) } } };
                }
                else if (sim.failWrite) body = { error: { error: 'accessDenied' } };
                else {
                    states.set(entityId, request.setEntityValue.value);
                    body = { success: {} };
                }
            } else body = { error: { error: 'unsupported' } }; // Map setup can fail independently.
            const reply = () => send(socket, { response: { seq: request.seq, ...body } });
            if (sim.hold && request.getEntityInfo) sim.pending = reply;
            else reply();
        });
    });
    t.mock.method(views, 'sendServerMessage', async () => {});
    t.mock.method(require('../dist/src/utils/validationUtils'), 'isValidImageUrl', async () => false);
    dm.getGuildIdsForUser = async () => [guildId];
    dm.sendUpdateMessage = async (guild, content, channelId, existingId) => {
        assert.equal(guild, guildId);
        assert.equal(channelId, channel);
        await sleep(1); // Include a genuine edit/create race window.
        const id = existingId ?? 'card-' + (cards.size + 1);
        const embed = content.embeds[0].toJSON();
        const button = content.components[0].toJSON().components[0];
        cards.set(id, { button, state: embed.fields[0].value });
        return { id };
    };
    async function pair(entityId, account) {
        const body = {
            ...(relay ? { id: serverId.slice(6) } : { ip: '127.0.0.1', port }),
            type: 'entity', entityType: '1', entityName: 'Smart Switch', entityId,
            playerId: accounts[account], playerToken: String(100 + account),
            name: 'Local server', desc: '', img: '', logo: '', url: ''
        };
        const notification = { channelId: 'pairing', title: 'Switch', message: 'paired', body: JSON.stringify(body) };
        const appData = Object.entries(notification)
            .map(([key, value]) => ({ key, value }));
        await fcm.onDataReceived(accounts[account], { appData });
    }
    await pair(light, 0);
    await pair(pump, 1);
    const server = guild.serverInfoMap[serverId];
    server.active = true;
    const devices = server.smartSwitchConfigMap;
    app.rustPlusManager.addInstance(guildId, serverId);
    const instance = app.rustPlusManager.getInstance(guildId, serverId);
    t.after(async () => {
        await instance.shutdown();
        for (const socket of ws.clients) socket.terminate();
        await new Promise(resolve => ws.close(resolve));
        guilds.delete(guildId);
    });
    const card = entityId => cards.get(devices[entityId].messageId);
    async function click(entityId, allowed = true, messageId = devices[entityId].messageId) {
        const replies = [];
        let deferred = false;
        const result = await buttonHandler(dm, { guildId, customId: card(entityId).button.custom_id, allowed,
            message: { id: messageId }, user: { username: 'Operator' }, deferUpdate: async () => { deferred = true; },
            followUp: async reply => replies.push(reply) });
        assert.ok(deferred);
        if (!result) assert.equal(replies[0].flags, discordjs.MessageFlags.Ephemeral);
        return result;
    }
    function change(entityId, value) {
        states.set(entityId, value);
        send(sim.socket, { broadcast: { entityChanged: { entityId, payload: { value } } } });
    }
    await instance.startup();
    await until(() => cards.size === 2);
    return { card, click, change, pair, instance, requests, devices, states, owners, cards, sim, server };
}

test('FCM → Discord ON/OFF → game broadcast → reconnect reads the server without replaying a write', async t => {
    const { card, click, change, pair, instance, requests, devices, states, cards, sim } = await setup(t);
    assert.equal(card(light).state, 'OFF');
    assert.equal(card(pump).state, 'ON');
    const originalMessage = devices[light].messageId;
    const chat = [];
    guilds.get(instance.guildId).generalSettings.inGameChatNotifySmartSwitchChangedFromDiscord = true;
    t.mock.method(instance, 'inGameTeamChatQueueMessage', message => chat.push(message));
    assert.ok(isValidSmartSwitchConfig(devices[light]));
    const legacy = { ...devices[light] };
    delete legacy.pairedSteamIds;
    assert.ok(isValidSmartSwitchConfig(legacy));
    assert.equal(await click(light, false), false);
    assert.equal(await click(light, true, 'retired-card'), false);
    assert.equal(requests.filter(r => r.setEntityValue).length, 0);
    assert.equal(await click(light), true);
    assert.equal(states.get(light), true);
    assert.equal(card(light).state, 'ON');
    assert.equal(await click(light), true);
    assert.equal(states.get(light), false);
    assert.equal(card(light).state, 'OFF');

    // An older read reply arrives after a game broadcast on the same socket.
    sim.hold = true;
    const read = instance.requestSmartSwitch(light);
    await until(() => sim.pending);
    change(light, true);
    await until(() => card(light).state === 'ON');
    sim.hold = false;
    sim.pending();
    await read;
    assert.equal(card(light).state, 'ON');
    change('7', true);
    change(pump, false);
    await until(() => card(pump).state === 'OFF');
    assert.equal(cards.size, 2);

    sim.failWrite = true;
    assert.equal(await click(light), false);
    assert.equal(states.get(light), true);
    assert.equal(card(light).state, 'Unknown');
    assert.deepEqual(chat, ['Operator turned Smart Switch ON from Discord.',
        'Operator turned Smart Switch OFF from Discord.']);
    assert.equal(await click(light), true); // Refresh reads, even when a write was rejected.
    assert.equal(card(light).state, 'ON');
    sim.failWrite = false;
    devices[light].name = 'Workshop';
    await pair(light, 0);
    assert.equal(devices[light].name, 'Workshop');
    assert.equal(devices[light].messageId, originalMessage);

    const previous = sim.socket;
    previous.close();
    await until(() => instance.connectionStatus === ConnectionStatus.Reconnecting && card(light).button.disabled);
    assert.equal(card(light).state, 'Unknown');
    states.set(light, false);
    states.set(pump, true);
    const count = requests.length;
    await until(() => sim.socket !== previous && card(light).state === 'OFF' && card(pump).state === 'ON');
    const restored = requests.slice(count).map(r => [r.entityId, !!r.getEntityInfo]);
    assert.deepEqual(restored, [[light, true], [pump, true]]);
    assert.equal(devices[light].messageId, originalMessage);
    assert.equal(cards.size, 2);
});

test('relay respects the paired account and supports legacy requester configs', async t => {
    const { card, click, instance, devices, change, requests } = await setup(t, true);
    assert.equal(card(light).state, 'OFF');
    assert.equal(card(pump).state, 'Unknown');
    assert.equal(await click(pump), false);
    change(pump, true);
    delete devices[light].pairedSteamIds;
    assert.equal(await click(light), true);
    assert.equal(card(light).state, 'ON');
    assert.equal(instance.smartSwitchValue(pump), undefined);
    assert.equal(card(pump).state, 'Unknown');
    assert.ok(requests.every(request => request.entityId === light && request.playerId === accounts[0]));
});

test('pairing on a connected server creates one card even during broadcasts and cleans up a retired card', async t => {
    const { card, change, pair, instance, devices, owners, states, server, cards } = await setup(t);
    const send = dm.sendUpdateMessage;
    let entered = Promise.withResolvers();
    let resume = Promise.withResolvers();
    dm.sendUpdateMessage = async (...args) => {
        if (!args[3]) {
            entered.resolve();
            await resume.promise;
        }
        return send(...args);
    };
    const deleted = [];
    dm.deleteMessage = async (_guild, _channel, id) => {
        deleted.push(id);
        cards.delete(id);
    };

    owners.set('73', accounts[1]);
    states.set('73', false);
    const creating = pair('73', 1);
    await entered.promise;
    change('73', true);
    await until(() => instance.smartSwitchValue('73') === true);
    resume.resolve();
    await creating;
    assert.equal(card('73').state, 'ON');
    assert.equal(cards.size, 3);

    entered = Promise.withResolvers();
    resume = Promise.withResolvers();
    owners.set('74', accounts[0]);
    states.set('74', true);
    const retiring = pair('74', 0);
    await entered.promise;
    server.active = false;
    resume.resolve();
    await retiring;
    assert.equal(devices['74'].messageId, null);
    assert.equal(deleted.length, 1);
    assert.equal(cards.size, 3);
});
