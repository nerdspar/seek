/**
 * Tapping the already-active bottom tab scrolls its page back to the start — the
 * top for most tabs, the Today anchor for Upcoming. The TabBar dispatches a
 * `tabreselect` window event carrying the tab id; a page's content opts in with
 * this action on its `<main>`, optionally pointing at an anchor element to stop
 * at.
 *
 * Model B (window-scroll): the page scrolls the *window*, not the node the action
 * is attached to, so this tweens `document.scrollingElement`. This is the same
 * surface iOS's tap-the-status-bar gesture drives, so the re-tap and the status-
 * bar tap agree.
 */
type Opts = { tab: string; target?: () => HTMLElement | null | undefined };

/** The window scroller — `<html>` under the standard box model. */
function scroller(): HTMLElement {
	return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

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
		const se = scroller();

		/* A tap can land while a flick is still momentum-scrolling. Left alone the
		   native fling keeps writing scrollTop and fights the tween — it flashes and
		   never settles (the reported bug). Toggling overflow cancels the in-flight
		   momentum; done in one synchronous reflow so nothing paints in between. */
		const prevOverflow = se.style.overflowY;
		se.style.overflowY = 'hidden';
		void se.offsetHeight;
		se.style.overflowY = prevOverflow;

		const from = se.scrollTop;
		const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
		// Honour reduced-motion, and skip the tween when there is nowhere to go.
		if (reduce || from === to) {
			se.scrollTop = to;
			return;
		}
		const start = performance.now();
		const step = (now: number) => {
			const t = (now - start) / DURATION_MS;
			se.scrollTop = scrollAt(from, to, t);
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
		/* Land the anchor just below the sticky header rather than under it, by
		   treating the header's height as the container top. With no anchor,
		   reselectTop returns 0 — the very top, matching the status-bar tap. */
		const header = node.closest('.app')?.querySelector(':scope > header') as HTMLElement | null;
		const headerBottom = header?.getBoundingClientRect().height ?? 0;
		animateTo(reselectTop(scroller().scrollTop, headerBottom, targetTop));
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
