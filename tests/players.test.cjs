const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, until, guilds, accounts, ConnectionStatus } = require('./fixtures/smart-devices.cjs');
const app = require('../dist/index');
const slash = require('../dist/src/discordGuildSlashCommands/players').default;
const { getBattleMetricsRoster } = require('../dist/src/api/battlemetrics');
const { MessageFlags } = require('discord.js');

const publicPlayer = (id, name, hidden = false) => ({ type: 'player', id, attributes: { name, private: hidden } });
const roster = (id, included, attrs = {}) => ({ data: { id, type: 'server',
    attributes: { name: 'Mock Rust ' + id, status: 'online', players: 40, ...attrs },
    relationships: { game: { data: { id: 'rust' } } } }, included });

function token(t, enabled = true) {
    const previous = process.env.RPP_BATTLEMETRICS_TOKEN;
    t.after(() => {
        if (previous === undefined) delete process.env.RPP_BATTLEMETRICS_TOKEN;
        else process.env.RPP_BATTLEMETRICS_TOKEN = previous;
    });
    if (enabled) process.env.RPP_BATTLEMETRICS_TOKEN = 'fixture-only';
    else delete process.env.RPP_BATTLEMETRICS_TOKEN;
}

async function commands(t) {
    const { instance, server, sim } = await setup(t);
    const guild = guilds.get(instance.guildId);
    guild.serverToView = instance.serverId;
    guild.generalSettings.inGameChatTrademark = 'Rust++';
    sim.team = { leaderSteamId: accounts[0], members: [
        { steamId: accounts[0], name: 'Helen West', isOnline: true },
        { steamId: accounts[1], name: 'Ekawa', isOnline: false }
    ] };
    const response = await instance.rustPlus.getTeamInfoAsync(accounts[0], 100);
    instance.lastServerPollSuccessful = true;
    instance.rpTeamInfo = { appTeamInfo: response.teamInfo };
    instance.rpInfo = { appInfo: { players: 40, maxPlayers: 100 } };
    const messages = [];
    t.mock.method(instance, 'inGameTeamChatQueueMessage', lines => messages.push(lines));
    const discord = async (sub, options = {}, perms = true) => {
        let msg;
        const ok = await slash.execute({ validPermissions: (_, admin) => perms === 'admin' || (perms && !admin) }, {
            guildId: guild.guildId, options: { getSubcommand: () => sub, getString: key => options[key] ?? null },
            deferReply: async ({ flags }) => assert.equal(flags, MessageFlags.Ephemeral),
            editReply: async reply => { assert.deepEqual(reply.allowedMentions.parse, []); msg = reply.content; }
        });
        return { ok, msg };
    };
    const game = async (steamId, message) => {
        assert.equal(await instance.prefixCommandHandler({ steamId, message }, true), true);
        return messages.at(-1);
    };
    return { guild, server, instance, discord, game, sim };
}

test('team-only name, offline and any use the polled team, handle unavailable data, and bound team chat', async t => {
    token(t, false);
    const fetch = t.mock.method(global, 'fetch', () => { throw new Error('unexpected fetch'); });
    const { guild, server, instance, discord, game, sim } = await commands(t);
    let r = await discord('name');
    assert.ok(r.ok);
    assert.match(r.msg, /40\/100/);
    assert.match(r.msg, /online teammates · Helen West/);
    assert.doesNotMatch(r.msg, /Ekawa/);
    r = await discord('name', { status: '1' });
    assert.match(r.msg, /offline teammates · Ekawa/);
    assert.doesNotMatch(r.msg, /Helen/);
    assert.match((await discord('name', { status: '2', name: 'EKAW' })).msg, /offline teammates · Ekawa/);
    assert.match((await discord('playerid', { playerid: accounts[0] })).msg, /BattleMetrics server ID/);
    guild.generalSettings.language = 'ko';
    for (const [account, command] of [[accounts[0], '!player HELEN wEs'], [accounts[1], '!플레이어들']]) {
        assert.match((await game(account, command)).join('\n'), /Rust\+ 온라인 팀원 · Helen West/);
    }
    guild.generalSettings.language = 'en';
    server.battlemetricsId = '101';
    assert.match((await discord('name')).msg, /token is not configured/);
    instance.rpTeamInfo.appTeamInfo.members = Array.from({ length: 80 }, (_, i) =>
        ({ name: 'A very long player name ' + i, isOnline: true }));
    const lines = await game(accounts[0], '!players');
    assert.match(lines.at(-1), /… \+\d+$/);
    assert.ok(lines.every(s => s.length + 'Rust++ | '.length <= 128));
    instance.connectionStatus = ConnectionStatus.Reconnecting;
    r = await discord('name');
    assert.equal(r.ok, false);
    assert.match(r.msg, /team data is unavailable/);
    assert.doesNotMatch(r.msg, /40\/100|Helen/);
    instance.connectionStatus = ConnectionStatus.Connected;
    assert.equal(sim.connections.length, 1);
    assert.equal(fetch.mock.callCount(), 0);
});

