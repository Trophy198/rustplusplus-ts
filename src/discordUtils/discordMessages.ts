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
import * as path from 'path';
import { projectRoot } from '../utils/runtimePaths';
import * as rp from 'rustplus-ts';

import {
    log, guildInstanceManager as gim, credentialsManager as cm, localeManager as lm, rustPlusManager as rpm
} from '../../index';
import { ConnectionStatus, RustPlusInstance } from '../managers/rustPlusManager';
import * as constants from '../utils/constants';
import * as discordButtons from './discordButtons';
import * as discordEmbeds from './discordEmbeds';
import * as discordSelectMenus from './discordSelectMenus';
import { DiscordManager } from '../managers/discordManager';
import * as types from '../utils/types';
import { NewsNewsBody, PlayerDeathBody, TeamLoginBody } from '../managers/fcmListenerManager';
import { EventNotificationSettings, GuildInstance, SettingsMessages } from '../managers/guildInstanceManager';
import { Credentials } from '../managers/credentialsManager';


/**
 * Direct-Message based messages
 */

export async function sendCredentialsExpiredMessage(dm: DiscordManager, steamId: types.SteamId) {
    const fn = `[sendCredentialsExpiredMessage: ${steamId}]`;
    const credentials = cm.getCredentials(steamId) as Credentials;

    const user = await dm.getUser(credentials.discordUserId);
    if (!user) {
        log.warn(`${fn} Could not find user '${credentials.discordUserId}'.`);
        return;
    }

    const imagePath = path.join(__dirname, '..', 'resources/images/rustplusplus_logo.png');
    const content = {
        embeds: [await discordEmbeds.getCredentialsExpiredEmbed(dm, steamId, 'rustplusplus_logo.png')],
        components: discordButtons.getCredentialsExpiredButtons(),
        files: [new discordjs.AttachmentBuilder(imagePath)]
    };

    await dm.handleMessage(user, content, 'send');
}

export async function sendFcmPlayerDeathMessage(dm: DiscordManager, steamId: types.SteamId, title: string,
    body: PlayerDeathBody) {
    const fn = `[sendFcmPlayerDeathMessage: ${steamId}]`;
    const logParam = { steamId: steamId };

    const credentials = cm.getCredentials(steamId);
    if (!credentials) {
        log.warn(`${fn} Could not find Credentials.`, logParam);
        return;
    }

    const user = await dm.getUser(credentials.discordUserId);
    if (!user) {
        log.warn(`${fn} Could not find user '${credentials.discordUserId}'.`);
        return;
    }

    const content = {
        embeds: [await discordEmbeds.getFcmPlayerDeathEmbed(title, body)]
    };

    await dm.handleMessage(user, content, 'send');
}

export async function sendPrivateMessage(dm: DiscordManager, discordUserId: types.UserId, message: string):
    Promise<boolean> {
    const fn = `[sendPrivateMessage: ${discordUserId}]`;

    const user = await dm.getUser(discordUserId);
    if (!user) {
        log.warn(`${fn} Could not find user '${discordUserId}'.`);
        return false;
    }

    const imagePath = path.join(__dirname, '..', 'resources/images/rustplusplus_logo.png');
    const content = {
        embeds: [await discordEmbeds.getPrivateMessageEmbed(message, 'rustplusplus_logo.png')],
        files: [new discordjs.AttachmentBuilder(imagePath)]
    };

    await dm.handleMessage(user, content, 'send');
    return true;
}


/**
 * Slash Command based messages
 */

export async function sendDefaultMessage(dm: DiscordManager, interaction: discordjs.Interaction, title: string,
    description: string, parameters: { [key: string]: string } = {}) {
    const imagePath = path.join(__dirname, '..', 'resources/images/rustplusplus_logo.png');

    const content = {
        embeds: [discordEmbeds.getDefaultEmbed(dm, interaction, 'rustplusplus_logo.png', title, description,
            parameters)],
        files: [new discordjs.AttachmentBuilder(imagePath)]
    };

    await dm.handleInteractionReply(interaction, content, 'editReply');
}

export async function sendHelpMessage(dm: DiscordManager, interaction: discordjs.Interaction) {
    const imagePath = path.join(__dirname, '..', 'resources/images/rustplusplus_logo.png');

    const content = {
        embeds: [discordEmbeds.getHelpEmbed(dm, 'rustplusplus_logo.png')],
        components: discordButtons.getHelpButtons(),
        files: [new discordjs.AttachmentBuilder(imagePath)]
    };

    await dm.handleInteractionReply(interaction, content, 'editReply');
}

