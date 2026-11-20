import type { Message } from 'discord.js';
import type { AppTeamMessage } from 'rustplus-ts';
import { guildInstanceManager as gim, localeManager as lm } from '../../index';
import { rustRoster } from '../handlers/rustRoster';
import type { RustPlusInstance } from '../managers/rustPlusManager';
import { findTeamMembersByName } from '../structures/rustPlusTeamInfo';

export const name = 'steamid';

function identity(player: { name: string; steamId: string }) {
    const label = player.name.replace(/<[^>]*>/g, '').replace(/[\p{C}\s]+/gu, ' ').trim().slice(0, 64);
    return label ? label + ': ' + player.steamId : player.steamId;
}

export async function execute(instance: RustPlusInstance, args: string[], message: AppTeamMessage | Message) {
    if (!('steamId' in message)) return false;
    if (!args.length) {
        instance.sendPrefixCommandResponse(identity(message), true);
        return true;
    }

    const session = instance.sessionId;
    const { team } = await rustRoster(instance, false);
    if (instance.sessionId !== session) return true;
    const settings = gim.getGuildInstance(instance.guildId)?.generalSettings;
    const language = settings?.language ?? null;
    let response: string;
    if (!team) {
        response = lm.getIntl(language, 'players_noTeam');
    } else {
        const matches = findTeamMembersByName(team, args.join(' '));
        response = matches.length === 1 ? identity(matches[0]) :
            lm.getIntl(language, matches.length ? 'steamIdAmbiguous' : 'leaderNoMember',
                { command: (settings?.inGameChatCommandPrefix ?? '!') + name });
    }
    instance.sendPrefixCommandResponse(response, true);
    return true;
}
