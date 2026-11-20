import * as fs from 'fs';
import * as path from 'path';

export const moduleExtension = path.extname(__filename);
// Compiled modules live one directory deeper, under dist/src.
export const projectRoot = path.resolve(__dirname, moduleExtension === '.js' ? '../../..' : '../..');

export function prefixCommandNames(): string[] {
    return fs.readdirSync(path.join(__dirname, '..', 'prefixCommands'))
        .filter(file => file.endsWith(moduleExtension))
        .map(file => path.basename(file, moduleExtension));
}
