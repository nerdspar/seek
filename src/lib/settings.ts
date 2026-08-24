/** Client-visible preferences (§8). Persisted server-side later; localStorage
 *  is sufficient while only the swipe direction is in play. */
export type MarkDirection = 'rtl' | 'ltr';

const KEY = 'seek.settings.v1';

export type Settings = {
	/** §4.2 default is right-to-left — the opposite of Hobi, deliberately. */
	markDirection: MarkDirection;
};

export const defaults: Settings = { markDirection: 'rtl' };

export function load(): Settings {
	if (typeof localStorage === 'undefined') return defaults;
	try {
		return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
	} catch {
		return defaults;
	}
}

export function save(s: Settings): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(KEY, JSON.stringify(s));
}
