// @vitest-environment-options { "url": "http://localhost:3000/p/test-app/" }
import { afterEach, describe, expect, it } from 'vitest';
import { init, isActive, shutdown } from '../src/core/analytics';
import { isLocalHost } from '../src/core/config';

afterEach(() => {
  shutdown();
});

describe('isLocalHost', () => {
  it.each(['localhost', 'LOCALHOST', 'localhost.', '127.0.0.1', '127.0.0.2', '0.0.0.0', '[::1]', 'app.localhost'])('%s is a local host', (hostname) => {
    expect(isLocalHost(hostname)).toBe(true);
  });

  it.each(['mi.example.com', 'localhost.example.com', 'notlocalhost', '192.168.1.20', '127.example.com', ''])(
    '%s is not a local host',
    (hostname) => {
      expect(isLocalHost(hostname)).toBe(false);
    },
  );
});

describe('init() on a local dev server', () => {
  it('runs on the local host this file asks for', () => {
    expect(window.location.hostname).toBe('localhost');
  });

  it('stays silent by default', () => {
    init();

    expect(isActive()).toBe(false);
  });

  it('tracks when trackLocalhost is true', () => {
    init({ trackLocalhost: true });

    expect(isActive()).toBe(true);
  });
});
