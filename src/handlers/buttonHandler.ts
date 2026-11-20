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

import { manageSwitch, switchCardTarget } from './smartSwitchControls';
import { manageGroupCard, switchGroupCardTarget } from './smartSwitchGroupControls';
import * as discordjs from 'discord.js';

import { guildInstanceManager as gim, rustPlusManager as rpm, localeManager as lm } from '../../index';
import { ConnectionStatus } from '../managers/rustPlusManager';
import { DiscordManager } from "../managers/discordManager";
import * as types from '../utils/types';
import { GuildInstance } from '../managers/guildInstanceManager';
import * as discordMessages from '../discordUtils/discordMessages';
import * as discordModals from '../discordUtils/discordModals';

export async function buttonHandler(dm: DiscordManager, interaction: discordjs.ButtonInteraction):
    Promise<boolean> {
    if (interaction.customId.startsWith('SwitchGroup:')) return manageGroupCard(dm, interaction);
    if (interaction.customId === 'SwitchGroupOn' || interaction.customId === 'SwitchGroupOff') {
        return handleSwitchGroup(dm, interaction);
    }
    const manage = /^(SmartSwitchEdit|SmartSwitchRemove)(\[.*\])$/.exec(interaction.customId);
    if (manage) return manageSwitch(dm, interaction, manage[1] === 'SmartSwitchEdit' ? 'edit' : 'remove', manage[2]);
    const switchAction = /^(SmartSwitchOn|SmartSwitchOff|SmartSwitchRead)(\[.*\])$/.exec(interaction.customId);
    if (switchAction) {
        return handleSmartSwitch(dm, interaction, switchAction[1], switchAction[2]);
    }
    /* General settings */
    if (interaction.customId === 'GeneralSetting-leaderCommandEnabled' ||
        interaction.customId === 'GeneralSetting-leaderCommandOnlyPaired') {
        await interaction.deferUpdate();
        const guild = interaction.guildId && gim.getGuildInstance(interaction.guildId);
        if (!guild || !interaction.message?.id || guild.settingsMessages.leaderCommand !== interaction.message.id ||
            !dm.validPermissions(interaction, true)) return false;
        const key = interaction.customId === 'GeneralSetting-leaderCommandEnabled' ?
            'leaderCommandEnabled' : 'leaderCommandOnlyPaired';
        guild.generalSettings[key] = !guild.generalSettings[key];
        if (!gim.updateGuildInstance(guild.guildId)) {
            guild.generalSettings[key] = !guild.generalSettings[key];
            return false;
        }
        await discordMessages.updateSetting(dm, guild.guildId, 'leaderCommand');
        return true;
    }
    if (interaction.customId === 'GeneralSetting-inGameChatFunctionalityEnabled') {
        return await inGameChatFunctionalityEnabledButtonHandler(dm, interaction);
    }
    else if (interaction.customId === 'GeneralSetting-inGameChatBotUnmuted') {
        return await inGameChatBotUnmutedButtonHandler(dm, interaction);
    }
    else if (interaction.customId === 'GeneralSetting-inGameChatTrademark') {
        return await inGameChatTrademarkButtonHandler(dm, interaction);
    }
    else if (interaction.customId === 'GeneralSetting-inGameChatCommandPrefix') {
        return await inGameChatCommandPrefixButtonHandler(dm, interaction);
    }
    else if (interaction.customId === 'GeneralSetting-inGameChatCommandsEnabled') {
        return await inGameChatCommandsEnabledButtonHandler(dm, interaction);
    }
    else if (interaction.customId === 'GeneralSetting-inGameChatNotifySmartSwitchChangedFromDiscord') {
        return await inGameChatNotifySmartSwitchChangedFromDiscordButtonHandler(dm, interaction);
    }
    else if (interaction.customId === 'GeneralSetting-inGameChatNotifyConnection') {
        return await inGameChatNotifyConnectionButtonHandler(dm, interaction);
    }
    else if (interaction.customId === 'GeneralSetting-inGameChatNotifyAfk') {
        return await inGameChatNotifyAfkButtonHandler(dm, interaction);
    }
    else if (interaction.customId === 'GeneralSetting-inGameChatNotifyDeath') {
        return await inGameChatNotifyDeathButtonHandler(dm, interaction);
    }
    else if (interaction.customId === 'GeneralSetting-fcmAlarmNotify') {
        return await fcmAlarmNotifyButtonHandler(dm, interaction);
    }
    else if (interaction.customId === 'GeneralSetting-fcmAlarmNotifyEveryone') {
        return await fcmAlarmNotifyEveryoneButtonHandler(dm, interaction);
    }
    else if (interaction.customId === 'GeneralSetting-fcmAlarmPluginNotify') {
        return await fcmAlarmPluginNotifyButtonHandler(dm, interaction);
    }
    else if (interaction.customId === 'GeneralSetting-fcmAlarmPluginNotifyEveryone') {
        return await fcmAlarmPluginNotifyEveryoneButtonHandler(dm, interaction);
    }
    else if (interaction.customId === 'GeneralSetting-fcmAlarmPluginNotifyActiveServer') {
        return await fcmAlarmPluginNotifyActiveServerButtonHandler(dm, interaction);
    }
    // A cached Discord card can send a retired setting while the menu is being updated.
    else if (interaction.customId.startsWith('GeneralSetting-') ||
        interaction.customId.startsWith('EventNotificationSetting-')) {
        await interaction.deferUpdate();
        return false;
    }
    /* Servers Channel buttons */
    else if (interaction.customId.startsWith('ServerConnecting') ||
        interaction.customId.startsWith('ServerDisconnect') ||
        interaction.customId.startsWith('ServerReconnecting')) {
        return await serverConnectingDisconnectReconnectingButtonHandler(dm, interaction);
    }
    else if (interaction.customId.startsWith('ServerConnect')) {
        return await serverConnectButtonHandler(dm, interaction);
    }
    else if (interaction.customId.startsWith('ServerView')) {
        return await serverViewButtonHandler(dm, interaction);
    }
    else if (interaction.customId.startsWith('ServerDelete')) {
        return await serverDeleteButtonHandler(dm, interaction);
    }

    return false;
}


