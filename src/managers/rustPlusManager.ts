/*
    Copyright (C) 2025 Alexander Emanuelsson (alexemanuelol)

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.

    https://github.com/alexemanuelol/rustplusplus

*/

import * as discordjs from 'discord.js';
import * as rp from 'rustplus-ts';
import * as fs from 'fs';
import * as path from 'path';
import { moduleExtension } from '../utils/runtimePaths';
import * as winston from 'winston';

import {
    log, discordManager as dm, guildInstanceManager as gim, credentialsManager as cm, config, localeManager as lm
} from '../../index';
import * as constants from '../utils/constants';
import * as types from '../utils/types';
import {
    GuildInstance, EventNotificationSettings, ServerInfo
} from './guildInstanceManager';
import { sendServerMessage } from '../discordUtils/discordMessages';
import { StorageMonitors } from '../handlers/storageMonitorHandler';
import { deliverSmartAlarm } from '../handlers/smartAlarmHandler';
import * as rpTeamInfoHandler from '../handlers/rustPlusTeamInfoHandler';
import * as rpInfoHandler from '../handlers/rustPlusInfoHandler';
import * as rpTimeHandler from '../handlers/rustPlusTimeHandler';
import { RustPlusInfo } from '../structures/rustPlusInfo';
import { RustPlusTime } from '../structures/rustPlusTime';
import { RustPlusMap } from '../structures/rustPlusMap';
import { RustPlusMapMarkers } from '../structures/rustPlusMapMarkers';
import { RustPlusTeamInfo } from '../structures/rustPlusTeamInfo';
import * as discordMessages from '../discordUtils/discordMessages';
import * as discordVoice from '../discordUtils/discordVoice';
import * as Timer from '../utils/timer';
import * as informationChannelHandler from '../handlers/informationChannelHandler';
import { getPos, getPosString } from '../utils/map';
import { DockingStatus } from '../structures/rustPlusMapMarkers';


export type RustPlusInstanceMap = { [guildId: types.GuildId]: RustPlusServerMap };
export type RustPlusServerMap = { [serverId: types.ServerId]: RustPlusInstance };

export enum ConnectionStatus {
    Disconnected = 0,
    Connecting = 1,
    Connected = 2,
    Reconnecting = 3
}

export interface RustPlusConnectionMetaData {
    time: string;
    str: string;
}

export interface RustPlusDeathMetaData {
    time: string;
    name: string;
    location: string | null;
}

export interface TimersMetaData {
    index: number;
    timer: Timer.Timer;
    message: string;
}

export class RustPlusManager {
    private rustPlusInstanceMap: RustPlusInstanceMap;

    constructor() {
        this.rustPlusInstanceMap = {};
    }

    public hasInstance(guildId: types.GuildId, serverId: types.ServerId): boolean {
        if (Object.hasOwn(this.rustPlusInstanceMap, guildId) &&
            Object.hasOwn(this.rustPlusInstanceMap[guildId], serverId)) {
            return true;
        }

        return false;
    }

    public addInstance(guildId: types.GuildId, serverId: types.ServerId): boolean {
        if (!Object.hasOwn(this.rustPlusInstanceMap, guildId)) {
            this.rustPlusInstanceMap[guildId] = {};
        }

        if (this.hasInstance(guildId, serverId)) {
            log.warn(`Instance already exist.`, { guildId: guildId, serverId: serverId });
            return false;
        }

        this.rustPlusInstanceMap[guildId][serverId] = new RustPlusInstance(guildId, serverId);
        return true;
    }

    public removeInstance(guildId: types.GuildId, serverId: types.ServerId): boolean {
        if (!this.hasInstance(guildId, serverId)) {
            log.warn(`Instance does not exist.`, { guildId: guildId, serverId: serverId });
            return false;
        }

        this.rustPlusInstanceMap[guildId][serverId].shutdown();
        delete this.rustPlusInstanceMap[guildId][serverId];
        if (!Object.keys(this.rustPlusInstanceMap[guildId]).length) delete this.rustPlusInstanceMap[guildId];
        return true;
    }

    public getInstance(guildId: types.GuildId, serverId: types.ServerId): RustPlusInstance | null {
        return this.rustPlusInstanceMap[guildId]?.[serverId] ?? null;
    }
}

// TODO! Each rustplus instance have one main rpInstance and a main playerid/token
// - variable "available playerId/tokens to use for requests"
// - Save who made the last request
// - If teamChanged and player that made last request is not in same team and main playerid/token, then
//   the main playerid/token should regain last request status and update "available playerid/tokens"
// -
export class RustPlusInstance {
    private lg: winston.Logger;
    public guildId: types.GuildId;
    private relaySteamId?: string;
    private started = false;
    private starting?: Promise<void>;
    private generation = 0;
    public get sessionId() { return this.generation; }
    private pollVersion = 0;
    private switchStates = new Map<types.EntityId, { value: boolean }>();
    private switchRequests = new Map<types.EntityId, Promise<boolean>>();
    private alarmStates = new Map<types.EntityId, { version: number; value: boolean; disconnectedAt?: number }>();
    public readonly storageMonitors = new StorageMonitors(this,
        id => this.devicePairing(id, 'storageMonitorConfigMap'));
    private alarmRetries = new Set<types.EntityId>();
    private alarmReads = new Map<types.EntityId, { version: number; owner?: string; token?: number;
        done: Promise<void> }>();
    public serverId: types.ServerId;
    public serverName: string;

    public rustPlus: rp.RustPlus;
    public connectionStatus: ConnectionStatus;
    public reconnectTimeoutId: NodeJS.Timeout | undefined;
    public reconnectTimeoutSeconds: number;

    public serverPollingHandlerIntervalId: NodeJS.Timeout | undefined;
    public serverPollingHandlerIntervalSeconds: number;
    public lastServerPollSuccessful: boolean;
    public lastServerPollSuccessfulTimestampSeconds: types.Timestamp | null;

    public inGameTeamChatQueue: string[];
    public inGameTeamChatTimeoutId: NodeJS.Timeout | undefined;
    public inGameTeamChatMessagesSentByBot: string[];

    private commandNames: string[];

    public rpInfo: RustPlusInfo | null;
    public rpTime: RustPlusTime | null;
    public rpMap: RustPlusMap | null;
    public rpTeamInfo: RustPlusTeamInfo | null;
    public rpMapMarkers: RustPlusMapMarkers | null;

    public allConnections: RustPlusConnectionMetaData[];
    public playerConnections: { [steamId: types.SteamId]: RustPlusConnectionMetaData[] };
    public allDeaths: RustPlusDeathMetaData[];
    public playerDeaths: { [steamId: types.SteamId]: RustPlusDeathMetaData[] };

    public timers: { [index: number]: TimersMetaData };
    public informationChannelCounter: number;

