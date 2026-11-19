const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const Ws = require('ws');
const { normalizeRelayToken, pairingServerKey } = require('../src/utils/rustRelay');

test('relay tokens preserve Steam64, and repeat pairings reuse the existing server key', () => {
    const steam = '76561198000000001';
    const token = Buffer.from(`{"steamId":${steam}}`).toString('base64') + '.signature';
    assert.equal(normalizeRelayToken(encodeURIComponent(token), steam), token);
    assert.equal(normalizeRelayToken(token, '76561198000000002'), null);
    assert.equal(normalizeRelayToken('%', steam), null);
    const id = '12345678-aaaa-bbbb-cccc-123456789012';
    const servers = { '10.0.0.1-123': { relayServerId: id } };
    assert.equal(pairingServerKey({}, { id }), 'relay-' + id);
    assert.equal(pairingServerKey(servers, { id }), '10.0.0.1-123');
    assert.equal(pairingServerKey({}, { id, ip: '10.0.0.1', port: '123' }), '10.0.0.1-123');
});

test('real WebSocket handshake, binary requests, broadcasts and account binding', async t => {
    const server = new Ws.Server({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    t.after(() => server.close());
    const local = 'ws://127.0.0.1:' + server.address().port;
    const urls = [];
    // Substitute only the network destination; ws performs its actual HTTP upgrade and frame parsing.
    class LocalSocket extends Ws {
        constructor(url, protocols, options) {
            urls.push(url);
            const { pathname, search } = new URL(url);
            super(local + pathname + search, protocols, options);
        }
    }
    const module = require.cache[require.resolve('ws')];
    module.exports = LocalSocket;
    t.after(() => { module.exports = Ws; });
    const rp = require('rustplus-ts');
    const client = new rp.RustPlus('127.0.0.1', String(server.address().port));
    t.after(() => client.disconnect());
    const steamId = '76561198000000001';
    const id = '18446744073709551615';
    const relay = { steamId, serverId: 'a-b-c', authToken: 'fixture.token' };
    const handshake = once(server, 'connection');
    const connected = once(client, 'connected');
    await client.connect(relay);
    const [socket, request] = await handshake;
    await connected;
    assert.match(urls[0], /^wss:\/\/companion-rust\.facepunch\.com\/socket\/a-b-c\?v=\d+$/);
    assert.equal(request.headers.origin, 'https://app.playrust.com');
    assert.deepEqual(request.headers['sec-websocket-protocol'].split(/,\s*/),
        ['rustplus.auth.v1', Buffer.from(relay.authToken).toString('base64url')]);

    socket.on('message', bytes => {
        const req = rp.AppRequest.fromBinary(bytes);
        assert.ok(rp.isValidAppRequest(req));
        assert.equal(req.entityId, id);
        assert.equal(req.playerId, steamId);
        socket.send(rp.AppMessage.toBinary({ response: { seq: req.seq, success: {} } }));
    });
    const response = await client.getEntityInfoAsync(steamId, 123, id);
    assert.deepEqual(response.success, {});
    assert.match(client.sendRequest({ getInfo: {} }, 'another', 123, () => {}).message, /authenticated/);
    assert.match(client.sendRequest({ entityId: 2 ** 53 }, steamId, 123, () => {}).message, /decimal string/);
    const incoming = once(client, 'message');
    socket.send('relay status');
    const entityChanged = { entityId: id, payload: rp.AppEntityPayload.create() };
    socket.send(rp.AppMessage.toBinary({ broadcast: { entityChanged } }));
    const [broadcast] = await incoming;
    assert.equal(broadcast.broadcast.entityChanged.entityId, id);
    assert.ok(rp.isValidAppEntityChanged(broadcast.broadcast.entityChanged));

    const direct = once(server, 'connection');
    const reopened = once(client, 'connected');
    await client.connect();
    const [, legacy] = await direct;
    await reopened;
    assert.equal(urls[1], local);
    assert.equal(legacy.headers['sec-websocket-protocol'], undefined);
});

test('uint64 codec and validators agree for requests, broadcasts and camera entities', () => {
    const rp = require('rustplus-ts');
    for (const entityId of ['0', '4294967296', '9007199254740993', '18446744073709551615']) {
        for (const [codec, validate, fields] of [
            [rp.AppRequest, rp.isValidAppRequest],
            [rp.AppEntityChanged, rp.isValidAppEntityChanged],
            [rp.AppCameraRays_Entity, rp.isValidAppCameraRays_Entity,
                { type: rp.AppCameraRays_EntityType.Tree, position: {}, rotation: {}, size: {} }]
        ]) {
            const value = codec.create({ entityId, ...fields });
            const decoded = codec.fromBinary(codec.toBinary(value));
            assert.equal(decoded.entityId, entityId);
            assert.ok(validate(decoded), codec.typeName);
        }
    }
    for (const bad of ['18446744073709551616', '-1', '1.5', '1e5', '00', '']) {
        assert.equal(rp.isValidAppRequest(rp.AppRequest.create({ entityId: bad })), false);
    }
});
