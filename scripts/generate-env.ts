import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from '../src/utils/runtimePaths';

export const projectEnvPath = path.join(projectRoot, '.env');

export function ensureEnvFile(envPath = projectEnvPath): boolean {
    if (fs.existsSync(envPath)) return false;
    const template = fs.readFileSync(path.join(__dirname, '.env.template'));
    try {
        fs.writeFileSync(envPath, template, { flag: 'wx', mode: 0o600 });
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw error;
    }
}

if (require.main === module) {
    console.log(ensureEnvFile() ? `Created ${projectEnvPath}` : `File already exists: ${projectEnvPath}`);
}