export async function sendRoleListMessage(dm: DiscordManager, interaction: discordjs.Interaction) {
    const imagePath = path.join(__dirname, '..', 'resources/images/rustplusplus_logo.png');

    const content = {
        embeds: [discordEmbeds.getRoleListEmbed(dm, interaction, 'rustplusplus_logo.png')],
        files: [new discordjs.AttachmentBuilder(imagePath)]
    };

    await dm.handleInteractionReply(interaction, content, 'editReply');
}

export async function sendCredentialsInfoMessage(dm: DiscordManager, interaction: discordjs.Interaction) {
    const imagePath = path.join(__dirname, '..', 'resources/images/rustplusplus_logo.png');

    const content = {
        embeds: [await discordEmbeds.getCredentialsInfoEmbed(dm, interaction, 'rustplusplus_logo.png')],
        files: [new discordjs.AttachmentBuilder(imagePath)]
    };

    await dm.handleInteractionReply(interaction, content, 'editReply');
}

export async function sendCredentialsListMessage(dm: DiscordManager, interaction: discordjs.Interaction) {
    const imagePath = path.join(__dirname, '..', 'resources/images/rustplusplus_logo.png');

    const content = {
        embeds: [await discordEmbeds.getCredentialsListEmbed(dm, interaction, 'rustplusplus_logo.png')],
        files: [new discordjs.AttachmentBuilder(imagePath)]
    };

    await dm.handleInteractionReply(interaction, content, 'editReply');
}

export async function sendAliasListMessage(dm: DiscordManager, interaction: discordjs.Interaction) {
    const imagePath = path.join(__dirname, '..', 'resources/images/rustplusplus_logo.png');

    const content = {
        embeds: [await discordEmbeds.getAliasListEmbed(dm, interaction, 'rustplusplus_logo.png')],
        files: [new discordjs.AttachmentBuilder(imagePath)]
    };

    await dm.handleInteractionReply(interaction, content, 'editReply');
}

export async function sendBlacklistListMessage(dm: DiscordManager, interaction: discordjs.Interaction) {
    const imagePath = path.join(__dirname, '..', 'resources/images/rustplusplus_logo.png');

    const content = {
        embeds: [await discordEmbeds.getBlacklistListEmbed(dm, interaction, 'rustplusplus_logo.png')],
        files: [new discordjs.AttachmentBuilder(imagePath)]
    };

    await dm.handleInteractionReply(interaction, content, 'editReply');
}

export async function sendCctvcodesMessage(dm: DiscordManager, interaction: discordjs.Interaction,
    monumentOption: string) {
    const imagePath = path.join(__dirname, '..', 'resources/images/rustplusplus_logo.png');

    const content = {
        embeds: [await discordEmbeds.getCctvcodesEmbed(dm, interaction, 'rustplusplus_logo.png', monumentOption)],
        files: [new discordjs.AttachmentBuilder(imagePath)]
    };

    await dm.handleInteractionReply(interaction, content, 'editReply');
}

export async function sendMapMessage(dm: DiscordManager, interaction: discordjs.Interaction, serverId: types.ServerId,
    imageName: string) {
    const gInstance = gim.getGuildInstance(interaction.guildId as types.GuildId) as GuildInstance;
    const imagePath = path.join(projectRoot, 'maps', `${imageName}`);

    const content = {
        embeds: [discordEmbeds.getEmbed({
            color: discordEmbeds.colorHexToNumber(constants.COLOR_DEFAULT),
            image: { url: `attachment://${imageName}` },
            footer: { text: gInstance.serverInfoMap[serverId].name }
        })],
        files: [new discordjs.AttachmentBuilder(imagePath)]
    };

    await dm.handleInteractionReply(interaction, content, 'editReply');
}


/**
 * Guild based messages
 */

export async function sendServerMessage(dm: DiscordManager, guildId: types.GuildId, serverId: types.ServerId,
    connectionStatus: ConnectionStatus, interaction: discordjs.Interaction | null = null) {
    const fn = `[sendServerMessage]`;
    const logParam = {
        guildId: guildId,
        serverId: serverId
    };

    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    const serverInfo = gInstance.serverInfoMap[serverId];
    if (!serverInfo) {
        log.warn(`${fn} Could not find ServerInfo.`, logParam);
        return;
    }

    const content = {
        embeds: [discordEmbeds.getServerEmbed(guildId, serverId, connectionStatus)],
        components: [
            await discordSelectMenus.getRequesterSteamIdSelectMenu(dm, guildId, serverId),
            discordButtons.getServerButtons(guildId, serverId, connectionStatus),
            new discordjs.ActionRowBuilder<discordjs.ButtonBuilder>()
                .addComponents(discordButtons.createSwitchGroupButton(gInstance))]
    };

    const message = await dm.sendUpdateMessage(guildId, content, gInstance.guildChannelIds.servers, serverInfo.
        messageId, interaction);

    if (interaction === null && message instanceof discordjs.Message &&
        gInstance.serverInfoMap[serverId].messageId !== message.id) {
        gInstance.serverInfoMap[serverId].messageId = message.id;
        gim.updateGuildInstance(guildId);
    }
}

