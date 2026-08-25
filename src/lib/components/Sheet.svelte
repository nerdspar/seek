<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Bottom sheet with drag-to-dismiss.
	 *
	 * The grip used to be decorative, which is worse than having no grip at all —
	 * it advertises a gesture that does nothing. Dragging anywhere on the sheet
	 * now dismisses it.
	 *
	 * The one subtlety: a scrollable sheet (the episode sheet has a still, a
	 * synopsis and a button) must not steal downward drags that are meant to
	 * scroll its content back up. So a dismiss only begins when the content is
	 * already at the top, which is the same rule native sheets use.
	 */
	type Props = {
		label: string;
		onclose: () => void;
		/** Sheets with their own scroll area need the content pane measured. */
		scrollable?: boolean;
		children: Snippet;
	};
	let { label, onclose, scrollable = false, children }: Props = $props();

	let pane: HTMLElement | undefined = $state();
	let dy = $state(0);
	let dragging = $state(false);
	let closing = $state(false);

	let startY = 0;
	let startX = 0;
	let startedAtTop = true;
	let axis: 'undecided' | 'y' | 'x' | 'scroll' = 'undecided';
	let pointer: number | null = null;
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
		startedAtTop = !scrollable || (pane?.scrollTop ?? 0) <= 0;
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
	const scrimOpacity = $derived(
		closing ? 0 : Math.max(0, 1 - dy / ((pane?.offsetHeight ?? 400) * 0.9))
	);
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
	<div class="grip" aria-hidden="true"></div>
	{@render children()}
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 70;
		background: rgb(0 0 0 / 0.6);
		border: none;
		transition: opacity 180ms ease;
	}

	.sheet {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 71;
		max-height: 88dvh;
		padding-bottom: calc(var(--safe-b) + 16px);
		background: var(--surface);
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		/* Vertical drags are ours; the browser keeps horizontal. */
		touch-action: pan-x;
		will-change: transform;
		animation: rise 240ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.sheet.scrollable {
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.sheet.settling {
		transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	@keyframes rise {
		from {
			transform: translateY(100%);
		}
	}

	.grip {
		position: sticky;
		top: 0;
		width: 40px;
		height: 4px;
		margin: 9px auto;
		border-radius: 2px;
		background: var(--surface-raised);
		z-index: 2;
	}
</style>
