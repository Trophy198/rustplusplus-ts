import * as rp from 'rustplus-ts';

import { config, discordManager as dm, guildInstanceManager as gim, log } from '../../index';
import { sendStorageMonitorMessage } from '../discordUtils/discordMessages';
import { PairingData, StorageMonitorConfigType } from '../managers/guildInstanceManager';
import type { RustPlusInstance } from '../managers/rustPlusManager';
import * as constants from '../utils/constants';

const containerTypes = new Map([
    [constants.STORAGE_MONITOR_TOOL_CUPBOARD_CAPACITY, StorageMonitorConfigType.ToolCupboard],
    [constants.STORAGE_MONITOR_VENDING_MACHINE_CAPACITY, StorageMonitorConfigType.VendingMachine],
    [constants.STORAGE_MONITOR_LARGE_WOOD_BOX_CAPACITY, StorageMonitorConfigType.LargeWoodBox]
]);

interface Monitor {
    owner?: string;
    token?: number;
    revision: number;
    checkedAt: number;
    nextExpiry?: number;
    payload?: rp.AppEntityPayload;
    read?: Promise<void>;
    timer?: NodeJS.Timeout;
}

export class StorageMonitors {
    private monitors = new Map<string, Monitor>();

    constructor(private instance: RustPlusInstance, private pairing: (id: string) => PairingData | undefined) {}

    private current(id: string, monitor: Monitor) {
        const pairing = this.pairing(id);
        return this.monitors.get(id) === monitor && pairing?.steamId === monitor.owner &&
            pairing?.playerToken === monitor.token;
    }

    private getOrCreate(id: string) {
        const previous = this.monitors.get(id);
        if (previous && this.current(id, previous)) return previous;
        clearTimeout(previous?.timer);
        this.monitors.delete(id);
        const pairing = this.pairing(id);
        const monitor: Monitor = {
            owner: pairing?.steamId, token: pairing?.playerToken, revision: 0, checkedAt: 0
        };
        this.monitors.set(id, monitor);
        return monitor;
    }

    public clear() {
        for (const monitor of this.monitors.values()) clearTimeout(monitor.timer);
        this.monitors.clear();
    }

    public value(id: string) {
        const monitor = this.monitors.get(id);
        if (monitor && this.current(id, monitor)) return monitor.payload;
    }

    private card(id: string) {
        return sendStorageMonitorMessage(dm, this.instance.guildId, this.instance.serverId, id);
    }

    private async apply(id: string, monitor: Monitor, payload: rp.AppEntityPayload | undefined, force: boolean) {
        const { guildId, serverId } = this.instance;
        const device = gim.getGuildInstance(guildId)?.serverInfoMap[serverId]?.storageMonitorConfigMap[id];
        if (!device) return;
        if (payload && payload.capacity > 0) {
            const type = containerTypes.get(payload.capacity) ?? StorageMonitorConfigType.Unknown;
            if (device.type !== type) {
                device.type = type;
                gim.updateGuildInstance(guildId);
            }
        }
        const expiry = payload?.capacity === constants.STORAGE_MONITOR_TOOL_CUPBOARD_CAPACITY ?
            payload.protectionExpiry * 1000 : 0;
        const nextExpiry = expiry > Date.now() ? expiry : undefined;
        const same = nextExpiry === monitor.nextExpiry && rp.AppEntityPayload.equals(monitor.payload, payload);
        monitor.nextExpiry = nextExpiry;
        monitor.payload = payload;
        if (force || !same || !device.messageId) await this.card(id);
    }

    public async refresh(id: string, forceCard = true) {
        const monitor = this.getOrCreate(id);
        const { owner, token } = monitor;
        if (!owner || token === undefined) return this.card(id);
        if (monitor.read) return monitor.read;
        const revision = monitor.revision;
        const read = (async () => {
            const reply = await this.instance.rustPlus.getEntityInfoAsync(owner, token, id);
            if (!this.current(id, monitor) || revision !== monitor.revision) return;
            const info = rp.isValidAppResponse(reply) && !reply.error ? reply.entityInfo : undefined;
            monitor.checkedAt = Date.now();
            await this.apply(id, monitor, info?.type === rp.AppEntityType.StorageMonitor ? info.payload : undefined,
                forceCard);
        })();
        monitor.read = read;
        try {
            await read;
        } finally {
            monitor.read = undefined;
        }
    }

    public async changed(id: string, payload: rp.AppEntityPayload) {
        const monitor = this.getOrCreate(id);
        if (!monitor.owner) return;
        ++monitor.revision;
        const isTC = payload.capacity === constants.STORAGE_MONITOR_TOOL_CUPBOARD_CAPACITY;
        if (!payload.value && payload.capacity > 0 && !isTC) {
            clearTimeout(monitor.timer);
            monitor.timer = undefined;
            await this.apply(id, monitor, payload, false);
            return;
        }

        // Pulses may contain no inventory. TC protection updates can trail the inventory broadcast.
        if (monitor.timer) return;
        const timer = setTimeout(async () => {
            try {
                await monitor.read;
                if (!this.current(id, monitor) || monitor.timer !== timer) return;
                monitor.timer = undefined;
                await this.refresh(id, false);
            } catch (error) {
                if (monitor.timer === timer) monitor.timer = undefined;
                log.warn(`Storage monitor ${id} refresh failed: ${error}`);
            }
        }, 2000);
        monitor.timer = timer;
        timer.unref();
    }

    public async poll() {
        // Bound repair and periodic reconciliation to one request per poll across the whole server.
        const now = Date.now();
        const interval = config.general.serverPollingHandlerIntervalMs * 30;
        let oldest: [string, Monitor] | undefined;
        const { guildId, serverId } = this.instance;
        const devices = gim.getGuildInstance(guildId)?.serverInfoMap[serverId]?.storageMonitorConfigMap;
        for (const entry of this.monitors) {
            const [id, monitor] = entry;
            if (!devices?.[id]) {
                clearTimeout(monitor.timer);
                this.monitors.delete(id);
                continue;
            }
            if (!this.current(id, monitor)) return this.refresh(id);
            if (!monitor.owner || monitor.read || monitor.timer) continue;
            const expiryDue = monitor.nextExpiry !== undefined && now >= monitor.nextExpiry;
            if (monitor.payload && !expiryDue && now - monitor.checkedAt < interval) continue;
            if (!oldest || monitor.checkedAt < oldest[1].checkedAt) oldest = entry;
        }
        if (oldest) await this.refresh(oldest[0], false);
    }
}
