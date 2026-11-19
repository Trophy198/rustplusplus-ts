const assert = require('node:assert/strict');
const test = require('node:test');
const { setup, until, dm, accounts, light, pump, ConnectionStatus } = require('./fixtures/smart-devices.cjs');
const { AppEntityType } = require('rustplus-ts');
const { isValidSmartAlarmConfig } = require('../dist/src/managers/guildInstanceManager');

test('two FCM recipients and WebSocket edges produce one Discord alert per activation', async t => {
    const { change, card, push, pair, devices, alerts, cards, instance } = await setup(t, false, AppEntityType.Alarm);
    assert.equal(card(light).state, 'OFF');
    assert.equal(card(pump).state, 'ON');
    assert.equal(alerts.length, 0, 'initial snapshot of an already powered alarm is passive');
    const id = devices[light].messageId;
    devices[light].name = 'Garage';
    devices[light].everyone = true;
    await pair(light, 1);
    assert.deepEqual(devices[light].pairedSteamIds, accounts);
    assert.equal(devices[light].messageId, id);
    const at = Date.now();
    const copies = Promise.all([push(1, light, 'b1', at), push(0, light, 'a1', at + 15)]);
    change(light, true);
    change(light, true);
    await copies;
    await until(() => card(light).state === 'ON');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].content, '@everyone');
    assert.equal(devices[light].lastTrigger, Math.floor(at / 1000));
    assert.ok(isValidSmartAlarmConfig(JSON.parse(JSON.stringify(devices[light]))));
    change(light, false);
    change(light, true);
    change(pump, false);
    change(pump, true);
    await until(() => alerts.length === 3);
    // Repeated pulses from the same device and a second device with the same text remain separate.
    await push(0, light, 'a2', at + 80);
    await push(1, pump, 'b2', at + 80);
    await push(0, light, 'a1', at);
    assert.equal(alerts.length, 3);
    assert.equal(new Set(alerts.map(a => a.nonce)).size, 3);
    assert.equal(cards.size, 2);
    await push(0, pump, 'wrong-owner');
    assert.equal(alerts.length, 3);
    assert.equal(instance.rustPlus.listenerCount('message'), 1);
});

test('reconnect reconciles missed state, queued push, and held-high alarm without an extra trigger', async t => {
    const { card, change, push, pair, states, devices, alerts, requests, instance, sim } =
        await setup(t, false, AppEntityType.Alarm);
    await pair(light, 1);
    const previous = sim.socket;
    previous.close();
    await until(() => instance.connectionStatus === ConnectionStatus.Reconnecting && card(light).state === 'Unknown');
    const at = Date.now();
    states.set(light, true);
    await push(1, light, 'outage-b', at);
    assert.equal(alerts.length, 1);
    await until(() => sim.socket !== previous && card(light).state === 'ON' && card(pump).state === 'ON');
    await push(0, light, 'late-a', at);
    assert.equal(alerts.length, 1);
    assert.equal(devices[pump].lastTrigger, null);
    assert.equal(requests.filter(r => r.entityId === pump).length, 2);

    change(light, false);
    await until(() => card(light).state === 'OFF');
    const second = sim.socket;
    second.close();
    await until(() => card(light).state === 'Unknown');
    const sent = Date.now();
    states.set(light, true); // Only the reconnect snapshot is available until the delayed FCM delivery.
    await until(() => sim.socket !== second && card(light).state === 'ON');
    assert.equal(alerts.length, 2);
    await push(0, light, 'delayed-copy', sent);
    assert.equal(alerts.length, 2);
    assert.equal(instance.rustPlus.listenerCount('message'), 1);
});

test('FCM routes secondary relay accounts and preserves distinct anonymous firings', async t => {
    const { card, push, devices, alerts, server } = await setup(t, true, AppEntityType.Alarm);
    assert.equal(card(pump).state, 'Unknown');
    const sent = Date.now();
    await push(1, undefined, 'anonymous-1', sent);
    await push(1, undefined, 'anonymous-2', sent);
    await push(1, undefined, 'anonymous-1', sent);
    assert.equal(alerts.length, 2);
    assert.equal(devices[pump].lastTrigger, null, 'an anonymous alert must not update an arbitrary device');
    await push(1, pump, 'pump-3', sent + 50);
    assert.equal(alerts.length, 3);
    server.active = false;
    await push(1, pump, 'disabled-inactive', sent + 100);
    assert.equal(alerts.length, 3);
});

