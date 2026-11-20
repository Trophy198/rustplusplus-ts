import { randomBytes } from 'node:crypto';
import { ButtonInteraction, ComponentType, LabelBuilder, MessageFlags, ModalBuilder, ModalSubmitInteraction,
    StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { guildInstanceManager as gim, localeManager as lm, rustPlusManager as rpm } from '../../index';
import { sendSmartSwitchGroupMessage } from '../discordUtils/discordMessages';
import type { DiscordManager } from '../managers/discordManager';
import type { GuildInstance } from '../managers/guildInstanceManager';
import { switchCommandError } from './smartSwitchControls';

export async function changeSwitchGroup(dm: DiscordManager, guild: GuildInstance, serverId: string, action: string,
    input: { groupId?: string | null; name?: string | null; command?: string | null; member?: string | null;
        members?: string[] }) {
    if (!Object.hasOwn(guild.serverInfoMap, serverId)) return 'groupMissing';
    const server = guild.serverInfoMap[serverId], groups = server.smartSwitchGroupConfigMap;
    const groupId = action === 'create' ? randomBytes(8).toString('hex') : input.groupId ?? '';
    const group = Object.hasOwn(groups, groupId) ? groups[groupId] : undefined;
    if (action !== 'create' && !group) return 'groupMissing';
    let undo: () => void;
    if (action === 'create' || action === 'edit') {
        const nameInput = input.name ?? null;
        const commandInput = input.command ?? null;
        if (nameInput === null && commandInput === null) return 'groupEditOptions';
        const name = nameInput?.trim() ?? group?.name;
        let command = commandInput?.trim().toLowerCase() || group?.command;
        if (!name || name.length > 80) return 'switchInvalidName';
        if (!command && action === 'create') {
            const slug = name.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 25);
            const base = slug && !/^\d+$/.test(slug) ? slug : 'group';
            command = base;
            for (let n = 2; switchCommandError(guild, serverId, command) === 'switchCommandTaken'; n++) {
                command = base + '-' + n;
            }
        }
        if (!command) return 'groupInvalidCommand';
        if (commandInput !== null) {
            const error = switchCommandError(guild, serverId, command, group);
            if (error) return error === 'switchInvalidCommand' ? 'groupInvalidCommand' : error;
        }
        if (group) {
            const old = { name: group.name, command: group.command };
            undo = () => { Object.assign(group, old); };
            Object.assign(group, { name, command });
        } else {
            const smartSwitches = [...new Set(input.members ?? [])];
            if (smartSwitches.some(id => !Object.hasOwn(server.smartSwitchConfigMap, id))) return 'groupMissing';
            groups[groupId] = { name, command, messageId: null, image: 'smart_switch.png', smartSwitches };
            undo = () => { delete groups[groupId]; };
        }
    } else if (group && (action === 'add' || action === 'remove')) {
        const member = input.member ?? '';
        const original = group.smartSwitches;
        if (action === 'add' && !Object.hasOwn(server.smartSwitchConfigMap, member)) return 'groupMissing';
        if (original.includes(member) === (action === 'add')) return 'groupMembershipChanged';
        undo = () => { group.smartSwitches = original; };
        group.smartSwitches = action === 'add' ? [...original, member] : original.filter(id => id !== member);
    } else if (group && action === 'delete') {
        delete groups[groupId];
        undo = () => { groups[groupId] = group; };
    } else return 'groupMissing';
    if (!gim.updateGuildInstance(guild.guildId)) { undo(); return 'errorDescUnknownError'; }
    if (action === 'delete' || action === 'add' || action === 'remove') {
        rpm.getInstance(guild.guildId, serverId)?.cancelSwitchGroupTimer(groupId);
    }
    if (action === 'delete') {
        const channel = guild.guildChannelIds.smartSwitchGroups;
        if (group?.messageId && channel && !await dm.deleteMessage(guild.guildId, channel, group.messageId)) {
            return 'groupCardDeleteFailed';
        }
    } else await sendSmartSwitchGroupMessage(dm, guild.guildId, serverId, groupId);
}

export function switchGroupCardTarget(guild: GuildInstance, messageId?: string) {
    if (!messageId) return;
    for (const [serverId, server] of Object.entries(guild.serverInfoMap)) {
        if (!server.active) continue;
        const match = Object.entries(server.smartSwitchGroupConfigMap).find(([, g]) => g.messageId === messageId);
        if (match) return { serverId, server, groupId: match[0], group: match[1] };
    }
}

