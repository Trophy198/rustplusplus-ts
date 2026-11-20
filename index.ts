/*
    Copyright (C) 2025 Alexander Emanuelsson (alexemanuelol)

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.

    https://github.com/alexemanuelol/rustplusplus

*/

import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { ensureEnvFile, projectEnvPath } from './scripts/generate-env';
import { projectRoot } from './src/utils/runtimePaths';

import { createLogger } from './src/managers/loggerManager';
import { LocaleManager, Languages, isValidLanguage } from './src/managers/LocaleManager';
import { CredentialsManager } from './src/managers/credentialsManager';
import { GuildInstanceManager } from './src/managers/guildInstanceManager';
import { DiscordManager } from './src/managers/discordManager';
import { RustPlusManager } from './src/managers/rustPlusManager';
import { FcmListenerManager } from './src/managers/fcmListenerManager';

// Keep accepting a service's working-directory .env. Fresh installs use the project root.
const workingEnv = path.resolve('.env');
const envPath = fs.existsSync(workingEnv) ? workingEnv : projectEnvPath;
dotenv.config({ path: envPath, quiet: true });

const clientId = process.env.RPP_DISCORD_CLIENT_ID?.trim();
const token = process.env.RPP_DISCORD_TOKEN?.trim();
if (!clientId || !token) {
    if (ensureEnvFile(envPath)) console.log(`Created ${envPath}`);
    const missing = [!clientId && 'RPP_DISCORD_CLIENT_ID', !token && 'RPP_DISCORD_TOKEN'].filter(Boolean);
    console.error(`Discord setup required. Set ${missing.join(' and ')} in ${envPath} and restart the bot.`);
    process.exit(1);
}

export const config = {
    general: {
        debug: process.env.RPP_DEBUG === 'true',
        language: isValidLanguage(process.env.RPP_LANGUAGE) ? process.env.RPP_LANGUAGE as Languages : Languages.ENGLISH,
        serverPollingHandlerIntervalMs: Number(process.env.RPP_SERVER_POLLING_HANDLER_INTERVAL_MS ?? '') || 10_000,
        showCallStackOnError: (process.env.RPP_SHOW_CALL_STACK_ON_ERROR === 'true') || false,
        reconnectIntervalMs: Number(process.env.RPP_RECONNECT_INTERVAL_MS ?? '') || 15_000
    },
    discord: {
        username: process.env.RPP_DISCORD_USERNAME || 'rustplusplus',
        clientId,
        token,
        useCache: process.env.RPP_USE_CACHE === 'true',
        enforceNameChange: process.env.RPP_ENFORCE_NAME_CHANGE === 'true',
        enforceAvatarChange: process.env.RPP_ENFORCE_AVATAR_CHANGE === 'true',
        enforceChannelPermissions: process.env.RPP_ENFORCE_CHANNEL_PERMISSIONS === 'true'
    }
}

export const log = createLogger(path.join(projectRoot, 'logs', 'rustplusplus.log'));

function createMissingDirectories() {
    const directories = ['logs', 'guildInstances', 'credentials', 'maps'];

    directories.forEach(dir => {
        const dirPath = path.join(projectRoot, dir);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    });
}
createMissingDirectories();

export const localeManager = new LocaleManager(config.general.language);
export const credentialsManager = new CredentialsManager(path.join(projectRoot, 'credentials'));
export const guildInstanceManager = new GuildInstanceManager(
    path.join(projectRoot, 'guildInstances'),
    path.join(__dirname, 'src', 'templates')
);

export const rustPlusManager = new RustPlusManager();
export const discordManager = new DiscordManager();
discordManager.build();

export const fcmListenerManager = new FcmListenerManager(discordManager);

process.on('unhandledRejection', error => {
    log.error(`[index.ts] Unhandled Rejection: ${error}`);
    console.log(error);
});