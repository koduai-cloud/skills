import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ignore = '# 口袋空间的本地关联、部署包和私密文件，不提交到 Git。\n*\n';

// Every CLI write under .appisle goes through here, so credentials saved in
// .appisle/private never show up as untracked files a later `git add .` commits.
export async function projectDirectory(cwd = process.cwd()) {
  const dir = join(cwd, '.appisle');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '.gitignore'), ignore, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  return dir;
}
