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
import { isUint64String } from 'rustplus-ts';
import { editSwitch } from '../handlers/smartSwitchControls';

import { log, config, localeManager as lm, guildInstanceManager as gim } from '../../index';
import * as discordMessages from '../discordUtils/discordMessages';
import { DiscordManager } from '../managers/discordManager';
import * as types from '../utils/types';
import { Languages } from '../managers/LocaleManager';
import { GuildInstance } from '../managers/guildInstanceManager';

export default {
	name: 'smartswitch',

	getData(language: Languages) {
		return new discordjs.SlashCommandBuilder()
			.setName('smartswitch')
			.setDescription(lm.getIntl(language, 'slashCommandDescSmartswitch'))
			.addSubcommand(subcommand => subcommand
				.setName('edit')
				.setDescription(lm.getIntl(language, 'slashCommandDescSmartswitchEdit'))
				.addStringOption(option => option
					.setName('entity_id')
					.setDescription(lm.getIntl(language, 'slashCommandDescSmartswitchEditEntityId'))
					.setRequired(true).setAutocomplete(true))
				.addStringOption(option => option.setName('name').setDescription(lm.getIntl(language, 'switchName'))
					.setMinLength(1).setMaxLength(80))
				.addStringOption(option => option.setName('command')
					.setDescription(lm.getIntl(language, 'switchCommand'))
					.setMinLength(1).setMaxLength(32))
				.addStringOption(option => option
					.setName('image')
					.setDescription(lm.getIntl(language, 'slashCommandDescSmartswitchEditImage'))
					.addChoices(
						{ name: lm.getIntl(language, 'autoturret'), value: 'autoturret' },
						{ name: lm.getIntl(language, 'boomBox'), value: 'boombox' },
						{ name: lm.getIntl(language, 'broadcaster'), value: 'broadcaster' },
						{ name: lm.getIntl(language, 'ceilingLight'), value: 'ceiling_light' },
						{ name: lm.getIntl(language, 'discoFloor'), value: 'discofloor' },
						{ name: lm.getIntl(language, 'doorController'), value: 'door_controller' },
						{ name: lm.getIntl(language, 'elevator'), value: 'elevator' },
						{ name: lm.getIntl(language, 'hbhfSensor'), value: 'hbhf_sensor' },
						{ name: lm.getIntl(language, 'heater'), value: 'heater' },
						{ name: lm.getIntl(language, 'samsite'), value: 'samsite' },
						{ name: lm.getIntl(language, 'sirenLight'), value: 'siren_light' },
						{ name: lm.getIntl(language, 'smartAlarm'), value: 'smart_alarm' },
						{ name: lm.getIntl(language, 'smartSwitch'), value: 'smart_switch' },
						{ name: lm.getIntl(language, 'sprinkler'), value: 'sprinkler' },
						{ name: lm.getIntl(language, 'storageMonitor'), value: 'storage_monitor' },
						{ name: lm.getIntl(language, 'christmasLights'), value: 'xmas_light' })));
	},

	async execute(dm: DiscordManager, interaction: discordjs.ChatInputCommandInteraction): Promise<boolean> {
		const fn = '[SlashCommand: smartswitch]';
		const logParam = {
			guildId: interaction.guildId
		};

		const id = `Interaction ID: ${interaction.id} -`
		await interaction.deferReply({ flags: discordjs.MessageFlags.Ephemeral });

		if (!interaction.guild) {
			await discordMessages.sendDefaultMessage(dm, interaction, 'errorTitleUnknownError',
				'errorDescUnknownError');
			log.warn(`${fn} ${id} Unknown Error: interaction.guild is not valid.`, logParam);
			return false;
		}

		switch (interaction.options.getSubcommand()) {
			case 'edit': {
				return await executeEdit(dm, interaction);
			} break;

			default: {
				const parameters = {
					subcommand: interaction.options.getSubcommand()
				}
				await discordMessages.sendDefaultMessage(dm, interaction, 'errorTitleInvalidSubcommand',
					'errorDescInvalidSubcommand', parameters);
				log.info(`${fn} ${id} ${lm.getIntl(config.general.language, 'errorDescInvalidSubcommand')}`,
					logParam);
				return false;
			} break;
		}
	}
};

async function executeEdit(dm: DiscordManager, interaction: discordjs.ChatInputCommandInteraction): Promise<boolean> {
	const fn = '[SlashCommand: smartswitch: edit]';
	const guildId = interaction.guildId as types.GuildId;
	const logParam = {
		guildId: guildId
	};

	const gInstance = gim.getGuildInstance(guildId) as GuildInstance;
	const id = `Interaction ID: ${interaction.id} -`

	const entityIdOption = interaction.options.getString('entity_id', true);
	const imageOption = interaction.options.getString('image');
	const name = interaction.options.getString('name') ?? undefined;
	const command = interaction.options.getString('command') ?? undefined;

	if (!dm.validPermissions(interaction)) {
		await discordMessages.sendDefaultMessage(dm, interaction, 'errorTitleMissingPermission',
			'errorDescMissingPermission');
		log.warn(`${fn} ${id} ${lm.getIntl(config.general.language, 'errorDescMissingPermission')}`, logParam);
		return false;
	}

	const matches = isUint64String(entityIdOption) ? Object.entries(gInstance.serverInfoMap)
		.filter(([, server]) => Object.hasOwn(server.smartSwitchConfigMap, entityIdOption)) : [];
	const replyError = async (key: string) => {
		await interaction.editReply(lm.getIntl(gInstance.generalSettings.language, key));
		return false;
	};
	if (matches.length > 1) return replyError('switchAmbiguous');
	if (matches.length === 0) {
		const parameters = {
			entityId: `\`${entityIdOption}\``
		};

		await discordMessages.sendDefaultMessage(dm, interaction, 'errorTitleSmartswitchDoesNotExist',
			'errorDescSmartswitchDoesNotExist', parameters);
		log.warn(`${fn} ${id} ${lm.getIntl(config.general.language, 'errorDescSmartswitchDoesNotExist',
			parameters)}`, logParam);
		return false;
	}

	const [serverId, server] = matches[0];
	const entity = server.smartSwitchConfigMap[entityIdOption];
	if (!imageOption && name === undefined && command === undefined) return replyError('switchEditOptions');
	const error = editSwitch(gInstance, serverId, entityIdOption, { name, command,
		img: imageOption ? imageOption + '.png' : undefined });
	if (error) return replyError(error);
	await discordMessages.sendSmartSwitchMessage(dm, guildId, serverId, entityIdOption);

	const parameters = {
		entity: `\`${entity.name} (${entityIdOption})\``
	};

	await discordMessages.sendDefaultMessage(dm, interaction, 'slashCommandSuccessTitleSmartswitchEdit',
		'slashCommandSuccessDescSmartswitchEdit', parameters);
	log.info(`${fn} ${id} ${lm.getIntl(config.general.language,
		'slashCommandSuccessDescSmartswitchEdit', parameters)}`, logParam);

	return true;
}