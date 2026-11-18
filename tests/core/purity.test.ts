import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 递归列出目录下的全部 .ts 文件 */
function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const CORE_DIR = join(__dirname, '../../src/core');
const DATA_DIR = join(__dirname, '../../src/data');

describe('逻辑层纯净性', () => {
  const coreFiles = listTsFiles(CORE_DIR);

  it('core 目录里有源文件', () => {
    expect(coreFiles.length).toBeGreaterThan(5);
  });

  it('core 不引用 three、document、window', () => {
    for (const file of coreFiles) {
      const text = readFileSync(file, 'utf-8');
      expect(text, file).not.toMatch(/\bthree\b/i);
      expect(text, file).not.toMatch(/\bdocument\b/);
      expect(text, file).not.toMatch(/\bwindow\b/);
    }
  });

  it('core 只引用 core 内部的模块（不引用 data、render、ui、assets）', () => {
    for (const file of coreFiles) {
      const text = readFileSync(file, 'utf-8');
      for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        expect(m[1], `${file} 引用了 ${m[1]}`).toMatch(/^\.\/[\w-]+$/);
      }
    }
  });

  it('explore（探索模式的纯逻辑，步骤 14）不引用 three、DOM，只引用 explore、data 和 core 的类型', () => {
    const files = listTsFiles(join(__dirname, '../../src/explore'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      expect(text, file).not.toMatch(/from\s+['"]three/);
      expect(text, file).not.toMatch(/\bdocument\b/);
      expect(text, file).not.toMatch(/\bwindow\b/);
      for (const m of text.matchAll(/(import(?:\s+type)?)\s[^;]*?from\s+['"]([^'"]+)['"]/g)) {
        const typeOnly = m[1]!.includes('type');
        const path = m[2]!;
        const ok = /^\.\/[\w-]+$/.test(path) || /^\.\.\/data\/[\w-]+$/.test(path) || (typeOnly && /^\.\.\/core\/types$/.test(path));
        expect(ok, `${file} 引用了 ${path}`).toBe(true);
      }
    }
  });

  it('growth（等级、经验、属性计算，步骤 21）不引用 three、DOM，只引用 growth、data 和 core 的类型', () => {
    const files = listTsFiles(join(__dirname, '../../src/growth'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      expect(text, file).not.toMatch(/from\s+['"]three/);
      expect(text, file).not.toMatch(/\bdocument\b/);
      expect(text, file).not.toMatch(/\bwindow\b/);
      for (const m of text.matchAll(/(import(?:\s+type)?)\s[^;]*?from\s+['"]([^'"]+)['"]/g)) {
        const typeOnly = m[1]!.includes('type');
        const path = m[2]!;
        const ok = /^\.\/[\w-]+$/.test(path) || /^\.\.\/data\/[\w-]+$/.test(path) || (typeOnly && /^\.\.\/core\/types$/.test(path));
        expect(ok, `${file} 引用了 ${path}`).toBe(true);
      }
    }
  });

  it('data 只引用 core 和 data 内部的模块', () => {
    for (const file of listTsFiles(DATA_DIR)) {
      const text = readFileSync(file, 'utf-8');
      for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        expect(m[1], `${file} 引用了 ${m[1]}`).toMatch(/^(\.\/[\w-]+|\.\.\/core\/[\w-]+)$/);
      }
    }
  });
});
