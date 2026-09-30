/**
 * Test stand-in for SvelteKit's `$env/dynamic/private` virtual module. Server
 * code reads `env.SOMETHING`; in tests that resolves to `process.env`, so a test
 * sets what it needs (e.g. `process.env.JELLYFIN_URL = '…'`) and clears it after.
 */
export const env: Record<string, string | undefined> = process.env;