// Serialize creation and coalesce edits so a burst of broadcasts leaves one card with the latest value.
const deviceCards = new Map<string, { dirty: boolean; done: Promise<void> }>();

export async function sendSmartSwitchMessage(dm: DiscordManager, guildId: types.GuildId, serverId: types.ServerId,
    entityId: types.EntityId): Promise<void> {
    const groups = gim.getGuildInstance(guildId)?.serverInfoMap[serverId]?.smartSwitchGroupConfigMap ?? {};
    await Promise.all([
        queueDeviceCard(JSON.stringify(['switch', guildId, serverId, entityId]),
            () => updateSmartSwitchCard(dm, guildId, serverId, entityId)),
        ...Object.entries(groups).filter(([, group]) => group.smartSwitches.includes(entityId))
            .map(([id]) => sendSmartSwitchGroupMessage(dm, guildId, serverId, id))
    ]);
}

export function sendSmartSwitchGroupMessage(dm: DiscordManager, guildId: string, serverId: string, groupId: string) {
    return queueDeviceCard(JSON.stringify(['switchGroup', guildId, serverId, groupId]), async () => {
        const guild = gim.getGuildInstance(guildId);
        const server = guild?.serverInfoMap[serverId];
        const group = server?.smartSwitchGroupConfigMap[groupId];
        const channel = guild?.guildChannelIds.smartSwitchGroups;
        if (!guild || !server?.active || !group || !channel) return;
        const lang = guild.generalSettings.language;
        const instance = rpm.getInstance(guildId, serverId);
        const members = [...new Set(group.smartSwitches)];
        const lines = members.map(id => {
            const value = instance?.smartSwitchValue(id);
            const state = lm.getIntl(lang, value === undefined ? 'unknown' : value ? 'buttonOn' : 'buttonOff');
            return `${server.smartSwitchConfigMap[id]?.name ?? id} · ${state}`;
        });
        const embed = new discordjs.EmbedBuilder().setTitle(group.name.slice(0, 256))
            .setFooter({ text: server.name.slice(0, 2048) })
            .setDescription(lines.join('\n').slice(0, 4096) || lm.getIntl(lang, 'groupEmpty'))
            .addFields({ name: lm.getIntl(lang, 'switchCommand'),
                value: lm.getIntl(lang, 'groupUsage', {
                    command: `\`${guild.generalSettings.inGameChatCommandPrefix}${group.command}\``
                }) });
        const disabled = !members.length || instance?.connectionStatus !== ConnectionStatus.Connected;
        const buttons = new discordjs.ActionRowBuilder<discordjs.ButtonBuilder>().addComponents(
            new discordjs.ButtonBuilder().setCustomId('SwitchGroupOn').setLabel(lm.getIntl(lang, 'buttonOn'))
                .setStyle(discordjs.ButtonStyle.Success).setDisabled(disabled),
            new discordjs.ButtonBuilder().setCustomId('SwitchGroupOff').setLabel(lm.getIntl(lang, 'buttonOff'))
                .setStyle(discordjs.ButtonStyle.Danger).setDisabled(disabled),
            new discordjs.ButtonBuilder().setCustomId('SwitchGroup:edit').setLabel(lm.getIntl(lang, 'groupButton_edit'))
                .setStyle(discordjs.ButtonStyle.Primary),
            new discordjs.ButtonBuilder().setCustomId('SwitchGroup:add').setLabel(lm.getIntl(lang, 'groupButton_add'))
                .setStyle(discordjs.ButtonStyle.Secondary),
            new discordjs.ButtonBuilder().setCustomId('SwitchGroup:remove')
                .setLabel(lm.getIntl(lang, 'groupButton_remove')).setStyle(discordjs.ButtonStyle.Secondary)
                .setDisabled(!members.length));
        const message = await dm.sendUpdateMessage(guildId, { embeds: [embed], components: [buttons] },
            channel, group.messageId);
        if (!message) return;
        const current = gim.getGuildInstance(guildId)?.serverInfoMap[serverId];
        if (!current?.active || current.smartSwitchGroupConfigMap[groupId] !== group) {
            await dm.deleteMessage(guildId, channel, message.id);
        } else if (group.messageId !== message.id) {
            group.messageId = message.id;
            gim.updateGuildInstance(guildId);
        }
    });
}

