import { randomBytes } from 'node:crypto';
import { guildInstanceManager as gim, rustPlusManager as rpm, log } from '../../index';
import type { DiscordManager } from '../managers/discordManager';
import type { GuildInstance } from '../managers/guildInstanceManager';
import * as messages from '../discordUtils/discordMessages';

export interface AlarmSignal {
    source: string; // Steam ID of the FCM receiver, or "socket".
    deliveryId?: string;
    messageId?: string;
    time: number; // FCM send time or local time of a WebSocket rising edge, in milliseconds.
    since?: number; // Earliest possible edge for an OFF to ON change discovered after an outage.
    entityId?: string;
    candidates: string[];
    title: string;
    message: string;
}

interface AlarmDelivery {
    serverId: string;
    time: number;
    since?: number;
    entityId?: string;
    candidates: string[];
    pushText?: string;
    receipts: Map<string, { deliveryId?: string; messageId?: string; time: number }>;
    nonce: string;
    pending?: Promise<void>;
    delivered: boolean;
    recorded: boolean;
}

// No upstream event ID is shared by Rust+ broadcasts and individual FCM subscriptions.
// Pair at most one observation per source per occurrence. Keep history across socket/FCM reconnects.
const histories = new WeakMap<GuildInstance, AlarmDelivery[]>();
const FANOUT_SKEW_MS = 2000;
const HISTORY_LIMIT = 512;

function findDelivery(history: AlarmDelivery[], serverId: string, signal: AlarmSignal, text?: string) {
    if (signal.deliveryId || signal.messageId) {
        const replay = history.find(entry => {
            const receipt = entry.receipts.get(signal.source);
            if (!receipt || entry.serverId !== serverId) return false;
            return (!!signal.deliveryId && receipt.deliveryId === signal.deliveryId) ||
                (!!signal.messageId && receipt.messageId === signal.messageId && receipt.time === signal.time &&
                    entry.pushText === text && (!signal.entityId || signal.entityId === entry.entityId));
        });
        if (replay) return replay;
    }
    return history.find(entry => {
        if (entry.serverId !== serverId || entry.receipts.has(signal.source) ||
            signal.time < (entry.since ?? entry.time) - FANOUT_SKEW_MS ||
            (signal.since ?? signal.time) > entry.time + FANOUT_SKEW_MS) return false;
        if (text && entry.pushText && text !== entry.pushText) return false;
        if (entry.entityId && signal.entityId) return entry.entityId === signal.entityId;
        // Anonymous pushes may come from different circuits with identical in-game text.
        // Only correlate them across accounts when there is one common device or a shared message identity.
        if (entry.candidates.length === 1 && signal.candidates.length === 1) {
            return entry.candidates[0] === signal.candidates[0];
        }
        return !!signal.messageId && text === entry.pushText && [...entry.receipts.values()].some(receipt =>
            receipt.messageId === signal.messageId && receipt.time === signal.time);
    });
}

export async function deliverSmartAlarm(dm: DiscordManager, guildId: string, serverId: string, signal: AlarmSignal) {
    const guild = gim.getGuildInstance(guildId);
    const server = guild?.serverInfoMap[serverId];
    if (!guild || !server) return;
    const history = histories.get(guild) ?? [];
    histories.set(guild, history);
    const text = signal.source === 'socket' ? undefined : JSON.stringify([signal.title, signal.message]);
    let entry = findDelivery(history, serverId, signal, text);
    if (!entry) {
        entry = { serverId, time: signal.time, since: signal.since, entityId: signal.entityId,
            candidates: signal.candidates,
            receipts: new Map(), nonce: randomBytes(12).toString('hex'), delivered: false, recorded: false };
        history.push(entry);
    } else if (signal.candidates.length && entry.candidates.length) {
        entry.candidates = entry.candidates.filter(id => signal.candidates.includes(id));
    }
    if (entry.since !== undefined && signal.since === undefined) {
        entry.time = signal.time;
        entry.since = undefined;
    }
    const { deliveryId, messageId, time } = signal;
    entry.receipts.set(signal.source, { deliveryId, messageId, time });
    entry.entityId ??= signal.entityId;
    entry.pushText ??= text;
    const device = entry.entityId ? server.smartAlarmConfigMap[entry.entityId] : undefined;

    if (!entry.delivered) {
        // Reserve before Discord I/O. A failed send can retry with the same Discord nonce.
        const delivery = entry;
        delivery.pending ??= (async () => {
            const everyone = device?.everyone ?? guild.generalSettings.fcmAlarmNotifyEveryone;
            for (let attempt = 0; attempt < 2; attempt++) {
                const sent = await messages.sendSmartAlarmNotification(dm, guildId, serverId,
                    signal.title, signal.message, everyone, delivery.nonce);
                if (sent) {
                    delivery.delivered = true;
                    return;
                }
            }
            log.warn('Smart alarm delivery to Discord failed.', { guildId, serverId });
        })().finally(() => {
            delivery.pending = undefined;
            while (history.length > HISTORY_LIMIT) {
                const oldest = history.findIndex(item => !item.pending);
                if (oldest < 0) break;
                history.splice(oldest, 1);
            }
        });
        await delivery.pending;
    }
    if (!entry.delivered || !device || entry.recorded ||
        gim.getGuildInstance(guildId)?.serverInfoMap[serverId]?.smartAlarmConfigMap[device.entityId] !== device) return;
    entry.recorded = true;
    device.lastTrigger = Math.max(device.lastTrigger ?? 0, Math.floor(entry.time / 1000));
    gim.updateGuildInstance(guildId);
    if (device.inGame) rpm.getInstance(guildId, serverId)?.inGameTeamChatQueueMessage(
        `${device.name}: ${device.message}`);
    if (server.active && signal.source !== 'socket') {
        await messages.sendSmartAlarmMessage(dm, guildId, serverId, device.entityId);
    }
}
