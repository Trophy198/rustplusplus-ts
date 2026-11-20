const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ChannelType, ComponentType, DiscordAPIError } = require('discord.js');

const index = require.resolve('../dist/index.js');
const app = { log: { info() {}, warn() {}, error() {} } };
require.cache[index] = { id: index, loaded: true, exports: app };
const { LocaleManager } = require('../dist/src/managers/LocaleManager');
const { GuildInstanceManager } = require('../dist/src/managers/guildInstanceManager');
const { DiscordManager } = require('../dist/src/managers/discordManager');
const { buttonHandler } = require('../dist/src/handlers/buttonHandler');
app.localeManager = new LocaleManager();

const oldPluginButton = 'GeneralSetting-fcmAlarmPluginNotifyInGame';
const expected = ['generalSettingsHeader', 'language', 'voiceGender', 'inGameChatFunctionalityEnabled',
    'inGameChatBotUnmuted', 'inGameChatTrademark', 'inGameChatCommandPrefix', 'inGameChatCommandsEnabled',
    'inGameChatMessageDelay', 'leaderCommand', 'inGameChatNotifySmartSwitchChangedFromDiscord', 'inGameChatNotify',
    'fcmAlarmNotify', 'fcmAlarmPluginNotify'];
function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-settings-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const manager = new GuildInstanceManager(dir, path.resolve('src/templates'));
    app.guildInstanceManager = manager;
    const guild = { id: 'test' };
    manager.addNewGuildInstance(guild.id);
    const state = manager.getGuildInstance(guild.id);
    state.guildChannelIds.settings = 'settings';
    const dm = Object.create(DiscordManager.prototype);
    const messages = new Map();
    const blocked = new Set();
    const edits = [];
    let next = 0;
    function add(id, author = 'bot') {
        const msg = { id, author: { id: author }, components: [],
            async edit(content) {
                edits.push(id);
                this.components = (content.components ?? []).map(row => ({
                    type: ComponentType.ActionRow, components: row.toJSON().components.map(c => ({
                        customId: c.custom_id
                    }))
                }));
            },
            async delete() { messages.delete(id); }
        };
        messages.set(id, msg);
        return msg;
    }
    const channel = { type: ChannelType.GuildText, messages: { async fetch({ message: id }) {
        if (blocked.has(id)) throw Error('Temporary read error');
        if (messages.has(id)) return messages.get(id);
        throw new DiscordAPIError({ message: 'Unknown Message', code: 10008 }, 10008, 404, 'GET', '/', {});
    } }, async send(content) {
        const msg = add('new-' + ++next);
        await msg.edit(content);
        return msg;
    } };
    Object.assign(dm, { settingsUpdates: new Map(), client: { user: { id: 'bot' } },
        getChannel: async (guildId, channelId) => {
            assert.equal(guildId, guild.id);
            assert.equal(channelId, state.guildChannelIds.settings);
            return channel;
        }
    });
    const sync = update => dm.setupGuildSettingsChannel(guild, update);
    return { guild, dm, state, messages, edits, add, blocked, sync, dir };
}

test('upgrade retires old cards, preserves IDs and preferences, and edits the Raid Alarm card in place', async t => {
    const { state, messages, edits, add, sync, dir } = fixture(t);
    const refs = state.settingsMessages;
    assert.equal(Object.keys(refs).length, 39);
    for (const key of Object.keys(refs)) {
        refs[key] = add(key).id;
    }
    messages.get('fcmAlarmPluginNotify').components = [
        { type: ComponentType.ActionRow, components: [{ customId: oldPluginButton }] }
    ];
    state.generalSettings.leaderCommandEnabled = false;
    state.eventNotificationSettings.ch47Spawned.voice = false;
    const preferences = structuredClone([state.generalSettings, state.eventNotificationSettings]);
    await sync(false);
    assert.deepEqual([...messages.keys()], expected);
    assert.deepEqual(expected.map(k => refs[k]), expected);
    assert.deepEqual(edits, ['fcmAlarmPluginNotify']);
    const controls = messages.get('fcmAlarmPluginNotify').components[0].components.map(c => c.customId);
    assert.deepEqual(controls, ['GeneralSetting-fcmAlarmPluginNotify', 'GeneralSetting-fcmAlarmPluginNotifyEveryone',
        'GeneralSetting-fcmAlarmPluginNotifyActiveServer']);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'test.json')));
    assert.deepEqual(saved.settingsMessages, refs);
    assert.deepEqual([saved.generalSettings, saved.eventNotificationSettings], preferences);
    await sync(false);
    assert.deepEqual(edits, ['fcmAlarmPluginNotify']);
});

