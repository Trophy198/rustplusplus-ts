const assert = require('node:assert/strict');
const test = require('node:test');
const { setup, until, dm, accounts, guilds, light, pump, ConnectionStatus } = require('./fixtures/smart-devices.cjs');
const { default: slash, autocompleteGroup } = require('../dist/src/discordGuildSlashCommands/switchgroup');
const { buttonHandler } = require('../dist/src/handlers/buttonHandler');
const { isValidSmartSwitchGroupConfig } = require('../dist/src/managers/guildInstanceManager');

function controls(instance) {
    const { guildId, serverId } = instance;
    const guild = guilds.get(guildId);
    guild.guildChannelIds.smartSwitchGroups = guild.guildChannelIds.smartSwitches;
    const replies = [];
    const base = { guildId, allowed: true, async deferUpdate() {}, async deferReply() {},
        async editReply(r) { replies.push(r); }, async followUp(r) { replies.push(r.content); } };
    function command(action, fields, allowed = true) {
        const options = { server: serverId, ...fields };
        return slash.execute(dm, { ...base, allowed, options: {
            getSubcommand: () => action, getString: k => options[k] ?? null
        } });
    }
    const click = (id, on, allowed = true) => buttonHandler(dm, { ...base, allowed, message: { id },
        customId: on ? 'SwitchGroupOn' : 'SwitchGroupOff' });
    return { guild, base, command, click, replies };
}

test('switch group slash commands, card, broadcasts, multi-account writes and reconnect', async t => {
    const { instance, requests, states, sim, cards, devices, server, change } = await setup(t);
    const { command, click, replies, base } = controls(instance);
    const groups = server.smartSwitchGroupConfigMap;
    const create = { name: 'Garage', command: 'garage' };
    assert.deepEqual(slash.getData('ko').toJSON().options.map(o => o.name),
        ['create', 'edit', 'add', 'remove', 'delete']);
    assert.equal(await command('create', create, false), false);
    assert.equal(await command('create', { ...create, command: 'time' }), false);
    assert.equal(await command('create', create), true);
    const [groupId, group] = Object.entries(groups)[0];
    assert.ok(isValidSmartSwitchGroupConfig(group));
    const id = group.messageId, card = () => cards.get(id);
    assert.ok(card().button.disabled);
    assert.equal(await command('add', { group: groupId, switch: light }), true);
    assert.equal(await command('add', { group: groupId, switch: pump }), true);
    assert.equal(await command('add', { group: groupId, switch: pump }), false);
    assert.equal(await command('add', { group: groupId, switch: 'missing' }), false);
    const picks = [];
    await autocompleteGroup(dm, { ...base, options: { getSubcommand: () => 'remove',
        getFocused: () => ({ name: 'switch', value: pump }),
        getString: k => k === 'server' ? instance.serverId : groupId },
        respond: result => picks.push(...result) });
    assert.deepEqual(picks.map(r => r.value), [pump]);
    assert.match(card().embed.description, /OFF\n.*ON/);
    const writes = () => requests.filter(r => r.setEntityValue)
        .map(r => [r.entityId, r.playerId, r.setEntityValue.value]);
    assert.equal(await click('old-card', true), false);
    assert.equal(await click(id, true, false), false);
    assert.deepEqual(writes(), []);
    await Promise.all([click(id, true), click(id, true)]);
    assert.deepEqual(writes(), [[light, accounts[0], true]]);
    assert.equal(await click(id, false), true);
    assert.deepEqual(writes().slice(1), [[light, accounts[0], false], [pump, accounts[1], false]]);
    change(pump, true);
    await until(() => /OFF\n.*ON/.test(card().embed.description));
    const chat = [];
    t.mock.method(instance, 'inGameTeamChatQueueMessage', msg => chat.push(msg));
    const game = message => instance.prefixCommandHandler({ steamId: accounts[1], message }, true);
    assert.equal(await game('!garage status'), true);
    assert.equal(await game('!garage nonsense'), true);
    assert.equal(writes().length, 3);
    assert.equal(await game('!GARAGE on'), true);
    assert.equal(writes().length, 4);
    assert.match(chat.at(-1), /2\/2/);
    const before = writes().length;
    const socket = sim.socket;
    socket.close();
    await until(() => instance.connectionStatus === ConnectionStatus.Reconnecting && card().button.disabled);
    assert.match(card().embed.description, /Unknown/);
    states.set(light, false); states.set(pump, true);
    await until(() => !card().button.disabled && /OFF\n.*ON/.test(card().embed.description));
    assert.equal(group.messageId, id);
    assert.equal(cards.size, 3);
    assert.equal(writes().length, before);
    assert.equal(await command('edit', { group: groupId, name: 'Lighting', command: 'lamps' }), true);
    assert.equal(await game('!garage on'), false);
    assert.equal(card().embed.title, 'Lighting');
    const remove = { ...base, customId: 'SmartSwitchRemove' + JSON.stringify([instance.serverId, pump]),
        message: { id: devices[pump].messageId }, isButton: () => true };
    assert.equal(await buttonHandler(dm, remove), true);
    assert.deepEqual(group.smartSwitches, [light]);
    assert.doesNotMatch(card().embed.description, /ON/);
    assert.equal(await command('remove', { group: groupId, switch: light }), true);
    assert.ok(card().button.disabled);
    assert.equal(await command('delete', { group: groupId }), true);
    assert.ok(devices[light]);
    assert.equal(cards.has(id), false);
    assert.equal(await click(id, true), false);
    assert.ok(replies.length);
});

