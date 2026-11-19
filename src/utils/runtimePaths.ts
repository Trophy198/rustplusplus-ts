import * as path from 'path';

export const moduleExtension = path.extname(__filename);
// Compiled modules live one directory deeper, under dist/src.
export const projectRoot = path.resolve(__dirname, moduleExtension === '.js' ? '../../..' : '../..');
