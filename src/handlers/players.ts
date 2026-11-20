import { escapeMarkdown } from 'discord.js';
import { isValidAppResponse, type AppInfo, type AppTeamInfo } from 'rustplus-ts';
import { guildInstanceManager as gim, localeManager as lm } from '../../index';
import { getBattleMetricsRoster } from '../api/battlemetrics';
import type { Languages } from '../managers/LocaleManager';
import { ConnectionStatus, type RustPlusInstance } from '../managers/rustPlusManager';

export type PlayerStatus = 'online' | 'offline' | 'any';

interface Query {
    name?: string;
    playerId?: string;
    status: PlayerStatus;
}

type Snapshot = { team?: AppTeamInfo; info?: AppInfo };
const snapshots = new WeakMap<RustPlusInstance, {
    session: number; requester: string; token: number; expires: number; result: Promise<Snapshot>
}>();

async function rustRoster(instance: RustPlusInstance | null): Promise<Snapshot> {
    if (!instance || instance.connectionStatus !== ConnectionStatus.Connected) return {};
    const { guildId, serverId, sessionId } = instance;
    const guild = gim.getGuildInstance(guildId);
    const server = guild?.serverInfoMap[serverId];
    const requester = server?.requesterSteamId;
    const pair = requester ? guild?.pairingDataMap[serverId]?.[requester] : undefined;
    if (!server?.active || !requester || !pair?.valid ||
        (instance.connectedRelayAccount && instance.connectedRelayAccount !== requester)) return {};
    if (instance.lastServerPollSuccessful && instance.rpTeamInfo && instance.rpInfo) {
        return { team: instance.rpTeamInfo.appTeamInfo, info: instance.rpInfo.appInfo };
    }
    // A slow or unavailable map can delay normal polling even when team and population reads work.
    const now = Date.now();
    let snapshot = snapshots.get(instance);
    if (!snapshot || snapshot.session !== sessionId || snapshot.requester !== requester ||
        snapshot.token !== pair.playerToken || snapshot.expires <= now) {
        const result = Promise.allSettled([
            instance.rustPlus.getTeamInfoAsync(requester, pair.playerToken, false, 5000),
            instance.rustPlus.getInfoAsync(requester, pair.playerToken, false, 5000)
        ]).then(([team, info]) => ({
            team: team.status === 'fulfilled' && isValidAppResponse(team.value) && !team.value.error ?
                team.value.teamInfo : undefined,
            info: info.status === 'fulfilled' && isValidAppResponse(info.value) && !info.value.error ?
                info.value.info : undefined
        }));
        snapshot = { session: sessionId, requester, token: pair.playerToken, expires: now + 10000, result };
        snapshots.set(instance, snapshot);
    }
    const result = await snapshot.result;
    const current = gim.getGuildInstance(guildId);
    return instance.sessionId === sessionId && instance.connectionStatus === ConnectionStatus.Connected &&
        current?.serverInfoMap[serverId]?.active && current.serverInfoMap[serverId].requesterSteamId === requester &&
        current.pairingDataMap[serverId]?.[requester]?.valid &&
        current.pairingDataMap[serverId][requester].playerToken === snapshot.token ? result : {};
}

export async function lookupPlayers(language: Languages, instance: RustPlusInstance | null, bmId: string | null,
    query: Query, compactLimit?: number) {
    const t = (key: string) => lm.getIntl(language, 'players_' + key);
    const clean = (name: string) => {
        const plain = name.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/[\p{C}\s]+/gu, ' ').trim();
        return compactLimit ? plain.slice(0, 64) : escapeMarkdown(plain.slice(0, 80));
    };
    const find = (name: string) => name.normalize('NFKC').toLowerCase();
    const needle = find(query.name?.trim() ?? '');
    const lines: string[] = [];
    // Keep room for population, source notices and both online/offline sections in a Discord reply.
    const limit = compactLimit ?? 760;
    function section(label: string, names: string[]) {
        let line = label + ' · ';
        names.sort((a, b) => a.localeCompare(b, language));
        if (!names.length) line += t('noMatch');
        for (let i = 0; i < names.length; i++) {
            const part = (i ? ', ' : '') + names[i];
            const remaining = names.length - i - 1;
            const suffix = remaining ? ' … +' + remaining : '';
            if (line.length + part.length + suffix.length > limit) {
                line += '… +' + (remaining + 1);
                break;
            }
            line += part;
        }
        lines.push(line);
    }

    const bm = bmId && (query.status !== 'offline' || query.playerId) ? await getBattleMetricsRoster(bmId) : null;
    const { team, info } = query.playerId ? {} : await rustRoster(instance);
    if (info) {
        lines.push(lm.getIntl(language, 'populationPlayers', { current: String(info.players),
            max: String(info.maxPlayers) }));
    }
    let available = false;
    let noPublicMatch = false;
    if (bm?.kind === 'ok') {
        available = true;
        if (!compactLimit) lines.push(clean(bm.server) + ' · BattleMetrics #' + bmId);
        const matches = bm.players.filter(p => query.playerId ? p.id === query.playerId :
            find(p.name).includes(needle));
        noPublicMatch = !!needle && !matches.length;
        section(t('bmOnline'), matches.map(p => compactLimit ? clean(p.name) : clean(p.name) + ' (#' + p.id + ')'));
    } else if (bm) {
        lines.push(t(bm.kind));
    } else if (query.playerId) {
        lines.push(t('noMapping'));
    }

    if (!query.playerId) {
        const showTeamOnline = query.status !== 'offline' && (bm?.kind !== 'ok' || (team && noPublicMatch));
        if (showTeamOnline || query.status !== 'online') {
            if (team) {
                available = true;
                const members = team.members.filter(m => find(m.name).includes(needle));
                if (showTeamOnline) section(t('teamOnline'), members.filter(m => m.isOnline).map(m => clean(m.name)));
                if (query.status !== 'online') {
                    section(t('teamOffline'), members.filter(m => !m.isOnline).map(m => clean(m.name)));
                }
            } else {
                lines.push(t('noTeam'));
            }
        }
    }
    return { ok: available, lines: lines.map(line => line.length > limit ? line.slice(0, limit - 1) + '…' : line) };
}