test('relay group reports partial completion, rejects foreign IDs and rolls back failed saves', async t => {
    const { instance, server, requests, states } = await setup(t, true);
    const { command, click, replies, guild } = controls(instance);
    await command('create', { name: 'Pool', command: 'pool' });
    const [groupId, group] = Object.entries(server.smartSwitchGroupConfigMap)[0];
    const add = member => command('add', { group: groupId, switch: member });
    await add(light); await add(pump);
    assert.equal(await click(group.messageId, true), false);
    assert.match(replies.at(-1), /1\/2/);
    assert.ok(requests.filter(r => r.setEntityValue).every(r => r.playerId === accounts[0] && r.entityId === light));
    assert.equal(states.get(light), true);
    guild.serverInfoMap.other = { ...server, smartSwitchConfigMap: {}, smartSwitchGroupConfigMap: {} };
    assert.equal(await command('delete', { server: 'other', group: groupId }), false);
    assert.equal(await command('delete', { server: '__proto__', group: groupId }), false);
    const app = require('../dist/index');
    t.mock.method(app.guildInstanceManager, 'updateGuildInstance', () => false);
    assert.equal(await command('remove', { group: groupId, switch: light }), false);
    assert.equal(await command('edit', { group: groupId, name: 'Failed' }), false);
    assert.equal(await command('delete', { group: groupId }), false);
    assert.equal(server.smartSwitchGroupConfigMap[groupId], group);
    assert.deepEqual(group.smartSwitches, [light, pump]);
    assert.equal(group.name, 'Pool');
});

test('group card edits and changes members by ID, with submit-time permission and stale-card checks', async t => {
    const { instance, server, cards } = await setup(t);
    const { base, command } = controls(instance);
    const { modalHandler } = require('../dist/src/handlers/modalHandler');
    const { ComponentType } = require('discord.js');
    await command('create', { name: 'Garage', command: 'garage' });
    const [groupId, group] = Object.entries(server.smartSwitchGroupConfigMap)[0];
    const message = { id: group.messageId };
    const buttonIds = cards.get(message.id).buttons.map(b => b.custom_id);
    assert.deepEqual(buttonIds, ['SwitchGroupOn', 'SwitchGroupOff', 'SwitchGroup:edit',
        'SwitchGroup:add', 'SwitchGroup:remove']);
    let shown;
    const open = action => buttonHandler(dm, { ...base, message, customId: 'SwitchGroup:' + action,
        isButton: () => true, showModal: modal => { shown = modal.toJSON(); } });
    const submit = (fields, extra = {}) => modalHandler(dm, { ...base, message, customId: shown.custom_id,
        isButton: () => false, async reply() {}, fields, ...extra });
    assert.equal(await open('edit'), true);
    assert.equal(shown.components[0].component.value, 'Garage');
    assert.equal(await submit({ getTextInputValue: key => key === 'name' ? 'Pump room' : 'pumps' }), true);
    assert.equal(cards.get(message.id).embed.title, 'Pump room');
    assert.equal(await open('add'), true);
    assert.deepEqual(shown.components[0].component.options.map(o => o.value).sort(), [light, pump].sort());
    const fields = { getField: () => ({ type: ComponentType.StringSelect }), getStringSelectValues: () => [light] };
    assert.equal(await submit(fields, { allowed: false }), false);
    assert.deepEqual(group.smartSwitches, []);
    assert.equal(await submit(fields), true);
    assert.equal(await open('remove'), true);
    assert.deepEqual(shown.components[0].component.options.map(o => o.value), [light]);
    assert.equal(await submit(fields), true);
    assert.deepEqual(group.smartSwitches, []);

    // More than 25 devices cannot fit in a Discord select. A typed ID still addresses the correct member.
    for (let i = 1; i <= 24; i++) server.smartSwitchConfigMap[String(i)] = { name: 'Lamp ' + i };
    assert.equal(await open('add'), true);
    assert.equal(shown.components[0].component.type, ComponentType.TextInput);
    const typed = { getField: () => ({ type: ComponentType.TextInput }), getTextInputValue: () => ' ' + pump + ' ' };
    assert.equal(await submit(typed), true);
    assert.deepEqual(group.smartSwitches, [pump]);
    for (let i = 1; i <= 24; i++) delete server.smartSwitchConfigMap[String(i)];
    await command('delete', { group: groupId });
    assert.equal(await submit(typed), false);
});