    constructor(guildId: types.GuildId, serverId: types.ServerId) {
        this.guildId = guildId;
        this.serverId = serverId;

        this.lg = log.child({ guildId: guildId, serverId: this.serverId });

        const gInstance = gim.getGuildInstance(this.guildId) as GuildInstance;
        const server = gInstance.serverInfoMap[serverId];
        this.serverName = server.name;

        this.rustPlus = new rp.RustPlus(server.ip, server.port, false, log);
        this.connectionStatus = ConnectionStatus.Disconnected;
        this.reconnectTimeoutId = undefined;
        this.reconnectTimeoutSeconds = constants.DEFAULT_RECONNECT_TIMEOUT_SECONDS;

        this.serverPollingHandlerIntervalId = undefined;
        this.serverPollingHandlerIntervalSeconds = config.general.serverPollingHandlerIntervalMs / 1000;
        this.lastServerPollSuccessful = false;
        this.lastServerPollSuccessfulTimestampSeconds = null;

        this.inGameTeamChatQueue = [];
        this.inGameTeamChatTimeoutId = undefined;
        this.inGameTeamChatMessagesSentByBot = [];

        this.commandNames = this.getCommandNames();

        /* Latest request responses. */
        this.rpInfo = null;
        this.rpTime = null;
        this.rpMap = null;
        this.rpTeamInfo = null;
        this.rpMapMarkers = null;

        this.allConnections = [];
        this.playerConnections = {};
        this.allDeaths = [];
        this.playerDeaths = {};

        this.timers = {};
        this.informationChannelCounter = 0;

        //this.leaderSteamId = '0'; /* 0 When there is no leader. */
    }

    private getCommandNames(): string[] {
        return fs.readdirSync(path.join(__dirname, '..', 'prefixCommands'))
            .filter(file => file.endsWith(moduleExtension))
            .map(file => path.basename(file, moduleExtension));
    }

    public startup(): Promise<void> {
        if (this.starting) return this.starting;
        if (this.started) return Promise.resolve();
        this.started = true;
        const session = ++this.generation;
        this.stopReconnectionTimer();
        this.starting = this.openSession(session).finally(() => {
            if (session === this.sessionId) this.starting = undefined;
        });
        return this.starting;
    }

    private async openSession(session: number) {
        try {
            await this.loadRustPlusEvents(session);
            if (session !== this.sessionId) return;
            await this.connect();
        } catch (error) {
            if (session === this.sessionId) {
                this.lg.warn(`Rust+ connection failed: ${error}`);
                await this.scheduleReconnect();
            }
        }
    }

    private async connect() {
        const guild = gim.getGuildInstance(this.guildId) as GuildInstance;
        const server = guild.serverInfoMap[this.serverId];
        const steamId = server.requesterSteamId;
        const authToken = steamId ? cm.getCredentials(steamId)?.rustplusAuthToken : undefined;
        if (server.relayServerId && steamId && authToken) {
            this.relaySteamId = steamId;
            await this.rustPlus.connect({ serverId: server.relayServerId, steamId, authToken });
        } else if (server.ip && server.port) {
            this.relaySteamId = undefined;
            await this.rustPlus.connect();
        } else {
            this.lg.warn('Rust+ relay needs a requester with a Rust+ auth token. Update /credentials add.');
            await this.scheduleReconnect();
        }

        /* Wait for 'connected' event before updating server embed. */
    }

    public async shutdown() {
        this.connectionStatus = ConnectionStatus.Disconnected;
        await this.closeSession();
    }

    private closeSession() {
        ++this.generation;
        this.started = false;
        this.starting = undefined;
        this.switchStates.clear();
        this.switchRequests.clear();
        const disconnectedAt = Date.now();
        for (const state of this.alarmStates.values()) state.disconnectedAt ??= disconnectedAt;
        this.alarmReads.clear();
        this.alarmRetries.clear();
        this.rustPlus.removeAllListeners();
        this.clearAllData();
        return this.rustPlus.disconnect();
    }

    public async scheduleReconnect() {
        if (!this.started) return;
        const firstRetry = this.connectionStatus !== ConnectionStatus.Reconnecting;
        const closing = this.closeSession();
        this.connectionStatus = ConnectionStatus.Reconnecting;
        this.reconnectTimeoutSeconds = firstRetry ? constants.DEFAULT_RECONNECT_TIMEOUT_SECONDS :
            Math.min(this.reconnectTimeoutSeconds * 2, constants.MAX_RECONNECT_TIMEOUT_SECONDS);
        this.lg.info(`Reconnecting in ${this.reconnectTimeoutSeconds} seconds.`);
        this.startReconnectionTimer();
        if (firstRetry) {
            const server = gim.getGuildInstance(this.guildId)?.serverInfoMap[this.serverId];
            await Promise.all([
                sendServerMessage(dm, this.guildId, this.serverId, this.connectionStatus),
                ...Object.keys(server?.smartSwitchConfigMap ?? {}).map(id =>
                    discordMessages.sendSmartSwitchMessage(dm, this.guildId, this.serverId, id)),
                ...Object.keys(server?.smartAlarmConfigMap ?? {}).map(id =>
                    discordMessages.sendSmartAlarmMessage(dm, this.guildId, this.serverId, id)),
                ...Object.keys(server?.storageMonitorConfigMap ?? {}).map(id =>
                    discordMessages.sendStorageMonitorMessage(dm, this.guildId, this.serverId, id))
            ]);
        }
        await closing;
    }

    private async loadRustPlusEvents(session: number) {
        const rustPlusEventFilesPath = path.join(__dirname, '..', 'rustPlusEvents');
        const rustPlusEventFiles = fs.readdirSync(rustPlusEventFilesPath)
            .filter(file => file.endsWith(moduleExtension));

        for (const file of rustPlusEventFiles) {
            const filePath = path.join(rustPlusEventFilesPath, file);
            const { name, execute } = await import(filePath);
            if (session !== this.sessionId) return;

            this.rustPlus.on(name, (...args: unknown[]) => execute(this, ...args));
        }
    }

    private clearAllData() {
        this.stopReconnectionTimer();
        this.stopServerPollingHandler();
        this.lastServerPollSuccessful = false;

        this.inGameTeamChatQueue = [];
        clearTimeout(this.inGameTeamChatTimeoutId);
        this.inGameTeamChatTimeoutId = undefined;
        this.inGameTeamChatMessagesSentByBot = [];

        this.rpInfo = null;
        this.rpTime = null;
        this.rpMap = null;
        this.rpTeamInfo = null;
        this.rpMapMarkers?.stopTimers();
        this.rpMapMarkers = null;

        for (const timer of Object.values(this.timers)) {
            timer.timer.stop();
        }
        this.timers = {};
    }

    public startReconnectionTimer() {
        if (this.reconnectTimeoutId !== undefined) {
            this.stopReconnectionTimer();
        }

        this.lg.info(`Start Reconnection Timer.`);

        this.reconnectTimeoutId = setTimeout(() => {
            this.reconnectTimeoutId = undefined;
            void this.startup();
        }, this.reconnectTimeoutSeconds * 1000);
    }

    public stopReconnectionTimer() {
        this.lg.info(`Stop Reconnection Timer.`);

        clearTimeout(this.reconnectTimeoutId);
        this.reconnectTimeoutId = undefined;
    }

    public startServerPollingHandler(initialInfo?: rp.AppInfo) {
        if (this.serverPollingHandlerIntervalId !== undefined) return;
        const version = this.pollVersion;
        let inFlight = false;
        const run = async (info?: rp.AppInfo) => {
            if (inFlight || version !== this.pollVersion) return;
            inFlight = true;
            try {
                await this.serverPolling(version, info);
            } catch (error) {
                if (version === this.pollVersion) {
                    this.lastServerPollSuccessful = false;
                    this.lg.error(`Server polling failed: ${error}`);
                }
            } finally {
                inFlight = false;
            }
        };
        const intervalMs = this.serverPollingHandlerIntervalSeconds * 1000;
        this.serverPollingHandlerIntervalId = setInterval(() => void run(), intervalMs);
        void run(initialInfo);
    }

