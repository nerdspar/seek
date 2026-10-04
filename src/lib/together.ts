import { notify } from '$lib/notices.svelte';

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
	if (addResponse.household !== 'pending') {
		void notify(message);
		return;
	}
	void notify(message, {
		label: 'Watching together',
		run: () =>
			answerTogether(show, 'together').then(
				() => notify(`Watching ${show.title} together`),
				(err) => notify(`Couldn't share ${show.title} — ${err instanceof Error ? err.message : err}`)
			)
	});
}
