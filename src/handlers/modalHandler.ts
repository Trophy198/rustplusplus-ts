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

import { manageGroupCard } from './smartSwitchGroupControls';
import { manageSwitch } from './smartSwitchControls';
import * as discordjs from 'discord.js';

import { guildInstanceManager as gim } from '../../index';
import { DiscordManager } from "../managers/discordManager";
import * as types from '../utils/types';
import { GuildInstance } from '../managers/guildInstanceManager';
import * as discordMessages from '../discordUtils/discordMessages';

export async function modalHandler(dm: DiscordManager, interaction: discordjs.ModalSubmitInteraction):
    Promise<boolean> {
    if (interaction.customId.startsWith('SwitchGroup:')) return manageGroupCard(dm, interaction);
    const switchEdit = /^SmartSwitchEdit(\[.*\])$/.exec(interaction.customId);
    if (switchEdit) return manageSwitch(dm, interaction, 'edit', switchEdit[1]);
    /* GeneralSettings */
    if (interaction.customId === 'GeneralSetting-inGameChatTrademark') {
        return await inGameChatTrademarkModalHandler(dm, interaction);
    }
    else if (interaction.customId === 'GeneralSetting-inGameChatCommandPrefix') {
        return await inGameChatCommandPrefixModalHandler(dm, interaction);
    }

    return false;
}


/**
 * General Settings
 */

async function inGameChatTrademarkModalHandler(dm: DiscordManager, interaction: discordjs.ModalSubmitInteraction):
    Promise<boolean> {
    const guildId = interaction.guildId as types.GuildId;
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;
    const trademark = interaction.fields.getTextInputValue('inGameChatTrademark');

    gInstance.generalSettings.inGameChatTrademark = trademark;
    gim.updateGuildInstance(guildId);

    await interaction.deferUpdate();
    await discordMessages.updateSetting(dm, guildId, 'inGameChatTrademark');

    return true;
}

async function inGameChatCommandPrefixModalHandler(dm: DiscordManager, interaction: discordjs.ModalSubmitInteraction):
    Promise<boolean> {
    const guildId = interaction.guildId as types.GuildId;
    const gInstance = gim.getGuildInstance(guildId) as GuildInstance;
    const commandPrefix = interaction.fields.getTextInputValue('inGameChatCommandPrefix');

    gInstance.generalSettings.inGameChatCommandPrefix = commandPrefix;
    gim.updateGuildInstance(guildId);


    await interaction.deferUpdate();
    await discordMessages.updateSetting(dm, guildId, 'inGameChatCommandPrefix');
    for (const [serverId, server] of Object.entries(gInstance.serverInfoMap)) {
        if (!server.active) continue;
        for (const groupId of Object.keys(server.smartSwitchGroupConfigMap)) {
            await discordMessages.sendSmartSwitchGroupMessage(dm, guildId, serverId, groupId);
        }
        for (const entityId of Object.keys(server.smartSwitchConfigMap)) {
            await discordMessages.sendSmartSwitchMessage(dm, guildId, serverId, entityId);
        }
    }

    return true;
}