function queueDeviceCard(key: string, update: () => Promise<void>) {
    const pending = deviceCards.get(key);
    if (pending) {
        pending.dirty = true;
        return pending.done;
    }
    const job = { dirty: true, done: Promise.resolve() };
    deviceCards.set(key, job);
    job.done = (async () => {
        try {
            while (job.dirty) {
                job.dirty = false;
                await update();
            }
        } finally {
            deviceCards.delete(key);
        }
    })();
    return job.done;
}

async function updateSmartSwitchCard(dm: DiscordManager, guildId: types.GuildId, serverId: types.ServerId,
    entityId: types.EntityId) {
    const gInstance = gim.getGuildInstance(guildId);
    const server = gInstance?.serverInfoMap[serverId];
    const smartSwitchConfig = server?.smartSwitchConfigMap[entityId];
    if (!gInstance || !server?.active || !smartSwitchConfig) return;
    const instance = rpm.getInstance(guildId, serverId);
    const active = instance?.smartSwitchValue(entityId);

    const content = {
        embeds: [discordEmbeds.getSmartSwitchEmbed(guildId, serverId, entityId, active)],
        components: [
            discordButtons.getSmartSwitchButtons(guildId, serverId, entityId, active,
                instance?.connectionStatus === ConnectionStatus.Connected)
        ],
        files: [
            new discordjs.AttachmentBuilder(path.join(__dirname, '..', 'resources', 'images', 'electrics',
                smartSwitchConfig.img))
        ]
    };

    const channelId = gInstance.guildChannelIds.smartSwitches;
    if (!channelId) return;
    const message = await dm.sendUpdateMessage(guildId, content, channelId, smartSwitchConfig.messageId);
    if (!message) return;
    const current = gim.getGuildInstance(guildId)?.serverInfoMap[serverId];
    if (!current?.active || current.smartSwitchConfigMap[entityId] !== smartSwitchConfig) {
        // Disconnect/delete may finish while Discord is creating the first card.
        await dm.deleteMessage(guildId, channelId, message.id);
        return;
    }
    if (smartSwitchConfig.messageId !== message.id) {
        smartSwitchConfig.messageId = message.id;
        gim.updateGuildInstance(guildId);
    }
}

export function sendSmartAlarmMessage(dm: DiscordManager, guildId: types.GuildId, serverId: types.ServerId,
    entityId: types.EntityId) {
    return queueDeviceCard(JSON.stringify(['alarm', guildId, serverId, entityId]), async () => {
        const guild = gim.getGuildInstance(guildId);
        const server = guild?.serverInfoMap[serverId];
        const device = server?.smartAlarmConfigMap[entityId];
        const channelId = guild?.guildChannelIds.smartAlarms;
        if (!server?.active || !device || !channelId) return;
        const value = rpm.getInstance(guildId, serverId)?.smartAlarmValue(entityId);
        const content = {
            embeds: [discordEmbeds.getSmartAlarmEmbed(guildId, serverId, entityId, value)],
            components: [discordButtons.getSmartAlarmButtons(guildId, serverId, entityId)],
            files: [new discordjs.AttachmentBuilder(path.join(__dirname, '..', 'resources', 'images', 'electrics',
                device.img))]
        };
        const message = await dm.sendUpdateMessage(guildId, content, channelId, device.messageId);
        if (!message) return;
        const current = gim.getGuildInstance(guildId)?.serverInfoMap[serverId];
        if (!current?.active || current.smartAlarmConfigMap[entityId] !== device) {
            await dm.deleteMessage(guildId, channelId, message.id);
        } else if (device.messageId !== message.id) {
            device.messageId = message.id;
            gim.updateGuildInstance(guildId);
        }
    });
}

export function sendStorageMonitorMessage(dm: DiscordManager, guildId: types.GuildId, serverId: types.ServerId,
    entityId: types.EntityId) {
    return queueDeviceCard(JSON.stringify(['storage', guildId, serverId, entityId]), async () => {
        const guild = gim.getGuildInstance(guildId);
        const server = guild?.serverInfoMap[serverId];
        const device = server?.storageMonitorConfigMap[entityId];
        const channelId = guild?.guildChannelIds.storageMonitors;
        if (!server?.active || !device || !channelId) return;
        const payload = rpm.getInstance(guildId, serverId)?.storageMonitors.value(entityId);
        const content = {
            embeds: [discordEmbeds.getStorageMonitorEmbed(guildId, serverId, entityId, payload)],
            components: [],
            files: [new discordjs.AttachmentBuilder(path.join(__dirname, '..', 'resources', 'images', 'electrics',
                device.img))]
        };
        const message = await dm.sendUpdateMessage(guildId, content, channelId, device.messageId);
        if (!message) return;
        const current = gim.getGuildInstance(guildId)?.serverInfoMap[serverId];
        if (!current?.active || current.storageMonitorConfigMap[entityId] !== device) {
            await dm.deleteMessage(guildId, channelId, message.id);
        } else if (device.messageId !== message.id) {
            device.messageId = message.id;
            gim.updateGuildInstance(guildId);
        }
    });
}

