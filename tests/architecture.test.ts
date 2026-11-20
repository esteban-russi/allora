/** Tests enforcing the platform/product layering of src/. */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const srcDir = path.resolve(__dirname, '..', 'src');
const IMPORT_PATTERN = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** Every relative import in `dir`'s files that lands outside the allowed folders. */
function forbiddenImports(dir: string, allowed: string[]): string[] {
  const allowedDirs = allowed.map((name) => path.join(srcDir, name) + path.sep);
  return sourceFiles(path.join(srcDir, dir)).flatMap((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return [...text.matchAll(IMPORT_PATTERN)]
      .map((match) => match[1])
      .filter((spec) => {
        const target = path.resolve(path.dirname(file), spec);
        return !allowedDirs.some((allowedDir) => target.startsWith(allowedDir));
      })
      .map((spec) => `${path.relative(srcDir, file)} -> ${spec}`);
  });
}

describe('src layering', () => {
  it('keeps platform code free of product imports', () => {
    expect(forbiddenImports('platform', ['platform', 'config'])).toEqual([]);
  });

  it('keeps app config free of code imports', () => {
    expect(forbiddenImports('config', ['config'])).toEqual([]);
  });
});
