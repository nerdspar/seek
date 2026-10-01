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

/** Eased scroll position between `from` and `to` at progress `t` in [0,1]
 *  (easeOutCubic — quick to start, settling at the end). */
export function scrollAt(from: number, to: number, t: number): number {
	const p = t <= 0 ? 0 : t >= 1 ? 1 : t;
	const eased = 1 - Math.pow(1 - p, 3);
	return from + (to - from) * eased;
}

/** A quick tween — long enough to read as a scroll, short enough to feel snappy. */
const DURATION_MS = 340;

export function tabReselect(node: HTMLElement, opts: Opts) {
	let current = opts;
	let raf = 0;

	function animateTo(to: number) {
		cancelAnimationFrame(raf);
		const from = node.scrollTop;
		const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
		// Honour reduced-motion, and skip the tween when there is nowhere to go.
		if (reduce || from === to) {
			node.scrollTop = to;
			return;
		}
		const start = performance.now();
		const step = (now: number) => {
			const t = (now - start) / DURATION_MS;
			node.scrollTop = scrollAt(from, to, t);
			if (t < 1) raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
	}

	function onReselect(event: Event) {
		if ((event as CustomEvent<string>).detail !== current.tab) return;
		const target = current.target?.();
		// getBoundingClientRect forces a final layout so the offset is exact. The
		// tab is foregrounded during a tap, so rAF runs (the once-per-session auto
		// anchor jumps instead, since it can fire while backgrounded).
		const targetTop = target ? target.getBoundingClientRect().top : null;
		animateTo(reselectTop(node.scrollTop, node.getBoundingClientRect().top, targetTop));
	}

	window.addEventListener('tabreselect', onReselect);
	return {
		update(next: Opts) {
			current = next;
		},
		destroy() {
			cancelAnimationFrame(raf);
			window.removeEventListener('tabreselect', onReselect);
		}
	};
}
