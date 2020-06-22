import { fork } from 'child_process';
import { unlink, writeFileSync } from 'fs';
import * as path from 'path';

/**
 * Runs the code in a child process, and returns its stdout/err string.
 */
export async function runInChild(code: string) {
  const cwd = path.resolve(__dirname, '..', '..');
  const file = path.resolve(cwd, '.test.js');

  after(done => unlink(file, () => done()));

  writeFileSync(file, `const { Policy } = require('./');\n${code}`);

  const child = fork(file, [], { cwd, stdio: 'pipe' });
  const output: Buffer[] = [];
  child.stderr?.on('data', d => output.push(d));
  child.stdout?.on('data', d => output.push(d));

  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', resolve);
  });

  return Buffer.concat(output).toString().replace(/\r?\n/g, '\n').trim();
}
