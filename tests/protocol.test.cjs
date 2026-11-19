const assert = require('node:assert/strict');
const test = require('node:test');
const rp = require('rustplus-ts');
const quiet = { error() {} };

// Literal tag/value bytes from the wire layout in Facepunch web build 7dd3c04bdfaf4cb6351e.
// Test the writer independently of the reader so a symmetric error cannot pass a round trip.
function checkWire(codec, validate, hex, fields) {
    const bytes = Buffer.from(hex.replaceAll(' ', ''), 'hex');
    const expected = codec.create(fields);
    assert.deepEqual(Buffer.from(codec.toBinary(expected)), bytes, codec.typeName);
    const decoded = codec.fromBinary(Uint8Array.from(bytes));
    assert.deepEqual(decoded, expected);
    assert.ok(validate(decoded, quiet), codec.typeName);
    return decoded;
}

test('Half3 uses uint32 varints on all axes', () => {
    checkWire(rp.Half3, rp.isValidHalf3, '08 01 10 ac02 18 ffffffff0f', { x: 1, y: 300, z: 4294967295 });
    assert.ok(rp.isValidHalf3(rp.Half3.fromBinary(new Uint8Array(0))));
    for (const axis of ['x', 'y', 'z']) {
        for (const value of [-1, 0.5, 4294967296, NaN, '1']) {
            assert.equal(rp.isValidHalf3(rp.Half3.create({ [axis]: value }), quiet), false);
        }
    }
});

test('team notes accept signed int32 values beyond the known map UI names', () => {
    const note = checkWire(rp.AppTeamInfo_Note, rp.isValidAppTeamInfo_Note,
        '10 ffffffffffffffffff01 28 64 30 ff01', { type: -1, icon: 100, colourIndex: 255 });
    assert.ok(rp.isValidAppMessage(rp.AppMessage.create({ response: { teamInfo: { mapNotes: [note] } } })));
    assert.equal(rp.AppTeamInfo_Note_Type.Death, 0);
    assert.ok(rp.isValidAppTeamInfo_Note_Icon(rp.AppTeamInfo_Note_Icon.Pin));
    assert.equal(rp.isValidAppTeamInfo_Note_ColourIndex(255), false);
    for (const key of ['type', 'icon', 'colourIndex']) {
        for (const value of [-2147483648, 2147483647]) assert.ok(rp.isValidAppTeamInfo_Note({ ...note, [key]: value }));
        for (const value of [-2147483649, 2147483648, 0.5]) {
            assert.equal(rp.isValidAppTeamInfo_Note({ ...note, [key]: value }, quiet), false);
        }
    }
});

test('device and camera entity validators enforce the official enum members', () => {
    const entity = rp.AppEntityInfo.create({ payload: {} });
    const camera = rp.AppCameraRays_Entity.create({ position: {}, rotation: {}, size: {} });
    for (const type of [1, 2, 3]) assert.ok(rp.isValidAppEntityInfo({ ...entity, type }));
    for (const type of [1, 2]) assert.ok(rp.isValidAppCameraRays_Entity({ ...camera, type }));
    for (const type of [0, 4, -1]) assert.equal(rp.isValidAppEntityInfo({ ...entity, type }, quiet), false);
    for (const type of [0, 3, -1]) assert.equal(rp.isValidAppCameraRays_Entity({ ...camera, type }, quiet), false);
});

test('team kick uses request tag 33 and an optional uint64 Steam ID', () => {
    const steamId = '18446744073709551615';
    checkWire(rp.AppRequest, rp.isValidAppRequest, '0801 1001 1801 8a02 0b 08 ffffffffffffffffff01',
        { seq: 1, playerId: '1', playerToken: 1, kickFromTeam: { steamId } });
    checkWire(rp.AppTeamKick, rp.isValidAppTeamKick, '', {});
    for (const invalid of ['18446744073709551616', '-1', 1]) {
        assert.equal(rp.isValidAppRequest(rp.AppRequest.create({ kickFromTeam: { steamId: invalid } }), quiet), false);
    }
});

