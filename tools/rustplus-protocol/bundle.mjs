// Read protobufjs-generated codecs as syntax trees. Never execute the downloaded app.
import { parse } from 'acorn';

const scalars = new Set('bool bytes double float fixed32 fixed64 int32 int64 sfixed32 sfixed64 sint32 sint64 string uint32 uint64'.split(' '));
const prop = node => node?.type === 'MemberExpression' && !node.computed ? node.property.name : undefined;

function walk(node, visit) {
    if (!node?.type || visit(node) === false) return;
    for (const child of Object.values(node)) {
        if (Array.isArray(child)) child.forEach(item => walk(item, visit));
        else if (child?.type) walk(child, visit);
    }
}

function typeName(member) {
    const parts = [];
    while (prop(member)) {
        if (prop(member) === 'ProtoBuf') return parts.join('.');
        parts.unshift(prop(member));
        member = member.object;
    }
}

function decodeField(arm, instance, reader) {
    const writes = [];
    walk(arm, node => {
        if (node.type === 'AssignmentExpression' && node.left.object?.name === instance &&
            node.right.type !== 'ArrayExpression') {
            writes.push([prop(node.left), node.right, false]);
        }
        if (node.type === 'CallExpression' && prop(node.callee) === 'push' &&
            node.callee.object.object?.name === instance) {
            writes.push([prop(node.callee.object), node.arguments[0], true]);
        }
    });
    const [name, call, repeated] = writes[0] || [];
    const method = prop(call?.callee);
    let type;
    if (call?.callee?.object?.name === reader && scalars.has(method)) type = method;
    if (method === 'decode') type = typeName(call.callee.object);
    if (writes.length !== 1 || !name || !type) throw Error('unsupported field decoder at byte ' + arm.start);
    return { name, type, rule: repeated ? 'repeated' : 'singular' };
}

function readDecoder(fn, name) {
    let instance;
    const arms = [];
    const required = new Set();
    const fields = {};
    walk(fn.body, n => {
        if (n.type === 'VariableDeclarator' && n.init?.type === 'NewExpression' &&
            typeName(n.init.callee) === name) instance = n.id.name;
        if (n.type === 'SwitchStatement') {
            if (arms.length || n.discriminant.operator !== '>>>' || n.discriminant.right.value !== 3)
                throw Error(name + ': unsupported protobuf tag dispatch');
            arms.push(...n.cases.filter(arm => arm.test).map(arm => [arm.test.value, arm]));
        }
        if (['ConditionalExpression', 'IfStatement'].includes(n.type) &&
            ['===', '=='].includes(n.test.operator) && n.test.left.operator === '>>>' && n.test.left.right.value === 3)
            arms.push([n.test.right.value, n.consequent]);
        if (n.type === 'ThrowStatement') {
            const msg = n.argument.arguments?.[0]?.value;
            const match = /^missing required '(\w+)'$/.exec(msg);
            if (!match) throw Error(name + ': unsupported decode check');
            required.add(match[1]);
        }
    });
    if (!instance) throw Error(name + ': unrecognized decoder');
    for (const [id, arm] of arms) {
        if (!Number.isInteger(id) || id < 1 || fields[id]) throw Error(name + ': invalid field number');
        fields[id] = decodeField(arm, instance, fn.params[0].name);
        if (required.delete(fields[id].name)) fields[id].rule = 'required';
    }
    if (required.size) throw Error(name + ': incomplete decode');
    return fields;
}

function enumNumber(node) {
    if (node?.type === 'Literal' && Number.isInteger(node.value)) return node.value;
    if (node?.operator === '-' && Number.isInteger(node.argument.value)) return -node.argument.value;
}