test('a transient Discord failure retries one nonce while parallel recipients share the send', async t => {
    const { push, pair, alerts } = await setup(t, false, AppEntityType.Alarm);
    await pair(light, 1);
    const send = dm.sendUpdateMessage;
    const nonces = [];
    dm.sendUpdateMessage = async (...args) => {
        if (args[1].nonce) {
            nonces.push(args[1].nonce);
            if (nonces.length === 1) return undefined;
        }
        return send(...args);
    };
    const at = Date.now();
    await Promise.all([push(0, light, 'a', at), push(1, light, 'b', at)]);
    assert.equal(alerts.length, 1);
    assert.equal(nonces.length, 2);
    assert.equal(nonces[0], nonces[1]);
});

test('alarm settings and last trigger survive a guild file reload, including older string timestamps', async t => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const { GuildInstanceManager } = require('../dist/src/managers/guildInstanceManager');
    const { instance, server, push } = await setup(t, false, AppEntityType.Alarm);
    await push(0, light, 'persist');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-alarm-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const load = () => new GuildInstanceManager(dir, path.resolve(__dirname, '../dist/src/templates'));
    const manager = load();
    const guildId = instance.guildId;
    assert.ok(manager.addNewGuildInstance(guildId));
    manager.getGuildInstance(guildId).serverInfoMap[instance.serverId] = server;
    assert.ok(manager.updateGuildInstance(guildId));
    const device = server.smartAlarmConfigMap[light];
    const restored = () => load().getGuildInstance(guildId).serverInfoMap[instance.serverId].smartAlarmConfigMap[light];
    assert.deepEqual(restored(), device);
    const file = path.join(dir, guildId + '.json');
    const legacy = JSON.parse(fs.readFileSync(file, 'utf8'));
    const old = legacy.serverInfoMap[instance.serverId].smartAlarmConfigMap[light];
    delete old.pairedSteamIds;
    old.lastTrigger = String(device.lastTrigger);
    fs.writeFileSync(file, JSON.stringify(legacy));
    assert.equal(restored().lastTrigger, device.lastTrigger);
});

test('anonymous copies merge by message identity while ambiguous circuits are both reported', async t => {
    const { pair, push, alerts, devices } = await setup(t, false, AppEntityType.Alarm);
    // Only the first circuit is shared. Identify copies by the same upstream message identity.
    await pair(light, 1);
    const at = Date.now();
    await push(0, undefined, 'shared', at, 'motion', 'same-upstream-id');
    await push(1, undefined, 'other-transport', at, 'motion', 'same-upstream-id');
    assert.equal(alerts.length, 1);
    await pair(pump, 0);
    await push(0, undefined, 'a', at + 10, 'power');
    await push(1, undefined, 'b', at + 10, 'power');
    assert.equal(alerts.length, 3);
    assert.equal(devices[light].lastTrigger, null);
    assert.equal(devices[pump].lastTrigger, null);
});

test('the next normal poll retries a failed subscription and leaves healthy alarms alone', async t => {
    const { instance, card, alerts, requests, states } = await setup(t, false, AppEntityType.Alarm);
    const read = instance.rustPlus.getEntityInfoAsync.bind(instance.rustPlus);
    let fail = true;
    t.mock.method(instance.rustPlus, 'getEntityInfoAsync', (...args) => {
        if (fail) {
            fail = false;
            return Promise.resolve(new Error('connection interrupted'));
        }
        return read(...args);
    });
    await instance.refreshSmartAlarm(light);
    assert.equal(card(light).state, 'Unknown');
    states.set(light, true);
    const before = requests.length;
    instance.startServerPollingHandler();
    await until(() => card(light).state === 'ON');
    assert.deepEqual(requests.slice(before).map(r => r.entityId), [light]);
    assert.equal(alerts.length, 1);
});