export async function sendInformationChannelMapMessage(dm: DiscordManager, rpInstance: RustPlusInstance,
    mapPath: string) {
    const guildId = rpInstance.guildId;

    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    const content = {
        files: [new discordjs.AttachmentBuilder(path.join(projectRoot, 'maps', mapPath))]
    };

    const message = await dm.sendUpdateMessage(guildId, content, gInstance.guildChannelIds.information,
        gInstance.informationChannelMessageIds.map);

    if (message instanceof discordjs.Message && gInstance.informationChannelMessageIds.map !== message.id) {
        gInstance.informationChannelMessageIds.map = message.id;
        gim.updateGuildInstance(guildId);
    }
}

export async function sendInformationChannelServerEventMessage(dm: DiscordManager, rpInstance: RustPlusInstance) {
    const guildId = rpInstance.guildId;
    const serverId = rpInstance.serverId;

    const fn = `[sendInformationChannelServerEventMessage]`;
    const logParam = {
        guildId: guildId,
        serverId: serverId
    };

    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    const serverInfo = gInstance.serverInfoMap[serverId];
    if (!serverInfo) {
        log.warn(`${fn} Could not find ServerInfo.`, logParam);
        return;
    }

    const content = {
        embeds: [
            discordEmbeds.getInformationChannelServerEmbed(rpInstance),
            discordEmbeds.getInformationChannelEventEmbed(rpInstance)],
        files: [
            new discordjs.AttachmentBuilder(path.join(__dirname, '..', 'resources', 'images', 'server_info_logo.png')),
            new discordjs.AttachmentBuilder(path.join(__dirname, '..', 'resources', 'images', 'event_info_logo.png'))
        ]
    };

    const message = await dm.sendUpdateMessage(guildId, content, gInstance.guildChannelIds.information,
        gInstance.informationChannelMessageIds.serverEvent);

    if (message instanceof discordjs.Message && gInstance.informationChannelMessageIds.serverEvent !== message.id) {
        gInstance.informationChannelMessageIds.serverEvent = message.id;
        gim.updateGuildInstance(guildId);
    }
}

export async function sendInformationChannelTeamMessage(dm: DiscordManager, rpInstance: RustPlusInstance) {
    const guildId = rpInstance.guildId;
    const serverId = rpInstance.serverId;

    const fn = `[sendInformationChannelTeamMessage]`;
    const logParam = {
        guildId: guildId,
        serverId: serverId
    };

    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    const serverInfo = gInstance.serverInfoMap[serverId];
    if (!serverInfo) {
        log.warn(`${fn} Could not find ServerInfo.`, logParam);
        return;
    }

    const content = {
        embeds: [
            discordEmbeds.getInformationChannelTeamEmbed(rpInstance)],
        files: [
            new discordjs.AttachmentBuilder(path.join(__dirname, '..', 'resources', 'images', 'team_info_logo.png'))
        ]
    };

    const message = await dm.sendUpdateMessage(guildId, content, gInstance.guildChannelIds.information,
        gInstance.informationChannelMessageIds.team);

    if (message instanceof discordjs.Message && gInstance.informationChannelMessageIds.team !== message.id) {
        gInstance.informationChannelMessageIds.team = message.id;
        gim.updateGuildInstance(guildId);
    }
}


/**
 * Notifications based messages
 */

export async function sendSmartAlarmNotification(dm: DiscordManager, guildId: string, serverId: string,
    title: string, message: string, everyone: boolean, nonce: string) {
    const guild = gim.getGuildInstance(guildId);
    if (!guild?.guildChannelIds.activity) return false;
    const content: discordjs.MessageCreateOptions = {
        embeds: [discordEmbeds.getFcmAlarmTriggerEmbed(guildId, serverId, title, message)],
        content: everyone ? '@everyone' : '',
        allowedMentions: { parse: everyone ? ['everyone'] : [] },
        nonce, enforceNonce: true
    };
    return !!await dm.sendUpdateMessage(guildId, content, guild.guildChannelIds.activity);
}

