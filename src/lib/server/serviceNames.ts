/** Streaming-service names tidied into the watchlist's service chips. */

/**
 * TMDB lists the same service many times over: resale channels ("HBO Max Amazon
 * Channel"), ad tiers ("Netflix Standard with Ads") and plan tiers ("Paramount
 * Plus Premium", "Paramount Plus Essential"). Untouched that is 43 entries of
 * near-duplicates, which is unusable as a filter. Collapsing them to the service
 * you actually subscribe to gets it to roughly 20.
 */
const RESELLER = /\s+(?:Amazon Channel|Apple TV Channel|Roku Premium Channel|Channel)$/i;
const AD_TIER = /\s+(?:Standard |Basic )?with Ads$/i;
const PLAN_TIER = /\s+(?:Premium\+|Premium Plus|Premium|Essential|Standard|Basic|Plus)$/i;

export function normaliseService(name: string): string {
	let out = name.replace(RESELLER, '').replace(AD_TIER, '').trim();
	// "Paramount Plus" and "Paramount+" are the same thing; settle on the symbol
	// before stripping tiers, so "Paramount Plus Premium" does not become
	// "Paramount".
	out = out.replace(/\bPlus\b/g, '+').replace(/\s+\+/g, '+');
	out = out.replace(PLAN_TIER, '').trim();
	out = out.replace(/\+\s*\+/g, '+');
	return out;
}

/** Case-insensitive canonical form, so "BritBox" and "Britbox" are one entry. */
const canonical = new Map<string, string>();
export function dedupeKey(name: string): string {
	const key = name.toLowerCase().replace(/[^a-z0-9+]/g, '');
	const seen = canonical.get(key);
	if (seen) return seen;
	canonical.set(key, name);
	return name;
}

/** TMDB provider names tidied into the watchlist's service chips. */
export function serviceNames(raw: string[]): string[] {
	return [...new Set(raw.map((name) => dedupeKey(normaliseService(name))))];
}
