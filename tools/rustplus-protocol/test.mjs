import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { extract } from './bundle.mjs';
import { bundleDiff, planSchema } from './schema.mjs';

function temp(t) {
    const dir = mkdtempSync(join(tmpdir(), 'rustplus-protocol-test-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}

// Synthetic static-codegen shapes; the downloaded/transcribed program is never imported.
const core = ['AppRequest', 'AppMessage', 'AppResponse', 'AppBroadcast'];
function fixture(type) {
    const codecs = core.map(name => `
        p.${name} = (function () {
            function C() {}
            C.prototype.entityId = 0;
            C.decode = function (reader) {
                var msg = new root.ProtoBuf.${name}();
                while (reader.pos < reader.len) {
                    var tag = reader.uint32();
                    switch (tag >>> 3) {
                        case 4: msg.entityId = reader.${type}(); break;
                        default: reader.skipType(tag & 7);
                    }
                }
                return msg;
            };
            return C;
        })()`);
    return 'throw Error("must not execute"); root.ProtoBuf = (' + codecs.join(',') + ',p);';
}
const proto = 'syntax = "proto3";\npackage rustplus;\n' +
    core.map(name => 'message ' + name + ' {\n\toptional uint32 entityId = 4; // preserve\n}').join('\n') + '\n';

test('extracts changed wire type by tag, rejects incomplete decoders', () => {
    const old = extract(fixture('uint32')), newer = extract(fixture('uint64'));
    assert.equal(bundleDiff(old, newer).length, 4);
    assert.match(bundleDiff(old, newer)[0], /uint32 entityId → singular uint64 entityId/);
    assert.throws(() => extract(fixture('unknownRead')), /unsupported field/);
    assert.throws(() => extract(fixture('uint32').replace('case 4:', 'default:').replace('default: reader.skipType(tag & 7);', '')), /missing decoder/);
});

test('candidate preserves comments, reserved tags and branch extensions, compiles, and is idempotent', t => {
    const dir = temp(t);
    const schema = extract(fixture('uint64'));
    schema.messages.AppRequest[5] = { name: 'busy', type: 'bool', rule: 'singular' };
    schema.messages.AppRequest[6] = { name: 'extra', type: 'AppExtra', rule: 'repeated' };
    schema.messages.AppExtra = { 1: { name: 'label', type: 'string', rule: 'required' } };
    schema.enums['AppExtra.Mode'] = { Enabled: 1 };
    schema.messages.AppExtra[2] = { name: 'mode', type: 'AppExtra.Mode', rule: 'singular' };
    const branch = proto.replace('message AppRequest {', 'message AppRequest {\n\treserved 5;\n\tbool local = 10;');
    const plan = planSchema(branch, schema, dir);
    assert.match(plan.candidate, /optional uint64 entityId = 4; \/\/ preserve/);
    assert.match(plan.candidate, /repeated .rustplus.AppExtra extra = 6/);
    assert.match(plan.candidate, /APPEXTRA_MODE_UNSPECIFIED = 0;/);
    assert.match(plan.candidate, /reserved 5;/);
    assert.match(plan.candidate, /bool local = 10;/);
    assert.ok(plan.review.some(r => r.includes('reserved')));
    assert.equal(planSchema(plan.candidate, schema, dir).candidate, plan.candidate);
});

test('CLI records consecutive builds, rechecks branch drift and preserves history on failure', t => {
    const dir = temp(t), state = join(dir, 'history'), bundle = join(dir, 'app.js');
    const a = join(dir, 'master.proto'), b = join(dir, 'playground.proto');
    writeFileSync(a, proto); writeFileSync(b, proto);
    const script = fileURLToPath(new URL('./check.mjs', import.meta.url));
    const argv = [script, '--state', state, '--bundle', bundle, '--master-proto', a,
        '--playground-proto', b, '--master-ref', 'HEAD', '--playground-ref', 'HEAD'];
    function run() { return execFileSync(process.execPath, argv, { encoding: 'utf8' }).trim(); }
    writeFileSync(bundle, fixture('uint32'));
    assert.match(run(), /00000001\/report.md/);
    assert.match(run(), /같습니다/);
    writeFileSync(bundle, fixture('uint64'));
    assert.match(run(), /00000002\/report.md/);
    assert.match(readFileSync(join(state, '00000002', 'report.md'), 'utf8'), /uint32 entityId → singular uint64 entityId/);
    writeFileSync(a, proto.replaceAll('uint32', 'uint64'));
    assert.match(run(), /00000003\/report.md/);
    assert.equal(readFileSync(join(state, '00000003/master/protocol.patch'), 'utf8'), '');
    assert.equal(JSON.parse(readFileSync(join(state, '00000003/snapshot.json'))).previousBundle, '00000001');
    writeFileSync(bundle, 'let brokenLayout = true;');
    assert.equal(spawnSync(process.execPath, argv).status, 1);
    assert.deepEqual(readdirSync(state).sort(), ['00000001', '00000002', '00000003']);
});