test('Discord and in-game users share a single public roster per server; IDs and populations stay scoped', async t => {
    token(t);
    const { discord, game, server, instance } = await commands(t);
    const calls = [];
    t.mock.method(global, 'fetch', async (url, options) => {
        assert.equal(options.headers.Authorization, 'Bearer fixture-only');
        assert.equal(options.redirect, 'error');
        const id = new URL(url).pathname.split('/').pop();
        calls.push(id);
        await new Promise(resolve => setTimeout(resolve, 5));
        return Response.json(roster(id, [publicPlayer('81', 'Raid West'), publicPlayer('81', 'Raid West'),
            publicPlayer('82', 'Secret', true), publicPlayer('83', '**Guest**'), { type: 'identifier' }]));
    });
    server.battlemetricsId = '222';
    const [list, first, second] = await Promise.all([
        discord('name', { status: '2' }), game(accounts[0], '!player RaID w'), game(accounts[1], '!players')]);
    assert.deepEqual(calls, ['222']);
    assert.ok(list.ok);
    assert.equal(list.msg.split('Raid West').length, 2);
    assert.match(list.msg, /#81/);
    assert.match(list.msg, /offline teammates · Ekawa/);
    assert.match(list.msg, /\\\*\\\*Guest/);
    for (const lines of [first, second]) {
        assert.match(lines.join('\n'), /BattleMetrics public online/);
        assert.doesNotMatch(lines.join('\n'), /Secret|Ekawa/);
    }
    assert.doesNotMatch((await discord('playerid', { playerid: accounts[0] })).msg, /Helen/);
    assert.match((await discord('playerid', { playerid: '81' })).msg, /Raid West/);
    assert.match((await discord('name', { name: 'hele' })).msg, /online teammates · Helen West/);
    const other = await discord('name', { battlemetricsid: '223', status: '2' });
    assert.match(other.msg, /Mock Rust 223/);
    assert.doesNotMatch(other.msg, /Helen|Ekawa|40\/100/);
    assert.deepEqual(calls, ['222', '223']);
    assert.equal(instance.connectionStatus, ConnectionStatus.Connected);
});

test('during map setup, two accounts read the team and population once; revoked or stale sessions reveal no team',
    async t => {
        token(t, false);
        const { guild, server, discord, instance, game, sim } = await commands(t);
        instance.lastServerPollSuccessful = false;
        instance.rpTeamInfo = null;
        const teamReads = t.mock.method(instance.rustPlus, 'getTeamInfoAsync');
        const infoReads = t.mock.method(instance.rustPlus, 'getInfoAsync');
        const results = await Promise.all([discord('name'), game(accounts[0], '!players'),
            game(accounts[1], '!player')]);
        assert.match(results[0].msg, /online teammates · Helen West/);
        assert.match(results[1].join(' '), /online teammates · Helen West/);
        assert.match(results[2].join(' '), /online teammates · Helen West/);
        assert.equal(teamReads.mock.callCount(), 1);
        assert.equal(infoReads.mock.callCount(), 1);
        const pair = guild.pairingDataMap[instance.serverId][server.requesterSteamId];
        pair.valid = false;
        assert.doesNotMatch((await discord('name')).msg, /Helen West/);
        pair.valid = true;
        sim.team.members[0].name = 'After reconnect';
        await instance.shutdown();
        await instance.startup();
        await until(() => instance.connectionStatus === ConnectionStatus.Connected);
        const after = await discord('name');
        assert.match(after.msg, /After reconnect/);
        assert.doesNotMatch(after.msg, /Helen West/);
        assert.equal(teamReads.mock.callCount(), 2);
    });

test('link and unlink apply only to the selected guild server and only persist with permission', async t => {
    token(t, false);
    const { discord, guild, server } = await commands(t);
    for (const lang of ['en', 'ko']) {
        const schema = slash.getData(lang).toJSON();
        assert.deepEqual(schema.options.map(s => s.name), ['name', 'playerid', 'link', 'unlink']);
    }
    assert.equal((await discord('link', { battlemetricsid: '303' })).ok, false);
    assert.equal((await discord('name', {}, false)).ok, false);
    assert.equal((await discord('link', { battlemetricsid: 'x' }, 'admin')).ok, false);
    assert.equal((await discord('link', { battlemetricsid: '303' }, 'admin')).ok, true);
    assert.equal(server.battlemetricsId, '303');
    const fail = t.mock.method(app.guildInstanceManager, 'updateGuildInstance', () => false);
    assert.equal((await discord('unlink', {}, 'admin')).ok, false);
    assert.equal(server.battlemetricsId, '303');
    fail.mock.restore();
    assert.equal((await discord('unlink', {}, 'admin')).ok, true);
    assert.equal(server.battlemetricsId, null);
    guild.serverToView = null;
    guild.serverInfoMap.other = { active: true };
    assert.equal((await discord('link', { battlemetricsid: '303' }, 'admin')).ok, false);
});

test('access errors and hidden rosters fall back to Rust+ without treating missing names as offline', async t => {
    token(t);
    const { discord, server } = await commands(t);
    let id = 330;
    for (const [response, notice] of [
        [() => new Response(null, { status: 403 }), /denied API access/],
        [() => { throw new Error('timeout'); }, /Could not retrieve/],
        [() => Response.json({}), /Could not retrieve/],
        [() => Response.json(roster(String(id), undefined)), /no public online roster/],
        [() => Response.json(roster(String(id), [publicPlayer('55', 'Hidden', true)])), /no public online roster/],
        [() => Response.json(roster(String(id), [], { status: 'dead' })), /no public online roster/]
    ]) {
        server.battlemetricsId = String(++id);
        const mock = t.mock.method(global, 'fetch', async () => response());
        const { msg } = await discord('name');
        assert.match(msg, notice);
        assert.match(msg, /online teammates · Helen West/);
        assert.doesNotMatch(msg, /Hidden|offline teammates/);
        mock.mock.restore();
    }
    server.battlemetricsId = '337';
    const fetch = t.mock.method(global, 'fetch', async () =>
        new Response(null, { status: 429, headers: { 'Retry-After': '90' } }));
    assert.match((await discord('name')).msg, /Try again later/);
    assert.equal((await getBattleMetricsRoster('338')).kind, 'rateLimit');
    assert.equal((await getBattleMetricsRoster('https://example.com')).kind, 'invalidId');
    assert.equal(fetch.mock.callCount(), 1);
});
