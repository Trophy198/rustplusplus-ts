const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, until, accounts, guilds } = require('./fixtures/smart-devices.cjs');
const { AppMessage } = require('rustplus-ts');

const [helen, ekawa] = accounts;

async function chat(t, relay) {
    const { instance, server, sim } = await setup(t, relay);
    const guild = guilds.get(instance.guildId);
    guild.blacklist = { steamIds: [] };
    Object.assign(guild.generalSettings, {
        inGameChatFunctionalityEnabled: true, inGameChatCommandsEnabled: true, inGameChatBotUnmuted: true,
        inGameChatMessageDelay: 0, inGameChatTrademark: '', language: 'ko'
    });
    sim.teamReplies = [];
    const ask = (steamId, name, message) => sim.socket.send(AppMessage.toBinary(AppMessage.create({
        broadcast: { teamMessage: { message: { steamId, name, message } } }
    })));
    const exchange = async (id, name, command) => {
        const total = sim.teamReplies.length + 1;
        ask(id, name, command);
        await until(() => sim.teamReplies.length >= total);
        return sim.teamReplies[total - 1].text;
    };
    return { instance, server, sim, guild, ask, exchange };
}

for (const relay of [false, true]) {
    test('!steamid returns each sender and named teammate over one ' + (relay ? 'relay' : 'direct') + ' socket',
        async t => {
            const { instance, server, sim, ask, exchange } = await chat(t, relay);
            assert.equal(server.requesterSteamId, helen);
            const reads = t.mock.method(instance.rustPlus, 'getTeamInfoAsync');
            const infoReads = t.mock.method(instance.rustPlus, 'getInfoAsync');
            assert.equal(await exchange(helen, 'Helen West', '!steamid'), 'Helen West: ' + helen);
            assert.equal(await exchange(ekawa, 'Ekawa', '!steamid'), 'Ekawa: ' + ekawa);
            assert.equal(reads.mock.callCount(), 0);
            sim.team = { leaderSteamId: helen, members: [
                { name: 'Helen West', steamId: helen, isOnline: true },
                { name: 'Ekawa', steamId: ekawa, isOnline: true }
            ] };
            sim.holdTeam = true;
            ask(helen, 'Helen West', '!steamid eKa');
            ask(ekawa, 'Ekawa', '!스팀아이디 helen WEST');
            await until(() => sim.pending);
            sim.holdTeam = false;
            sim.pending();
            await until(() => sim.teamReplies.length === 4);
            assert.deepEqual(sim.teamReplies.slice(2).map(r => r.text).sort(),
                ['Ekawa: ' + ekawa, 'Helen West: ' + helen]);
            assert.equal(await exchange(helen, 'Helen West', '!steamid ekawa'), 'Ekawa: ' + ekawa);
            assert.equal(await exchange(ekawa, 'Ekawa', '!steamid Helen West'), 'Helen West: ' + helen);
            assert.ok(sim.teamReplies.every(r => r.from === helen));
            assert.equal(sim.connections.length, 1);
            assert.equal(reads.mock.callCount(), 1);
            assert.equal(infoReads.mock.callCount(), 0);
        });
}

test('!steamid handles ambiguous, exact, offline and missing names in the polled roster', async t => {
    const { instance, guild, exchange } = await chat(t, false);
    guild.generalSettings.inGameChatCommandPrefix = '?';
    instance.lastServerPollSuccessful = true;
    instance.rpTeamInfo = { appTeamInfo: { members: [
        { name: 'Helen', steamId: helen }, { name: 'Helen West', steamId: ekawa, isOnline: false }
    ] } };
    const read = t.mock.method(instance.rustPlus, 'getTeamInfoAsync');
    assert.equal(await exchange(ekawa, 'Ekawa', '?steamid HELEN'), 'Helen: ' + helen);
    assert.equal(await exchange(helen, 'Helen', '?steamid west'), 'Helen West: ' + ekawa);
    const ambiguous = await exchange(helen, 'Helen', '?steamid Hel');
    assert.match(ambiguous, /여러 명/);
    assert.match(ambiguous, /\?steamid/);
    assert.doesNotMatch(ambiguous, /7656119/);
    const missing = await exchange(ekawa, 'Ekawa', '?steamid Nobody');
    assert.equal(missing, '일치하는 팀원이 없습니다.');
    assert.equal(read.mock.callCount(), 0);
});

test('a missing team roster permits self lookup and keeps named lookups scoped to this team', async t => {
    const { exchange, instance, sim } = await chat(t, false);
    assert.equal(await exchange(ekawa, 'Ekawa', '!steamid'), 'Ekawa: ' + ekawa);
    const missing = await exchange(helen, 'Helen', '!steamid Ekawa');
    assert.match(missing, /팀 정보를 조회할 수 없습니다/);
    assert.doesNotMatch(missing, /7656119/);
    assert.equal(await instance.prefixCommandHandler({ cleanContent: '!steamid' }, false), false);
    assert.equal(sim.teamReplies.length, 2);
});
