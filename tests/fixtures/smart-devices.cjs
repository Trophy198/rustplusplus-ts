const assert = require('node:assert/strict');
const { once } = require('node:events');
const { setTimeout: sleep } = require('node:timers/promises');
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
const index = require.resolve('../../dist/index.js');
const log = { child() { return this; }, info() {}, warn() {}, error() {} };
const accounts = ['76561198000000001', '76561198000000002'];
const credentials = Object.fromEntries(accounts.map((id, i) =>
    [id, { discordUserId: String(i), rustplusAuthToken: 'fixture.' + i }]));
const guilds = new Map();
const dm = { connectionStarted: [], validPermissions: interaction => interaction.allowed };
const app = { log, discordManager: dm, config: { general: { serverPollingHandlerIntervalMs: 60000 } },
    guildInstanceManager: { getGuildInstance: id => guilds.get(id), updateGuildInstance() { return true; } },
    credentialsManager: { getCredentials: id => credentials[id], getCredentialSteamIds: () => [] } };
require.cache[index] = { id: index, loaded: true, exports: app };
const { LocaleManager } = require('../../dist/src/managers/LocaleManager');
const { RustPlusManager, ConnectionStatus } = require('../../dist/src/managers/rustPlusManager');
const { FcmListenerManager } = require('../../dist/src/managers/fcmListenerManager');
const { buttonHandler } = require('../../dist/src/handlers/buttonHandler');
const views = require('../../dist/src/discordUtils/discordMessages');
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

