const assert = require('node:assert/strict');
const test = require('node:test');
const { setup, until, dm, accounts, guilds, light, pump, ConnectionStatus } = require('./fixtures/smart-devices.cjs');
const { isValidSmartSwitchConfig } = require('../dist/src/managers/guildInstanceManager');

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