    public stopServerPollingHandler() {
        ++this.pollVersion;
        this.storageMonitors.clear();
        clearInterval(this.serverPollingHandlerIntervalId);
        this.serverPollingHandlerIntervalId = undefined;
    }

    private async serverPolling(version: number, initialInfo?: rp.AppInfo) {
        await this.storageMonitors.poll();
        if (version !== this.pollVersion) return;
        // Retry one failed device subscription per poll without creating another timer or re-reading healthy alarms.
        const retry = this.alarmRetries.values().next();
        if (!retry.done) {
            this.alarmRetries.delete(retry.value);
            await this.refreshSmartAlarm(retry.value);
            if (version !== this.pollVersion) return;
        }
        const gInstance = gim.getGuildInstance(this.guildId) as GuildInstance;
        const server = gInstance.serverInfoMap[this.serverId];
        const requesterSteamId = server.requesterSteamId;
        if (requesterSteamId === null) return;

        const pairingData = gInstance.pairingDataMap[this.serverId]?.[requesterSteamId] ?? null;
        if (!pairingData) {
            this.lastServerPollSuccessful = false;
            this.lg.warn(`pairingData for ${requesterSteamId} could not be found.`);
            return;
        }

        const { steamId, playerToken } = pairingData;
        const info = initialInfo ?? await this.pollResponse('info',
            this.rustPlus.getInfoAsync(steamId, playerToken), version);
        if (!info || version !== this.pollVersion) return;
        const time = await this.pollResponse('time', this.rustPlus.getTimeAsync(steamId, playerToken), version);
        if (!time || version !== this.pollVersion) return;
        const teamInfo = await this.pollResponse('teamInfo',
            this.rustPlus.getTeamInfoAsync(steamId, playerToken), version);
        if (!teamInfo || version !== this.pollVersion) return;
        const mapMarkers = await this.pollResponse('mapMarkers',
            this.rustPlus.getMapMarkersAsync(steamId, playerToken), version);
        if (!mapMarkers || version !== this.pollVersion) return;

        this.lastServerPollSuccessful = true;
        this.lastServerPollSuccessfulTimestampSeconds = Math.floor(Date.now() / 1000);

        this.rpInfo ??= new RustPlusInfo(this, info);
        this.rpTime ??= new RustPlusTime(this, time);
        this.rpMapMarkers ??= new RustPlusMapMarkers(this, mapMarkers);
        if (!this.rpTeamInfo) {
            this.rpTeamInfo = new RustPlusTeamInfo(this, teamInfo);
        } else {
            await rpTeamInfoHandler.handler(this, teamInfo, () => version === this.pollVersion);
            if (version !== this.pollVersion) return;
            this.rpTeamInfo.updateTeamInfo(teamInfo);
        }

        // TODO! timeHandler
        await rpInfoHandler.handler(this, info);
        if (version !== this.pollVersion) return;
        await rpTimeHandler.handler(this, time);
        if (version !== this.pollVersion) return;

        (this.rpInfo as RustPlusInfo).updateInfo(info);
        (this.rpTime as RustPlusTime).updateTime(time);
        (this.rpMapMarkers as RustPlusMapMarkers).updateMapMarkers(mapMarkers);

        // TODO! informationChannelHandler
        await informationChannelHandler.handler(this, () => version === this.pollVersion);
    }

    public inGameTeamChatQueueMessage(message: string | string[]) {
        const gInstance = gim.getGuildInstance(this.guildId) as GuildInstance;
        const inGameChatMessageDelayMs = gInstance.generalSettings.inGameChatMessageDelay * 1000;
        const trademark = gInstance.generalSettings.inGameChatTrademark;
        const trademarkString = trademark === '' ? '' : `${trademark} | `;
        const messageMaxLength = constants.MAX_LENGTH_TEAM_MESSAGE - trademarkString.length;

        if (!gInstance.generalSettings.inGameChatBotUnmuted ||
            !gInstance.generalSettings.inGameChatFunctionalityEnabled) return;

        const messages = Array.isArray(message) ? message : [message];
        for (const msg of messages) {
            const strings = msg.match(new RegExp(`.{1,${messageMaxLength}}(\\s|$)`, 'g')) as string[];

            for (const str of strings) {
                this.inGameTeamChatQueue.push(`${trademarkString}${str}`);
            }
        }

        if (this.inGameTeamChatTimeoutId === undefined) {
            this.inGameTeamChatTimeoutId = setTimeout(this.inGameTeamChatMessageQueueHandler.bind(this),
                inGameChatMessageDelayMs);
        }
    }

    private inGameTeamChatMessageQueueHandler() {
        const gInstance = gim.getGuildInstance(this.guildId) as GuildInstance;
        const server = gInstance.serverInfoMap[this.serverId];
        const requesterSteamId = server.requesterSteamId;

        clearTimeout(this.inGameTeamChatTimeoutId);
        this.inGameTeamChatTimeoutId = undefined;

        if (this.inGameTeamChatQueue.length === 0) return;

        const message = this.inGameTeamChatQueue[0];
        this.inGameTeamChatQueue = this.inGameTeamChatQueue.slice(1);

        if (requesterSteamId === null) return;

        const pairingData = gInstance.pairingDataMap[this.serverId]?.[requesterSteamId] ?? null;
        if (!pairingData) {
            this.lg.warn(`pairingData for ${requesterSteamId} could not be found.`);
            return;
        }

        this.inGameTeamChatAddMessageToSentByBot(message);
        this.rustPlus.sendTeamMessageAsync(pairingData.steamId, pairingData.playerToken, message);
        this.lg.info(`Message sent in-game: '${message}'.`);

        this.inGameTeamChatResetMessageQueueTimeout();
    }

    public inGameTeamChatResetMessageQueueTimeout() {
        const gInstance = gim.getGuildInstance(this.guildId) as GuildInstance;
        const inGameChatMessageDelayMs = gInstance.generalSettings.inGameChatMessageDelay * 1000;

        clearTimeout(this.inGameTeamChatTimeoutId);
        this.inGameTeamChatTimeoutId = undefined;
        if (this.inGameTeamChatQueue.length !== 0) {
            this.inGameTeamChatTimeoutId = setTimeout(this.inGameTeamChatMessageQueueHandler.bind(this),
                inGameChatMessageDelayMs);
        }
    }

    public inGameTeamChatAddMessageToSentByBot(message: string) {
        if (this.inGameTeamChatMessagesSentByBot.length === constants.BOT_MESSAGE_HISTORY_LIMIT) {
            this.inGameTeamChatMessagesSentByBot.pop();
        }
        this.inGameTeamChatMessagesSentByBot.unshift(message);
    }

