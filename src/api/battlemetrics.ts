import { z } from 'zod';

export const battleMetricsId = /^[1-9]\d{0,19}$/;

const serverResponse = z.object({
    data: z.object({
        type: z.literal('server'), id: z.string(),
        attributes: z.object({ name: z.string(), status: z.string(), private: z.boolean().optional(),
            players: z.number().int().nonnegative().optional() }),
        relationships: z.object({
            game: z.object({ data: z.object({ id: z.string() }) }).optional()
        }).optional()
    }),
    included: z.array(z.unknown()).optional()
});
const publicPlayer = z.object({
    type: z.literal('player'), id: z.string().regex(battleMetricsId),
    attributes: z.object({ name: z.string().trim().min(1), private: z.literal(false) })
});

type Roster = { kind: 'ok'; server: string; players: { id: string; name: string }[] } |
    { kind: 'noToken' | 'denied' | 'rateLimit' | 'unavailable' | 'noRoster' | 'invalidId' };

const cache = new Map<string, { expires: number; result: Promise<Roster> }>();
let retryAt = 0;

async function fetchRoster(id: string, token: string): Promise<Roster> {
    try {
        const response = await fetch(`https://api.battlemetrics.com/servers/${id}?include=player`, {
            headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(5000), redirect: 'error'
        });
        if (response.status === 401 || response.status === 403) return { kind: 'denied' };
        if (response.status === 429) {
            const header = response.headers.get('retry-after') ?? '30';
            const deadline = /^\d+$/.test(header) ? Date.now() + Number(header) * 1000 : Date.parse(header);
            retryAt = Math.max(retryAt, Number.isFinite(deadline) ? deadline : Date.now() + 30000);
            return { kind: 'rateLimit' };
        }
        if (!response.ok) return { kind: 'unavailable' };
        const parsed = serverResponse.safeParse(await response.json());
        if (!parsed.success || parsed.data.data.id !== id) return { kind: 'unavailable' };
        const { data, included } = parsed.data;
        const game = data.relationships?.game?.data.id;
        if (game && game !== 'rust') return { kind: 'invalidId' };
        if (data.attributes.status !== 'online' || data.attributes.private || !included) return { kind: 'noRoster' };
        const players = new Map<string, { id: string; name: string }>();
        for (const entity of included) {
            const player = publicPlayer.safeParse(entity);
            if (player.success) players.set(player.data.id, { id: player.data.id, name: player.data.attributes.name });
        }
        if (!players.size && data.attributes.players !== 0) return { kind: 'noRoster' };
        return { kind: 'ok', server: data.attributes.name, players: [...players.values()] };
    } catch {
        return { kind: 'unavailable' };
    }
}

export async function getBattleMetricsRoster(id: string): Promise<Roster> {
    if (!battleMetricsId.test(id)) return { kind: 'invalidId' };
    const token = process.env.RPP_BATTLEMETRICS_TOKEN?.trim();
    if (!token) return { kind: 'noToken' };
    const now = Date.now();
    const cached = cache.get(id);
    if (cached && cached.expires > now) return cached.result;
    if (now < retryAt) return { kind: 'rateLimit' };
    for (const [key, value] of cache) if (value.expires <= now) cache.delete(key);
    if (cache.size >= 64) return { kind: 'rateLimit' };
    const result = fetchRoster(id, token);
    cache.set(id, { expires: now + 15000, result });
    return result;
}
