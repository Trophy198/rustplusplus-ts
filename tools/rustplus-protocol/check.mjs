import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { extract } from './bundle.mjs';
import { bundleDiff, planSchema } from './schema.mjs';

const { values: args } = parseArgs({ options: {
    help: { type: 'boolean' }, bundle: { type: 'string' }, state: { type: 'string' },
    'master-ref': { type: 'string', default: 'refs/rustplus-protocol/master' },
    'playground-ref': { type: 'string', default: 'HEAD' },
    'master-proto': { type: 'string' }, 'playground-proto': { type: 'string' },
    'refresh-refs': { type: 'boolean' }, watch: { type: 'string' }
} });
if (args.help) {
    console.log('node tools/rustplus-protocol/check.mjs [--state DIR] [--watch MINUTES] [--refresh-refs]\n' +
        '  [--master-ref REF] [--playground-ref REF] [--bundle FILE] [--master-proto FILE] [--playground-proto FILE]');
    process.exit(0);
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trimEnd();
const root = git('rev-parse', '--show-toplevel');
const state = resolve(args.state || join(root, 'temp', 'rustplus-protocol'));
const sha = data => createHash('sha256').update(data).digest('hex');
const read = p => readFileSync(p, 'utf8');
const readJSON = p => JSON.parse(read(p));
const toolVersion = sha(['check.mjs', 'bundle.mjs', 'schema.mjs', 'package-lock.json']
    .map(file => read(new URL(file, import.meta.url))).join('\n'));
const save = (p, obj) => writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
const branches = [
    { name: 'master', ref: args['master-ref'], override: args['master-proto'], pkg: '@liamcottle/rustplus.js', path: 'rustplus.proto' },
    { name: 'alle_playground', ref: args['playground-ref'], override: args['playground-proto'], pkg: 'rustplus-ts', path: 'src/protos/rustplus.proto' }
];

async function get(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw Error(`${url} returned HTTP ${response.status}`);
    return response.text();
}

async function officialBundle() {
    if (args.bundle) return { source: resolve(args.bundle), code: read(args.bundle) };
    const site = 'https://app.playrust.com/';
    const html = await get(site);
    const scripts = [...html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)]
        .map(m => new URL(m[1], site))
        .filter(u => u.origin === new URL(site).origin && /\/app\.[\w-]+\.js$/.test(u.pathname));
    if (scripts.length !== 1) throw Error('Expected one official app.<hash>.js entry. Inspect the new web build.');
    return { source: scripts[0].href, code: await get(scripts[0].href) };
}

async function branchInput(branch, last, previous) {
    const commit = git('-C', root, 'rev-parse', '--verify', '--end-of-options', branch.ref + '^{commit}');
    const file = path => git('-C', root, 'show', commit + ':' + path);
    const trackedPaths = filePaths(commit);
    const hasRelay = trackedPaths.has('src/util/rustRelay.js') &&
        file('src/util/rustRelay.js').includes('rustplus.auth.v1') ||
        trackedPaths.has('src/utils/rustRelay.ts') && trackedPaths.has('src/managers/rustPlusManager.ts') &&
        file('src/managers/rustPlusManager.ts').includes('this.rustPlus.connect({ serverId:');
    const strictAddress = trackedPaths.has('src/managers/fcmListenerManager.ts') &&
        /PairingServerBodySchema\s*=\s*z\.object\(\{[^}]*\bip:\s*z\.string\(\)\s*,[^}]*\bport:\s*z\.string\(\)\s*,/s
            .test(file('src/managers/fcmListenerManager.ts'));
    if (branch.override) {
        return { ...branch, commit, source: resolve(branch.override), proto: read(branch.override), hasRelay, strictAddress };
    }
    const lock = JSON.parse(file('package-lock.json'));
    const entry = lock.packages?.['node_modules/' + branch.pkg];
    if (!entry) throw Error(branch.name + ': missing lock entry for ' + branch.pkg + '. Supply a --*-proto file.');
    if (entry.link) {
        const target = entry.resolved + '/' + branch.path;
        const proto = execFileSync('git', ['-C', root, 'show', commit + ':' + target], { encoding: 'utf8' });
        return { ...branch, commit, source: commit + ':' + target, proto, hasRelay, strictAddress };
    }
    const pin = [entry.version, entry.resolved, entry.integrity].join(' ');
    const cached = previous?.branches.find(b => b.name === branch.name && b.pin === pin);
    if (cached) {
        const proto = read(join(state, last, branch.name, 'original.proto'));
        if (sha(proto) !== cached.sha256) throw Error(branch.name + ': cached original.proto checksum mismatch');
        return { ...branch, commit, source: cached.source, proto, pin, hasRelay, strictAddress };
    }
    let repo, revision;
    if (entry.resolved?.startsWith('git+')) {
        const match = /github\.com[/:]([\w.-]+\/[\w.-]+?)\.git#([0-9a-f]{40})$/.exec(entry.resolved);
        if (!match) throw Error(branch.name + ': unsupported Git dependency ' + entry.resolved);
        [, repo, revision] = match;
    } else {
        const registry = 'https://registry.npmjs.org/' + encodeURIComponent(branch.pkg) + '/' + encodeURIComponent(entry.version);
        const meta = JSON.parse(await get(registry));
        if (!entry.integrity || meta.dist?.integrity !== entry.integrity) throw Error(branch.name + ': npm integrity mismatch');
        repo = /github\.com[/:]([\w.-]+\/[\w.-]+?)\.git$/.exec(meta.repository?.url)?.[1];
        revision = meta.gitHead;
        if (!repo || !/^[0-9a-f]{40}$/.test(revision)) throw Error(branch.name + ': npm package has no verifiable source revision');
    }
    const source = `https://raw.githubusercontent.com/${repo}/${revision}/${branch.path}`;
    return { ...branch, commit, source, proto: await get(source), pin, hasRelay, strictAddress };
}

