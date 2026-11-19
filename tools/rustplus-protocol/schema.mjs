import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import descriptor from 'protobufjs/ext/descriptor/index.js';

function compile(source, dir) {
    writeFileSync(join(dir, 'rustplus.proto'), source);
    execFileSync('protoc', ['--include_source_info', '--descriptor_set_out=schema.pb', 'rustplus.proto'], { cwd: dir });
    return descriptor.FileDescriptorSet.decode(readFileSync(join(dir, 'schema.pb'))).file[0];
}

export function describe(field) {
    return field ? `${field.rule} ${field.type} ${field.name}` : '—';
}

export function bundleDiff(before, after) {
    const rows = [];
    for (const kind of ['messages', 'enums']) {
        const names = new Set([...Object.keys(before[kind]), ...Object.keys(after[kind])]);
        for (const name of [...names].sort()) {
            const a = before[kind][name], b = after[kind][name];
            if (!a || !b) rows.push(`${name} · ${a ? 'removed' : 'added'} ${kind === 'messages' ? 'message' : 'enum'}`);
            const ids = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
            for (const id of ids) {
                const format = kind === 'messages' ? describe : v => v ?? '—';
                const left = format(a?.[id]), right = format(b?.[id]);
                if (left !== right) rows.push(`${name}[${id}] · ${left} → ${right}`);
            }
        }
    }
    return rows;
}

// protoc reports zero-based byte columns with eight-column tab stops.
function offset(lines, starts, line, column) {
    let index = 0, visual = 0;
    while (visual < column && index < lines[line].length) {
        visual += lines[line][index++] === 9 ? 8 - visual % 8 : 1;
    }
    if (visual !== column) throw Error('Unexpected protoc source position');
    return starts[line] + index;
}