test('fresh, concurrent and refresh setups create one set of cards and recover missing active messages', async t => {
    const { state, messages, sync } = fixture(t);
    await Promise.all([sync(false), sync(false)]);
    const refs = state.settingsMessages;
    assert.deepEqual(Object.keys(refs).filter(k => refs[k]), expected);
    assert.equal(messages.size, expected.length);
    const missing = refs.language;
    messages.delete(missing);
    await sync(false);
    assert.notEqual(refs.language, missing);
    assert.equal(messages.size, expected.length);
    const snapshot = { ...refs };
    await sync(true);
    assert.deepEqual(refs, snapshot);
    assert.equal(messages.size, expected.length);
});

test('cleanup preserves foreign and shared messages and retries temporary failures', async t => {
    const { state, messages, add, blocked, sync } = fixture(t);
    const refs = state.settingsMessages;
    refs.language = add('language').id;
    refs.mapWipeNotifyEveryone = refs.language;
    refs.leaderCommand = add('foreign', 'somebody-else').id;
    refs.ch47Spawned = 'already-deleted';
    refs.ch47Despawned = add('retry-delete').id;
    refs.voiceGender = add('retry-active').id;
    blocked.add('retry-delete').add('retry-active');
    await sync(false);
    assert.ok(messages.has('foreign'));
    assert.ok(refs.leaderCommand && refs.leaderCommand !== 'foreign');
    assert.equal(refs.mapWipeNotifyEveryone, null);
    assert.equal(refs.ch47Spawned, null);
    assert.equal(refs.ch47Despawned, 'retry-delete');
    assert.equal(refs.voiceGender, 'retry-active');
    blocked.clear();
    await sync(false);
    assert.equal(refs.ch47Despawned, null);
    assert.ok(!messages.has('retry-delete'));
    assert.ok(messages.has('language'));
    assert.equal(messages.size, expected.length + 1);
});

test('cached retired buttons acknowledge the click without changing saved settings', async t => {
    const { dm, state, guild } = fixture(t);
    const before = structuredClone(state);
    let acknowledgements = 0;
    for (const customId of ['GeneralSetting-leaderCommandEnabled', 'GeneralSetting-leaderCommandOnlyPaired',
        'GeneralSetting-mapWipeNotifyEveryone', oldPluginButton, 'EventNotificationSetting-discord-ch47Spawned']) {
        const result = await buttonHandler(dm, { guildId: guild.id, customId, deferUpdate() { acknowledgements++; } });
        assert.equal(result, false);
    }
    assert.equal(acknowledgements, 5);
    assert.deepEqual(state, before);
});

test('leader settings use the saved card, require admin permission and persist both switches', async t => {
    const { dm, state, guild, sync, dir } = fixture(t);
    await sync(false);
    t.mock.method(dm, 'validPermissions', (i, admin) => admin && i.admin);
    t.mock.method(require('../dist/src/discordUtils/discordMessages'), 'updateSetting', async () => {});
    const click = (key, admin = true, id = state.settingsMessages.leaderCommand) => buttonHandler(dm, {
        guildId: guild.id, customId: 'GeneralSetting-' + key, message: { id }, admin, async deferUpdate() {}
    });
    assert.equal(await click('leaderCommandEnabled', false), false);
    assert.equal(await click('leaderCommandEnabled', true, 'retired'), false);
    assert.equal(await click('leaderCommandEnabled'), true);
    assert.equal(await click('leaderCommandOnlyPaired'), true);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'test.json')));
    assert.equal(saved.generalSettings.leaderCommandEnabled, false);
    assert.equal(saved.generalSettings.leaderCommandOnlyPaired, true);
});
