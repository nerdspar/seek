<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Bottom sheet you can drag down from anywhere to dismiss.
	 *
	 * Two ways out: a flick down closes it at any distance, and a slow drag closes
	 * it once it has passed half the sheet's height (otherwise it springs back).
	 * The grab handle also closes on a plain tap.
	 *
	 * The drag works anywhere on the sheet, including over its buttons and its
	 * scrolling content. The subtlety is a *scrollable* sheet: dragging up, or
	 * down from a scrolled position, must scroll the content, while dragging down
	 * from the top must dismiss. We decide which on the first move, and when it is
	 * a dismiss we `preventDefault` the touch so the browser doesn't also scroll —
	 * the piece a plain `touch-action` can't express, and the reason the sheet
	 * used to feel stuck.
	 */
	type Props = {
		label: string;
		onclose: () => void;
		/** Sheets with their own scroll area put content in a scrolling body. */
		scrollable?: boolean;
		children: Snippet;
	};
	let { label, onclose, scrollable = false, children }: Props = $props();

	let pane: HTMLElement | undefined = $state();
	let body: HTMLElement | undefined = $state();
	let dy = $state(0);
	let dragging = $state(false);
	let closing = $state(false);
	/* Sheet height, captured when a drag starts. scrimOpacity is recomputed on
	   every drag frame; reading `pane.offsetHeight` there forced a layout each
	   frame. The height is stable during a dismiss, so read it once — and it also
	   sets the slow-drag threshold (half the sheet). */
	let paneHeight = 400;

	let startY = 0;
	let startX = 0;
	let startedAtTop = true;
	let axis: 'undecided' | 'y' | 'x' | 'scroll' = 'undecided';
	let pointer: number | null = null;
	/* A drag that moved suppresses the handle's click, so a snap-back drag on the
	   grip doesn't also fire tap-to-close. */
	let moved = false;
	/* Velocity is measured over a short trailing window rather than between
	   consecutive events. Consecutive-sample velocity divides by a dt that can be
	   a fraction of a millisecond, which produces a huge number from a tiny
	   movement and dismisses the sheet on a nudge. */
	type Sample = { y: number; t: number };
	let samples: Sample[] = [];

	const DISMISS_VELOCITY = 0.55; // px per ms — a flick, at any distance
	const VELOCITY_WINDOW_MS = 90;
	/** Below this the sample span is too short to infer a flick from. */
	const MIN_VELOCITY_SPAN_MS = 25;
	/** Movement before we commit to an axis. */
	const AXIS_THRESHOLD = 8;

	function flickVelocity(): number {
		if (samples.length < 2) return 0;
		const newest = samples[samples.length - 1];
		const oldest = samples.find((s) => newest.t - s.t <= VELOCITY_WINDOW_MS) ?? samples[0];
		const span = newest.t - oldest.t;
		if (span < MIN_VELOCITY_SPAN_MS) return 0;
		return (newest.y - oldest.y) / span;
	}

	function close() {
		if (closing) return;
		closing = true;
		// Let it finish leaving before the parent unmounts it.
		dy = (pane?.offsetHeight ?? 400) + 40;
		setTimeout(onclose, 190);
	}

	/** Tap on the grab handle — close, unless the tap was really a drag. */
	function gripTap() {
		if (!moved) close();
	}

	/** Would a downward drag from here dismiss (vs. scroll the content)? */
	function canDismissFrom(target: EventTarget | null): boolean {
		if (!scrollable) return true;
		if ((target as HTMLElement | null)?.closest('.grip')) return true;
		return (body?.scrollTop ?? 0) <= 0;
	}

	function begin(target: EventTarget | null, x: number, y: number) {
		startY = y;
		startX = x;
		samples = [{ y, t: performance.now() }];
		axis = 'undecided';
		moved = false;
		startedAtTop = canDismissFrom(target);
		paneHeight = pane?.offsetHeight ?? 400;
		dragging = true;
	}

	function onpointerdown(e: PointerEvent) {
		if (closing || pointer !== null) return;
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		// Native form controls need their own gestures; everything else on the
		// sheet — buttons, links, plain content — can start a dismiss drag, and a
		// tap still reaches the control because we only take over once it moves.
		if ((e.target as HTMLElement | null)?.closest('input, select, textarea')) return;

		pointer = e.pointerId;
		begin(e.target, e.clientX, e.clientY);
	}

	function onpointermove(e: PointerEvent) {
		if (!dragging || e.pointerId !== pointer) return;

		const rawY = e.clientY - startY;
		const rawX = e.clientX - startX;

		if (axis === 'undecided') {
			if (Math.abs(rawX) > 12 && Math.abs(rawX) > Math.abs(rawY)) {
				// Horizontal — hand it back (e.g. a scrolling chip row).
				axis = 'x';
				dragging = false;
				pointer = null;
				return;
			}
			if (Math.abs(rawY) > AXIS_THRESHOLD) {
				// Dragging up, or down from a scrolled position, belongs to the
				// content rather than the sheet.
				if (rawY < 0 || !startedAtTop) {
					axis = 'scroll';
					dragging = false;
					pointer = null;
					return;
				}
				axis = 'y';
				moved = true;
				try {
					pane?.setPointerCapture(e.pointerId);
				} catch {
					/* capture is an optimisation, and also cancels a button's tap */
				}
			} else {
				return;
			}
		}

		const now = performance.now();
		samples.push({ y: e.clientY, t: now });
		// Keep only what the velocity window needs.
		samples = samples.filter((sample) => now - sample.t <= VELOCITY_WINDOW_MS * 2);

		// Downward only.
		dy = rawY <= 0 ? 0 : rawY;
	}

	function onpointerup(e: PointerEvent) {
		if (e.pointerId !== pointer) return;
		// A flick closes at any distance; a slow drag must clear half the sheet.
		const shouldClose =
			axis === 'y' && (dy > paneHeight / 2 || flickVelocity() > DISMISS_VELOCITY);
		dragging = false;
		pointer = null;
		axis = 'undecided';
		samples = [];

		if (shouldClose) close();
		else dy = 0;
	}

	function reset(e: PointerEvent) {
		if (e.pointerId !== pointer) return;
		dragging = false;
		pointer = null;
		axis = 'undecided';
		samples = [];
		dy = 0;
	}

	/* While a dismiss drag is live, stop the browser from also scrolling the body.
	   Must be a non-passive listener, so it's attached by hand. Deciding here too
	   (not only in pointermove) matters on iOS, which commits to a scroll on the
	   first unprevented move. */
	function suppressScroll(node: HTMLElement) {
		const handler = (e: TouchEvent) => {
			if (!dragging) return;
			if (axis === 'y') {
				e.preventDefault();
				return;
			}
			if (axis === 'undecided') {
				const t = e.touches[0];
				if (!t) return;
				const rawY = t.clientY - startY;
				const rawX = t.clientX - startX;
				if (rawY > 0 && startedAtTop && Math.abs(rawY) > Math.abs(rawX)) e.preventDefault();
			}
		};
		node.addEventListener('touchmove', handler, { passive: false });
		return { destroy: () => node.removeEventListener('touchmove', handler) };
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}

	// The scrim fades in step with the drag, so the gesture feels connected to it.
	const scrimOpacity = $derived(closing ? 0 : Math.max(0, 1 - dy / (paneHeight * 0.9)));