function readDefinition(name, rhs, messages, enums) {
    const children = [];
    const values = {};
    const enumFields = new Map();
    const defaults = new Set();
    let fields;
    walk(rhs, n => {
        if (n.type === 'CallExpression' && ['oneOfGetter', 'oneOfSetter'].includes(prop(n.callee)))
            throw Error(name + ': oneof grouping needs an extractor update');
        if (n.type !== 'AssignmentExpression') return;
        const key = prop(n.left);
        if (key && /^[A-Z]/.test(key)) {
            children.push([name + '.' + key, n.right]);
            return false;
        }
        if (prop(n.left?.object) === 'prototype' && key) defaults.add(key);
        const pair = n.left.property;
        if (n.left.computed && pair?.type === 'AssignmentExpression' &&
            typeof pair.right.value === 'string' && enumNumber(n.right) !== undefined &&
            enumNumber(n.right) === enumNumber(pair.left.property)) {
            values[pair.right.value] = enumNumber(n.right);
        }
        if (key === 'decode') fields = readDecoder(n.right, name);
        if (key === 'toObject') walk(n.right, expr => {
            if (expr.type === 'MemberExpression' && expr.computed && typeName(expr.object) && prop(expr.property))
                enumFields.set(prop(expr.property), typeName(expr.object));
        });
        if (key === 'decode' || key === 'toObject') return false;
    });
    if (fields) {
        const names = new Set(Object.values(fields).map(f => f.name));
        for (const field of defaults) {
            if (!names.has(field) && field !== 'toJSON') throw Error(name + ': missing decoder for ' + field);
        }
        for (const f of Object.values(fields)) {
            if (enumFields.has(f.name)) f.type = enumFields.get(f.name);
        }
        messages[name] = fields;
    } else if (Object.keys(values).length) enums[name] = values;
    else throw Error('Unknown generated definition ' + name);
    for (const [child, body] of children) readDefinition(child, body, messages, enums);
}

export function extract(source) {
    const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    const messages = {}, enums = {}, transport = {};
    const companionHosts = new Set();
    let namespace;
    walk(ast, n => {
        if (n.type === 'AssignmentExpression' && prop(n.left) === 'ProtoBuf' &&
            source.slice(n.right.start, n.right.end).includes('AppRequest')) {
            if (namespace) throw Error('Ambiguous ProtoBuf namespace');
            namespace = n.right;
            return false;
        }
        if (n.type === 'Literal' && typeof n.value === 'string' &&
            /^(?:[a-z0-9-]*companion[a-z0-9-]*\.)[a-z0-9.-]+$/i.test(n.value))
            companionHosts.add(n.value);
        if (n.type === 'MethodDefinition' && ['getWebSocketConnectUrl', 'getSubProtocols'].includes(n.key.name)) {
            const literals = [], properties = new Set();
            walk(n.value.body, item => {
                if (item.type === 'Literal' && typeof item.value === 'string') literals.push(item.value);
                if (item.type === 'TemplateElement') literals.push(item.value.raw);
                if (item.type === 'MemberExpression' && item.object.type === 'ThisExpression' && prop(item))
                    properties.add(prop(item));
            });
            (transport[n.key.name] ??= []).push({ literals, properties: [...properties].sort() });
        }
    });
    if (!namespace) throw Error('No Rust+ protobufjs namespace found. Check the bundle layout.');
    walk(namespace, n => {
        if (n.type === 'AssignmentExpression' && /^[A-Z]/.test(prop(n.left) || '')) {
            readDefinition(prop(n.left), n.right, messages, enums);
            return false;
        }
    });
    for (const k of ['AppRequest', 'AppResponse', 'AppMessage', 'AppBroadcast']) {
        if (!Object.keys(messages[k] || {}).length) throw Error('Missing core decoder ' + k);
    }
    for (const [name, fields] of Object.entries(messages)) {
        for (const f of Object.values(fields)) {
            if (!scalars.has(f.type) && !messages[f.type] && !enums[f.type])
                throw Error(name + ': unknown field type ' + f.type);
        }
    }
    transport.companionHosts = [...companionHosts].sort();
    return { messages, enums, transport };
}
