import { ChatInputCommandInteraction, escapeMarkdown, MessageFlags, SlashCommandBuilder,
    type SlashCommandStringOption } from 'discord.js';
import { guildInstanceManager as gim, localeManager as lm, rustPlusManager as rpm } from '../../index';
import { battleMetricsId } from '../api/battlemetrics';
import { lookupPlayers } from '../handlers/players';
import type { DiscordManager } from '../managers/discordManager';
import type { Languages } from '../managers/LocaleManager';

export default {
    name: 'players',
    getData(lang: Languages) {
        const t = (key: string) => lm.getIntl(lang, 'players_' + key);
        const serverId = (o: SlashCommandStringOption) => o.setName('battlemetricsid')
            .setDescription(t('serverId')).setMaxLength(20);
        return new SlashCommandBuilder().setName('players').setDescription(t('command'))
            .addSubcommand(s => s.setName('name').setDescription(t('byName'))
                .addStringOption(o => o.setName('status').setDescription(t('status')).addChoices(
                    { name: t('online'), value: '0' }, { name: t('offline'), value: '1' },
                    { name: t('any'), value: '2' }))
                .addStringOption(o => o.setName('name').setDescription(t('byName')).setMaxLength(100))
                .addStringOption(serverId))
            .addSubcommand(s => s.setName('playerid').setDescription(t('byId'))
                .addStringOption(o => o.setName('playerid').setDescription(t('byId')).setRequired(true)
                    .setMaxLength(20)).addStringOption(serverId))
            .addSubcommand(s => s.setName('link').setDescription(t('link'))
                .addStringOption(o => serverId(o).setRequired(true)))
            .addSubcommand(s => s.setName('unlink').setDescription(t('unlink')));
    },
    async execute(dm: DiscordManager, interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const guild = interaction.guildId ? gim.getGuildInstance(interaction.guildId) : null;
        const lang = guild?.generalSettings.language ?? null;
        const action = interaction.options.getSubcommand();
        const mapping = action === 'link' || action === 'unlink';
        const reply = async (key: string, ok = false, params?: Record<string, string>) => {
            await interaction.editReply({ content: lm.getIntl(lang, key, params), allowedMentions: { parse: [] } });
            return ok;
        };
        if (!guild || !dm.validPermissions(interaction, mapping)) return reply('errorDescMissingPermission');
        const bmId = interaction.options.getString('battlemetricsid');
        const playerId = interaction.options.getString('playerid');
        if ((bmId !== null && !battleMetricsId.test(bmId)) || (playerId !== null && !battleMetricsId.test(playerId))) {
            return reply('players_invalidId');
        }
        const active = Object.keys(guild.serverInfoMap).filter(id => guild.serverInfoMap[id].active);
        const selectedId = guild.serverToView ?? (active.length === 1 ? active[0] : undefined);
        const selected = selectedId ? guild.serverInfoMap[selectedId] : undefined;
        if (mapping) {
            if (!selected) return reply('players_selectServer');
            const previous = selected.battlemetricsId;
            selected.battlemetricsId = action === 'link' ? bmId : null;
            if (!gim.updateGuildInstance(guild.guildId)) {
                selected.battlemetricsId = previous;
                return reply('errorDescUnknownError');
            }
            return reply(action === 'link' ? 'players_linked' : 'players_unlinked', true,
                { server: escapeMarkdown(selected.name), id: bmId ?? '' });
        }
        if (!selected && !bmId) return reply('players_selectServer');
        // Only combine named players and Rust+ team/population from the same server.
        const localId = !bmId || selected?.battlemetricsId === bmId ? selectedId :
            Object.keys(guild.serverInfoMap).find(id => guild.serverInfoMap[id].battlemetricsId === bmId);
        const local = localId && guild.serverInfoMap[localId]?.active ? rpm.getInstance(guild.guildId, localId) : null;
        const status = interaction.options.getString('status');
        const result = await lookupPlayers(guild.generalSettings.language, local, bmId ?? selected?.battlemetricsId ??
            null, { status: status === '1' ? 'offline' : status === '2' ? 'any' : 'online',
            name: interaction.options.getString('name') ?? '', playerId: playerId ?? undefined });
        await interaction.editReply({ content: result.lines.join('\n'), allowedMentions: { parse: [] } });
        return result.ok;
    }
};