    public async prefixCommandHandler(message: rp.AppTeamMessage | discordjs.Message, inGame: boolean):
        Promise<boolean> {
        const gInstance = gim.getGuildInstance(this.guildId) as GuildInstance;
        const language = gInstance.generalSettings.language;
        const commandPrefix = gInstance.generalSettings.inGameChatCommandPrefix;

        const messageString = inGame ? (message as rp.AppTeamMessage).message :
            (message as discordjs.Message).cleanContent;

        const match = messageString.match(/^\S+\s?/);
        const baseCommandStartRaw = match ? match[0] : null;
        if (!baseCommandStartRaw || !baseCommandStartRaw.startsWith(`${commandPrefix}`)) return false;
        const baseCommandNameRaw = baseCommandStartRaw.slice(commandPrefix.length).trim();

        let aliasResolvedCommandName = baseCommandNameRaw;
        for (const alias of gInstance.aliases) {
            if (aliasResolvedCommandName === alias.alias) {
                aliasResolvedCommandName = alias.value;
                break;
            }
        }

        let command = this.commandNames.find(command => aliasResolvedCommandName === `${command}`);
        if (!command) {
            const commandNamesCurrentLocale = Object.fromEntries(
                this.commandNames.map(commandName => {
                    return [lm.getIntl(language, `prefixCommand-${commandName}`), commandName];
                })
            );

            if (!(aliasResolvedCommandName in commandNamesCurrentLocale)) return false;

            command = commandNamesCurrentLocale[aliasResolvedCommandName];
        }

        const commandPath = path.join(__dirname, '..', 'prefixCommands', `${command}${moduleExtension}`);
        const commandModule = await import(commandPath);

        const args = messageString.slice(baseCommandStartRaw.length).trim().split(/\s+/).filter(Boolean);

        return await commandModule.execute(this, args, message);
    }

    public sendPrefixCommandResponse(response: string | string[], inGame: boolean) {
        if (inGame) {
            this.inGameTeamChatQueueMessage(response);
        }
        else {
            const formattedResponse = Array.isArray(response) ? response.join('\n') : response;
            discordMessages.sendPrefixCommandResponseMessage(dm, this.guildId, formattedResponse);
        }
    }

    private async pollResponse<K extends 'info' | 'time' | 'teamInfo' | 'mapMarkers' | 'map'>(key: K,
        request: Promise<rp.AppResponse | Error | rp.ConsumeTokensError>, version: number) {
        const guild = gim.getGuildInstance(this.guildId) as GuildInstance;
        const requester = guild.serverInfoMap[this.serverId].requesterSteamId;
        const pairing = requester && guild.pairingDataMap[this.serverId]?.[requester];
        const response = await request;
        if (version !== this.pollVersion || guild.serverInfoMap[this.serverId]?.requesterSteamId !== requester ||
            !requester || guild.pairingDataMap[this.serverId]?.[requester] !== pairing) return;

        // The envelope validator recursively checks the selected payload.
        if (rp.isValidAppResponse(response, log)) {
            const payload = response[key];
            if (payload !== undefined && !response.error) {
                if (pairing && !pairing.valid) {
                    pairing.valid = true;
                    gim.updateGuildInstance(this.guildId);
                    await sendServerMessage(dm, this.guildId, this.serverId, this.connectionStatus);
                }
                return payload;
            }
            this.lastServerPollSuccessful = false;
            this.lg.warn(`Rust+ ${key}: ${response.error?.error ?? 'missing response field'}`);
            if (pairing && pairing.valid &&
                this.rustPlus.getAppResponseError(response) === rp.AppResponseError.NotFound) {
                pairing.valid = false;
                gim.updateGuildInstance(this.guildId);
                await sendServerMessage(dm, this.guildId, this.serverId, this.connectionStatus);
            }
        } else {
            this.lastServerPollSuccessful = false;
            this.lg.warn(`Invalid Rust+ ${key} response.`, {
                error: response instanceof Error ? response.message : response
            });
        }
        return undefined;
    }

    public async validatePairingData() {
        const gInstance = gim.getGuildInstance(this.guildId) as GuildInstance;
        const session = this.sessionId;
        let changed = false;
        for (const [steamId, pairingData] of Object.entries(gInstance.pairingDataMap[this.serverId] ?? {})) {
            // setupRequesting validates the selected account once, on its own connection.
            if (steamId === gInstance.serverInfoMap[this.serverId].requesterSteamId) continue;
            if (this.relaySteamId && steamId !== this.relaySteamId) continue;
            const rpInfo = await this.rustPlus.getInfoAsync(pairingData.steamId, pairingData.playerToken);
            if (session !== this.sessionId) return;
            const wasValid = pairingData.valid;
            if (rp.isValidAppResponse(rpInfo, log)) {
                if (rpInfo.info === undefined) {
                    if (rp.isValidAppError(rpInfo.error, log)) {
                        this.lg.warn(`SteamId: ${steamId}, AppError: ${rpInfo.error.error}`);
                        if (this.rustPlus.getAppResponseError(rpInfo) === rp.AppResponseError.NotFound) {
                            this.lg.warn(`PairingData no longer valid for ${steamId}.`);
                            pairingData.valid = false;
                        }
                    }
                    else {
                        this.lg.error(`We got completely wrong response: ${JSON.stringify(rpInfo)}`);
                    }
                }
                else {
                    pairingData.valid = true;
                }
            }
            else {
                /* Error or rp.ConsumeTokensError */
                if (rpInfo instanceof Error) {
                    this.lg.error(`Error: ${rpInfo.message}`);
                }
                else {
                    this.lg.error(`ConsumeTokensError: ${rpInfo}`);
                }
            }
            changed ||= wasValid !== pairingData.valid;
        }
        if (changed) gim.updateGuildInstance(this.guildId);
    }

    public async setupRequesting() {
        this.stopServerPollingHandler();
        const version = this.pollVersion;
        this.switchStates.clear();
        await Promise.all([this.restoreSmartDevices(version), this.setupServerPolling(version)]);
    }

    private async setupServerPolling(version: number) {
        this.rpTeamInfo = null;
        const gInstance = gim.getGuildInstance(this.guildId) as GuildInstance;
        const server = gInstance.serverInfoMap[this.serverId];
        const requesterSteamId = server.requesterSteamId;
        if (requesterSteamId === null) return;

        const pairingData = gInstance.pairingDataMap[this.serverId]?.[requesterSteamId] ?? null;
        if (!pairingData) return;

        const { steamId, playerToken } = pairingData;
        const requestedAt = Date.now();
        const info = await this.pollResponse('info',
            this.rustPlus.getInfoAsync(steamId, playerToken), version);
        if (!info || version !== this.pollVersion) return;
        this.rpInfo = new RustPlusInfo(this, info);
        const map = await this.pollResponse('map',
            this.rustPlus.getMapAsync(steamId, playerToken, true, 180_000), version);
        if (!map || version !== this.pollVersion) return;

        if (this.rpMap !== null) {
            if (this.rpMap.isJpgImageChanged(map)) {
                // TODO! Notify that the map was wiped
                console.log('MAP WAS WIPED')
            }

            this.rpMap.updateMap(map);
        }
        else {
            this.rpMap = new RustPlusMap(this, map);
        }
        const mapPath = await this.rpMap.writeImage();

        if (version !== this.pollVersion) return;
        await discordMessages.sendInformationChannelMapMessage(dm, this, mapPath);

        if (version !== this.pollVersion) return;
        const fresh = Date.now() - requestedAt < this.serverPollingHandlerIntervalSeconds * 1000;
        this.startServerPollingHandler(fresh ? info : undefined);
    }