</script>

<svelte:window {onkeydown} />

<div
	class="scrim"
	style:opacity={scrimOpacity}
	role="button"
	tabindex="-1"
	aria-label="Close"
	onclick={close}
	onkeydown={(e) => e.key === 'Enter' && close()}
></div>

<div
	class="sheet"
	class:settling={!dragging}
	bind:this={pane}
	class:scrollable
	style:transform={`translate3d(0, ${dy}px, 0)`}
	role="dialog"
	aria-modal="true"
	aria-label={label}
	tabindex="-1"
	use:suppressScroll
	{onpointerdown}
	{onpointermove}
	{onpointerup}
	onpointercancel={reset}
>
	<div
		class="grip"
		role="button"
		aria-label="Close"
		tabindex="0"
		onclick={gripTap}
		onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), close())}
	>
		<span class="bar"></span>
	</div>
	{#if scrollable}
		<div class="body" bind:this={body}>{@render children()}</div>
	{:else}
		{@render children()}
	{/if}
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 70;
		background: var(--scrim);
		border: none;
		transition: opacity 180ms ease;
	}

	.sheet {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 71;
		display: flex;
		flex-direction: column;
		max-height: 88dvh;
		background: var(--surface);
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		/* JS owns the vertical gesture (dismiss vs. scroll); the browser may still
		   pan horizontally for a scrolling chip row inside. */
		touch-action: pan-x;
		will-change: transform;
		animation: rise 240ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	/* Non-scrolling sheets grow to their content and carry the bottom safe area. */
	.sheet:not(.scrollable) {
		padding-bottom: calc(var(--safe-b) + 16px);
	}
	.sheet.scrollable {
		overflow: hidden;
	}
	.sheet.settling {
		transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	@keyframes rise {
		from {
			transform: translateY(100%);
		}
	}

	/* The scrolling area of a scrollable sheet. pan-y lets the browser scroll it;
	   a dismiss drag from the top is caught in JS, which preventDefaults the touch
	   so the browser doesn't scroll at the same time. */
	.body {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		touch-action: pan-y;
		padding-bottom: calc(var(--safe-b) + 16px);
	}

	/* A generous, always-hittable grab handle; JS owns its gesture entirely. */
	.grip {
		flex: none;
		display: grid;
		place-items: center;
		width: 100%;
		height: 28px;
		cursor: grab;
		touch-action: none;
	}
	.grip:active {
		cursor: grabbing;
	}
	.grip .bar {
		width: 40px;
		height: 4px;
		border-radius: 2px;
		background: var(--surface-raised);
	}
</style>
