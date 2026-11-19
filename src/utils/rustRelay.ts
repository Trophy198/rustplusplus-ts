import type { ServerInfoMap } from '../managers/guildInstanceManager';

interface NotificationAddress {
    id?: string;
    ip?: string;
    port?: string;
}

export function pairingServerKey(servers: ServerInfoMap, body: NotificationAddress): string {
    if (body.id) {
        const existing = Object.entries(servers).find(([, server]) => server.relayServerId === body.id);
        if (existing) return existing[0];
    }
    if (body.ip && body.port) return `${body.ip}-${body.port}`;
    if (body.id) return `relay-${body.id}`;
    throw new Error('Pairing notification has no server address');
}

/** The callback can contain URL escapes. Verify the account before associating a relay token with it. */
export function normalizeRelayToken(raw: string, steamId: string): string | null {
    try {
        const token = decodeURIComponent(raw.trim());
        const [encoded, signature, ...extra] = token.split('.');
        if (!encoded || !signature || extra.length) return null;
        // Older token payloads encode Steam64 as a JSON number. Preserve all digits before JSON.parse.
        const json = Buffer.from(encoded, 'base64').toString('utf8')
            .replace(/("steamId"\s*:\s*)(\d+)(?=\s*[,}])/g, '$1"$2"');
        return JSON.parse(json).steamId === steamId ? token : null;
    } catch {
        return null;
    }
}
