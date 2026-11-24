import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ICON = 'assets/icon.webp';
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { cortico: { icon?: string }; files: string[] };

describe('cortico.icon 静态头像', () => {
  it('package.json 的 cortico.icon 指向 assets/icon.webp', () => {
    expect(manifest.cortico.icon).toBe(ICON);
  });

  it('icon 相对路径指向的包内文件真实存在', () => {
    expect(existsSync(fileURLToPath(new URL(`../${ICON}`, import.meta.url)))).toBe(true);
  });

  it('files 数组包含 assets，保证 npm 包携带头像', () => {
    expect(manifest.files).toContain('assets');
  });
});
