import { escapeMarkdown } from 'discord.js';
import { localeManager as lm } from '../../index';
import { getBattleMetricsRoster } from '../api/battlemetrics';
import type { Languages } from '../managers/LocaleManager';
import type { RustPlusInstance } from '../managers/rustPlusManager';
import { rustRoster } from './rustRoster';

export type PlayerStatus = 'online' | 'offline' | 'any';

interface Query {
    name?: string;
    playerId?: string;
    status: PlayerStatus;
}

export async function lookupPlayers(language: Languages, instance: RustPlusInstance | null, bmId: string | null,
    query: Query, compactLimit?: number) {
    const t = (key: string) => lm.getIntl(language, 'players_' + key);
    const clean = (name: string) => {
        const plain = name.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/[\p{C}\s]+/gu, ' ').trim();
        return compactLimit ? plain.slice(0, 64) : escapeMarkdown(plain.slice(0, 80));
    };
    const find = (name: string) => name.normalize('NFKC').toLowerCase();
    const needle = find(query.name?.trim() ?? '');
    const lines: string[] = [];
    // Keep room for population, source notices and both online/offline sections in a Discord reply.
    const limit = compactLimit ?? 760;
    function section(label: string, names: string[]) {
        let line = label + ' · ';
        names.sort((a, b) => a.localeCompare(b, language));
        if (!names.length) line += t('noMatch');
        for (let i = 0; i < names.length; i++) {
            const part = (i ? ', ' : '') + names[i];
            const remaining = names.length - i - 1;
            const suffix = remaining ? ' … +' + remaining : '';
            if (line.length + part.length + suffix.length > limit) {
                line += '… +' + (remaining + 1);
                break;
            }
            line += part;
        }
        lines.push(line);
    }

    const bm = bmId && (query.status !== 'offline' || query.playerId) ? await getBattleMetricsRoster(bmId) : null;
    const { team, info } = query.playerId ? {} : await rustRoster(instance);
    if (info) {
        lines.push(lm.getIntl(language, 'populationPlayers', { current: String(info.players),
            max: String(info.maxPlayers) }));
    }
    let available = false;
    let noPublicMatch = false;
    if (bm?.kind === 'ok') {
        available = true;
        if (!compactLimit) lines.push(clean(bm.server) + ' · BattleMetrics #' + bmId);
        const matches = bm.players.filter(p => query.playerId ? p.id === query.playerId :
            find(p.name).includes(needle));
        noPublicMatch = !!needle && !matches.length;
        section(t('bmOnline'), matches.map(p => compactLimit ? clean(p.name) : clean(p.name) + ' (#' + p.id + ')'));
    } else if (bm) {
        lines.push(t(bm.kind));
    } else if (query.playerId) {
        lines.push(t('noMapping'));
    }

    if (!query.playerId) {
        const showTeamOnline = query.status !== 'offline' && (bm?.kind !== 'ok' || (team && noPublicMatch));
        if (showTeamOnline || query.status !== 'online') {
            if (team) {
                available = true;
                const members = team.members.filter(m => find(m.name).includes(needle));
                if (showTeamOnline) section(t('teamOnline'), members.filter(m => m.isOnline).map(m => clean(m.name)));
                if (query.status !== 'online') {
                    section(t('teamOffline'), members.filter(m => !m.isOnline).map(m => clean(m.name)));
                }
            } else {
                lines.push(t('noTeam'));
            }
        }
    }
    return { ok: available, lines: lines.map(line => line.length > limit ? line.slice(0, limit - 1) + '…' : line) };
}