export async function sendFcmAlarmPluginTriggerMessage(dm: DiscordManager, guildId: types.GuildId,
    serverId: types.ServerId, title: string, message: string) {
    const fn = `[sendFcmAlarmPluginTriggerMessage]`;
    const logParam = {
        guildId: guildId,
        serverId: serverId
    };

    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    const serverInfo = gInstance.serverInfoMap[serverId];
    if (!serverInfo) {
        log.warn(`${fn} Could not find ServerInfo.`, logParam);
        return;
    }

    const content = {
        embeds: [discordEmbeds.getFcmAlarmPluginTriggerEmbed(guildId, serverId, title, message)],
        content: gInstance.generalSettings.fcmAlarmPluginNotifyEveryone ? '@everyone' : '',
    }

    await dm.sendUpdateMessage(guildId, content, gInstance.guildChannelIds.activity);
}

export async function sendFcmTeamLoginMessage(dm: DiscordManager, guildId: types.GuildId, body: TeamLoginBody) {
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    const content = {
        embeds: [await discordEmbeds.getFcmTeamLoginEmbed(guildId, body)]
    }

    await dm.sendUpdateMessage(guildId, content, gInstance.guildChannelIds.activity);
}

export async function sendFcmNewsNewsMessage(dm: DiscordManager, guildId: types.GuildId, title: string,
    message: string, body: NewsNewsBody) {
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    const content = {
        embeds: [discordEmbeds.getFcmNewsNewsEmbed(guildId, title, message)],
        components: [discordButtons.getFcmNewsNewsButton(guildId, body)]
    }

    await dm.sendUpdateMessage(guildId, content, gInstance.guildChannelIds.activity);
}

export async function sendEventNotificationMessage(dm: DiscordManager, guildId: types.GuildId,
    serverId: types.ServerId, setting: keyof EventNotificationSettings, text: string) {
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;
    const serverInfo = gInstance.serverInfoMap[serverId];
    const settingData = gInstance.eventNotificationSettings[setting];

    const content = {
        embeds: [discordEmbeds.getEmbed({
            title: text,
            timestamp: new Date(),
            color: discordEmbeds.colorHexToNumber(settingData.color),
            footer: { text: serverInfo.name, iconURL: serverInfo.img },
            thumbnail: { url: `attachment://${settingData.image}` },
        })],
        files: [
            new discordjs.AttachmentBuilder(path.join(__dirname, '..', 'resources', 'images', 'events',
                settingData.image))
        ]
    };

    await dm.sendUpdateMessage(guildId, content, gInstance.guildChannelIds.events);
}

export async function sendActivityNotificationMessage(dm: DiscordManager, guildId: types.GuildId,
    serverId: types.ServerId, text: string, color: string, steamId: types.SteamId, everyone: boolean = false) {
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    const content = {
        embeds: [await discordEmbeds.getActivityNotificationEmbed(guildId, serverId, text, color, steamId)],
        content: everyone ? '@everyone' : ''
    };

    await dm.sendUpdateMessage(guildId, content, gInstance.guildChannelIds.activity);
}


/**
 * Response based messages
 */

export async function sendPrefixCommandResponseMessage(dm: DiscordManager, guildId: types.GuildId, message: string) {
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    const content = {
        embeds: [discordEmbeds.getEmbed({
            title: message,
            color: discordEmbeds.colorHexToNumber(constants.COLOR_DEFAULT)
        })]
    }

    await dm.sendUpdateMessage(guildId, content, gInstance.guildChannelIds.commands);
}

export async function sendTeamChatMessage(dm: DiscordManager, guildId: types.GuildId, teamMessage: rp.AppTeamMessage) {
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    let color = discordEmbeds.colorHexToNumber(constants.COLOR_DEFAULT);
    if (Object.hasOwn(gInstance.teamMemberChatColorMap, teamMessage.steamId)) {
        color = discordEmbeds.colorHexToNumber(gInstance.teamMemberChatColorMap[teamMessage.steamId]);
    }

    const content = {
        embeds: [discordEmbeds.getEmbed({
            color: color,
            description: `**${teamMessage.name}**: ${teamMessage.message}`
        })]
    }

    await dm.sendUpdateMessage(guildId, content, gInstance.guildChannelIds.teamchat);
}


/**
 * Settings based messages
 */

// Only cards backed by settings used by the bot on the standard Rust+ protocol.
export const settingsCards = {
    generalSettingsHeader,
    language,
    voiceGender,
    inGameChatFunctionalityEnabled,
    inGameChatBotUnmuted,
    inGameChatTrademark,
    inGameChatCommandPrefix,
    inGameChatCommandsEnabled,
    inGameChatMessageDelay,
    inGameChatNotifySmartSwitchChangedFromDiscord,
    inGameChatNotify,
    fcmAlarmNotify,
    fcmAlarmPluginNotify,
} satisfies Partial<Record<keyof SettingsMessages, (guildId: types.GuildId) => discordjs.MessageCreateOptions>>;