    private async restoreSmartDevices(version: number) {
        const server = gim.getGuildInstance(this.guildId)?.serverInfoMap[this.serverId];
        const restore = async (ids: string[], refresh: (id: string) => Promise<unknown>) => {
            for (const id of ids) {
                if (version !== this.pollVersion) return;
                await refresh(id);
            }
        };
        await Promise.all([
            restore(Object.keys(server?.smartSwitchConfigMap ?? {}), id => this.requestSmartSwitch(id)),
            restore(Object.keys(server?.smartAlarmConfigMap ?? {}), id => this.refreshSmartAlarm(id)),
            restore(Object.keys(server?.storageMonitorConfigMap ?? {}), id => this.storageMonitors.refresh(id))
        ]);
    }

    private devicePairing(entityId: types.EntityId,
        devices: 'smartAlarmConfigMap' | 'smartSwitchConfigMap' | 'storageMonitorConfigMap') {
        const guild = gim.getGuildInstance(this.guildId);
        const server = guild?.serverInfoMap[this.serverId];
        const device = server?.[devices]?.[entityId];
        if (this.connectionStatus !== ConnectionStatus.Connected || !server?.active || !server.requesterSteamId ||
            !device) return;
        const pairings = guild?.pairingDataMap[this.serverId];
        // Older configs have no device owner. Use the configured requester until the device is paired again.
        const owners = device.pairedSteamIds ?? [server.requesterSteamId];
        const canRequest = (id: string) => pairings?.[id]?.valid && !!cm.getCredentials(id);
        const requester = this.relaySteamId ?? server.requesterSteamId;
        const owner = owners.includes(requester) && canRequest(requester) ? requester :
            this.relaySteamId ? undefined : owners.find(canRequest);
        return owner ? pairings?.[owner] : undefined;
    }

    public smartAlarmValue(entityId: string) {
        const state = this.alarmStates.get(entityId);
        return state?.version === this.pollVersion && this.devicePairing(entityId, 'smartAlarmConfigMap') ?
            state.value : undefined;
    }

    public async refreshSmartAlarm(entityId: string) {
        const version = this.pollVersion;
        const pairing = this.devicePairing(entityId, 'smartAlarmConfigMap');
        const owner = pairing?.steamId;
        const token = pairing?.playerToken;
        const pending = this.alarmReads.get(entityId);
        if (pending?.version === version && pending.owner === owner && pending.token === token) return pending.done;
        const before = this.alarmStates.get(entityId);
        const read = (async () => {
            if (pairing) {
                const reply = await this.rustPlus.getEntityInfoAsync(pairing.steamId, pairing.playerToken, entityId);
                const current = this.devicePairing(entityId, 'smartAlarmConfigMap');
                if (version !== this.pollVersion || current?.steamId !== owner ||
                    current?.playerToken !== token) return;
                if (this.alarmStates.get(entityId) === before) {
                    if (rp.isValidAppResponse(reply) && !reply.error &&
                        reply.entityInfo?.type === rp.AppEntityType.Alarm && reply.entityInfo.payload) {
                        const value = reply.entityInfo.payload.value;
                        this.alarmRetries.delete(entityId);
                        this.alarmStates.set(entityId, { version, value });
                        if (value && before?.value === false && before.disconnectedAt !== undefined) {
                            await this.notifySmartAlarm(entityId, before.disconnectedAt);
                        }
                    } else {
                        this.alarmRetries.add(entityId);
                        if (before) {
                            this.alarmStates.set(entityId, { value: before.value, version: -1,
                                disconnectedAt: before.disconnectedAt ?? Date.now() });
                        }
                    }
                }
            }
            await discordMessages.sendSmartAlarmMessage(dm, this.guildId, this.serverId, entityId);
        })();
        this.alarmReads.set(entityId, { version, owner, token, done: read });
        try {
            await read;
        } finally {
            if (this.alarmReads.get(entityId)?.done === read) this.alarmReads.delete(entityId);
        }
    }

    public async entityChanged(entityId: string, payload: rp.AppEntityPayload) {
        const value = payload.value;
        const server = gim.getGuildInstance(this.guildId)?.serverInfoMap[this.serverId];
        if (server?.storageMonitorConfigMap?.[entityId]) return this.storageMonitors.changed(entityId, payload);
        const alarm = server?.smartAlarmConfigMap?.[entityId];
        if (!alarm) return this.smartSwitchChanged(entityId, value);
        if (!this.devicePairing(entityId, 'smartAlarmConfigMap')) return;
        const before = this.alarmStates.get(entityId);
        this.alarmRetries.delete(entityId);
        this.alarmStates.set(entityId, { version: this.pollVersion, value });
        if (value && !before?.value) await this.notifySmartAlarm(entityId, before?.disconnectedAt);
        if (before?.value !== value || before.version !== this.pollVersion) {
            await discordMessages.sendSmartAlarmMessage(dm, this.guildId, this.serverId, entityId);
        }
    }

    private async notifySmartAlarm(entityId: string, since?: number) {
        const alarm = gim.getGuildInstance(this.guildId)?.serverInfoMap[this.serverId]?.smartAlarmConfigMap[entityId];
        if (!alarm) return;
        await deliverSmartAlarm(dm, this.guildId, this.serverId, {
            source: 'socket', entityId, candidates: [entityId], time: Date.now(), since,
            title: alarm.name, message: alarm.message
        });
    }

    public smartSwitchValue(entityId: types.EntityId) {
        if (this.devicePairing(entityId, 'smartSwitchConfigMap')) return this.switchStates.get(entityId)?.value;
    }

    public async smartSwitchChanged(entityId: types.EntityId, value: boolean) {
        if (!this.devicePairing(entityId, 'smartSwitchConfigMap')) return;
        const previous = this.switchStates.get(entityId);
        // Even an identical broadcast supersedes an older in-flight snapshot or write acknowledgement.
        this.switchStates.set(entityId, { value });
        if (previous?.value !== value) {
            await discordMessages.sendSmartSwitchMessage(dm, this.guildId, this.serverId, entityId);
        }
    }

    public async requestSmartSwitch(entityId: types.EntityId, desired?: boolean): Promise<boolean> {
        const version = this.pollVersion;
        const previous = this.switchRequests.get(entityId);
        const current = (previous ?? Promise.resolve())
            .then(() => this.runSwitchRequest(version, entityId, desired))
            .catch(error => {
                this.lg.warn(`Smart switch ${entityId} request failed: ${error}`);
                return false;
            });
        this.switchRequests.set(entityId, current);
        try {
            return await current;
        } finally {
            if (this.switchRequests.get(entityId) === current) this.switchRequests.delete(entityId);
        }
    }

    private async runSwitchRequest(version: number, entityId: types.EntityId, desired?: boolean) {
        if (version !== this.pollVersion) return false;
        const pairing = this.devicePairing(entityId, 'smartSwitchConfigMap');
        const before = this.switchStates.get(entityId);
        let value: boolean | undefined;
        if (pairing) {
            const { steamId, playerToken } = pairing;
            if (desired === undefined) {
                const reply = await this.rustPlus.getEntityInfoAsync(steamId, playerToken, entityId);
                if (rp.isValidAppResponse(reply) && !reply.error &&
                    reply.entityInfo?.type === rp.AppEntityType.Switch) {
                    value = reply.entityInfo.payload?.value;
                }
            } else if (before) {
                const reply = await this.rustPlus.setEntityValueAsync(steamId, playerToken, entityId, desired);
                if (rp.isValidAppResponse(reply) && !reply.error && reply.success) value = desired;
            }
        }
        if (version !== this.pollVersion ||
            pairing !== this.devicePairing(entityId, 'smartSwitchConfigMap')) return false;
        if (this.switchStates.get(entityId) === before) {
            if (value === undefined) this.switchStates.delete(entityId);
            else this.switchStates.set(entityId, { value });
        }
        await discordMessages.sendSmartSwitchMessage(dm, this.guildId, this.serverId, entityId);
        return value !== undefined;
    }

