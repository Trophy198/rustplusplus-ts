const assert = require('node:assert/strict');
const test = require('node:test');
const Receiver = require('@liamcottle/push-receiver/src/client');

test('multiple credentials share the MCS schema and keep individual receiver connections', async t => {
    const credentials = {};
    const index = require.resolve('../index.ts');
    require.cache[index] = { id: index, loaded: true, exports: {
        log: { info() {}, warn() {}, error() {} }, credentialsManager: {
            getCredentials: id => credentials[id], getCredentialSteamIds: () => []
        }
    } };
    const { FcmListenerManager } = require('../src/managers/fcmListenerManager');
    const manager = new FcmListenerManager({});
    const connections = [];
    const connect = Receiver.prototype.connect;
    let checkIns = 0;
    t.mock.method(Receiver.prototype, 'connect', function () {
        const pending = connect.call(this);
        connections.push(pending);
        return pending;
    });
    t.mock.method(Receiver.prototype, '_checkIn', async () => { checkIns++; });
    t.mock.method(Receiver.prototype, '_connect', () => {});
    global.gc?.();
    const initialHeap = process.memoryUsage().heapUsed;
    for (let i = 0; i < 32; i++) credentials[i] = { gcm: { androidId: String(i), securityToken: 'fixture' } };
    for (let pass = 0; pass < 2; pass++) {
        for (const id of Object.keys(credentials)) manager.startListener(id);
        await Promise.all(connections);
    }
    const listeners = Object.values(manager.listeners);
    const schemas = new Set(listeners.map(receiver => receiver._proto)).size;
    if (global.gc) {
        global.gc();
        t.diagnostic('32 active credentials heap delta (KiB): ' +
            Math.round((process.memoryUsage().heapUsed - initialHeap) / 1024));
    }
    for (const id of Object.keys(credentials)) manager.stopListener(id);
    const remaining = listeners.reduce((sum, receiver) => sum + receiver.listenerCount('ON_DATA_RECEIVED'), 0);
    t.diagnostic(`check-ins: ${checkIns}, distinct parsed schemas: ${schemas}, listeners after removal: ${remaining}`);
    assert.equal(listeners.length, 32);
    assert.equal(new Set(listeners).size, 32);
    assert.equal(remaining, 0);
    assert.equal(checkIns, 32);
    assert.equal(schemas, 1);
});
