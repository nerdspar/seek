<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Bottom sheet with a grab handle that both taps and drags to dismiss.
	 *
	 * The hard part is a *scrollable* sheet (the filter and episode sheets have
	 * their own scroll area). If the whole sheet is the scroll container, the
	 * browser claims every vertical touch for scrolling (`touch-action: pan-y`)
	 * and cancels the drag — so you get stuck inside with no way out. The fix is
	 * to split the two jobs: a fixed **handle** at the top owns the dismiss
	 * gesture (`touch-action: none`, so drags and taps on it always reach us),
	 * and an inner **body** owns scrolling. Content-drag-to-dismiss still works
	 * from the body when it is already scrolled to the top, the rule native
	 * sheets use, but the handle is the guaranteed way out either way.
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
	   frame. The height is stable during a dismiss, so read it once. */
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

	const DISMISS_PX = 110;
	const DISMISS_VELOCITY = 0.55; // px per ms
	const VELOCITY_WINDOW_MS = 90;
	/** Below this the sample span is too short to infer a flick from. */
	const MIN_VELOCITY_SPAN_MS = 25;

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

	function onpointerdown(e: PointerEvent) {
		if (closing || pointer !== null) return;
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		// Never start a drag from a control — buttons own their own taps.
		if ((e.target as HTMLElement | null)?.closest('button, a, input, select, textarea')) return;

		pointer = e.pointerId;
		startY = e.clientY;
		startX = e.clientX;
		samples = [{ y: e.clientY, t: performance.now() }];
		axis = 'undecided';
		moved = false;
		// A drag started on the handle is always a dismiss, never a scroll.
		const onHandle = !!(e.target as HTMLElement | null)?.closest('.grip');
		startedAtTop = onHandle || !scrollable || (body?.scrollTop ?? 0) <= 0;
		paneHeight = pane?.offsetHeight ?? 400;
		dragging = true;
	}

	function onpointermove(e: PointerEvent) {
		if (!dragging || e.pointerId !== pointer) return;

		const rawY = e.clientY - startY;
		const rawX = e.clientX - startX;

		if (axis === 'undecided') {
			if (Math.abs(rawX) > 12 && Math.abs(rawX) > Math.abs(rawY)) {
				axis = 'x';
				dragging = false;
				pointer = null;
				return;
			}
			if (Math.abs(rawY) > 8) {
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
					/* capture is an optimisation */
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
		const shouldClose = axis === 'y' && (dy > DISMISS_PX || flickVelocity() > DISMISS_VELOCITY);
		dragging = false;
		pointer = null;
		axis = 'undecided';
		samples = [];

		if (shouldClose) close();
		else dy = 0;
	}

	function oncancel(e: PointerEvent) {
		if (e.pointerId !== pointer) return;
		dragging = false;
		pointer = null;
		axis = 'undecided';
		samples = [];
		dy = 0;
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
	{onpointerdown}
	{onpointermove}
	{onpointerup}
	onpointercancel={oncancel}
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
		/* Non-scrolling sheets hand every vertical drag to the dismiss gesture. */
		touch-action: pan-x;
		will-change: transform;
		animation: rise 240ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	/* Non-scrolling sheets grow to their content and carry the bottom safe area. */
	.sheet:not(.scrollable) {
		padding-bottom: calc(var(--safe-b) + 16px);
	}
	.sheet.scrollable {
		/* The frame owns the dismiss gesture; the body inside owns scrolling. With
		   the two split, a drag that starts anywhere but the scrolling body — the
		   handle, the padding — reliably dismisses instead of being swallowed. */
		touch-action: none;
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
	   dismissal from here still works because the drag handler only claims the
	   gesture when the body is already at the top. */
	.body {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		touch-action: pan-y;
		padding-bottom: calc(var(--safe-b) + 16px);
	}

	/* A generous, always-hittable grab handle: full width so a tap or drag lands,
	   touch-action:none so the browser never steals the gesture for scrolling. */
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
