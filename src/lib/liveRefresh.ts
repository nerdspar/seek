/**
 * Keeps a screen current with changes made elsewhere — a Jellyfin mark, your
 * partner's mark on a shared show, another device — without a pull-to-refresh:
 * re-reads when the app comes back to the foreground, and every so often while
 * it's on screen. Never mid-action (`busy`), so a re-read can't yank a row out
 * from under a swipe or an undo.
 */
type Doc = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

export function startLiveRefresh(opts: { refresh: () => unknown; busy: () => boolean; everyMs?: number; doc?: Doc }): () => void {
	const doc = opts.doc ?? document;
	const every = opts.everyMs ?? 30_000;
	const tick = () => {
		if (doc.visibilityState === 'visible' && !opts.busy()) void opts.refresh();
	};
	const onVisible = () => tick();
	doc.addEventListener('visibilitychange', onVisible);
	const timer = setInterval(tick, every);
	return () => {
		doc.removeEventListener('visibilitychange', onVisible);
		clearInterval(timer);
	};
}