    public async sendEventNotification(setting: keyof EventNotificationSettings, text: string) {

        const gInstance = gim.getGuildInstance(this.guildId) as GuildInstance;
        const settingData = gInstance.eventNotificationSettings[setting];

        const session = this.sessionId;
        if (settingData.discord) {
            await discordMessages.sendEventNotificationMessage(dm, this.guildId, this.serverId, setting, text);
        }
        if (session !== this.sessionId) return;
        if (settingData.inGame) {
            this.inGameTeamChatQueueMessage(text);
        }
        if (settingData.voice) {
            await discordVoice.sendDiscordVoiceMessage(this.guildId, text);
        }

        this.lg.info(`Event Notification: ${text}`);
    }

    public async updateConnections(steamId: types.SteamId, str: string) {
        const time = Timer.getCurrentDateTime();
        const data = {
            time: time,
            str: str
        }

        if (this.allConnections.length === 10) {
            this.allConnections.pop();
        }
        this.allConnections.unshift(data)

        if (!this.playerConnections[steamId]) {
            this.playerConnections[steamId] = [];
        }

        if (this.playerConnections[steamId].length === 10) {
            this.playerConnections[steamId].pop();
        }
        this.playerConnections[steamId].unshift(data);
    }

    public async updateDeaths(steamId: types.SteamId, name: string, location: string | null) {
        const time = Timer.getCurrentDateTime();
        const data = {
            time: time,
            name: name,
            location: location
        }

        if (this.allDeaths.length === 10) {
            this.allDeaths.pop();
        }
        this.allDeaths.unshift(data)

        if (!this.playerDeaths[steamId]) {
            this.playerDeaths[steamId] = [];
        }

        if (this.playerDeaths[steamId].length === 10) {
            this.playerDeaths[steamId].pop();
        }
        this.playerDeaths[steamId].unshift(data);
    }

    /**
     * Information channel server methods
     */

    public getInformationChannelServerPlayersString(): string {
        let str = '\u200B';

        if (this.rpInfo) {
            str = `${this.rpInfo.appInfo.players}`;
            str += this.rpInfo.isQueue() ? `(${this.rpInfo.appInfo.queuedPlayers})` : '';
            str += `/${this.rpInfo.appInfo.maxPlayers}`;
        }

        return str;
    }

    public getInformationChannelServerTimeString(): string {
        let str = '\u200B';

        if (this.rpTime) {
            str = `${Timer.convertDecimalToHoursMinutes(this.rpTime.appTime.time)}`;
        }

        return str;
    }

    public getInformationChannelServerWipeString(): string {
        let str = '\u200B';

        if (this.rpInfo) {
            str = `<t:${this.rpInfo.appInfo.wipeTime}:R>`;
        }

        return str;
    }

    public getInformationChannelServerTimeTillString(): string {
        let str = '\u200B';

        if (this.rpTime) {
            const timeTillData = this.rpTime.getTimeTillSunriseOrSunset();
            const timeTillTimestamp = Math.floor((new Date().getTime() / 1000)) + timeTillData.timeTillSeconds;
            str = `<t:${timeTillTimestamp}:R>`;
        }

        return str;
    }

    public getInformationChannelServerMapSizeString(): string {
        let str = '\u200B';

        if (this.rpInfo) {
            str = `${this.rpInfo.appInfo.mapSize}`;
        }

        return str;
    }

    public getInformationChannelServerMapSeedString(): string {
        let str = '\u200B';

        if (this.rpInfo) {
            str = `${this.rpInfo.appInfo.seed}`;
        }

        return str;
    }

    public getInformationChannelServerMapSaltString(): string {
        let str = '\u200B';

        if (this.rpInfo) {
            str = `${this.rpInfo.appInfo.salt}`;
        }

        return str;
    }

    public getInformationChannelServerMapString(): string {
        let str = '\u200B';

        if (this.rpInfo) {
            str = `${this.rpInfo.appInfo.map}`;
        }

        return str;
    }

    public getInformationChannelServerConnectString(): string {
        let str = '\u200B';

        const gInstance = gim.getGuildInstance(this.guildId) as GuildInstance;
        const serverInfo = gInstance.serverInfoMap[this.serverId];

        if (serverInfo && serverInfo.connect !== null) {
            str = `${serverInfo.connect}`;
        }

        return str;
    }

    /**
     * Information channel event methods
     */

