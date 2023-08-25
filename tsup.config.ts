import { resolve } from 'path';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: {
    resolve: true,
    compilerOptions: {
      skipLibCheck: true,
    },
  },
  tsconfig: resolve('./tsconfig.json'),
  clean: true,
  sourcemap: false,
});
