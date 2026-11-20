const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, until, dm, accounts, guilds } = require('./fixtures/smart-devices.cjs');
const { default: slash } = require('../dist/src/discordGuildSlashCommands/leader');

const [main, alt] = accounts, third = '76561198000000003';
async function setupTeam(t, relay) {
    const { instance, server, sim } = await setup(t, relay);
    const guild = guilds.get(instance.guildId);
    guild.generalSettings.leaderCommandEnabled = true;
    guild.generalSettings.leaderCommandOnlyPaired = true;
    guild.serverToView = instance.serverId;
    sim.team = { leaderSteamId: main, members: [
        { steamId: main, name: 'Helen' }, { steamId: alt, name: 'Ekawa' }, { steamId: third, name: 'Eka West' }
    ] };
    sim.promotions = [];
    const messages = [];
    t.mock.method(instance, 'inGameTeamChatQueueMessage', message => messages.push(message));
    const game = (steamId, message) => instance.prefixCommandHandler({ steamId, message }, true);
    const discord = (member, user = '0', allowed = true, serverId = null) => slash.execute(dm, {
        guildId: guild.guildId, user: { id: user }, allowed,
        options: { getString: key => key === 'member' ? member : serverId }, async deferReply() {},
        async editReply(message) { messages.push(message.content ?? message); }
    });
    return { guild, instance, sim, server, messages, game, discord };
}

for (const relay of [false, true]) {
    test((relay ? 'account-bound relay' : 'direct socket') + ' transfers leadership both ways with one main connection',
        async t => {
            const { sim, server, game, discord, messages } = await setupTeam(t, relay);
            const primary = sim.connections[0].socket;
            assert.equal(server.requesterSteamId, main);
            assert.equal(await game(alt, '!leader'), true);
            assert.equal(sim.team.leaderSteamId, alt);
            assert.match(messages.at(-1), /Ekawa is now/);
            assert.equal(await discord('Helen', '1'), true);
            assert.equal(sim.team.leaderSteamId, main);
            assert.deepEqual(sim.promotions, [[main, alt], [alt, main]]);
            assert.equal(server.requesterSteamId, main);
            if (relay) {
                assert.deepEqual(sim.connections.map(c => c.account), [main, alt]);
                await until(() => sim.connections[1].socket.readyState === 3);
            } else assert.equal(sim.connections.length, 1);
            assert.equal(primary.readyState, 1);
        });
}

test('leader permissions, ambiguous names and stale team data never produce a false success', async t => {
    const { guild, instance, sim, game, discord, messages } = await setupTeam(t, false);
    const pairs = guild.pairingDataMap[instance.serverId];
    await discord('Ekawa', '0', false);
    await discord('Ekawa', '0', true, 'other-server');
    await game(main, '!leader Eka');
    await game(main, '!leader nobody');
    await game(main, '!leader Helen');
    await game(third, '!leader');
    await game(main, '!leader Eka West');
    await game('76561198000000004', '!leader Ekawa');
    pairs[alt].valid = false;
    await game(main, '!leader Ekawa');
    pairs[alt].valid = true;
    sim.team.leaderSteamId = third;
    await game(alt, '!leader');
    sim.team.leaderSteamId = main;
    guild.generalSettings.leaderCommandEnabled = false;
    await game(alt, '!leader');
    assert.deepEqual(sim.promotions, []);
    guild.generalSettings.leaderCommandEnabled = true;
    sim.rejectLeader = true;
    assert.equal(await discord(alt), false);
    assert.match(messages.at(-1), /rejected/);
    sim.rejectLeader = false; sim.ignoreLeader = true;
    assert.equal(await discord(alt), false);
    assert.match(messages.at(-1), /Could not confirm/);
    sim.ignoreLeader = false;
    guild.generalSettings.leaderCommandOnlyPaired = false;
    assert.equal(await discord('Eka West'), true);
    assert.equal(sim.team.leaderSteamId, third);
    assert.deepEqual(sim.promotions, [[main, alt], [main, alt], [main, third]]);
});

test('overlapping leader commands perform one mutation and pairing revocation before dispatch cancels it', async t => {
    const { sim, guild, instance, discord, messages } = await setupTeam(t, true);
    sim.holdTeam = true;
    const first = discord('Ekawa');
    await until(() => sim.pending);
    assert.equal(await discord('Ekawa'), false);
    assert.match(messages.at(-1), /in progress/);
    guild.pairingDataMap[instance.serverId][main].valid = false;
    sim.holdTeam = false;
    sim.pending();
    assert.equal(await first, false);
    assert.deepEqual(sim.promotions, []);
    guild.pairingDataMap[instance.serverId][main].valid = true;
    assert.equal(await discord('Ekawa'), true);
});

test('leader change during relay setup cancels the promotion and closes the temporary socket', async t => {
    const { sim, game, messages } = await setupTeam(t, true);
    sim.team.leaderSteamId = alt;
    sim.beforeTeamRead = reader => { if (reader === alt) sim.team.leaderSteamId = third; };
    await game(main, '!leader');
    assert.deepEqual(sim.promotions, []);
    assert.match(messages.at(-1), /changed/);
    await until(() => sim.connections[1].socket.readyState === 3);
    assert.equal(sim.connections[0].socket.readyState, 1);
});

test('master paired-only setting checks the recipient and the Korean command keeps self and named targets', async t => {
    const { guild, sim, game } = await setupTeam(t, false);
    guild.generalSettings.language = 'ko';
    await game(third, '!리더 Ekawa');
    await game(main, '!리더');
    await game(third, '!리더');
    assert.deepEqual(sim.promotions, [[main, alt], [alt, main]]);
});