export function planSchema(source, official, dir) {
    const file = compile(source, dir);
    if (file.syntax !== 'proto3') throw Error('Branch source requires a proto3 planner');
    const buffer = Buffer.from(source);
    const lines = source.split('\n').map(line => Buffer.from(line));
    const starts = [0];
    for (const line of lines) starts.push(starts.at(-1) + line.length + 1);
    const locations = new Map(file.sourceCodeInfo.location.map(loc => [loc.path.join('/'), loc.span]));
    function range(path) {
        const span = locations.get(path.join('/'));
        if (!span) throw Error('Missing source location ' + path.join('/'));
        const [line, col] = span;
        return [offset(lines, starts, line, col), offset(lines, starts, span.length === 4 ? span[2] : line, span.at(-1))];
    }

    const messages = new Map(), enums = new Map();
    function indexTypes(container, parent, path, top) {
        for (const [i, msg] of (top ? container.messageType : container.nestedType).entries()) {
            const name = parent + msg.name, msgPath = [...path, top ? 4 : 3, i];
            messages.set(name, { def: msg, path: msgPath });
            indexTypes(msg, name + '.', msgPath, false);
        }
        for (const [i, def] of container.enumType.entries())
            enums.set(parent + def.name, { def, path: [...path, top ? 5 : 4, i] });
    }
    indexTypes(file, '', [], true);
    const edits = [], additions = new Map(), changes = [], review = [];
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const unit = /^\t\S/m.test(source) ? '\t' : '    ';
    const packagePrefix = file.package ? '.' + file.package + '.' : '.';
    function add(parent, text) {
        if (!additions.has(parent)) additions.set(parent, []);
        additions.get(parent).push(text);
    }
    function fieldLine(field, id) {
        const type = (official.messages[field.type] || official.enums[field.type]) ? packagePrefix + field.type : field.type;
        return `${field.rule === 'repeated' ? 'repeated' : 'optional'} ${type} ${field.name} = ${id};`;
    }
    const parentName = name => name.split('.').slice(0, -1).join('.');
    function renderNew(name) {
        const short = name.split('.').at(-1);
        if (official.enums[name]) {
            const values = Object.entries(official.enums[name]);
            if (!values.some(([, id]) => id === 0)) {
                let zero = name.replaceAll('.', '_').toUpperCase() + '_UNSPECIFIED';
                while (Object.hasOwn(official.enums[name], zero)) zero += '_';
                values.unshift([zero, 0]);
                review.push(name + '.' + zero + ' = 0 is a proto3 placeholder added to the candidate');
            }
            values.sort((a, b) => Number(b[1] === 0) - Number(a[1] === 0));
            return ['enum ' + short + ' {', ...values.map(([key, id]) => unit + key + ' = ' + id + ';'), '}'].join(newline);
        }
        const members = Object.entries(official.messages[name]).map(([id, f]) => fieldLine(f, id));
        for (const child of [...Object.keys(official.messages), ...Object.keys(official.enums)])
            if (parentName(child) === name) members.push(renderNew(child));
        return ['message ' + short + ' {', ...members.flatMap(m => m.split(newline).map(line => unit + line)), '}'].join(newline);
    }
    function reserved(def, id, name, isEnum = false) {
        return def.reservedName.includes(name) || def.reservedRange.some(r =>
            id >= r.start && (isEnum ? id <= r.end : id < r.end));
    }
    for (const name of [...Object.keys(official.messages), ...Object.keys(official.enums)]) {
        if (messages.has(name) || enums.has(name)) continue;
        if (!parentName(name) || messages.has(parentName(name))) add(parentName(name), renderNew(name));
        changes.push('Add ' + name);
    }
    const types = descriptor.FieldDescriptorProto.lookupEnum('Type').valuesById;
    for (const [name, { def, path }] of messages) {
        const fields = official.messages[name];
        if (!fields) { review.push(name + ' exists only in the branch schema'); continue; }
        for (const [id, want] of Object.entries(fields)) {
            const index = def.field.findIndex(f => f.number === Number(id));
            const f = def.field[index];
            const key = `${name}[${id}]`;
            if (!f) {
                if (def.field.some(f => f.name === want.name) || reserved(def, +id, want.name)) {
                    review.push(key + ' conflicts with an existing or reserved name/tag: ' + want.name);
                } else {
                    add(name, fieldLine(want, id));
                    changes.push(key + ' add ' + describe(want));
                }
                continue;
            }
            const type = f.typeName ? f.typeName.replace(packagePrefix, '') : types[f.type].slice(5).toLowerCase();
            if (f.name !== want.name || (f.label === 3) !== (want.rule === 'repeated')) {
                review.push(key + ' ' + (f.label === 3 ? 'repeated ' : '') + type + ' ' + f.name + ' → ' + describe(want));
            } else if (type !== want.type) {
                const change = key + ' ' + f.name + ' · ' + type + ' → ' + want.type;
                if (type === 'uint32' && want.type === 'uint64' || type === 'int32' && want.type === 'int64') {
                    const [start, end] = range([...path, 2, index, 5]);
                    if (buffer.subarray(start, end).toString() !== type) throw Error('Invalid type span: ' + key);
                    edits.push({ start, end, text: want.type });
                    changes.push(change);
                } else review.push(change);
            }
        }
        for (const f of def.field)
            if (!fields[f.number]) review.push(`${name}[${f.number}] ${f.name} exists only in the branch schema`);
    }
    for (const [name, { def }] of enums) {
        const values = official.enums[name];
        if (!values) { review.push(name + ' enum exists only in the branch schema'); continue; }
        for (const [key, id] of Object.entries(values)) {
            if (def.value.some(v => v.name === key && v.number === id)) continue;
            if (def.value.some(v => v.name === key || v.number === id) || reserved(def, id, key, true)) {
                review.push(`${name}.${key} = ${id} conflicts with the branch enum`);
            } else {
                add(name, key + ' = ' + id + ';');
                changes.push(`${name}.${key} add value ${id}`);
            }
        }
        for (const v of def.value)
            if (!(v.name in values)) review.push(name + '.' + v.name + ' exists only in the branch enum');
    }
    for (const [parent, entries] of additions) {
        if (!parent) {
            edits.push({ start: buffer.length, end: buffer.length, text: newline + entries.join(newline + newline) + newline });
            continue;
        }
        const [, end] = range((messages.get(parent) || enums.get(parent)).path);
        if (buffer[end - 1] !== 125) throw Error('Missing closing brace for ' + parent);
        const lineStart = buffer.lastIndexOf(10, end - 2) + 1;
        const prefix = buffer.subarray(lineStart, end - 1).toString();
        const indent = /^\s*$/.test(prefix) ? prefix : '';
        const start = indent ? lineStart : end - 1;
        const body = entries.join(newline).split(newline).map(s => indent + unit + s).join(newline);
        edits.push({ start, end: end - 1, text: (prefix.trim() ? newline : '') + body + newline + indent });
    }
    let updated = buffer;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
        updated = Buffer.concat([updated.subarray(0, edit.start), Buffer.from(edit.text), updated.subarray(edit.end)]);
    }
    if (edits.length) compile(updated, dir);
    return { candidate: updated.toString(), changes, review };
}
