import deepEqual from 'deep-equal';
import { omit, pick } from 'lodash';
import colors from 'picocolors';
import type { PageContext } from '../context';

import { getRouteBlock } from '../customBlock';
import { generateClientCode } from '../stringify';
import type { CustomBlock, Optional, PageResolver } from '../types';
import { countSlash, isCatchAllRoute, isDynamicRoute, normalizeCase, normalizeName } from '../utils';

export interface VueRouteBase {
  name: string;
  path: string;
  props?: boolean;
  component?: string;
  children?: VueRouteBase[];
  customBlock?: CustomBlock;
  rawRoute: string;
  meta?: Record<string, any>;
}

export interface VueRoute extends Omit<Optional<VueRouteBase, 'rawRoute' | 'name'>, 'children'> {
  children?: VueRoute[];
}

function prepareRoutes(ctx: PageContext, routes: VueRoute[], parent?: VueRoute) {
  for (const route of routes) {
    if (route.name) route.name = route.name.replace(RegExp(`${ctx.options.routeNameSeparator}index$`), '');

    if (route.customBlock?.hideParPath) {
      const routeSplit = route.rawRoute?.split('/');
      if (routeSplit && routeSplit?.length >= 2) {
        const secondToLast = routeSplit[routeSplit.length - 2];
        route.path = route.path.replace(secondToLast + ctx.options.routeNameSeparator, '');
      }
    }

    if (parent) route.path = route.path?.replace(/^\//, '');

    if (!route.meta) {
      route.meta = {
        title: route.path || route.name
      };
    } else {
      route.meta.title = route.path || route.name;
    }

    if (route.children) route.children = prepareRoutes(ctx, route.children, route);

    if (route.children?.find((c) => c.name === route.name)) delete route.name;

    route.props = true;

    delete route.rawRoute;

    if (route.customBlock) {
      const noInMeta = ['path', 'name', 'children', 'component', 'redirect'];

      Object.assign(route, {
        ...pick(route.customBlock, noInMeta),
        meta: {
          ...route.meta,
          ...omit(route.customBlock, noInMeta)
        }
      });
      delete route.customBlock;
    }

    Object.assign(route, ctx.options.extendRoute?.(route, parent) || {});
  }

  return routes;
}

async function computeVueRoutes(ctx: PageContext, customBlockMap: Map<string, CustomBlock>): Promise<VueRoute[]> {
  const pageRoutes = [...ctx.pageRouteMap.values()];

  const _routes = pageRoutes.map(async (item) => {
    const data = await generateRoutes(item, ctx, customBlockMap);
    return {
      ...item,
      children: data
    };
  });

  return (await Promise.all(_routes)) as any;
}

async function generateRoutes(pageRoutes, ctx, customBlockMap) {
  const { routeStyle, caseSensitive, routeNameSeparator } = ctx.options;

  const routes: VueRouteBase[] = [];

  pageRoutes.children
    .sort((a, b) => countSlash(a.route) - countSlash(b.route))
    .forEach((page) => {
      const pathNodes = page.route.split('/');
      const component = page.path.replace(ctx.root, '');

      const noInMeta = ['path', 'hideComp', 'route'];

      const customBlock = customBlockMap.get(page.path) ? { ...omit(page, noInMeta), ...customBlockMap.get(page.path) } : omit(page, noInMeta);

      const route: VueRouteBase = {
        name: pageRoutes.path.replace(/\//, ''),
        path: '',
        component,
        customBlock,
        rawRoute: page.route
      };

      if (page.hideComp) {
        delete route.component;
      }

      let parentRoutes = routes;
      let dynamicRoute = false;

      for (let i = 0; i < pathNodes.length; i++) {
        const node = pathNodes[i];

        const nuxtStyle = routeStyle === 'nuxt';
        const isDynamic = isDynamicRoute(node, nuxtStyle);
        const isCatchAll = isCatchAllRoute(node, nuxtStyle);
        const normalizedName = normalizeName(node, isDynamic, nuxtStyle);

        const normalizedPath = normalizeCase(normalizedName, caseSensitive);

        if (isDynamic) dynamicRoute = true;

        route.name += route.name ? `${routeNameSeparator}${normalizedName}` : normalizedName;

        if (route.name.includes(':')) {
          route.name = route.name.replace(/:/g, routeNameSeparator);
        }

        // Check parent exits
        const parent = parentRoutes.find((parent) => {
          return pathNodes.slice(0, i + 1).join('/') === parent.rawRoute;
        });

        if (parent) {
          // Make sure children exist in parent
          parent.children = parent.children || [];
          // Append to parent's children
          parentRoutes = parent.children;
          // Reset path
          route.path = '';
        } else if (normalizedPath === 'index') {
          if (!route.path) route.path = '';
        } else if (normalizedPath !== 'index') {
          if (isDynamic) {
            if (normalizedName.includes(':')) {
              const _normalizedName = normalizedName.replace(/\:/g, '/:');
              route.path += route.path ? `/:${_normalizedName}` : `:${_normalizedName}`;
            } else {
              route.path += route.path ? `/:${normalizedName}` : `:${normalizedName}`;
            }

            if (isCatchAll) {
              if (i === 0)
                // root cache all route include children
                route.path += '(.*)*';
              // nested cache all route not include children
              else route.path += '(.*)';
            } else if (nuxtStyle && i === pathNodes.length - 1) {
              // we need to search if the folder provide `index.vue`
              const isIndexFound = pageRoutes.find(({ route }) => {
                return route === page.route.replace(pathNodes[i], 'index');
              });
              if (!isIndexFound) route.path += '?';
            }
          } else if (page.isMd) {
            let _path;
            if (normalizedPath.includes('.')) {
              _path = normalizedPath.split('.');
            }
            if (_path?.length) {
              route.path += route.path ? `${routeNameSeparator}${_path[1]}` : _path[1];
              route.customBlock = {
                ...route.customBlock,
                order: _path[0]
              };
            } else {
              route.path += route.path ? `${routeNameSeparator}${normalizedPath}` : normalizedPath;
            }
          } else {
            route.path += route.path ? `${routeNameSeparator}${normalizedPath}` : normalizedPath;
          }
        }
      }

      // put dynamic routes at the end
      if (dynamicRoute) parentRoutes.push(route);
      else parentRoutes.unshift(route);
    });

  let finalRoutes = prepareRoutes(ctx, routes);

  finalRoutes = (await ctx.options.onRoutesGenerated?.(finalRoutes)) || finalRoutes;

  return finalRoutes;
}

async function resolveVueRoutes(ctx: PageContext, customBlockMap: Map<string, CustomBlock>) {
  const finalRoutes = await computeVueRoutes(ctx, customBlockMap);

  let client = generateClientCode(finalRoutes, ctx.options);
  client = (await ctx.options.onClientGenerated?.(client)) || client;

  return client;
}

export function vueResolver(): PageResolver {
  const customBlockMap = new Map<string, CustomBlock>();

  async function checkCustomBlockChange(ctx: PageContext, path: string) {
    const exitsCustomBlock = customBlockMap.get(path);
    let customBlock: CustomBlock | undefined;
    try {
      customBlock = await getRouteBlock(path, ctx.options);
    } catch (error: any) {
      ctx.logger?.error(colors.red(`[vite-plugin-pages] ${error.message}`));
      return;
    }
    if (!exitsCustomBlock && !customBlock) return;

    if (!customBlock) {
      customBlockMap.delete(path);
      ctx.debug.routeBlock('%s deleted', path);
      return;
    }
    if (!exitsCustomBlock || !deepEqual(exitsCustomBlock, customBlock)) {
      ctx.debug.routeBlock('%s old: %O', path, exitsCustomBlock);
      ctx.debug.routeBlock('%s new: %O', path, customBlock);
      customBlockMap.set(path, customBlock);
      ctx.onUpdate();
    }
  }

  return {
    resolveExtensions() {
      return ['vue', 'ts', 'js'];
    },
    resolveModuleIds() {
      return ['~pages', 'pages-generated', 'virtual:generated-pages'];
    },
    async resolveRoutes(ctx) {
      return resolveVueRoutes(ctx, customBlockMap);
    },
    async getComputedRoutes(ctx) {
      return computeVueRoutes(ctx, customBlockMap);
    },
    hmr: {
      added: async (ctx, path) => checkCustomBlockChange(ctx, path),
      changed: async (ctx, path) => checkCustomBlockChange(ctx, path),
      removed: async (_ctx, path) => {
        customBlockMap.delete(path);
      }
    }
  };
}
