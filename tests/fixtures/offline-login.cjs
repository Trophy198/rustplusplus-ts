// Preloaded by the production startup test inside an isolated deployment.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const appRequire = createRequire(path.resolve('dist/index.js'));
appRequire('discord.js').Client.prototype.login = async function () {
    setImmediate(async () => {
        try {
            const { discordManager, guildInstanceManager } = appRequire('./index');
            const names = dir => fs.readdirSync(path.join('dist/src', dir))
                .filter(file => file.endsWith('.js')).map(file => path.basename(file, '.js')).sort();
            for (const [commands, directory] of [
                [discordManager.globalSlashCommands, 'discordGlobalSlashCommands'],
                [discordManager.guildSlashCommands, 'discordGuildSlashCommands']
            ]) {
                assert.ok(commands.size > 0);
                assert.equal(commands.size, names(directory).length);
            }
            assert.ok(discordManager.eventListeners.length > 0);
            assert.equal(discordManager.eventListeners.length, names('discordEvents').length);

            guildInstanceManager.getGuildInstance = () => ({ serverInfoMap: { server: { name: 'offline' } } });
            const { RustPlusInstance } = appRequire('./src/managers/rustPlusManager');
            const instance = new RustPlusInstance('guild', 'server');
            assert.ok(instance.commandNames.length > 0);
            assert.deepEqual(instance.commandNames.sort(), names('prefixCommands'));
            await instance.loadRustPlusEvents(instance.sessionId);
            assert.ok(instance.rustPlus.eventNames().length > 0);
            assert.equal(instance.rustPlus.eventNames().length, names('rustPlusEvents').length);
            for (const directory of ['credentials', 'guildInstances', 'logs', 'maps']) {
                assert.ok(fs.statSync(directory).isDirectory());
                assert.equal(fs.existsSync(path.join('dist', directory)), false);
            }
            for (const file of ['resources/images/rustplusplus_logo.png', 'staticFiles/cctvCodes.json']) {
                assert.ok(fs.statSync(path.join('dist/src', file)).size > 0);
            }
            assert.equal(require.cache[appRequire.resolve('typescript')], undefined);
            console.log('Compiled startup verified');
        } catch (error) {
            console.error(error);
            process.exitCode = 1;
        }
    });
    return 'offline';
};