    public getInformationChannelEventCargoShipString(): string {
        const gInstance = gim.getGuildInstance(this.guildId) as GuildInstance;
        const language = gInstance.generalSettings.language;

        if (!this.rpMapMarkers) {
            return '\u200B';
        }

        const unixTimestampNow = Math.floor(new Date().getTime() / 1000);
        const dateDespawned = this.rpMapMarkers.dateCargoShipDespawned;

        const strings: string[] = [];
        if (this.rpMapMarkers.cargoShips.length === 0) {
            if (dateDespawned === null) {
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseNotActive'));
            }
            else {
                const unixTimestampDespawned = Math.floor(dateDespawned.getTime() / 1000);
                const timeDespawned = Timer.getDiscordRelativeTime(unixTimestampDespawned);
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseLeftTime', {
                    time: timeDespawned
                }));
            }
        }

        for (const cargoShip of this.rpMapMarkers.cargoShips) {
            const metaData = this.rpMapMarkers.cargoShipMetaData[cargoShip.id];
            const dateSpawned = this.rpMapMarkers.dateCargoShipSpawned[cargoShip.id];

            const pos = getPos(cargoShip.x, cargoShip.y, this);
            const posString = (pos !== null) ? getPosString(pos, this, true, false) :
                lm.getIntl(language, 'unknown');

            let str: string;
            if (metaData.isLeaving) {
                str = lm.getIntl(language, 'infoChannelEmbedEventPhraseLeavingAtPos', { pos: posString });
            }
            else if (metaData.dockingStatus !== null && metaData.dockingStatus === DockingStatus.DOCKING) {
                str = lm.getIntl(language, 'infoChannelEmbedEventPhraseDockingAtPos', { pos: posString });
            }
            else if (metaData.dockingStatus !== null && metaData.dockingStatus === DockingStatus.DOCKED) {
                str = lm.getIntl(language, 'infoChannelEmbedEventPhraseDockedAtPos', { pos: posString });
            }
            else if (metaData.dockingStatus !== null && metaData.dockingStatus === DockingStatus.UNDOCKING) {
                str = lm.getIntl(language, 'infoChannelEmbedEventPhraseUndockingAtPos', { pos: posString });
            }
            else {
                str = lm.getIntl(language, 'infoChannelEmbedEventPhraseLocatedAtPos', { pos: posString });
            }
            str += '\n';

            if (dateSpawned) {
                const unixTimestampSpawned = Math.floor(dateSpawned.getTime() / 1000);
                const timeSpawned = Timer.getDiscordRelativeTime(unixTimestampSpawned);
                str += ` ${lm.getIntl(language, 'infoChannelEmbedEventPhraseSpawnedTime', {
                    time: timeSpawned
                })}\n`;
            }

            const numberOfHarborsDocked = `${metaData.harborsDocked.length}`;
            str += ` ${lm.getIntl(language, 'infoChannelEmbedEventPhraseDockedAtXHarbors', {
                num: numberOfHarborsDocked
            })}\n`;

            const numberOfLockedCratesSpawned = `${metaData.lockedCrateSpawnCounter}`;
            str += ` ${lm.getIntl(language, 'infoChannelEmbedEventPhraseNumLockedCratesSpawned', {
                num: numberOfLockedCratesSpawned
            })}\n`;

            if (!metaData.isLeaving) {
                const timer0 = this.rpMapMarkers.cargoShipEgressTimeoutIds[cargoShip.id];
                const timer1 = this.rpMapMarkers.cargoShipEgressAfterHarbor1TimeoutIds[cargoShip.id];
                const timer2 = this.rpMapMarkers.cargoShipEgressAfterHarbor2TimeoutIds[cargoShip.id];

                let timeLeft0: string = '';
                let timeLeft1: string = '';
                if (timer0 && timer0.running && !timer1 && !timer2) {
                    const secondsLeft0 = Math.floor(timer0.getTimeLeftMs() / 1000);
                    const unixTimestampLeave0 = unixTimestampNow + secondsLeft0;
                    timeLeft0 = Timer.getDiscordRelativeTime(unixTimestampLeave0);
                }
                else if (timer0 && timer0.running && timer2 && timer2.running) {
                    const secondsLeft0 = Math.floor(timer0.getTimeLeftMs() / 1000);
                    const unixTimestampLeave0 = unixTimestampNow + secondsLeft0;
                    timeLeft0 = Timer.getDiscordRelativeTime(unixTimestampLeave0);
                    const secondsLeft1 = Math.floor(timer2.getTimeLeftMs() / 1000);
                    const unixTimestampLeave1 = unixTimestampNow + secondsLeft1;
                    timeLeft1 = Timer.getDiscordRelativeTime(unixTimestampLeave1);
                }
                else if (timer1 && timer1.running && timer2 && timer2.running) {
                    const secondsLeft0 = Math.floor(timer1.getTimeLeftMs() / 1000);
                    const unixTimestampLeave0 = unixTimestampNow + secondsLeft0;
                    timeLeft0 = Timer.getDiscordRelativeTime(unixTimestampLeave0);
                    const secondsLeft1 = Math.floor(timer2.getTimeLeftMs() / 1000);
                    const unixTimestampLeave1 = unixTimestampNow + secondsLeft1;
                    timeLeft1 = Timer.getDiscordRelativeTime(unixTimestampLeave1);
                }
                else if (timer0 && !timer0.running && timer2 && timer2.running) {
                    const secondsLeft0 = Math.floor(timer2.getTimeLeftMs() / 1000);
                    const unixTimestampLeave0 = unixTimestampNow + secondsLeft0;
                    timeLeft0 = Timer.getDiscordRelativeTime(unixTimestampLeave0);
                }
                else {
                    /* Do nothing */
                }

                if (timeLeft0 !== '' && timeLeft1 !== '') {
                    const timeLeftString = lm.getIntl(language, 'infoChannelEmbedEventPhraseLeavingXOrYTime', {
                        time1: timeLeft0,
                        time2: timeLeft1
                    });
                    str += `${timeLeftString}\n`;
                }
                else if (timeLeft0 !== '') {
                    const timeLeftString = lm.getIntl(language, 'infoChannelEmbedEventPhraseLeavingTime', {
                        time: timeLeft0
                    });
                    str += `${timeLeftString}\n`;
                }
            }

            strings.push(str.trim());
        }

        return strings.length === 0 ? '\u200B' : strings.join('\n');
    }

    public getInformationChannelEventPatrolHelicopterString(): string {
        const gInstance = gim.getGuildInstance(this.guildId) as GuildInstance;
        const language = gInstance.generalSettings.language;

        if (!this.rpMapMarkers) {
            return '\u200B';
        }

        const strings: string[] = [];
        if (this.rpMapMarkers.patrolHelicopters.length === 0) {
            const dateDestroyed = this.rpMapMarkers.datePatrolHelicopterDestroyed;
            const dateDespawned = this.rpMapMarkers.datePatrolHelicopterDespawned;
            const destroyedLocation = this.rpMapMarkers.patrolHelicopterLastDestroyedLocation;

            if (dateDestroyed) {
                const unixTimestampDestroyed = Math.floor(dateDestroyed.getTime() / 1000);
                const timeDestroyed = Timer.getDiscordRelativeTime(unixTimestampDestroyed);
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseDestroyedTimeAtPos', {
                    time: timeDestroyed,
                    location: destroyedLocation ?? lm.getIntl(language, 'unknown')
                }));
            }

            if (dateDespawned) {
                const unixTimestampDespawned = Math.floor(dateDespawned.getTime() / 1000);
                const timeDespawned = Timer.getDiscordRelativeTime(unixTimestampDespawned);
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseLeftTime', {
                    time: timeDespawned
                }));
            }

            if (strings.length === 0) {
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseNotActive'));
            }
        }

        for (const patrolHelicopter of this.rpMapMarkers.patrolHelicopters) {
            const metaData = this.rpMapMarkers.patrolHelicopterMetaData[patrolHelicopter.id];

            const pos = getPos(patrolHelicopter.x, patrolHelicopter.y, this);
            const posString = (pos !== null) ? getPosString(pos, this, true, false) :
                lm.getIntl(language, 'unknown');

            if (metaData.isLeaving) {
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseLeavingAtPos', { pos: posString }));
            }
            else {
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseLocatedAtPos', { pos: posString }));
            }
        }

        return strings.length === 0 ? '\u200B' : strings.join('\n');
    }

    public getInformationChannelEventSmallOilRigString(): string {
        const gInstance = gim.getGuildInstance(this.guildId) as GuildInstance;
        const serverInfo = gInstance.serverInfoMap[this.serverId] as ServerInfo;
        const language = gInstance.generalSettings.language;

        if (!this.rpMapMarkers) {
            return '\u200B';
        }

        const strings: string[] = [];
        for (const content of Object.values(this.rpMapMarkers.oilRigLockedCrateUnlockedMetaData)) {
            if (content.oilRig === 'oil_rig_small') {
                const dateTriggered = content.dateTriggered;
                const unixTimestampTriggered = Math.floor(dateTriggered.getTime() / 1000);
                const eventDurationSeconds = Math.floor(serverInfo.customVariables.lockedCrateUnlockTimeMs / 1000);
                const unixTimestampUnlocks = unixTimestampTriggered + eventDurationSeconds;
                const timeUnlocks = Timer.getDiscordRelativeTime(unixTimestampUnlocks);
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseLockedCrateUnlocksTime', {
                    time: timeUnlocks
                }));
            }
        }

        if (strings.length === 0) {
            if (this.rpMapMarkers.dateSmallOilRigLastTriggered !== null) {
                const dateLastTriggered = this.rpMapMarkers.dateSmallOilRigLastTriggered;
                const unixTimestampLastTriggered = Math.floor(dateLastTriggered.getTime() / 1000);
                const timeLastTriggered = Timer.getDiscordRelativeTime(unixTimestampLastTriggered);
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseTriggeredTime', {
                    time: timeLastTriggered
                }));
            }
            else {
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseNotActive'));
            }
        }

        return strings.length === 0 ? '\u200B' : strings.join('\n');
    }

    public getInformationChannelEventLargeOilRigString(): string {
        const gInstance = gim.getGuildInstance(this.guildId) as GuildInstance;
        const serverInfo = gInstance.serverInfoMap[this.serverId] as ServerInfo;
        const language = gInstance.generalSettings.language;

        if (!this.rpMapMarkers) {
            return '\u200B';
        }

        const strings: string[] = [];
        for (const content of Object.values(this.rpMapMarkers.oilRigLockedCrateUnlockedMetaData)) {
            if (content.oilRig === 'large_oil_rig') {
                const dateTriggered = content.dateTriggered;
                const unixTimestampTriggered = Math.floor(dateTriggered.getTime() / 1000);
                const eventDurationSeconds = Math.floor(serverInfo.customVariables.lockedCrateUnlockTimeMs / 1000);
                const unixTimestampUnlocks = unixTimestampTriggered + eventDurationSeconds;
                const timeUnlocks = Timer.getDiscordRelativeTime(unixTimestampUnlocks);
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseLockedCrateUnlocksTime', {
                    time: timeUnlocks
                }));
            }
        }

        if (strings.length === 0) {
            if (this.rpMapMarkers.dateLargeOilRigLastTriggered !== null) {
                const dateLastTriggered = this.rpMapMarkers.dateLargeOilRigLastTriggered;
                const unixTimestampLastTriggered = Math.floor(dateLastTriggered.getTime() / 1000);
                const timeLastTriggered = Timer.getDiscordRelativeTime(unixTimestampLastTriggered);
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseTriggeredTime', {
                    time: timeLastTriggered
                }));
            }
            else {
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseNotActive'));
            }
        }

        return strings.length === 0 ? '\u200B' : strings.join('\n');
    }

    public getInformationChannelEventChinook47String(): string {
        const gInstance = gim.getGuildInstance(this.guildId) as GuildInstance;
        const language = gInstance.generalSettings.language;

        if (!this.rpMapMarkers) {
            return '\u200B';
        }

        const dateDespawned = this.rpMapMarkers.dateCh47Despawned;

        const strings: string[] = [];
        if (this.rpMapMarkers.ch47s.length === 0) {
            if (dateDespawned === null) {
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseNotActive'));
            }
            else {
                const unixTimestampDespawned = Math.floor(dateDespawned.getTime() / 1000);
                const timeDespawned = Timer.getDiscordRelativeTime(unixTimestampDespawned);
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseLeftTime', {
                    time: timeDespawned
                }));
            }
        }

        for (const ch47 of this.rpMapMarkers.ch47s) {
            const metaData = this.rpMapMarkers.ch47MetaData[ch47.id];
            const dateSpawned = this.rpMapMarkers.dateCh47Spawned[ch47.id];

            const pos = getPos(ch47.x, ch47.y, this);
            const posString = (pos !== null) ? getPosString(pos, this, true, false) :
                lm.getIntl(language, 'unknown');

            strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseLocatedAtPos', { pos: posString }));

            if (dateSpawned) {
                const unixTimestampSpawned = Math.floor(dateSpawned.getTime() / 1000);
                const timeSpawned = Timer.getDiscordRelativeTime(unixTimestampSpawned);
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseSpawnedTime', { time: timeSpawned }));
            }

            if (metaData.lockedCrateNotified) {
                const monumentName = lm.getIntl(language, metaData.lockedCrateDropLocation as string);
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseLockedCrateDroppedAtPos', {
                    monument: monumentName
                }));
            }
        }

        return strings.length === 0 ? '\u200B' : strings.join('\n');
    }

    public getInformationChannelEventTravellingVendorString(): string {
        const gInstance = gim.getGuildInstance(this.guildId) as GuildInstance;
        const serverInfo = gInstance.serverInfoMap[this.serverId] as ServerInfo;
        const language = gInstance.generalSettings.language;

        if (!this.rpMapMarkers) {
            return '\u200B';
        }

        const dateDespawned = this.rpMapMarkers.dateTravellingVendorDespawned;

        const strings: string[] = [];
        if (this.rpMapMarkers.travellingVendors.length === 0) {
            if (dateDespawned !== null) {
                const unixTimestampDespawned = Math.floor(dateDespawned.getTime() / 1000);
                const timeDespawned = Timer.getDiscordRelativeTime(unixTimestampDespawned);
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseLeftTime', {
                    time: timeDespawned
                }));
            }
            else {
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseNotActive'));
            }
        }
        else {
            for (const travellingVendor of this.rpMapMarkers.travellingVendors) {
                const dateSpawned = this.rpMapMarkers.dateTravellingVendorSpawned[travellingVendor.id];

                const pos = getPos(travellingVendor.x, travellingVendor.y, this);
                const posString = (pos !== null) ? getPosString(pos, this, true, false) :
                    lm.getIntl(language, 'unknown');

                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseLocatedAtPos', { pos: posString }));

                if (dateSpawned) {
                    const unixTimestampSpawned = Math.floor(dateSpawned.getTime() / 1000);
                    const eventDurationSeconds = Math.floor(
                        serverInfo.customVariables.travellingVendorDurationTimeMs / 1000);
                    const unixTimestampDespawn = unixTimestampSpawned + eventDurationSeconds;

                    const timeSpawned = Timer.getDiscordRelativeTime(unixTimestampSpawned);
                    const timeDespawn = Timer.getDiscordRelativeTime(unixTimestampDespawn);

                    strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseSpawnedTime', {
                        time: timeSpawned
                    }));
                    strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseDespawnsTime', {
                        time: timeDespawn
                    }));
                }
            }
        }

        return strings.length === 0 ? '\u200B' : strings.join('\n');
    }

    public getInformationChannelEventDeepSeaString(): string {
        const gInstance = gim.getGuildInstance(this.guildId) as GuildInstance;
        const serverInfo = gInstance.serverInfoMap[this.serverId] as ServerInfo;
        const language = gInstance.generalSettings.language;

        if (!this.rpMapMarkers) {
            return '\u200B';
        }

        const dateSpawned = this.rpMapMarkers.dateDeepSeaSpawned;
        const dateDespawned = this.rpMapMarkers.dateDeepSeaDespawned;

        const strings: string[] = [];
        if (this.rpMapMarkers.isDeepSeaActive) {
            strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseActive'));

            if (dateSpawned !== null) {
                const unixTimestampSpawned = Math.floor(dateSpawned.getTime() / 1000);
                const eventDurationSeconds = Math.floor(serverInfo.customVariables.deepSeaDurationTimeMs / 1000);
                const unixTimestampDespawn = unixTimestampSpawned + eventDurationSeconds;

                const timeSpawned = Timer.getDiscordRelativeTime(unixTimestampSpawned);
                const timeDespawn = Timer.getDiscordRelativeTime(unixTimestampDespawn);

                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseSpawnedTime', { time: timeSpawned }));
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseDespawnsTime', { time: timeDespawn }));
            }
        }
        else {
            if (dateDespawned !== null) {
                const unixTimestampDespawned = Math.floor(dateDespawned.getTime() / 1000);
                const timeDespawned = Timer.getDiscordRelativeTime(unixTimestampDespawned);
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseDespawnedTime', { time: timeDespawned }));
            }
            else {
                strings.push(lm.getIntl(language, 'infoChannelEmbedEventPhraseNotActive'));
            }
        }

        return strings.length === 0 ? '\u200B' : strings.join('\n');
    }
}
