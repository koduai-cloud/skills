import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The installer owns skill files, locks, copies and agent symlinks.
// Application platform URLs must never become skill download sources.
export async function updateSkill({ source } = {}) {
  if (source !== undefined) {
    throw new Error('此 Skill 由 skills CLI 管理更新，请运行 npx skills update koudai-run；连接平台时在 login 等业务命令中使用 --url。');
  }
  return {
    skill_name: 'koudai-run',
    distribution: 'github',
    update_manager: 'skills',
    updated: false,
    update_available: null,
    check_performed: false,
    check_command: 'npx skills check',
    update_command: 'npx skills update koudai-run',
    skill_path: join(skillRoot, 'SKILL.md'),
    message: '请使用 skills CLI 检查和更新本 Skill；本命令未访问网络，也未替换安装文件。',
  };
}
