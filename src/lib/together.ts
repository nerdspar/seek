import { notify } from '$lib/notices.svelte';
import { openTogetherPicker } from '$lib/togetherPick.svelte';

/**
 * After a show is added: if the household asks "together or solo?" for new
 * shows (the add's response says `household: 'pending'`), offer the answer in
 * the confirmation. Ignored, the show waits on the Watchlist for an answer.
 */
type Show = { source: string; mediaId: string; title: string };

export async function answerTogether(show: Show, choice: 'together' | 'solo'): Promise<void> {
	const res = await fetch('/api/household/new-shows', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ...show, choice })
	});
	if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
}

export function confirmShowAdded(show: Show, addResponse: { household?: unknown }, message = `Added ${show.title}`): void {
	const h = addResponse.household;
	// Only when the household shares shows and this one can still be decided.
	if (h !== 'together' && h !== 'solo' && h !== 'pending') {
		void notify(message);
		return;
	}
	const shared = h === 'together';
	const label = h === 'pending' ? 'Together or alone?' : shared ? 'Watching together' : 'Watching alone';
	// Tapping opens the picker so it can be changed either way.
	void notify(message, { label, run: () => openTogetherPicker({ ...show, shared }) });
}
