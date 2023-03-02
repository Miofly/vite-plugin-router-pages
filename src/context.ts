import { isEmptyObject, omit } from '@vft/utils';
import fg from 'fast-glob';
import { extname, join, resolve } from 'path';
import { slash, toArray } from '@antfu/utils';
import type { RouteLocationNormalized } from 'vue-router';
import { resolveOptions } from './options';
import { getPageDirs, getPageFiles } from './files';
import { debug, invalidatePagesModule, isTarget } from './utils';

import type { FSWatcher } from 'fs';
import type { Logger, ViteDevServer } from 'vite';
import type { PageOptions, ResolvedOptions, UserOptions } from './types';

export interface PageRoute {
  path: string;
  route: string;
}

type RouteType = Pick<RouteLocationNormalized, 'path' | 'name' | 'meta'> & { route?: string; component: string; hideComp?: boolean; children: Partial<RouteType>[] };

export class PageContext {
  private _server: ViteDevServer | undefined;
  private _pageRouteMap = new Map<string | string[], RouteType>();

  rawOptions: UserOptions;
  root: string;
  options: ResolvedOptions;
  logger?: Logger;

  constructor(userOptions: UserOptions, viteRoot: string = process.cwd()) {
    this.rawOptions = userOptions;
    this.root = slash(viteRoot);
    debug.env('root', this.root);
    this.options = resolveOptions(userOptions, this.root);
    debug.options(this.options);
  }

  setLogger(logger: Logger) {
    this.logger = logger;
  }

  setupViteServer(server: ViteDevServer) {
    if (this._server === server) return;

    this._server = server;
    this.setupWatcher(server.watcher);
  }

  setupWatcher(watcher: FSWatcher) {
    watcher.on('unlink', async (path) => {
      path = slash(path);
      if (!isTarget(path, this.options)) return;
      const page = this.options.dirs.find((i) => path.startsWith(slash(resolve(this.root, i.dir))))!;
      await this.removePage(path, page);
      this.onUpdate();
    });
    watcher.on('add', async (path) => {
      path = slash(path);

      if (!isTarget(path, this.options)) return;
      const page = this.options.dirs.find((i) => path.startsWith(slash(resolve(this.root, i.dir))))!;
      await this.addPage(path, page);
      this.onUpdate();
    });

    watcher.on('change', async (path) => {
      path = slash(path);
      if (!isTarget(path, this.options)) return;
      const page = this.options.dirs.find((i) => path.startsWith(slash(resolve(this.root, i.dir))))!;

      const pageList = this._pageRouteMap.get(page.dir) as RouteType;

      const _page = pageList.children.some((item) => {
        return item.path === path;
      });
      if (_page) await this.options.resolver.hmr?.changed?.(this, path);
    });
  }

  async addPage(path: string | string[], pageDir: PageOptions) {
    debug.pages('add', path);

    for (const p of toArray(path)) {
      const pageDirPath = slash(resolve(this.root, pageDir.dir));
      let route = slash(p.replace(`${pageDirPath}/`, ''));

      if (route.endsWith(extname(p))) {
        const _length = route.length - extname(p).length;
        route = route.slice(0, _length);
      }

      const _route = pageDir?.levelRouterDirList?.filter((item) => {
        return item.path === route;
      });
      
      const _pageDirInfos = omit(pageDir, ['files', 'dir', 'baseRoute', 'title', 'levelRouterDirList']);
      
      const routeInfo = _route?.length
        ? {
            ..._pageDirInfos,
            ..._route[0],
            path: p,
            route,
            hideComp: true
          }
        : { ..._pageDirInfos, path: p, route };

      // 如果之前已经存在直接塞到 children 中
      if (this._pageRouteMap.get(pageDir.dir) && !isEmptyObject(this._pageRouteMap.get(pageDir.dir))) {
        this._pageRouteMap.get(pageDir.dir)!.children.push(routeInfo);
      } else {
        this._pageRouteMap.set(pageDir.dir, {
          path: '/' + pageDir.baseRoute,
          name: pageDir.baseRoute,
          component: this.options.baseLayout,
          meta: {
            ..._pageDirInfos,
            title: pageDir.title,
            isBlog: pageDir.isBlog
          },
          children: [routeInfo]
        });
      }

      await this.options.resolver.hmr?.added?.(this, p);
    }
  }

  async removePage(path: string, pageDir: PageOptions) {
    const pageList = this._pageRouteMap.get(pageDir.dir) as RouteType;
    if (pageList.children?.length) {
      pageList.children.splice(
        pageList.children.findIndex((item) => item.path === path),
        1
      );
    }

    debug.pages('remove', path);

    await this.options.resolver.hmr?.removed?.(this, path);
  }

  onUpdate() {
    if (!this._server) return;

    invalidatePagesModule(this._server);
    debug.hmr('Reload generated pages.');
    this._server.ws.send({
      type: 'full-reload'
    });
  }

  async resolveRoutes() {
    return this.options.resolver.resolveRoutes(this);
  }

  async searchGlob() {
    const pageDirFiles = this.options.dirs.map((page) => {
      const pagesDirPath = slash(resolve(this.options.root, page.dir));

      const files = getPageFiles(pagesDirPath, this.options);

      debug.search(page.dir, files);

      if (page.isBlog) {
        page.levelRouterDirList = fg
          .sync(slash(pagesDirPath) + '/**', {
            onlyDirectories: true
          })
          .map((item) => {
            return {
              path: item.replace(new RegExp(pagesDirPath + '/'), '')
            };
          });
      }

      if (page.levelRouterDirList?.length) {
        for (const item of page.levelRouterDirList) {
          files.unshift(pagesDirPath + '/' + item.path + '.vue');
        }
      }

      return {
        ...page,
        files: files.map((file) => slash(file))
      };
    });

    // console.log(pageDirFiles);
    for (const page of pageDirFiles) await this.addPage(page.files, page);

    debug.cache(this.pageRouteMap);
  }

  get debug() {
    return debug;
  }

  get pageRouteMap() {
    return this._pageRouteMap;
  }
}
