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
    restoreMocks: true,
    unstubGlobals: true,
  },
});
