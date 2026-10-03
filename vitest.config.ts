import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Unit tests run in plain Node — no SvelteKit runtime. `$env/dynamic/private` is
 * a virtual module Vite injects at build time, so it is aliased to a stub that
 * simply exposes `process.env`; a test that needs a value sets it there. `$lib`
 * mirrors SvelteKit's own alias so server modules import the same way they do in
 * app code. No real upstreams: tests stub `fetch`.
 */
export default defineConfig({
	test: {
		include: ['src/**/*.{test,spec}.ts'],
		environment: 'node',
		/* Never touch a real /data: each worker gets a private in-memory database
		   (opened lazily), and anything Seek writes to its data directory — the
		   generated secrets file — lands in a throwaway temp folder. */
		env: {
			SEEK_DB_PATH: ':memory:',
			// Fixed so tests don't generate (and write) their own.
			SEEK_SESSION_SECRET: 'test-session-secret',
			SEEK_TOKEN_KEY: 'test-token-key',
			SEEK_DATA_DIR: join(tmpdir(), 'seek-vitest')
		}
	},
	resolve: {
		alias: {
			'$env/dynamic/private': fileURLToPath(new URL('./src/test/env-stub.ts', import.meta.url)),
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url))
		}
	}
});