test('clan scores and leaderboard retain 64-bit signs, nested fields and required name presence', () => {
    const entry = {
        timestamp: '-1', type: 2, score: -1, multiplier: 3, steamId: '18446744073709551615', otherSteamId: '4',
        otherClanId: '-9223372036854775808', arg1: 'A', arg2: 'B'
    };
    const entryBytes = '08 ffffffffffffffffff01 1002 18 ffffffffffffffffff01 2003 28 ffffffffffffffffff01 ' +
        '3004 38 80808080808080808001 420141 4a0142';
    checkWire(rp.ClanScoreEvents, rp.isValidClanScoreEvents, '0807 1238 ' + entryBytes,
        { clanId: '7', scoreEvents: [entry] });
    checkWire(rp.ClanLeaderboard, rp.isValidClanLeaderboard, '0a0e 0807 1200 18 ffffffffffffffff7f',
        { entries: [{ clanId: '7', name: '', score: '9223372036854775807' }] });
    assert.equal(rp.isValidClanLeaderboard(rp.ClanLeaderboard.fromBinary(Buffer.from('0a00', 'hex')), quiet), false);
    assert.ok(rp.isValidClanLeaderboard({ entries: [] }));
    assert.ok(rp.isValidClanScoreEvents({ scoreEvents: [] }));
    assert.equal(rp.isValidClanScoreEvents({ scoreEvents: new Array(1) }, quiet), false);
    for (const score of ['9223372036854775808', '-9223372036854775809', '1e2', 42]) {
        assert.equal(rp.isValidClanLeaderboard({ entries: [{ name: 'A', score }] }, quiet), false);
    }
    const validEntries = Array.from({ length: 20 }, () => entry);
    for (const invalid of [{ multiplier: 1.5 }, { steamId: '-1' }, { score: 2147483648 }, { arg1: 7 }]) {
        assert.equal(rp.isValidClanScoreEvents({ scoreEvents: [...validEntries, invalid] }, quiet), false);
    }
});

test('map, sell order and camera fields work inside legacy and current message envelopes', () => {
    const monument = checkWire(rp.AppMap_Monument, rp.isValidAppMap_Monument, '0a0141 2000',
        { token: 'A', isCustomName: false });
    const sell = checkWire(rp.AppMarker_SellOrder, rp.isValidAppMarker_SellOrder, '5d00000000',
        { receivedQuantityMultiplier: 0 });
    const rays = checkWire(rp.AppCameraRays, rp.isValidAppCameraRays,
        '1a017f 3a05 0d0000803f 4205 1500000040 4a05 1d00004040', {
            rayData: Uint8Array.of(127), cameraPosition: { x: 1 }, cameraRotation: { y: 2 }, sampleRotation: { z: 3 }
        });
    for (const [codec, validate, fields] of [[rp.AppMap_Monument, rp.isValidAppMap_Monument, { token: 'A' }],
        [rp.AppMarker_SellOrder, rp.isValidAppMarker_SellOrder, {}],
        [rp.AppCameraRays, rp.isValidAppCameraRays, { rayData: Uint8Array.of(127) }]]) {
        assert.ok(validate(codec.fromBinary(codec.toBinary(codec.create(fields)))));
    }
    assert.equal(rp.AppMarker_SellOrder.fromBinary(new Uint8Array(0)).receivedQuantityMultiplier, undefined);
    const envelopes = [
        { response: { map: { monuments: [monument] } } },
        { response: { mapMarkers: { markers: [{ sellOrders: [sell] }] } } },
        { broadcast: { cameraRays: rays } }
    ];
    for (const envelope of envelopes) {
        const decoded = rp.AppMessage.fromBinary(rp.AppMessage.toBinary(rp.AppMessage.create(envelope)));
        assert.ok(rp.isValidAppMessage(decoded));
    }
    assert.equal(rp.isValidAppMap_Monument({ ...monument, isCustomName: 'true' }, quiet), false);
    assert.equal(rp.isValidAppMarker_SellOrder({ ...sell, receivedQuantityMultiplier: '1' }, quiet), false);
    for (const key of ['cameraPosition', 'cameraRotation', 'sampleRotation']) {
        assert.equal(rp.isValidAppCameraRays({ ...rays, [key]: { x: '1', y: 0, z: 0 } }, quiet), false);
    }
});
