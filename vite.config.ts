import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

const path = require('path');

const resolvePath = (str: string) => path.resolve(__dirname, str);

export default defineConfig({
  plugins: [
    dts({
      entryRoot: './src',
      tsConfigFilePath: './tsconfig.json',
      include: ['src']
    })
  ],
  build: {
    target: 'modules',
    outDir: 'es',
    lib: {
      entry: resolvePath('./src/index.ts'),
      formats: ['es']
    },
    rollupOptions: {
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        dir: 'es',
        preserveModulesRoot: 'src',
        preserveModules: true
      }
    }
  }
});