async function setup(t, relay = false, type = rp.AppEntityType.Switch) {
    const isStorage = type === rp.AppEntityType.StorageMonitor;
    const isAlarm = type === rp.AppEntityType.Alarm;
    const ws = new Ws.Server({ host: '127.0.0.1', port: 0 });
    await once(ws, 'listening');
    const port = String(ws.address().port);
    const guildId = 'guild-' + port;
    const channel = 'devices-' + port;
    const activity = 'activity-' + port;
    const alerts = [];
    const serverId = relay ? 'relay-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' : '127.0.0.1-' + port;
    relayEndpoint = 'ws://127.0.0.1:' + port;
    const guild = { guildId, aliases: [], generalSettings: { language: 'en', inGameChatCommandPrefix: '!' },
        guildChannelIds: { servers: null, smartSwitches: channel, smartAlarms: channel,
            storageMonitors: channel, activity },
        serverInfoMap: {}, pairingDataMap: {},
        serverToView: null };
    guilds.set(guildId, guild);
    const cards = new Map();
    const requests = [];
    const expiry = Math.floor(Date.now() / 1000) + 86400;
    const states = new Map(isStorage ? [[light, { capacity: 29, protectionExpiry: expiry }],
        [pump, { capacity: 48, items: [{ itemId: -151838493, quantity: 10 }] }]] : [[light, false], [pump, true]]);
    const owners = new Map([[light, accounts[0]], [pump, accounts[1]]]);
    const sim = { socket: null, hold: false, failWrite: false, pending: null };
    const send = (socket, message) => socket.send(rp.AppMessage.toBinary(rp.AppMessage.create(message)));
    ws.on('connection', (socket, upgrade) => {
        sim.socket = socket;
        const protocol = upgrade.headers['sec-websocket-protocol']?.split(',').map(s => s.trim());
        const relayAccount = protocol && accounts.find(id => protocol[0] === 'rustplus.auth.v1' &&
            protocol[1] === Buffer.from(credentials[id].rustplusAuthToken).toString('base64url'));
        if (relay) assert.ok(relayAccount);
        sim.connections ??= [];
        sim.connections.push({ account: relayAccount, socket });
        socket.on('message', bytes => {
            const request = rp.AppRequest.fromBinary(bytes);
            let body;
            if (sim.team && (request.getTeamInfo || request.promoteToLeader)) {
                assert.ok(accounts.includes(request.playerId));
                assert.equal(request.playerToken, 100 + accounts.indexOf(request.playerId));
                if (relay) assert.equal(request.playerId, relayAccount);
                if (request.getTeamInfo) {
                    sim.beforeTeamRead?.(request.playerId);
                    body = { teamInfo: sim.team };
                } else {
                    const recipient = request.promoteToLeader.steamId;
                    sim.promotions.push([request.playerId, recipient]);
                    if (request.playerId !== sim.team.leaderSteamId || sim.rejectLeader ||
                        !sim.team.members.some(m => m.steamId === recipient)) {
                        body = { error: { error: 'no_permission' } };
                    } else {
                        if (!sim.ignoreLeader) sim.team.leaderSteamId = recipient;
                        body = { success: {} };
                    }
                }
            } else if (request.getInfo) body = { info: {} };
            else if (request.getEntityInfo || request.setEntityValue) {
                const { entityId, playerId } = request;
                requests.push(request);
                const deviceOwners = owners.get(entityId);
                assert.ok([deviceOwners].flat().includes(playerId));
                assert.equal(request.playerToken, 100 + accounts.indexOf(playerId));
                if (request.getEntityInfo) {
                    const payload = isStorage ? states.get(entityId) : { value: states.get(entityId) };
                    body = sim.readError ? { error: { error: 'not_found' } } : { entityInfo: { type, payload } };
                }
                else if (sim.failWrite) body = { error: { error: 'accessDenied' } };
                else {
                    states.set(entityId, request.setEntityValue.value);
                    body = { success: {} };
                }
            } else body = { error: { error: 'unsupported' } }; // Map setup can fail independently.
            const reply = () => send(socket, { response: { seq: request.seq, ...body } });
            if ((sim.hold && request.getEntityInfo) || (sim.holdWrites && request.setEntityValue) ||
                (sim.holdTeam && request.getTeamInfo)) sim.pending = reply;
            else reply();
        });
    });
    t.mock.method(views, 'sendServerMessage', async () => {});
    t.mock.method(require('../../dist/src/utils/validationUtils'), 'isValidImageUrl', async () => false);
    dm.getGuildIdsForUser = async () => [guildId];
    dm.deleteMessage = async (_guildId, _channelId, id) => cards.delete(id);
    dm.sendUpdateMessage = async (guild, content, channelId, existingId) => {
        assert.equal(guild, guildId);
        if (channelId === activity) {
            assert.ok(content.enforceNonce);
            const embed = content.embeds[0].toJSON();
            alerts.push({ title: embed.title, message: embed.description, nonce: content.nonce,
                content: content.content });
            return { id: 'alert-' + alerts.length };
        }
        assert.equal(channelId, channel);
        await sleep(1); // Include a genuine edit/create race window.
        const id = existingId ?? 'card-' + (cards.size + 1);
        const embed = content.embeds[0].toJSON();
        const buttons = content.components[0]?.toJSON().components;
        const button = buttons?.[0];
        cards.set(id, { button, buttons, state: embed.fields?.at(-1)?.value, embed });
        return { id };
    };
    async function pair(entityId, account) {
        owners.set(entityId, [...new Set([owners.get(entityId), accounts[account]].flat())]);
        const body = {
            ...(relay ? { id: serverId.slice(6) } : { ip: '127.0.0.1', port }),
            type: 'entity', entityType: String(type), entityId,
            entityName: isStorage ? 'Storage Monitor' : isAlarm ? 'Smart Alarm' : 'Smart Switch',
            playerId: accounts[account], playerToken: String(100 + account),
            name: 'Local server', desc: '', img: '', logo: '', url: ''
        };
        const notification = { channelId: 'pairing', title: 'Switch', message: 'paired', body: JSON.stringify(body) };
        const appData = Object.entries(notification)
            .map(([key, value]) => ({ key, value }));
        await fcm.onDataReceived(accounts[account], { appData, sent: String(Date.now()), ttl: 60 });
    }
    await pair(light, 0);
    await pair(pump, 1);
    const server = guild.serverInfoMap[serverId];
    server.active = true;
    const devices = isStorage ? server.storageMonitorConfigMap :
        isAlarm ? server.smartAlarmConfigMap : server.smartSwitchConfigMap;
    app.rustPlusManager.addInstance(guildId, serverId);
    const instance = app.rustPlusManager.getInstance(guildId, serverId);
    t.after(async () => {
        await instance.shutdown();
        // Finish card edits dispatched by the final socket frame before retiring the simulated guild.
        const refresh = isStorage ? views.sendStorageMonitorMessage :
            isAlarm ? views.sendSmartAlarmMessage : views.sendSmartSwitchMessage;
        await Promise.all(Object.keys(devices).map(id => refresh(dm, guildId, serverId, id)));
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
    function broadcast(entityId, payload) {
        send(sim.socket, { broadcast: { entityChanged: { entityId, payload } } });
    }
    function change(entityId, value) {
        states.set(entityId, value);
        broadcast(entityId, isStorage ? value : { value });
    }
    function push(account, entityId, deliveryId, sent = Date.now(), message = 'Intruder', id = deliveryId) {
        const address = relay ? { id: serverId.slice(6) } : { ip: '127.0.0.1', port };
        const body = JSON.stringify({ ...address, entityId, playerId: accounts[account], type: 'alarm' });
        const appData = Object.entries({ title: 'Garage', message, channelId: 'alarm', body })
            .map(([key, value]) => ({ key, value }));
        const data = { appData, sent: String(sent), ttl: 60, persistentId: deliveryId, id };
        return fcm.onDataReceived(accounts[account], data);
    }
    await instance.startup();
    await until(() => cards.size === 2);
    return { card, click, change, broadcast, pair, instance, requests, devices, states, owners, cards, sim,
        server, alerts, push };
}

module.exports = { setup, until, dm, accounts, guilds, light, pump, ConnectionStatus };
