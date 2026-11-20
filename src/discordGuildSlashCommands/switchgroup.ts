import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder, SlashCommandStringOption,
    type AutocompleteInteraction } from 'discord.js';
import { guildInstanceManager as gim, localeManager as lm } from '../../index';
import { changeSwitchGroup } from '../handlers/smartSwitchGroupControls';
import type { DiscordManager } from '../managers/discordManager';
import type { Languages } from '../managers/LocaleManager';

const actions = ['create', 'edit', 'add', 'remove', 'delete'] as const;

export async function autocompleteGroup(dm: DiscordManager, interaction: AutocompleteInteraction) {
    const guild = interaction.guildId && gim.getGuildInstance(interaction.guildId);
    if (!guild || !dm.validPermissions(interaction)) return interaction.respond([]);
    const focus = interaction.options.getFocused(true);
    const serverId = interaction.options.getString('server') ?? '';
    const server = Object.hasOwn(guild.serverInfoMap, serverId) ? guild.serverInfoMap[serverId] : undefined;
    let choices: { name: string; value: string }[] = [];
    if (focus.name === 'server') {
        choices = Object.entries(guild.serverInfoMap).map(([value, s]) => ({ name: s.name + ' · ' + value, value }));
    } else if (server && focus.name === 'group') {
        choices = Object.entries(server.smartSwitchGroupConfigMap)
            .map(([value, g]) => ({ name: g.name + ' · ' + g.command, value }));
    } else if (server && focus.name === 'switch') {
        const id = interaction.options.getString('group') ?? '';
        if (Object.hasOwn(server.smartSwitchGroupConfigMap, id)) {
            const members = server.smartSwitchGroupConfigMap[id].smartSwitches;
            const remove = interaction.options.getSubcommand() === 'remove';
            const ids = remove ? [...new Set(members)] : Object.keys(server.smartSwitchConfigMap)
                .filter(entityId => !members.includes(entityId));
            choices = ids.map(value => ({ name: (server.smartSwitchConfigMap[value]?.name ?? '') + ' · ' + value,
                value }));
        }
    }
    const query = String(focus.value).trim().toLowerCase();
    await interaction.respond(choices.filter(c => c.name.toLowerCase().includes(query) || c.value.includes(query))
        .slice(0, 25).map(c => ({ name: c.name.slice(0, 100), value: c.value })));
}

export default {
    name: 'switchgroup',
    getData(language: Languages) {
        const builder = new SlashCommandBuilder().setName('switchgroup')
            .setDescription(lm.getIntl(language, 'groupManage'));
        const lookup = (id: string, label: string) => (o: SlashCommandStringOption) =>
            o.setName(id).setDescription(lm.getIntl(language, label)).setRequired(true).setAutocomplete(true);
        for (const action of actions) {
            builder.addSubcommand(sub => {
                sub.setName(action).setDescription(lm.getIntl(language, 'groupAction_' + action))
                    .addStringOption(lookup('server', 'groupServer'));
                if (action !== 'create') sub.addStringOption(lookup('group', 'groupLabel'));
                if (action === 'create' || action === 'edit') {
                    sub.addStringOption(o => o.setName('name').setDescription(lm.getIntl(language, 'groupName'))
                        .setRequired(action === 'create').setMinLength(1).setMaxLength(80));
                    sub.addStringOption(o => o.setName('command').setDescription(lm.getIntl(language, 'switchCommand'))
                        .setRequired(false).setMinLength(1).setMaxLength(32));
                } else if (action === 'add' || action === 'remove') {
                    sub.addStringOption(lookup('switch', 'smartSwitch'));
                }
                return sub;
            });
        }
        return builder;
    },
    async execute(dm: DiscordManager, interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const guild = interaction.guildId && gim.getGuildInstance(interaction.guildId);
        const lang = guild ? guild.generalSettings.language : null;
        const reply = async (key: string, success = false) => {
            await interaction.editReply(lm.getIntl(lang, key));
            return success;
        };
        if (!guild || !dm.validPermissions(interaction)) return reply('errorDescMissingPermission');
        const serverId = interaction.options.getString('server', true);
        const error = await changeSwitchGroup(dm, guild, serverId, interaction.options.getSubcommand(), {
            groupId: interaction.options.getString('group'), member: interaction.options.getString('switch'),
            name: interaction.options.getString('name'), command: interaction.options.getString('command')
        });
        return reply(error ?? 'groupSaved', !error);
    }
};
