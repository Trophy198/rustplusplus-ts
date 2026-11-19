const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const source = path.resolve(__dirname, '../src');
const output = path.resolve(__dirname, '../dist/src');

// Commands and events are discovered from disk. Remove outputs for deleted modules on rebuild.
fs.rmSync(output, { recursive: true, force: true });
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', path.resolve(__dirname, '..')], {
    stdio: 'inherit'
});

for (const directory of ['languages', 'resources', 'staticFiles']) {
    fs.cpSync(path.join(source, directory), path.join(output, directory), { recursive: true });
}

for (const name of fs.readdirSync(path.join(source, 'templates'))) {
    if (name.endsWith('.json')) {
        fs.copyFileSync(path.join(source, 'templates', name), path.join(output, 'templates', name));
    }
}
