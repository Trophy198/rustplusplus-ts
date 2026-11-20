import { isValidAppResponse, type AppInfo, type AppTeamInfo } from 'rustplus-ts';
import { guildInstanceManager as gim } from '../../index';
import { ConnectionStatus, type RustPlusInstance } from '../managers/rustPlusManager';

type Snapshot = { team?: AppTeamInfo; info?: AppInfo };
const snapshots = new WeakMap<RustPlusInstance, {
    session: number; requester: string; token: number; expires: number;
    team: Promise<AppTeamInfo | undefined>; info?: Promise<AppInfo | undefined>
}>();

export async function rustRoster(instance: RustPlusInstance | null, includePopulation = true): Promise<Snapshot> {
    if (!instance || instance.connectionStatus !== ConnectionStatus.Connected) return {};
    const { guildId, serverId, sessionId } = instance;
    const guild = gim.getGuildInstance(guildId);
    const server = guild?.serverInfoMap[serverId];
    const requester = server?.requesterSteamId;
    const pair = requester ? guild?.pairingDataMap[serverId]?.[requester] : undefined;
    if (!server?.active || !requester || !pair?.valid ||
        (instance.connectedRelayAccount && instance.connectedRelayAccount !== requester)) return {};
    if (instance.lastServerPollSuccessful && instance.rpTeamInfo && (!includePopulation || instance.rpInfo)) {
        return { team: instance.rpTeamInfo.appTeamInfo, info: instance.rpInfo?.appInfo };
    }
    // A slow or unavailable map can delay normal polling even when team and population reads work.
    const now = Date.now();
    let snapshot = snapshots.get(instance);
    if (!snapshot || snapshot.session !== sessionId || snapshot.requester !== requester ||
        snapshot.token !== pair.playerToken || snapshot.expires <= now) {
        const team = instance.rustPlus.getTeamInfoAsync(requester, pair.playerToken, false, 5000)
            .then(r => isValidAppResponse(r) && !r.error ? r.teamInfo : undefined, () => undefined);
        snapshot = { session: sessionId, requester, token: pair.playerToken, expires: now + 10000, team };
        snapshots.set(instance, snapshot);
    }
    if (includePopulation) {
        snapshot.info ??= instance.rustPlus.getInfoAsync(requester, pair.playerToken, false, 5000)
            .then(r => isValidAppResponse(r) && !r.error ? r.info : undefined, () => undefined);
    }
    const [team, info] = await Promise.all([snapshot.team, includePopulation ? snapshot.info : undefined]);
    const current = gim.getGuildInstance(guildId);
    return instance.sessionId === sessionId && instance.connectionStatus === ConnectionStatus.Connected &&
        current?.serverInfoMap[serverId]?.active && current.serverInfoMap[serverId].requesterSteamId === requester &&
        current.pairingDataMap[serverId]?.[requester]?.valid &&
        current.pairingDataMap[serverId][requester].playerToken === snapshot.token ? { team, info } : {};
}
