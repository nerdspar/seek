/**
 * Moving a deployment off compose-file config, automatically.
 *
 * Before Settings → Services and per-person accounts, everything lived in env:
 * service addresses and keys, plus one BookOrbit login that the whole app ran on. On boot (and again the moment the owner
 * account is created), each of those is copied to where it now belongs, once:
 *
 * - service settings → the settings store (services.ts);
 * - the BookOrbit login → the owner's own account,
 *   unless the owner has already linked their own.
 *
 * After that the env lines are dead weight and can be deleted. Nothing here
 * ever overwrites something already set in Seek.
 */
import { env } from '$env/dynamic/private';
import { importEnvSettings } from './services';
import { getCredentials, getOwner, setBookOrbit } from './users';

/** Copy the old single-user credentials onto the owner. Returns what it copied. */
export function importEnvCredentials(): string[] {
	const owner = getOwner();
	if (!owner) return [];
	const have = getCredentials(owner.id);
	const copied: string[] = [];
	if (!have.bookorbit && env.BOOKORBIT_USER && env.BOOKORBIT_PASSWORD) {
		setBookOrbit(owner.id, { username: env.BOOKORBIT_USER, password: env.BOOKORBIT_PASSWORD, libraryId: null });
		copied.push('BOOKORBIT_USER/PASSWORD');
	}
	return copied;
}

/** Everything above; safe to run on every boot. */
export function upgradeFromEnv(): void {
	try {
		const settings = importEnvSettings();
		const creds = importEnvCredentials();
		const all = [...settings, ...creds];
		if (all.length) {
			console.log(
				`[seek] Copied ${all.join(', ')} from env into Seek. ` +
					'These are now managed in Settings; the env lines can be removed.'
			);
		}
	} catch (err) {
		console.warn('[seek] importing env config failed:', err);
	}
}