function filePaths(commit) {
    return new Set(git('-C', root, 'ls-tree', '-r', '--name-only', commit, 'src').split('\n'));
}

function patch(original, candidate, target, dir) {
    writeFileSync(join(dir, 'before'), original);
    writeFileSync(join(dir, 'after'), candidate);
    const result = spawnSync('diff', ['-u', '-L', 'a/' + target, '-L', 'b/' + target, 'before', 'after'],
        { cwd: dir, encoding: 'utf8' });
    if (result.error || ![0, 1].includes(result.status)) throw result.error || Error(result.stderr);
    return result.stdout;
}

function list(rows) {
    return rows.length ? rows.map(row => '- ' + row).join('\n') : '없음';
}

async function check() {
    const masterRef = args['master-ref'];
    if (masterRef === 'refs/rustplus-protocol/master' && (args['refresh-refs'] ||
        spawnSync('git', ['-C', root, 'show-ref', '--verify', '--quiet', masterRef]).status !== 0)) {
        git('-C', root, 'fetch', '--no-tags', 'https://github.com/alexemanuelol/rustplusplus.git',
            'refs/heads/master:' + masterRef);
    }
    mkdirSync(state, { recursive: true });
    const history = readdirSync(state).filter(f => /^\d{8}$/.test(f)).sort();
    const last = history.at(-1);
    const previous = last && readJSON(join(state, last, 'snapshot.json'));
    const [bundle, ...inputs] = await Promise.all([officialBundle(), ...branches.map(b => branchInput(b, last, previous))]);
    const digest = sha(bundle.code);
    const sources = inputs.map(b => ({ name: b.name, ref: b.ref, commit: b.commit, source: b.source, pin: b.pin, sha256: sha(b.proto) }));
    const sameBuild = previous?.sha256 === digest && previous.toolVersion === toolVersion;
    if (sameBuild && JSON.stringify(previous.branches) === JSON.stringify(sources)) {
        console.log('번들과 브랜치 기준이 같습니다. ' + join(state, last, 'report.md'));
        return;
    }
    const schema = sameBuild ? previous.schema : extract(bundle.code);
    const baselineId = previous?.sha256 === digest ? previous.previousBundle : last || null;
    const baseline = baselineId && readJSON(join(state, baselineId, 'snapshot.json'));
    const next = String(Number(last || 0) + 1).padStart(8, '0');
    const stage = mkdtempSync(join(state, '.build-'));
    const work = mkdtempSync(join(tmpdir(), 'rustplus-proto-'));
    try {
        save(join(stage, 'snapshot.json'), {
            source: bundle.source, toolVersion, sha256: digest, observedAt: new Date().toISOString(), previousBundle: baselineId,
            branches: sources, schema
        });
        const delta = baseline && bundleDiff(baseline.schema, schema);
        const report = ['# Rust+ 프로토콜 비교', '', `분석한 번들: ${bundle.source}`, `SHA-256: ${digest}`,
            '', '## 이전 번들과의 차이', '',
            baseline ? `비교 기준: ${baselineId} · ${baseline.source} · ${baseline.sha256}\n\n${list(delta)}`
                : '첫 관측입니다. 이번 스냅샷을 다음 웹 빌드의 비교 기준으로 저장합니다.',
            '', '## WebSocket 연결', '',
            '클라이언트 호스트 후보, URL 템플릿 및 서브프로토콜 메서드의 단서: ' + JSON.stringify(schema.transport),
            baseline && JSON.stringify(baseline.schema.transport) !== JSON.stringify(schema.transport)
                ? '이전 값: ' + JSON.stringify(baseline.schema.transport) : '',
            '이 항목은 문자열 단서입니다. 인증 흐름과 FCM 알림 형식은 별도 확인이 필요합니다.'];
        for (const b of inputs) {
            const { candidate, changes, review } = planSchema(b.proto, schema, work);
            const dir = join(stage, b.name);
            mkdirSync(dir);
            writeFileSync(join(dir, 'original.proto'), b.proto);
            writeFileSync(join(dir, 'rustplus.proto'), candidate);
            writeFileSync(join(dir, 'protocol.patch'), patch(b.proto, candidate, b.path, work));
            report.push('', '## ' + b.name, '', `기준: ${b.ref} @ ${b.commit}\n\n스키마: ${b.source}`,
                '', `### 수정 후보 (${changes.length})`, '', list(changes),
                '', `### 수동 검토 (${review.length})`, '', list(review),
                '', '### 봇에 반영할 위치', '',
                b.hasRelay ? '- 브랜치의 릴레이 연결 구현에서 공식 URL·인증 협상을 대조합니다.'
                    : '- 이 ref에서 master 방식의 src/util/rustRelay.js를 확인하지 못했습니다. 연결 관리자의 릴레이 경로를 확인합니다.',
                b.strictAddress ? '- fcmListenerManager의 페어링 검증은 ip와 port가 필수입니다. id만 오는 알림과 저장 키를 처리해야 합니다.' : '',
                b.name === 'master' ? '- 포크 루트의 rustplus.proto에 패치를 적용하고 라이브러리 커밋과 봇 lockfile을 갱신합니다.'
                    : '- rustplus-ts의 src/protos/rustplus.proto에 적용하고 npm run protogen 및 build 후 인터페이스·검증기를 대조하고 봇 의존성을 갱신합니다.',
                b.name === 'alle_playground' && changes.some(c => c.includes('entityId · uint32 → uint64'))
                    ? '- long_type_string으로 생성되는 entityId와 rustplus-ts/src/validation.ts의 number 검사, 각 호출 인자를 함께 대조합니다.' : '',
                changes.some(c => /uint64|int64/.test(c)) ? '- 64비트 값의 요청, 응답, 장치 키, JSON 저장 경로에서 정밀도가 보존되는지 확인합니다.' : '',
                '', `[컴파일된 수정 후보](${b.name}/rustplus.proto) · [라이브러리용 패치](${b.name}/protocol.patch)`);
        }
        report.push('', 'proto3 후보는 추가 필드를 optional/repeated로 표현합니다. 웹 디코더의 필수 검사는 snapshot.json의 rule에 기록합니다.');
        writeFileSync(join(stage, 'report.md'), report.join('\n') + '\n');
        // Publish only after both candidates compile. A competing non-empty run directory cannot be replaced.
        renameSync(stage, join(state, next));
        console.log(join(state, next, 'report.md'));
    } finally {
        rmSync(stage, { recursive: true, force: true });
        rmSync(work, { recursive: true, force: true });
    }
}

const minutes = Number(args.watch);
if (args.watch !== undefined && (!Number.isFinite(minutes) || minutes <= 0 || minutes * 60000 > 2147483647))
    throw Error('--watch expects a positive interval in minutes (maximum 35791)');
do {
    try { await check(); }
    catch (err) {
        console.error('Rust+ protocol check: ' + err.message);
        if (!minutes) process.exitCode = 1;
    }
    if (minutes) await delay(minutes * 60_000);
} while (minutes);
