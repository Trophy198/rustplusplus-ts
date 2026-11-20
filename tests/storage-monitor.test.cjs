const assert = require('node:assert/strict');
const test = require('node:test');
const { setTimeout: sleep } = require('node:timers/promises');
const { setup, until, accounts, light, pump, ConnectionStatus } = require('./fixtures/smart-devices.cjs');
const { AppEntityType } = require('rustplus-ts');
const { isValidStorageMonitorConfig } = require('../dist/src/managers/guildInstanceManager');

const storage = (t, relay = false) => setup(t, relay, AppEntityType.StorageMonitor);
const wood = (quantity, itemIsBlueprint = false) => ({ itemId: -151838493, quantity, itemIsBlueprint });
const fields = card => Object.fromEntries((card.embed.fields || []).map(field => [field.name, field.value.trim()]));

test('early storage pairings preserve owners, tokens and one card per monitor', async t => {
    const { card, pair, devices, cards, change, requests, states } = await storage(t);
    assert.deepEqual(requests.map(r => [r.entityId, r.playerId]), [[light, accounts[0]], [pump, accounts[1]]]);
    assert.match(card(light).embed.description, /Tool Cupboard/);
    assert.ok(card(light).embed.description.includes('<t:' + states.get(light).protectionExpiry + ':R>'));
    assert.match(card(pump).embed.description, /Large Wood Box/);
    assert.deepEqual(fields(card(pump)).Item, 'Wood');
    assert.equal(fields(card(pump)).Quantity, '10');
    const id = devices[pump].messageId;
    devices[pump].name = 'Supply box';
    await Promise.all([pair(pump, 0), pair(pump, 0)]);
    assert.deepEqual(devices[pump].pairedSteamIds, [accounts[1], accounts[0]]);
    assert.equal(requests.at(-1).playerId, accounts[0]);
    assert.equal(requests.length, 3);
    const config = JSON.parse(JSON.stringify(devices[pump]));
    assert.ok(isValidStorageMonitorConfig(config));
    delete config.pairedSteamIds;
    assert.ok(isValidStorageMonitorConfig(config));
    const reads = requests.length;
    change(pump, { capacity: 30, items: [wood(8), wood(12), wood(1, true), { itemId: -9, quantity: 3 }] });
    await until(() => card(pump).embed.description.includes('Vending Machine'));
    assert.match(card(pump).embed.description, /4\/30/);
    assert.equal(fields(card(pump)).Item, 'Wood\nWood (Blueprint)\n-9');
    assert.equal(fields(card(pump)).Quantity, '20\n1\n3');
    change(pump, { capacity: 17, items: [] });
    await until(() => card(pump).embed.description.includes('0/17'));
    assert.match(card(pump).embed.description, /Unknown/);
    assert.match(card(pump).embed.description, /Empty/);
    assert.equal(card(pump).embed.fields, undefined);
    assert.equal(card(pump).embed.title, 'Supply box');
    assert.equal(devices[pump].messageId, id);
    assert.equal(requests.length, reads);
    assert.equal(cards.size, 2);
});

test('TC burst waits for authoritative upkeep, and a power loss clears slots, inventory and expiry', async t => {
    const { card, change, broadcast, states, requests, instance } = await storage(t);
    const expiry = states.get(light).protectionExpiry + 600;
    const before = requests.length;
    change(light, { capacity: 29, items: [wood(99)], protectionExpiry: 0 });
    broadcast(light, { value: true });
    broadcast(light, { value: false });
    states.set(light, { capacity: 29, items: [wood(25)], protectionExpiry: expiry });
    await until(() => card(light).embed.description.includes('<t:' + expiry + ':R>'));
    assert.equal(fields(card(light)).Quantity, '25');
    assert.equal(requests.length, before + 1);
    change(light, { capacity: 0 });
    await until(() => card(light).embed.description.includes('No storage signal'));
    assert.doesNotMatch(card(light).embed.description, /Empty|Upkeep|Slots|DECAYING/);
    assert.equal(card(light).embed.fields, undefined);
    states.set(light, { capacity: 29, items: [], protectionExpiry: 0 });
    await instance.storageMonitors.refresh(light);
    assert.match(card(light).embed.description, /DECAYING/);
    assert.match(card(light).embed.description, /Empty/);
});

