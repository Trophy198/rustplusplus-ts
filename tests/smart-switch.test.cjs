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

test('switch card edits, account attribution, team commands and guild-scoped removal', async t => {
    const { card, pair, cards, devices, instance, states, requests, server } = await setup(t);
    const { buttonHandler } = require('../dist/src/handlers/buttonHandler');
    const { modalHandler } = require('../dist/src/handlers/modalHandler');
    const guildId = instance.guildId, message = { id: devices[light].messageId };
    const [, editButton, removeButton] = card(light).buttons;
    assert.equal(editButton.style, 1);
    assert.equal(removeButton.style, 2);
    assert.equal(removeButton.emoji.name, '🗑️');
    assert.match(editButton.custom_id, /^SmartSwitchEdit/);
    assert.match(removeButton.custom_id, /^SmartSwitchRemove/);
    assert.ok(card(light).embed.fields.some(field => field.value.includes(accounts[0]) &&
        field.value.includes('<@0>') && !field.value.includes(accounts[1])));
    await pair(light, 1);
    assert.ok(card(light).embed.fields.some(field => accounts.every(id => field.value.includes(id))));
    const replies = [];
    const base = { guildId, message, allowed: true, async deferUpdate() {},
        async followUp(r) { replies.push(r); }, async reply(r) { replies.push(r); } };
    let modal;
    const edit = { ...base, customId: editButton.custom_id, isButton: () => true,
        async showModal(m) { modal = m.toJSON(); } };
    assert.equal(await buttonHandler(dm, { ...edit, allowed: false }), false);
    assert.equal(await buttonHandler(dm, { ...edit, message: { id: 'old' } }), false);
    assert.equal(modal, undefined);
    assert.equal(await buttonHandler(dm, edit), true);
    assert.equal(modal.components[1].components[0].value, light);
    const submit = (command, extra) => modalHandler(dm, { ...base, customId: modal.custom_id, isButton: () => false,
        fields: { getTextInputValue: k => k === 'name' ? 'Workshop' : command }, ...extra });
    assert.equal(await submit('Light', { allowed: false }), false);
    assert.equal(await submit('Light', { message: { id: 'old' } }), false);
    assert.equal(await submit('time'), false);
    assert.equal(await submit(pump), false);
    assert.equal(await submit('two words'), false);
    assert.equal(devices[light].name, 'Smart Switch');
    assert.equal(await submit('Light'), true);
    await pair(light, 0);
    assert.equal(devices[light].command, 'light');
    assert.equal(card(light).embed.title, 'Workshop');
    assert.ok(card(light).embed.fields.some(f => f.value.includes('!light')));

    const chat = [];
    t.mock.method(instance, 'inGameTeamChatQueueMessage', text => chat.push(text));
    const command = text => instance.prefixCommandHandler({ steamId: accounts[0], message: text }, true);
    const count = () => requests.filter(r => r.setEntityValue).length;
    assert.equal(await command('!Light on'), true);
    assert.equal(states.get(light), true);
    assert.equal(await command('!' + light + ' off'), true);
    assert.equal(states.get(light), false);
    const before = count();
    assert.equal(await command('!light status'), true);
    assert.equal(await command('!light wat'), true);
    assert.equal(count(), before);
    await Promise.all([command('!light'), command('!' + light)]);
    assert.equal(count(), before + 2);
    assert.equal(states.get(light), false);
    assert.ok(chat.includes('Workshop · ON'));
    const remove = { ...base, customId: removeButton.custom_id, isButton: () => true };
    server.smartSwitchGroupConfigMap.group = { smartSwitches: [light, pump] };
    assert.equal(await buttonHandler(dm, { ...remove, allowed: false }), false);
    assert.equal(await buttonHandler(dm, remove), true);
    assert.equal(cards.has(message.id), false);
    assert.deepEqual(server.smartSwitchGroupConfigMap.group.smartSwitches, [pump]);
    assert.equal(instance.smartSwitchValue(light), undefined);
    assert.equal(await command('!light on'), false);
    assert.equal(await submit('late'), false);
    assert.equal(await buttonHandler(dm, remove), false);
});

test('slash edit preserves legacy devices, rejects ambiguous IDs and rolls back a failed save', async t => {
    const { card, instance, devices, server } = await setup(t);
    const app = require('../dist/index');
    const views = require('../dist/src/discordUtils/discordMessages');
    const slash = require('../dist/src/discordGuildSlashCommands/smartswitch').default;
    const guild = guilds.get(instance.guildId);
    delete devices[light].pairedSteamIds;
    t.mock.method(views, 'sendDefaultMessage', async () => {});
    const options = { entity_id: light, command: 'lamp' };
    const replies = [];
    const interaction = { guildId: instance.guildId, guild: {}, allowed: true, id: 'test',
        options: { getSubcommand: () => 'edit', getString: k => options[k] ?? null }, async deferReply() {},
        async editReply(r) { replies.push(r); } };
    assert.equal(await slash.execute(dm, interaction), true);
    assert.equal(card(light).embed.fields.find(f => f.name === 'Paired by').value,
        'Unknown · pair again to record the account');
    assert.equal(card(light).embed.fields.find(f => f.name === 'In-game command').value, '`!lamp`');
    const other = { ...devices[light], command: 'other' };
    guild.serverInfoMap.other = { ...server, smartSwitchConfigMap: { [light]: other } };
    options.command = 'hall';
    assert.equal(await slash.execute(dm, interaction), false);
    assert.equal(devices[light].command, 'lamp');
    assert.equal(other.command, 'other');
    delete guild.serverInfoMap.other;
    t.mock.method(app.guildInstanceManager, 'updateGuildInstance', () => false);
    assert.equal(await slash.execute(dm, interaction), false);
    assert.equal(devices[light].command, 'lamp');
    assert.equal(replies.length, 2);
});
