import type { Message } from 'discord.js';
import type { AppTeamMessage } from 'rustplus-ts';
import type { RustPlusInstance } from '../managers/rustPlusManager';
import { transferLeader } from '../handlers/leader';

export const name = 'leader';

export async function execute(instance: RustPlusInstance, args: string[], message: AppTeamMessage | Message) {
    if (!('steamId' in message)) return false;
    const result = await transferLeader(instance, args.join(' ') || message.steamId, message.steamId);
    instance.sendPrefixCommandResponse(result.text, true);
    return true;
}
