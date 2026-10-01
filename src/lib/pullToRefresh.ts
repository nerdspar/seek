/**
 * Pull-to-refresh for a scroll container. Engages only at the very top, so it
 * never fights a normal scroll, and takes over the native rubber-band only once
 * the pull is clearly downward. The component owns the visuals (a spinner and the
 * offset); this action just measures the gesture and reports it.
 */
type Opts = {
	/** True when a downward pull should arm — i.e. scrolled to the top and idle. */
	armed: () => boolean;
	/** Current pull offset in px (already damped); `settling` is true for the
	 *  spring back / rest set on release, so the view can animate it. */
	onpull: (offset: number, settling: boolean) => void;
	/** Fired when released past the threshold. Awaited; the spinner shows until it
	 *  resolves, then the offset springs back to 0. */
	onrefresh: () => void | Promise<void>;
};

export const PULL_THRESHOLD = 64;
const MAX = 96;
const DAMP = 0.5;

/** Damped pull offset for a raw downward drag of `dy` px: zero (or up) gives 0,
 *  and the pull is halved and capped so it resists rather than tracking 1:1. */
export function pullOffset(dy: number): number {
	if (dy <= 0) return 0;
	return Math.min(MAX, dy * DAMP);
}

export function pullToRefresh(node: HTMLElement, opts: Opts) {
	let startY = 0;
	let offset = 0;
	let pulling = false;
	let busy = false;

	function start(e: TouchEvent) {
		if (busy || e.touches.length !== 1 || !opts.armed()) return;
		startY = e.touches[0].clientY;
		offset = 0;
		pulling = true;
	}

	function move(e: TouchEvent) {
		if (!pulling || busy) return;
		const dy = e.touches[0].clientY - startY;
		if (dy <= 0 || !opts.armed()) {
			pulling = false;
			offset = 0;
			opts.onpull(0, true);
			return;
		}
		offset = pullOffset(dy);
		opts.onpull(offset, false);
		// Past a few px this is a pull, not a scroll — stop the native overscroll.
		if (offset > 2) e.preventDefault();
	}

	async function end() {
		if (!pulling) return;
		pulling = false;
		if (offset >= PULL_THRESHOLD) {
			busy = true;
			opts.onpull(PULL_THRESHOLD, true); // hold at the spinner's resting height
			try {
				await opts.onrefresh();
			} finally {
				busy = false;
				opts.onpull(0, true);
			}
		} else {
			opts.onpull(0, true);
		}
		offset = 0;
	}

	node.addEventListener('touchstart', start, { passive: true });
	node.addEventListener('touchmove', move, { passive: false });
	node.addEventListener('touchend', end, { passive: true });
	node.addEventListener('touchcancel', end, { passive: true });

	return {
		destroy() {
			node.removeEventListener('touchstart', start);
			node.removeEventListener('touchmove', move);
			node.removeEventListener('touchend', end);
			node.removeEventListener('touchcancel', end);
		}
	};
}
