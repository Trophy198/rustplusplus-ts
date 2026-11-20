import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder,
    type AutocompleteInteraction } from 'discord.js';
import { guildInstanceManager as gim, localeManager as lm, rustPlusManager as rpm } from '../../index';
import { transferLeader } from '../handlers/leader';
import type { GuildInstance } from '../managers/guildInstanceManager';
import type { DiscordManager } from '../managers/discordManager';
import type { Languages } from '../managers/LocaleManager';

function selectedServer(guild: GuildInstance, raw: string | null) {
    const active = Object.keys(guild.serverInfoMap).filter(id => guild.serverInfoMap[id].active);
    const id = raw ?? guild.serverToView ?? (active.length === 1 ? active[0] : undefined);
    return id && active.includes(id) ? id : undefined;
}

export async function autocompleteLeader(dm: DiscordManager, interaction: AutocompleteInteraction) {
    const guild = interaction.guildId && gim.getGuildInstance(interaction.guildId);
    if (!guild || !dm.validPermissions(interaction)) return interaction.respond([]);
    const focus = interaction.options.getFocused(true);
    const id = selectedServer(guild, interaction.options.getString('server'));
    const team = id && rpm.getInstance(guild.guildId, id)?.rpTeamInfo;
    const options = focus.name === 'server' ? Object.entries(guild.serverInfoMap).filter(([, s]) => s.active)
        .map(([value, s]) => ({ name: s.name, value })) :
        (team ? team.appTeamInfo.members.map(m => ({ name: m.name + ' · ' + m.steamId, value: m.steamId })) : []);
    const query = String(focus.value).toLowerCase();
    return interaction.respond(options.filter(o => o.name.toLowerCase().includes(query) || o.value.includes(query))
        .slice(0, 25).map(o => ({ name: o.name.slice(0, 100), value: o.value })));
}

export default {
    name: 'leader',
    getData(lang: Languages) {
        return new SlashCommandBuilder().setName('leader').setDescription(lm.getIntl(lang, 'commandsLeaderDesc'))
            .addStringOption(o => o.setName('member').setDescription(lm.getIntl(lang, 'commandsLeaderMemberDesc'))
                .setRequired(true).setAutocomplete(true))
            .addStringOption(o => o.setName('server').setDescription(lm.getIntl(lang, 'groupServer'))
                .setAutocomplete(true));
    },
    async execute(dm: DiscordManager, interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const guild = interaction.guildId && gim.getGuildInstance(interaction.guildId);
        if (!guild || !dm.validPermissions(interaction)) {
            await interaction.editReply(lm.getIntl(guild ? guild.generalSettings.language : null,
                'errorDescMissingPermission'));
            return false;
        }
        const id = selectedServer(guild, interaction.options.getString('server'));
        const instance = id && rpm.getInstance(guild.guildId, id);
        if (!instance) {
            await interaction.editReply(lm.getIntl(guild.generalSettings.language, 'leaderOffline'));
            return false;
        }
        const result = await transferLeader(instance, interaction.options.getString('member', true));
        await interaction.editReply({ content: result.text, allowedMentions: { parse: [] } });
        return result.ok;
    }
};