export async function manageGroupCard(dm: DiscordManager, interaction: ButtonInteraction | ModalSubmitInteraction) {
    const guild = interaction.guildId && gim.getGuildInstance(interaction.guildId);
    if (!guild) return false;
    const lang = guild.generalSettings.language;
    const action = interaction.customId.slice('SwitchGroup:'.length);
    const respond = async (key: string) => {
        const content = lm.getIntl(lang, key);
        if (interaction.deferred) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
        else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        return false;
    };
    if (!dm.validPermissions(interaction)) return respond('errorDescMissingPermission');
    if (action === 'create') {
        const source = () => {
            const id = interaction.message?.id;
            if (!id) return;
            for (const [serverId, server] of Object.entries(guild.serverInfoMap)) {
                if (server.messageId === id) return { serverId, server, first: undefined };
                const first = Object.values(server.smartSwitchConfigMap).find(device => device.messageId === id);
                if (server.active && first) return { serverId, server, first: first.entityId };
            }
        };
        const from = source();
        if (!from) return respond('groupUnavailable');
        if (interaction.isButton()) {
            const label = (key: string) => new LabelBuilder().setLabel(lm.getIntl(lang, key));
            const modal = new ModalBuilder().setCustomId(interaction.customId)
                .setTitle(lm.getIntl(lang, 'groupButton_create'))
                .addLabelComponents(label('groupName').setTextInputComponent(new TextInputBuilder()
                    .setCustomId('name').setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(true)));
            const ids = Object.keys(from.server.smartSwitchConfigMap);
            const choices = (from.first ? [from.first, ...ids.filter(id => id !== from.first)] : ids).slice(0, 25);
            if (choices.length) {
                const field = label('groupInitialMembers');
                if (ids.length > choices.length) field.setDescription(lm.getIntl(lang, 'groupMoreMembers'));
                modal.addLabelComponents(field.setStringSelectMenuComponent(new StringSelectMenuBuilder()
                    .setCustomId('members').setMinValues(0).setMaxValues(choices.length).setRequired(false)
                    .setOptions(choices.map(value => ({ value, label: (from.server.smartSwitchConfigMap[value].name ||
                        value).slice(0, 100), description: value, default: value === from.first })))));
            }
            await interaction.showModal(modal);
            return true;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const members = interaction.fields.fields.has('members') ?
            [...interaction.fields.getStringSelectValues('members')] : [];
        const error = source()?.serverId !== from.serverId ? 'groupUnavailable' :
            await changeSwitchGroup(dm, guild, from.serverId, 'create', {
                name: interaction.fields.getTextInputValue('name'), members
            });
        const channelId = guild.guildChannelIds.smartSwitchGroups;
        await interaction.editReply(lm.getIntl(lang, error ?? 'groupSaved') +
            (!error && from.server.active && channelId ? ' <#' + channelId + '>' : ''));
        return !error;
    }
    const target = switchGroupCardTarget(guild, interaction.message?.id);
    if (!target) return respond('groupUnavailable');
    const { server, group, groupId, serverId } = target;
    if (!['edit', 'add', 'remove'].includes(action)) return respond('groupUnavailable');
    if (interaction.isButton()) {
        const modal = new ModalBuilder().setCustomId(interaction.customId)
            .setTitle(lm.getIntl(lang, 'groupButton_' + action));
        const textField = (id: string, label: string, max: number, value?: string) => {
            const input = new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short)
                .setRequired(true).setMaxLength(max);
            if (value) input.setValue(value.slice(0, max));
            return new LabelBuilder().setLabel(lm.getIntl(lang, label)).setTextInputComponent(input);
        };
        if (action === 'edit') {
            modal.addLabelComponents(textField('name', 'groupName', 80, group.name),
                textField('command', 'switchCommand', 32, group.command));
        } else {
            const members = new Set(group.smartSwitches);
            const choices = action === 'remove' ? [...members] : Object.keys(server.smartSwitchConfigMap)
                .filter(id => !members.has(id));
            if (!choices.length) return respond('groupNoCandidates');
            if (choices.length <= 25) {
                const select = new StringSelectMenuBuilder().setCustomId('member').setOptions(choices.map(value => ({
                    label: (server.smartSwitchConfigMap[value]?.name || value).slice(0, 100), description: value, value
                })));
                modal.addLabelComponents(new LabelBuilder().setLabel(lm.getIntl(lang, 'smartSwitch'))
                    .setStringSelectMenuComponent(select));
            } else modal.addLabelComponents(textField('member', 'groupSwitchId', 20));
        }
        await interaction.showModal(modal);
        return true;
    }
    await interaction.deferUpdate();
    const input = action === 'edit' ? { name: interaction.fields.getTextInputValue('name'),
        command: interaction.fields.getTextInputValue('command') } : {
        member: interaction.fields.getField('member').type === ComponentType.StringSelect ?
            interaction.fields.getStringSelectValues('member')[0] :
            interaction.fields.getTextInputValue('member').trim()
    };
    if (switchGroupCardTarget(guild, interaction.message?.id)?.group !== group) return respond('groupUnavailable');
    const error = await changeSwitchGroup(dm, guild, serverId, action, { groupId, ...input });
    return error ? respond(error) : true;
}
