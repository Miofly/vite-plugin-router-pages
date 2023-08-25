import { slash } from '@antfu/utils';
import Debug from 'debug';
import { resolve } from 'path';
import { URLSearchParams } from 'url';

import type { ModuleNode, ViteDevServer } from 'vite';
import {
  cacheAllRouteRE,
  countSlashRE,
  dynamicRouteRE,
  MODULE_ID_VIRTUAL,
  nuxtCacheAllRouteRE,
  nuxtDynamicRouteRE,
  replaceDynamicRouteRE,
} from './constants';
import type { ResolvedOptions } from './types';

export const debug = {
  hmr: Debug('vite-plugin-pages:hmr'),
  routeBlock: Debug('vite-plugin-pages:routeBlock'),
  options: Debug('vite-plugin-pages:options'),
  pages: Debug('vite-plugin-pages:pages'),
  search: Debug('vite-plugin-pages:search'),
  env: Debug('vite-plugin-pages:env'),
  cache: Debug('vite-plugin-pages:cache'),
  resolver: Debug('vite-plugin-pages:resolver'),
};

export function extsToGlob(extensions: string[]) {
  return extensions.length > 1
    ? `{${extensions.join(',')}}`
    : extensions[0] || '';
}

export function countSlash(value: string) {
  return (value.match(countSlashRE) || []).length;
}

function isPagesDir(path: string, options: ResolvedOptions) {
  for (const page of options.dirs) {
    const dirPath = slash(resolve(options.root, page.dir));
    if (path.startsWith(dirPath)) return true;
  }
  return false;
}

export function isTarget(path: string, options: ResolvedOptions) {
  return isPagesDir(path, options) && options.extensionsRE.test(path);
}

export function isDynamicRoute(routePath: string, nuxtStyle = false) {
  return nuxtStyle
    ? nuxtDynamicRouteRE.test(routePath)
    : dynamicRouteRE.test(routePath);
}

export function isCatchAllRoute(routePath: string, nuxtStyle = false) {
  return nuxtStyle
    ? nuxtCacheAllRouteRE.test(routePath)
    : cacheAllRouteRE.test(routePath);
}

export function resolveImportMode(filepath: string, options: ResolvedOptions) {
  const mode = options.importMode;
  if (typeof mode === 'function') return mode(filepath, options);
  return mode;
}

export function invalidatePagesModule(server: ViteDevServer) {
  const { moduleGraph } = server;
  const mods = moduleGraph.getModulesByFile(MODULE_ID_VIRTUAL);
  if (mods) {
    const seen = new Set<ModuleNode>();
    mods.forEach(mod => {
      moduleGraph.invalidateModule(mod, seen);
    });
  }
}

export function normalizeCase(str: string, caseSensitive: boolean) {
  if (!caseSensitive) return str.toLocaleLowerCase();
  return str;
}

export function normalizeName(
  name: string,
  isDynamic: boolean,
  nuxtStyle = false,
) {
  if (!isDynamic) return name;

  return nuxtStyle
    ? name.replace(nuxtDynamicRouteRE, '$1') || 'all'
    : name.replace(replaceDynamicRouteRE, '$1');
}

export function parsePageRequest(id: string) {
  const [moduleId, rawQuery] = id.split('?', 2);
  const query = new URLSearchParams(rawQuery);
  const pageId = query.get('id');

  return {
    moduleId,
    query,
    pageId,
  };
}
