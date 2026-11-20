import type { Message } from 'discord.js';
import type { AppTeamMessage } from 'rustplus-ts';
import { guildInstanceManager as gim } from '../../index';
import { lookupPlayers } from '../handlers/players';
import type { RustPlusInstance } from '../managers/rustPlusManager';
import { MAX_LENGTH_TEAM_MESSAGE } from '../utils/constants';

export const name = 'player';

export async function execute(instance: RustPlusInstance, args: string[], message: AppTeamMessage | Message) {
    const guild = gim.getGuildInstance(instance.guildId);
    const server = guild?.serverInfoMap[instance.serverId];
    if (!server || !guild) return false;
    const inGame = 'steamId' in message;
    const trademark = guild.generalSettings.inGameChatTrademark;
    const limit = inGame ? MAX_LENGTH_TEAM_MESSAGE - (trademark ? trademark.length + 3 : 0) : 75;
    if (limit <= 0) return false;
    const session = instance.sessionId;
    const result = await lookupPlayers(guild.generalSettings.language, instance, server.battlemetricsId,
        { status: 'online', name: args.join(' ') }, limit);
    if (instance.sessionId !== session) return true;
    instance.sendPrefixCommandResponse(result.lines, inGame);
    return true;
}