test('removing group members while a write is in flight preserves the individual device acknowledgement', async t => {
    const { instance, server, sim, requests, card } = await setup(t);
    const { command } = controls(instance);
    await command('create', { name: 'Garage', command: 'garage' });
    const group = Object.keys(server.smartSwitchGroupConfigMap)[0];
    await command('add', { group, switch: light });
    await command('add', { group, switch: pump });
    sim.holdWrites = true;
    const operation = instance.setSwitchGroup(group, true);
    await until(() => sim.pending);
    await command('remove', { group, switch: light });
    await command('remove', { group, switch: pump });
    sim.holdWrites = false;
    sim.pending();
    assert.deepEqual(await operation, { confirmed: 0, total: 2 });
    assert.equal(card(light).state, 'ON');
    assert.deepEqual(requests.filter(r => r.setEntityValue).map(r => r.entityId), [light]);
});

test('queued group commands expire on disconnect and reconnect only reads the physical switches', async t => {
    const { instance, server, sim, requests, change, states } = await setup(t);
    const { command } = controls(instance);
    await command('create', { name: 'Pool', command: 'pool' });
    const group = Object.keys(server.smartSwitchGroupConfigMap)[0];
    await command('add', { group, switch: light });
    await command('add', { group, switch: pump });
    change(pump, false);
    await until(() => instance.smartSwitchValue(pump) === false);
    sim.holdWrites = true;
    const active = instance.setSwitchGroup(group, true);
    await until(() => sim.pending);
    const queued = instance.setSwitchGroup(group, false);
    const socket = sim.socket;
    socket.close();
    sim.holdWrites = false;
    await until(() => sim.socket !== socket && instance.smartSwitchValue(pump) === false);
    assert.deepEqual(await Promise.all([active, queued]), [{ confirmed: 0, total: 2 }, { confirmed: 0, total: 2 }]);
    assert.deepEqual(requests.filter(r => r.setEntityValue).map(r => r.entityId), [light]);
    assert.equal(instance.smartSwitchValue(light), states.get(light));
});

test('timed game command reverses confirmed switches, rejects invalid durations and cancels stale timers', async t => {
    const { instance, requests, server, states } = await setup(t);
    const { command, click } = controls(instance);
    await command('create', { name: 'Garage', command: 'garage' });
    const [groupId, group] = Object.entries(server.smartSwitchGroupConfigMap)[0];
    await command('add', { group: groupId, switch: light });
    const chat = [];
    t.mock.method(instance, 'inGameTeamChatQueueMessage', msg => chat.push(msg));
    const game = message => instance.prefixCommandHandler({ steamId: accounts[0], message }, true);
    const writes = () => requests.filter(r => r.setEntityValue).map(r => r.setEntityValue.value);
    for (const value of ['0s', '1sbad', '9999999d']) await game('!garage on ' + value);
    assert.deepEqual(writes(), []);
    await game('!garage on 1s');
    assert.equal(states.get(light), true);
    assert.ok(chat.some(line => line.includes('OFF') && line.includes('1s')));
    await until(() => instance.smartSwitchValue(light) === false);
    assert.deepEqual(writes(), [true, false]);
    await game('!garage on 1s');
    await click(group.messageId, true);
    await new Promise(resolve => setTimeout(resolve, 1050));
    assert.deepEqual(writes(), [true, false, true]);
    await game('!garage off 1s');
    await command('remove', { group: groupId, switch: light });
    await command('add', { group: groupId, switch: light });
    await new Promise(resolve => setTimeout(resolve, 1050));
    assert.deepEqual(writes(), [true, false, true, false]);
});

test('create groups from server and switch cards with a name and optional initial switches', async t => {
    const { instance, server, devices, card } = await setup(t);
    const { base } = controls(instance);
    const { modalHandler } = require('../dist/src/handlers/modalHandler');
    server.messageId = 'server-card';
    const customId = 'SwitchGroup:create';
    assert.ok(card(light).buttons.some(b => b.custom_id === customId));
    let modal;
    const open = id => buttonHandler(dm, { ...base, message: { id }, customId, isButton: () => true,
        showModal: m => { modal = m.toJSON(); }, async reply() {} });
    const submit = (id, members, allowed = true) => modalHandler(dm, { ...base, message: { id }, customId, allowed,
        isButton: () => false, async reply() {}, fields: { fields: new Map([['members', true]]),
            getTextInputValue: () => 'Garage lights', getStringSelectValues: () => members } });
    assert.equal(await open(devices[light].messageId), true);
    assert.equal(modal.components[1].component.options.find(o => o.default).value, light);
    assert.equal(await submit(devices[light].messageId, [light, pump], false), false);
    assert.equal(await submit(devices[light].messageId, [light, pump]), true);
    assert.equal(await open(server.messageId), true);
    assert.ok(modal.components[1].component.options.every(o => !o.default));
    assert.equal(await submit(server.messageId, ['removed-switch']), false);
    assert.equal(await submit(server.messageId, []), true);
    assert.equal(await open('retired-card'), false);
    const groups = Object.values(server.smartSwitchGroupConfigMap);
    assert.deepEqual(groups.map(g => g.smartSwitches), [[light, pump], []]);
    assert.deepEqual(groups.map(g => g.command), ['garage-lights', 'garage-lights-2']);
});
