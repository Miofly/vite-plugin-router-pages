import type { Plugin } from 'vite';
export function pagesPlugin(): Plugin {
  return {
    name: 'vite-plugin-pages',
    enforce: 'pre',
    async configResolved(config) {},
  };
}
