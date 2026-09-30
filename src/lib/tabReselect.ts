/**
 * Tapping the already-active bottom tab scrolls its page back to the start — the
 * top for most tabs, the Today anchor for Upcoming. The TabBar dispatches a
 * `tabreselect` window event carrying the tab id; a page's scroll container opts
 * in with this action, optionally pointing at an anchor element to stop at.
 */
type Opts = { tab: string; target?: () => HTMLElement | null | undefined };

/** The scrollTop that puts `targetTop` at the container's top edge, or 0 (the
 *  very top) when there is no anchor. Both tops are viewport coordinates. */
export function reselectTop(
	currentScrollTop: number,
	nodeTop: number,
	targetTop: number | null
): number {
	return targetTop === null ? 0 : currentScrollTop + (targetTop - nodeTop);
}

export function tabReselect(node: HTMLElement, opts: Opts) {
	let current = opts;

	function onReselect(event: Event) {
		if ((event as CustomEvent<string>).detail !== current.tab) return;
		const target = current.target?.();
		// Direct assignment, not scrollTo({behavior:'smooth'}): smooth scrolling is
		// unreliable on the scroll container here (and a backgrounded tab pauses the
		// animation), while getBoundingClientRect forces a final layout. Matches the
		// Upcoming anchor, which jumps for the same reasons.
		const targetTop = target ? target.getBoundingClientRect().top : null;
		node.scrollTop = reselectTop(node.scrollTop, node.getBoundingClientRect().top, targetTop);
	}

	window.addEventListener('tabreselect', onReselect);
	return {
		update(next: Opts) {
			current = next;
		},
		destroy() {
			window.removeEventListener('tabreselect', onReselect);
		}
	};
}
