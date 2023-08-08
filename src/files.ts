import { slash } from '@antfu/utils';
import fg from 'fast-glob';
import { join } from 'path';

import type { PageOptions, ResolvedOptions } from './types';
import { extsToGlob } from './utils';

/**
 * Resolves the page dirs for its for its given globs
 */
export function getPageDirs(PageOptions: PageOptions, root: string, exclude: string[]): PageOptions[] {
  const dirs = fg.sync(slash(PageOptions.dir), {
    ignore: exclude,
    onlyDirectories: true,
    dot: true,
    unique: true,
    cwd: root
  });

  const pageDirs = dirs.map(dir => ({
    ...PageOptions,
    dir
  }));

  return pageDirs;
}

/**
 * Resolves the files that are valid pages for the given context.
 */
export function getPageFiles(path: string, options: ResolvedOptions): string[] {
  const { exclude, extensions } = options;

  const ext = extsToGlob(extensions);

  const files = fg
    .sync(`**/*.${ext}`, {
      ignore: exclude,
      onlyFiles: true,
      cwd: path
    })
    .map(p => slash(join(path, p)));

  return files;
}