test('fresh broadcasts beat stale reads and polling retries only the failed monitor', async t => {
    const { instance, sim, change, card, requests } = await storage(t);
    sim.hold = true;
    const read = instance.storageMonitors.refresh(pump);
    await until(() => sim.pending);
    change(pump, { capacity: 48, items: [wood(80)] });
    await until(() => fields(card(pump)).Quantity === '80');
    sim.hold = false;
    sim.pending();
    await read;
    assert.equal(fields(card(pump)).Quantity, '80');
    sim.readError = true;
    await instance.storageMonitors.refresh(pump);
    assert.match(card(pump).embed.description, /Inventory unavailable/);
    assert.equal(card(pump).embed.fields, undefined);
    sim.readError = false;
    const count = requests.length;
    instance.startServerPollingHandler();
    await until(() => fields(card(pump)).Quantity === '80');
    await instance.storageMonitors.poll();
    assert.deepEqual(requests.slice(count).map(r => r.entityId), [pump]);
    assert.equal(fields(card(pump)).Quantity, '80');
});

test('reconnect cancels pending TC rereads and restores disconnected changes to both existing cards', async t => {
    const { instance, sim, states, card, requests, broadcast, cards, devices } = await storage(t);
    const ids = [devices[light].messageId, devices[pump].messageId];
    const count = requests.length;
    broadcast(light, { value: true });
    const previous = sim.socket;
    previous.close();
    await until(() => instance.connectionStatus === ConnectionStatus.Reconnecting &&
        card(light).embed.description.includes('Inventory unavailable') &&
        card(pump).embed.description.includes('Inventory unavailable'));
    const expiry = Math.floor(Date.now() / 1000) + 7200;
    states.set(light, { capacity: 29, protectionExpiry: expiry, items: [wood(54)] });
    states.set(pump, { capacity: 30, items: [wood(12)] });
    await until(() => sim.socket !== previous && fields(card(pump)).Quantity === '12');
    assert.equal(fields(card(light)).Quantity, '54');
    assert.ok(card(light).embed.description.includes('<t:' + expiry + ':R>'));
    assert.match(card(pump).embed.description, /Vending Machine/);
    await sleep(2100);
    assert.deepEqual(requests.slice(count).map(r => [r.entityId, r.playerId]),
        [[light, accounts[0]], [pump, accounts[1]]]);
    assert.deepEqual([devices[light].messageId, devices[pump].messageId], ids);
    assert.equal(cards.size, 2);
    assert.equal(instance.rustPlus.listenerCount('message'), 1);
});

test('a full 48-slot box keeps all item rows within Discord field limits', async t => {
    const { card, change } = await storage(t);
    const catalog = require('../src/staticFiles/items.json');
    const ids = Object.keys(catalog).sort((a, b) => catalog[b].name.length - catalog[a].name.length).slice(0, 48);
    change(pump, { capacity: 48, items: ids.map(id => ({ itemId: Number(id), quantity: 1, itemIsBlueprint: true })) });
    await until(() => card(pump).embed.description.includes('48/48'));
    const { fields } = card(pump).embed;
    assert.ok(fields.length > 3);
    assert.ok(fields.every(field => field.value.length <= 1024));
    const names = fields.filter((_, index) => index % 3 === 0).flatMap(field => field.value.trim().split('\n'));
    assert.deepEqual(names, ids.map(id => catalog[id].name + ' (Blueprint)'));
});

test('expired upkeep and legacy owner records are reconciled on a poll', async t => {
    const { instance, card, states, requests, devices } = await storage(t);
    delete devices[light].pairedSteamIds;
    const expiry = Math.floor(Date.now() / 1000) + 10;
    states.set(light, { capacity: 29, protectionExpiry: expiry });
    await instance.storageMonitors.refresh(light);
    assert.ok(card(light).embed.description.includes('<t:' + expiry + ':R>'));
    const count = requests.length;
    t.mock.method(Date, 'now', () => (expiry + 1) * 1000);
    await instance.storageMonitors.poll();
    assert.match(card(light).embed.description, /DECAYING/);
    assert.deepEqual(requests.slice(count).map(r => [r.entityId, r.playerId]), [[light, accounts[0]]]);
});

test('relay ownership follows the authenticated session after switching requesters', async t => {
    const { instance, card, broadcast, requests, server, devices } = await storage(t, true);
    assert.match(card(pump).embed.description, /Inventory unavailable/);
    broadcast(pump, { capacity: 48, items: [wood(100)] });
    assert.deepEqual(requests.map(r => r.entityId), [light]);
    const oldIds = [devices[light].messageId, devices[pump].messageId];
    await instance.shutdown();
    server.requesterSteamId = accounts[1];
    await instance.startup();
    await until(() => fields(card(pump)).Quantity === '10');
    assert.match(card(light).embed.description, /Inventory unavailable/);
    assert.deepEqual(requests.map(r => [r.entityId, r.playerId]), [[light, accounts[0]], [pump, accounts[1]]]);
    assert.deepEqual([devices[light].messageId, devices[pump].messageId], oldIds);
});
