import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, dirname, basename, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repository, skillDirectory, skillFiles, verifyPackage } from './verify-package.mjs';
import { packDirectory } from '../skills/koudai-run/scripts/appisle.mjs';

export async function packageSkill({ output = join(repository, '.local', 'releases', 'koudai-run.zip') } = {}) {
  await verifyPackage();
  output = resolve(output);
  const files = await skillFiles();
  await mkdir(join(repository, '.local', 'packaging'), { recursive: true });
  const temporaryRoot = await realpath(join(repository, '.local', 'packaging'));
  const relativeRoot = relative(await realpath(repository), temporaryRoot);
  if (!relativeRoot || relativeRoot.startsWith('..') || isAbsolute(relativeRoot)) throw new Error('Packaging must stay inside the repository');
  const stage = await mkdtemp(join(temporaryRoot, 'skill-'));
  try {
    for (const name of files) {
      const destination = join(stage, 'koudai-run', name);
      await mkdir(dirname(destination), { recursive: true });
      await cp(join(skillDirectory, name), destination, { dereference: false });
    }
    const result = await packDirectory(stage, output);
    const sha256 = createHash('sha256').update(await readFile(output)).digest('hex');
    await writeFile(output + '.sha256', sha256 + '  ' + basename(output) + '\n');
    return { ...result, sha256, included: files };
  } finally {
    const target = await realpath(stage);
    if (dirname(target) !== temporaryRoot || !basename(target).startsWith('skill-')) throw new Error('Unexpected packaging temporary directory');
    await rm(target, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out' || !args[1])) throw new Error('Usage: node scripts/package-skill.mjs [--out file.zip]');
  console.log(JSON.stringify(await packageSkill({ output: args[1] }), null, 2));
}