export function isSettingsCard(key: keyof SettingsMessages): key is keyof typeof settingsCards {
    return Object.hasOwn(settingsCards, key);
}

export async function updateSetting(dm: DiscordManager, guildId: types.GuildId, key: keyof typeof settingsCards,
    interaction?: discordjs.Interaction) {
    const guild = gim.getGuildInstance(guildId);
    const channelId = guild?.guildChannelIds.settings;
    if (!guild || !channelId) return;

    const content = settingsCards[key](guildId);
    if (interaction) {
        await dm.handleInteractionReply(interaction, content, 'update');
    } else {
        const messageId = guild.settingsMessages[key];
        const message = messageId && await dm.getMessage(guildId, channelId, messageId);
        if (message && message.author.id === dm.client.user?.id) {
            await dm.handleMessage(message, content, 'edit');
        }
    }
}

function generalSettingsHeader(guildId: types.GuildId) {
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;

    const language = gInstance.generalSettings.language === 'pt' ? 'en' : gInstance.generalSettings.language;
    return {
        attachments: [],
        files: [
            new discordjs.AttachmentBuilder(path.join(__dirname, '..', 'resources', 'images', 'settings',
                `general_settings_logo_${language}.png`))
        ]
    };
}

function language(guildId: types.GuildId) {
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;
    const language = gInstance.generalSettings.language;

    return {
        embeds: [discordEmbeds.getEmbed({
            title: `**${lm.getIntl(language, 'settingLanguageTitle')} :earth_africa:**`,
            description: `${lm.getIntl(language, 'settingLanguageDesc')}`,
            color: discordEmbeds.colorHexToNumber(constants.COLOR_DEFAULT)
        })],
        components: [
            discordSelectMenus.getSettingLanguageSelectMenu(guildId)
        ]
    };
}

function voiceGender(guildId: types.GuildId) {
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;
    const language = gInstance.generalSettings.language;

    return {
        embeds: [discordEmbeds.getEmbed({
            title: `**${lm.getIntl(language, 'settingVoiceGenderTitle')} :man:/:woman:**`,
            description: `${lm.getIntl(language, 'settingVoiceGenderDesc')}`,
            color: discordEmbeds.colorHexToNumber(constants.COLOR_DEFAULT)
        })],
        components: [
            discordSelectMenus.getSettingVoiceGenderSelectMenu(guildId)
        ]
    };
}

function inGameChatFunctionalityEnabled(guildId: types.GuildId) {
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;
    const language = gInstance.generalSettings.language;

    return {
        embeds: [discordEmbeds.getEmbed({
            title: `**${lm.getIntl(language, 'settingInGameChatFunctionalityEnabledTitle')} :speech_left:**`,
            description: `${lm.getIntl(language, 'settingInGameChatFunctionalityEnabledDesc')}`,
            color: discordEmbeds.colorHexToNumber(constants.COLOR_DEFAULT)
        })],
        components: [
            discordButtons.getSettingInGameChatFunctionalityEnabledButton(guildId)
        ]
    };
}

function inGameChatBotUnmuted(guildId: types.GuildId) {
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;
    const language = gInstance.generalSettings.language;

    return {
        embeds: [discordEmbeds.getEmbed({
            title: `**${lm.getIntl(language, 'settingInGameChatBotUnmutedTitle')} :shushing_face:**`,
            description: `${lm.getIntl(language, 'settingInGameChatBotUnmutedDesc')}`,
            color: discordEmbeds.colorHexToNumber(constants.COLOR_DEFAULT)
        })],
        components: [
            discordButtons.getSettingInGameChatBotUnmutedButton(guildId)
        ]
    };
}

function inGameChatTrademark(guildId: types.GuildId) {
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;
    const language = gInstance.generalSettings.language;

    const trademark = gInstance.generalSettings.inGameChatTrademark;
    const description = lm.getIntl(language, 'settingInGameChatTrademarkDesc', {
        trademark: trademark === '' ? '' : `\`${trademark}\``
    });

    return {
        embeds: [discordEmbeds.getEmbed({
            title: `**${lm.getIntl(language, 'settingInGameChatTrademarkTitle')} :tm:**`,
            description: description,
            color: discordEmbeds.colorHexToNumber(constants.COLOR_DEFAULT)
        })],
        components: [
            discordButtons.getSettingInGameChatTrademarkButton(guildId)
        ]
    };
}

