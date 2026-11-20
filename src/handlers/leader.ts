import { once } from 'node:events';
import { RustPlus, isValidAppResponse, type AppTeamInfo } from 'rustplus-ts';
import { credentialsManager as cm, guildInstanceManager as gim, localeManager as lm } from '../../index';
import { findTeamMembersByName } from '../structures/rustPlusTeamInfo';
import { ConnectionStatus, type RustPlusInstance } from '../managers/rustPlusManager';

const transfers = new WeakSet<RustPlusInstance>();

function resolveMember(team: AppTeamInfo, query: string) {
    const text = query.trim().toLowerCase();
    if (!text) return [];
    if (/^\d{17}$/.test(text)) return team.members.filter(member => member.steamId === text);
    return findTeamMembersByName(team, text);
}

export async function transferLeader(instance: RustPlusInstance, query: string, callerSteamId?: string) {
    const { guildId, serverId, sessionId } = instance;
    const guild = gim.getGuildInstance(guildId);
    const server = guild?.serverInfoMap[serverId];
    const reply = (key: string, name = '', ok = false) => ({
        ok, text: lm.getIntl(guild?.generalSettings.language ?? null, key, { name })
    });
    if (!guild || !server?.active || instance.connectionStatus !== ConnectionStatus.Connected) {
        return reply('leaderOffline');
    }
    if (!guild.generalSettings.leaderCommandEnabled) return reply('leaderDisabled');
    if (transfers.has(instance)) return reply('leaderBusy');
    const requester = server.requesterSteamId;
    const paired = (id: string) => {
        const p = guild.pairingDataMap[serverId]?.[id];
        return p?.valid && p.steamId === id && cm.getCredentials(id) ? p : undefined;
    };
    const readPair = requester && paired(requester);
    if (!readPair || (instance.connectedRelayAccount && instance.connectedRelayAccount !== requester)) {
        return reply('leaderOffline');
    }
    const valid = () => {
        const current = gim.getGuildInstance(guildId);
        const selected = current?.serverInfoMap[serverId];
        return instance.sessionId === sessionId && instance.connectionStatus === ConnectionStatus.Connected &&
            current === guild && selected?.active && selected.requesterSteamId === requester &&
            paired(requester) === readPair;
    };
    let temporary: RustPlus | undefined;
    let submitted = false;
    transfers.add(instance);
    try {
        const read = async () => {
            const response = await instance.rustPlus.getTeamInfoAsync(requester, readPair.playerToken);
            return isValidAppResponse(response) && !response.error ? response.teamInfo : undefined;
        };
        const team = await read();
        if (!valid() || !team) return reply('leaderOffline');
        const memberIds = new Set(team.members.map(m => m.steamId));
        if (callerSteamId && !memberIds.has(callerSteamId)) return reply('leaderCallerNotTeam');
        const matches = resolveMember(team, query);
        if (matches.length !== 1) return reply(matches.length ? 'leaderAmbiguous' : 'leaderNoMember');
        const target = matches[0], leader = team.leaderSteamId;
        if (target.steamId === leader) return reply('leaderAlreadyLeader', target.name);
        const leaderPair = paired(leader);
        if (!memberIds.has(leader) || !leaderPair) return reply('leaderNotPaired');
        const permitted = () => guild.generalSettings.leaderCommandEnabled &&
            (!guild.generalSettings.leaderCommandOnlyPaired || !!paired(target.steamId));
        if (!permitted()) return reply('leaderPairRequired');
        let client = instance.rustPlus;
        if (instance.connectedRelayAccount && instance.connectedRelayAccount !== leader) {
            const authToken = cm.getCredentials(leader)?.rustplusAuthToken;
            if (!server.relayServerId || !authToken) return reply('leaderNotPaired');
            temporary = new RustPlus(server.ip, server.port);
            client = temporary;
            client.on('error', () => { /* Handshake errors reject once(); requests report transport failures. */ });
            await Promise.all([once(client, 'connected', { signal: AbortSignal.timeout(6000) }),
                client.connect({ serverId: server.relayServerId, steamId: leader, authToken })]);
            const check = await client.getTeamInfoAsync(leader, leaderPair.playerToken, false, 5000);
            if (!isValidAppResponse(check) || check.error || check.teamInfo?.leaderSteamId !== leader ||
                !check.teamInfo.members.some(m => m.steamId === target.steamId) ||
                (callerSteamId && !check.teamInfo.members.some(m => m.steamId === callerSteamId))) {
                return reply('leaderChanged');
            }
        }
        if (!valid() || paired(leader) !== leaderPair || !permitted()) return reply('leaderChanged');
        submitted = true;
        const result = await client.promoteToLeaderAsync(leader, leaderPair.playerToken, target.steamId, false, 5000);
        if (isValidAppResponse(result) && result.error) return reply('leaderRejected');
        if (!valid()) return reply('leaderUnconfirmed');
        // A lost acknowledgement may follow a successful write. Read back and never replay a promotion.
        const after = await read();
        if (valid() && after?.leaderSteamId === target.steamId) return reply('leaderTransferred', target.name, true);
        return reply('leaderUnconfirmed');
    } catch {
        return reply(submitted ? 'leaderUnconfirmed' : 'leaderOffline');
    } finally {
        try { await temporary?.disconnect(); } finally { transfers.delete(instance); }
    }
}