async function handleSwitchGroup(dm: DiscordManager, interaction: discordjs.ButtonInteraction) {
    await interaction.deferUpdate();
    const guild = interaction.guildId && gim.getGuildInstance(interaction.guildId);
    if (!guild) return false;
    const lang = guild.generalSettings.language;
    const reply = (content: string) => interaction.followUp({ content, flags: discordjs.MessageFlags.Ephemeral,
        allowedMentions: { parse: [] } });
    if (!dm.validPermissions(interaction)) {
        await reply(lm.getIntl(lang, 'errorDescMissingPermission'));
        return false;
    }
    const target = switchGroupCardTarget(guild, interaction.message.id);
    const instance = target && rpm.getInstance(guild.guildId, target.serverId);
    if (target && instance?.connectionStatus === ConnectionStatus.Connected) {
        const { groupId, group } = target;
        const { confirmed, total } = await instance.setSwitchGroup(groupId, interaction.customId === 'SwitchGroupOn');
        await reply(lm.getIntl(lang, 'groupResult', { name: group.name, ok: String(confirmed), total: String(total) }));
        return total > 0 && confirmed === total;
    }
    await reply(lm.getIntl(lang, 'groupUnavailable'));
    return false;
}

async function handleSmartSwitch(dm: DiscordManager, interaction: discordjs.ButtonInteraction, action: string,
    identifier: string): Promise<boolean> {
    await interaction.deferUpdate();
    const guildId = interaction.guildId;
    if (!guildId) return false;
    const guild = gim.getGuildInstance(guildId);
    if (!guild) return false;
    const language = guild.generalSettings.language;
    if (!dm.validPermissions(interaction)) {
        await interaction.followUp({ content: lm.getIntl(language, 'errorDescMissingPermission'),
            flags: discordjs.MessageFlags.Ephemeral });
        return false;
    }

    const target = switchCardTarget(guild, identifier, interaction.message.id);
    if (!target) {
        await interaction.followUp({ content: lm.getIntl(language, 'switchCardExpired'),
            flags: discordjs.MessageFlags.Ephemeral });
        return false;
    }
    const { serverId, entityId, device } = target;
    const instance = rpm.getInstance(guildId, serverId);
    const desired = action === 'SmartSwitchRead' ? undefined : action === 'SmartSwitchOn';
    if (instance?.connectionStatus === ConnectionStatus.Connected) {
        const before = instance.smartSwitchValue(entityId);
        if (await instance.requestSmartSwitch(entityId, desired)) {
            if (guild.generalSettings.inGameChatNotifySmartSwitchChangedFromDiscord &&
                desired !== undefined && before !== desired) {
                const status = lm.getIntl(language, desired ? 'buttonOn' : 'buttonOff');
                instance.inGameTeamChatQueueMessage(lm.getIntl(language, 'userTurnedOnOffSmartSwitchFromDiscord', {
                    user: interaction.user.username, name: device.name, status
                }));
            }
            return true;
        }
    }
    const content = lm.getIntl(language, 'noCommunicationSmartSwitch', { name: device.name });
    await interaction.followUp({ content, flags: discordjs.MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return false;
}

/**
 * General settings
 */

async function inGameChatFunctionalityEnabledButtonHandler(dm: DiscordManager,
    interaction: discordjs.ButtonInteraction): Promise<boolean> {
    const guildId = interaction.guildId as types.GuildId;
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    gInstance.generalSettings.inGameChatFunctionalityEnabled =
        !gInstance.generalSettings.inGameChatFunctionalityEnabled;
    gim.updateGuildInstance(guildId);

    await discordMessages.updateSetting(dm, guildId, 'inGameChatFunctionalityEnabled', interaction);

    return true;
}

async function inGameChatBotUnmutedButtonHandler(dm: DiscordManager,
    interaction: discordjs.ButtonInteraction): Promise<boolean> {
    const guildId = interaction.guildId as types.GuildId;
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    gInstance.generalSettings.inGameChatBotUnmuted = !gInstance.generalSettings.inGameChatBotUnmuted;
    gim.updateGuildInstance(guildId);

    await discordMessages.updateSetting(dm, guildId, 'inGameChatBotUnmuted', interaction);

    return true;
}

async function inGameChatTrademarkButtonHandler(dm: DiscordManager,
    interaction: discordjs.ButtonInteraction): Promise<boolean> {
    const guildId = interaction.guildId as types.GuildId;

    const modal = discordModals.getSettingInGameChatTrademarkModal(guildId);
    await interaction.showModal(modal);

    return true;
}

async function inGameChatCommandPrefixButtonHandler(dm: DiscordManager,
    interaction: discordjs.ButtonInteraction): Promise<boolean> {
    const guildId = interaction.guildId as types.GuildId;

    const modal = discordModals.getSettingInGameChatCommandPrefixModal(guildId);
    await interaction.showModal(modal);

    return true;
}

async function inGameChatCommandsEnabledButtonHandler(dm: DiscordManager,
    interaction: discordjs.ButtonInteraction): Promise<boolean> {
    const guildId = interaction.guildId as types.GuildId;
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    gInstance.generalSettings.inGameChatCommandsEnabled = !gInstance.generalSettings.inGameChatCommandsEnabled;
    gim.updateGuildInstance(guildId);

    await discordMessages.updateSetting(dm, guildId, 'inGameChatCommandsEnabled', interaction);

    return true;
}

async function inGameChatNotifySmartSwitchChangedFromDiscordButtonHandler(dm: DiscordManager,
    interaction: discordjs.ButtonInteraction): Promise<boolean> {
    const guildId = interaction.guildId as types.GuildId;
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    gInstance.generalSettings.inGameChatNotifySmartSwitchChangedFromDiscord =
        !gInstance.generalSettings.inGameChatNotifySmartSwitchChangedFromDiscord;
    gim.updateGuildInstance(guildId);

    await discordMessages.updateSetting(dm, guildId, 'inGameChatNotifySmartSwitchChangedFromDiscord', interaction);

    return true;
}

async function inGameChatNotifyConnectionButtonHandler(dm: DiscordManager,
    interaction: discordjs.ButtonInteraction): Promise<boolean> {
    const guildId = interaction.guildId as types.GuildId;
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    gInstance.generalSettings.inGameChatNotifyConnection = !gInstance.generalSettings.inGameChatNotifyConnection;
    gim.updateGuildInstance(guildId);

    await discordMessages.updateSetting(dm, guildId, 'inGameChatNotify', interaction);

    return true;
}

async function inGameChatNotifyAfkButtonHandler(dm: DiscordManager,
    interaction: discordjs.ButtonInteraction): Promise<boolean> {
    const guildId = interaction.guildId as types.GuildId;
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    gInstance.generalSettings.inGameChatNotifyAfk = !gInstance.generalSettings.inGameChatNotifyAfk;
    gim.updateGuildInstance(guildId);

    await discordMessages.updateSetting(dm, guildId, 'inGameChatNotify', interaction);

    return true;
}

async function inGameChatNotifyDeathButtonHandler(dm: DiscordManager,
    interaction: discordjs.ButtonInteraction): Promise<boolean> {
    const guildId = interaction.guildId as types.GuildId;
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    gInstance.generalSettings.inGameChatNotifyDeath = !gInstance.generalSettings.inGameChatNotifyDeath;
    gim.updateGuildInstance(guildId);

    await discordMessages.updateSetting(dm, guildId, 'inGameChatNotify', interaction);

    return true;
}

async function fcmAlarmNotifyButtonHandler(dm: DiscordManager,
    interaction: discordjs.ButtonInteraction): Promise<boolean> {
    const guildId = interaction.guildId as types.GuildId;
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    gInstance.generalSettings.fcmAlarmNotify = !gInstance.generalSettings.fcmAlarmNotify;
    gim.updateGuildInstance(guildId);

    await discordMessages.updateSetting(dm, guildId, 'fcmAlarmNotify', interaction);

    return true;
}

async function fcmAlarmNotifyEveryoneButtonHandler(dm: DiscordManager,
    interaction: discordjs.ButtonInteraction): Promise<boolean> {
    const guildId = interaction.guildId as types.GuildId;
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    gInstance.generalSettings.fcmAlarmNotifyEveryone = !gInstance.generalSettings.fcmAlarmNotifyEveryone;
    gim.updateGuildInstance(guildId);

    await discordMessages.updateSetting(dm, guildId, 'fcmAlarmNotify', interaction);

    return true;
}

async function fcmAlarmPluginNotifyButtonHandler(dm: DiscordManager,
    interaction: discordjs.ButtonInteraction): Promise<boolean> {
    const guildId = interaction.guildId as types.GuildId;
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    gInstance.generalSettings.fcmAlarmPluginNotify = !gInstance.generalSettings.fcmAlarmPluginNotify;
    gim.updateGuildInstance(guildId);

    await discordMessages.updateSetting(dm, guildId, 'fcmAlarmPluginNotify', interaction);

    return true;
}

async function fcmAlarmPluginNotifyEveryoneButtonHandler(dm: DiscordManager,
    interaction: discordjs.ButtonInteraction): Promise<boolean> {
    const guildId = interaction.guildId as types.GuildId;
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    gInstance.generalSettings.fcmAlarmPluginNotifyEveryone = !gInstance.generalSettings.fcmAlarmPluginNotifyEveryone;
    gim.updateGuildInstance(guildId);

    await discordMessages.updateSetting(dm, guildId, 'fcmAlarmPluginNotify', interaction);

    return true;
}

async function fcmAlarmPluginNotifyActiveServerButtonHandler(dm: DiscordManager,
    interaction: discordjs.ButtonInteraction): Promise<boolean> {
    const guildId = interaction.guildId as types.GuildId;
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    gInstance.generalSettings.fcmAlarmPluginNotifyActiveServer =
        !gInstance.generalSettings.fcmAlarmPluginNotifyActiveServer;
    gim.updateGuildInstance(guildId);

    await discordMessages.updateSetting(dm, guildId, 'fcmAlarmPluginNotify', interaction);

    return true;
}


/**
 * Server channel
 */

async function serverConnectingDisconnectReconnectingButtonHandler(dm: DiscordManager,
    interaction: discordjs.ButtonInteraction): Promise<boolean> {
    const identifier = JSON.parse(interaction.customId.replace('ServerConnecting', '')
        .replace('ServerDisconnect', '')
        .replace('ServerReconnecting', ''));
    const serverId = identifier.serverId as types.ServerId;
    const guildId = interaction.guildId as types.GuildId;
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;
    const server = gInstance.serverInfoMap[serverId];

    if (!server) {
        interaction.deferUpdate();
        return false;
    }

    if (gInstance.serverToView === serverId) {
        gInstance.serverToView = null;

        /* Check if there are any other active servers that we can set view to. */
        for (const [sId, content] of Object.entries(gInstance.serverInfoMap)) {
            if (sId !== serverId && content.active) {
                gInstance.serverToView = sId;

                let connectionStatus = ConnectionStatus.Disconnected;
                const rpInstance = rpm.getInstance(guildId, sId);
                if (rpInstance) {
                    connectionStatus = rpInstance.connectionStatus;
                }

                await discordMessages.sendServerMessage(dm, guildId, sId, connectionStatus);
                break;
            }
        }

        // TODO! Remove embeds from information channel if serverToView === null
    }

    server.active = false;
    const deletionPromises: Promise<boolean>[] = [];
    for (const content of Object.values(server.smartSwitchConfigMap)) {
        const channelId = gInstance.guildChannelIds.smartSwitches;
        if (channelId !== null && content.messageId !== null) {
            deletionPromises.push(dm.deleteMessage(guildId, channelId, content.messageId));
            content.messageId = null;
        }
    }

    for (const content of Object.values(server.smartAlarmConfigMap)) {
        const channelId = gInstance.guildChannelIds.smartAlarms;
        if (channelId !== null && content.messageId !== null) {
            deletionPromises.push(dm.deleteMessage(guildId, channelId, content.messageId));
            content.messageId = null;
        }
    }

    for (const content of Object.values(server.storageMonitorConfigMap)) {
        const channelId = gInstance.guildChannelIds.storageMonitors;
        if (channelId !== null && content.messageId !== null) {
            deletionPromises.push(dm.deleteMessage(guildId, channelId, content.messageId));
            content.messageId = null;
        }
    }

    for (const content of Object.values(server.smartSwitchGroupConfigMap)) {
        const channelId = gInstance.guildChannelIds.smartSwitchGroups;
        if (channelId !== null && content.messageId !== null) {
            deletionPromises.push(dm.deleteMessage(guildId, channelId, content.messageId));
            content.messageId = null;
        }
    }
    await Promise.allSettled(deletionPromises);

    gim.updateGuildInstance(guildId);

    rpm.removeInstance(guildId, serverId);
    await discordMessages.sendServerMessage(dm, guildId, serverId, ConnectionStatus.Disconnected, interaction);

    dm.connectionStarted = dm.connectionStarted.filter(e => e !== `${guildId}-${serverId}`);
    return true;
}

async function serverConnectButtonHandler(dm: DiscordManager, interaction: discordjs.ButtonInteraction):
    Promise<boolean> {
    const identifier = JSON.parse(interaction.customId.replace('ServerConnect', ''));
    const serverId = identifier.serverId as types.ServerId;
    const guildId = interaction.guildId as types.GuildId;
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;
    const server = gInstance.serverInfoMap[serverId];

    interaction.deferUpdate();
    if (!server) return false;

    if (dm.connectionStarted.includes(`${guildId}-${serverId}`)) return false;
    dm.connectionStarted.push(`${guildId}-${serverId}`);

    if (gInstance.serverToView === null) {
        gInstance.serverToView = serverId;
    }
    else if (gInstance.serverToView !== serverId) {
        const previousServerToView = gInstance.serverToView;
        gInstance.serverToView = serverId;

        let connectionStatus = ConnectionStatus.Disconnected;
        const rpInstance = rpm.getInstance(guildId, previousServerToView);
        if (rpInstance) {
            connectionStatus = rpInstance.connectionStatus;
        }

        await discordMessages.sendServerMessage(dm, guildId, previousServerToView, connectionStatus);
    }

    server.active = true;
    gim.updateGuildInstance(guildId);

    if (rpm.addInstance(guildId, serverId)) {
        const rpInstance = rpm.getInstance(guildId, serverId);
        if (rpInstance) {
            await rpInstance.startup();
        }
    }

    return true;
}

async function serverViewButtonHandler(dm: DiscordManager, interaction: discordjs.ButtonInteraction):
    Promise<boolean> {
    const identifier = JSON.parse(interaction.customId.replace('ServerView', ''));
    const serverId = identifier.serverId as types.ServerId;
    const guildId = interaction.guildId as types.GuildId;
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    if (gInstance.serverToView === serverId) {
        gInstance.serverToView = null;
    }
    else if (gInstance.serverToView === null) {
        gInstance.serverToView = serverId;
    }
    else {
        const previousServerToView = gInstance.serverToView;
        gInstance.serverToView = serverId;

        let connectionStatus = ConnectionStatus.Disconnected;
        const rpInstance = rpm.getInstance(guildId, previousServerToView);
        if (rpInstance) {
            connectionStatus = rpInstance.connectionStatus;
        }

        await discordMessages.sendServerMessage(dm, guildId, previousServerToView, connectionStatus);
    }
    gim.updateGuildInstance(guildId);

    let connectionStatus = ConnectionStatus.Disconnected;
    const rpInstance = rpm.getInstance(guildId, serverId);
    if (rpInstance) {
        connectionStatus = rpInstance.connectionStatus;
    }

    await discordMessages.sendServerMessage(dm, guildId, serverId, connectionStatus, interaction);

    return true;
}

async function serverDeleteButtonHandler(dm: DiscordManager, interaction: discordjs.ButtonInteraction):
    Promise<boolean> {
    const identifier = JSON.parse(interaction.customId.replace('ServerDelete', ''));
    const serverId = identifier.serverId as types.ServerId;
    const guildId = interaction.guildId as types.GuildId;
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;
    const server = gInstance.serverInfoMap[serverId];

    if (!server) {
        await interaction.message.delete();
        return true;
    }

    interaction.deferUpdate();

    server.active = false;
    rpm.removeInstance(guildId, serverId);

    const deletionPromises: Promise<boolean>[] = [];
    for (const content of Object.values(server.smartSwitchConfigMap)) {
        const channelId = gInstance.guildChannelIds.smartSwitches;
        if (channelId !== null && content.messageId !== null) {
            deletionPromises.push(dm.deleteMessage(guildId, channelId, content.messageId));
        }
    }

    for (const content of Object.values(server.smartAlarmConfigMap)) {
        const channelId = gInstance.guildChannelIds.smartAlarms;
        if (channelId !== null && content.messageId !== null) {
            deletionPromises.push(dm.deleteMessage(guildId, channelId, content.messageId));
        }
    }

    for (const content of Object.values(server.storageMonitorConfigMap)) {
        const channelId = gInstance.guildChannelIds.storageMonitors;
        if (channelId !== null && content.messageId !== null) {
            deletionPromises.push(dm.deleteMessage(guildId, channelId, content.messageId));
        }
    }

    for (const content of Object.values(server.smartSwitchGroupConfigMap)) {
        const channelId = gInstance.guildChannelIds.smartSwitchGroups;
        if (channelId !== null && content.messageId !== null) {
            deletionPromises.push(dm.deleteMessage(guildId, channelId, content.messageId));
        }
    }

    if (gInstance.guildChannelIds.servers !== null && server.messageId !== null) {
        deletionPromises.push(dm.deleteMessage(guildId, gInstance.guildChannelIds.servers, server.messageId));
    }

    await Promise.allSettled(deletionPromises);

    if (gInstance.serverToView === serverId) {
        gInstance.serverToView = null;

        /* Check if there are any other active servers that we can set view to. */
        for (const [sId, content] of Object.entries(gInstance.serverInfoMap)) {
            if (sId !== serverId && content.active) {
                gInstance.serverToView = sId;

                let connectionStatus = ConnectionStatus.Disconnected;
                const rpInstance = rpm.getInstance(guildId, sId);
                if (rpInstance) {
                    connectionStatus = rpInstance.connectionStatus;
                }

                await discordMessages.sendServerMessage(dm, guildId, sId, connectionStatus);
                break;
            }
        }

        // TODO! Remove embeds from information channel if serverToView === null
    }

    delete gInstance.serverInfoMap[serverId];
    gim.updateGuildInstance(guildId);

    return true;
}