function inGameChatCommandPrefix(guildId: types.GuildId) {
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;
    const language = gInstance.generalSettings.language;

    const commandPrefix = gInstance.generalSettings.inGameChatCommandPrefix;
    const description = lm.getIntl(language, 'settingInGameChatCommandPrefixDesc', {
        prefix: `\`${commandPrefix}\``
    });

    return {
        embeds: [discordEmbeds.getEmbed({
            title: `**${lm.getIntl(language, 'settingInGameChatCommandPrefixTitle')} :symbols:**`,
            description: description,
            color: discordEmbeds.colorHexToNumber(constants.COLOR_DEFAULT)
        })],
        components: [
            discordButtons.getSettingInGameChatCommandPrefixButton(guildId)
        ]
    };
}

function inGameChatCommandsEnabled(guildId: types.GuildId) {
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;
    const language = gInstance.generalSettings.language;

    return {
        embeds: [discordEmbeds.getEmbed({
            title: `**${lm.getIntl(language, 'settingInGameChatCommandsEnabledTitle')} :keyboard:**`,
            description: `${lm.getIntl(language, 'settingInGameChatCommandsEnabledDesc')}`,
            color: discordEmbeds.colorHexToNumber(constants.COLOR_DEFAULT)
        })],
        components: [
            discordButtons.getSettingInGameChatCommandsEnabledButton(guildId)
        ]
    };
}

function inGameChatMessageDelay(guildId: types.GuildId) {
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;
    const language = gInstance.generalSettings.language;

    return {
        embeds: [discordEmbeds.getEmbed({
            title: `**${lm.getIntl(language, 'settingInGameChatMessageDelayTitle')} :timer:**`,
            description: `${lm.getIntl(language, 'settingInGameChatMessageDelayDesc')}`,
            color: discordEmbeds.colorHexToNumber(constants.COLOR_DEFAULT)
        })],
        components: [
            discordSelectMenus.getSettingInGameChatMessageDelaySelectMenu(guildId)
        ]
    };
}

function inGameChatNotifySmartSwitchChangedFromDiscord(guildId: types.GuildId) {
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;
    const language = gInstance.generalSettings.language;

    return {
        embeds: [discordEmbeds.getEmbed({
            title: `**${lm.getIntl(language, 'settingInGameChatNotifySmartSwitchChangedFromDiscordTitle')} ` +
                `:bell:**`,
            description: `${lm.getIntl(language, 'settingInGameChatNotifySmartSwitchChangedFromDiscordDesc')}`,
            color: discordEmbeds.colorHexToNumber(constants.COLOR_DEFAULT)
        })],
        components: [
            discordButtons.getSettingInGameChatNotifySmartSwitchChangedFromDiscordButton(guildId)
        ]
    };
}

function inGameChatNotify(guildId: types.GuildId) {
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;
    const language = gInstance.generalSettings.language;

    return {
        embeds: [discordEmbeds.getEmbed({
            title: `**${lm.getIntl(language, 'settingInGameChatNotifyTitle')} :bell:**`,
            description: `${lm.getIntl(language, 'settingInGameChatNotifyDesc')}`,
            color: discordEmbeds.colorHexToNumber(constants.COLOR_DEFAULT)
        })],
        components: [
            discordButtons.getSettingInGameChatNotifyButtons(guildId)
        ]
    };
}

function fcmAlarmNotify(guildId: types.GuildId) {
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;
    const language = gInstance.generalSettings.language;

    return {
        embeds: [discordEmbeds.getEmbed({
            title: `**${lm.getIntl(language, 'settingFcmAlarmNotifyTitle')} :bell:**`,
            description: `${lm.getIntl(language, 'settingFcmAlarmNotifyDesc')}`,
            color: discordEmbeds.colorHexToNumber(constants.COLOR_DEFAULT)
        })],
        components: [
            discordButtons.getSettingFcmAlarmNotifyButtons(guildId)
        ]
    };
}

function fcmAlarmPluginNotify(guildId: types.GuildId) {
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;
    const language = gInstance.generalSettings.language;

    return {
        embeds: [discordEmbeds.getEmbed({
            title: `**${lm.getIntl(language, 'settingFcmAlarmPluginNotifyTitle')} :boom:**`,
            description: `${lm.getIntl(language, 'settingFcmAlarmPluginNotifyDesc', {
                link: `[${lm.getIntl(language, 'linkToThePlugin')}](https://umod.org/plugins/raid-alarm)`
            })}`,
            color: discordEmbeds.colorHexToNumber(constants.COLOR_DEFAULT)
        })],
        components: [
            discordButtons.getSettingFcmAlarmPluginNotifyButtons(guildId)
        ]
    };
}
