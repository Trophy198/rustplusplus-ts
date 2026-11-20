import * as discordjs from 'discord.js';
import { isUint64String } from 'rustplus-ts';
import { guildInstanceManager as gim, localeManager as lm, rustPlusManager as rpm } from '../../index';
import { sendSmartSwitchMessage, sendSmartSwitchGroupMessage } from '../discordUtils/discordMessages';
import { DiscordManager } from '../managers/discordManager';
import { GuildInstance } from '../managers/guildInstanceManager';
import { prefixCommandNames } from '../utils/runtimePaths';

export function switchCardTarget(guild: GuildInstance, identifier: string, messageId?: string) {
    let ids: unknown;
    try { ids = JSON.parse(identifier); } catch { return; }
    if (!messageId || !Array.isArray(ids) || ids.length !== 2 ||
        typeof ids[0] !== 'string' || !isUint64String(ids[1])) return;
    const [serverId, entityId] = ids as [string, string];
    const server = guild.serverInfoMap[serverId];
    const device = server?.smartSwitchConfigMap?.[entityId];
    if (device?.messageId === messageId) return { serverId, entityId, server, device };
}

export function switchCommandError(guild: GuildInstance, serverId: string, command: string,
    except?: { command: string }) {
    if (!/^[\p{L}\p{N}_-]{1,32}$/u.test(command) || /^\d+$/.test(command)) return 'switchInvalidCommand';
    const server = guild.serverInfoMap[serverId];
    const reserved = prefixCommandNames().some(key => key === command ||
        lm.getIntl(guild.generalSettings.language, `prefixCommand-${key}`).toLowerCase() === command);
    if (reserved || guild.aliases.some(alias => alias.alias.toLowerCase() === command) ||
        [...Object.values(server.smartSwitchConfigMap), ...Object.values(server.smartSwitchGroupConfigMap)]
            .some(entry => entry !== except && entry.command?.toLowerCase() === command)) return 'switchCommandTaken';
}

export function editSwitch(guild: GuildInstance, serverId: string, entityId: string,
    changes: { name?: string; command?: string; img?: string }) {
    const server = guild.serverInfoMap[serverId];
    const device = server.smartSwitchConfigMap[entityId];
    const name = changes.name?.trim() ?? device.name;
    const command = changes.command?.trim().toLowerCase() ?? device.command;
    if (!name || name.length > 80) return 'switchInvalidName';
    if (changes.command !== undefined && command !== entityId) {
        const error = switchCommandError(guild, serverId, command, device);
        if (error) return error;
    }
    const before = { name: device.name, command: device.command, img: device.img };
    Object.assign(device, { name, command, img: changes.img ?? device.img });
    if (!gim.updateGuildInstance(guild.guildId)) {
        Object.assign(device, before);
        return 'errorDescUnknownError';
    }
}

type SwitchInteraction = discordjs.ButtonInteraction | discordjs.ModalSubmitInteraction;

export async function manageSwitch(dm: DiscordManager, interaction: SwitchInteraction, action: 'edit' | 'remove',
    identifier: string) {
    const openModal = action === 'edit' && interaction.isButton();
    if (!openModal) await interaction.deferUpdate();
    const guild = interaction.guildId && gim.getGuildInstance(interaction.guildId);
    if (!guild) return false;
    const language = guild.generalSettings.language;
    async function reject(key: string) {
        const reply = { content: lm.getIntl(language, key), flags: discordjs.MessageFlags.Ephemeral as const };
        if (openModal) await interaction.reply(reply);
        else await interaction.followUp(reply);
        return false;
    }
    if (!dm.validPermissions(interaction)) return reject('errorDescMissingPermission');
    const target = switchCardTarget(guild, identifier, interaction.message?.id);
    if (!target) return reject('switchCardExpired');
    const { server, serverId, entityId, device } = target;
    if (action === 'remove') {
        const memberships = Object.entries(server.smartSwitchGroupConfigMap)
            .filter(([, group]) => group.smartSwitches.includes(entityId))
            .map(([id, group]) => ({ id, group, previous: group.smartSwitches }));
        for (const { group, previous } of memberships) group.smartSwitches = previous.filter(id => id !== entityId);
        delete server.smartSwitchConfigMap[entityId];
        if (!gim.updateGuildInstance(guild.guildId)) {
            server.smartSwitchConfigMap[entityId] = device;
            for (const { group, previous } of memberships) group.smartSwitches = previous;
            return reject('errorDescUnknownError');
        }
        const instance = rpm.getInstance(guild.guildId, serverId);
        instance?.forgetSmartSwitch(entityId);
        for (const { id } of memberships) instance?.cancelSwitchGroupTimer(id);
        await Promise.all(memberships.map(({ id }) => sendSmartSwitchGroupMessage(dm, guild.guildId, serverId, id)));
        const channel = guild.guildChannelIds.smartSwitches;
        if (channel && device.messageId && !await dm.deleteMessage(guild.guildId, channel, device.messageId)) {
            return reject('switchCardDeleteFailed');
        }
        return true;
    }
    if (interaction.isButton()) {
        const field = (id: string, label: string, value: string, max: number) =>
            new discordjs.ActionRowBuilder<discordjs.TextInputBuilder>().addComponents(new discordjs.TextInputBuilder()
                .setCustomId(id).setLabel(lm.getIntl(language, label)).setStyle(discordjs.TextInputStyle.Short)
                .setRequired(true).setMaxLength(max).setValue(value.slice(0, max)));
        const modal = new discordjs.ModalBuilder().setCustomId(`SmartSwitchEdit${identifier}`)
            .setTitle(lm.getIntl(language, 'switchEditTitle'))
            .addComponents(field('name', 'switchName', device.name, 80),
                field('command', 'switchCommand', device.command || entityId, 32));
        await interaction.showModal(modal);
        return true;
    }
    const error = editSwitch(guild, serverId, entityId, { name: interaction.fields.getTextInputValue('name'),
        command: interaction.fields.getTextInputValue('command') });
    if (error) return reject(error);
    await sendSmartSwitchMessage(dm, guild.guildId, serverId, entityId);
    return true;
}
