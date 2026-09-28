import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify(version),
  },
  test: {
    environment: 'jsdom',
    // A portal-page URL, so init() resolves an app instead of staying silent.
    environmentOptions: { jsdom: { url: 'http://localhost/p/test-app/' } },
    include: ['test/**/*.test.ts'],
    // Public-signature tests: *.test-d.ts files are type-checked by tsc, not run.
    typecheck: { enabled: true, include: ['test/**/*.test-d.ts'], tsconfig: './test/tsconfig.json' },
    restoreMocks: true,
    unstubGlobals: true,
  },
});
