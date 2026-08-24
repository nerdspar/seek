<script lang="ts">
	import type { WatchlistRow } from '$lib/types';
	import Poster from './Poster.svelte';
	import type { MarkDirection } from '$lib/settings';

	type Props = {
		row: WatchlistRow;
		markDirection?: MarkDirection;
		pending?: boolean;
		onmark: (row: WatchlistRow) => void;
		onepisode: (row: WatchlistRow) => void;
		onshow: (row: WatchlistRow) => void;
	};

	let {
		row,
		markDirection = 'rtl',
		pending = false,
		onmark,
		onepisode,
		onshow
	}: Props = $props();

	/* ── Gesture state ─────────────────────────────────────────────────────
	   §4.2. The handler is written around a signed `markSign` rather than
	   hardcoding a direction, so binding a second action to the opposite swipe
	   later is a matter of filling in `oppositeAction` — the axis maths, the
	   threshold and the spring-back all already work both ways. The opposite
	   direction is deliberately left unbound for now: it clamps to zero, so a
	   wrong-way swipe does nothing rather than half-revealing a dead panel. */

	let el: HTMLElement | undefined = $state();
	let dx = $state(0);
	let dragging = $state(false);

	/* Commit is a two-beat animation, not a snap-back. The row finishes the
	   direction the thumb was already going and leaves the screen, which is what
	   makes the gesture read as "consumed" rather than "did that register?".
	   Then it returns from the same edge carrying the next episode.

	   'exiting'   — sliding off under its own power
	   'returning' — sliding back in with the row's new contents
	   Re-sorting to a new list position is still to come (see BACKLOG.md). */
	let phase = $state<'idle' | 'exiting' | 'returning'>('idle');
	const committing = $derived(phase !== 'idle');
	let timers: ReturnType<typeof setTimeout>[] = [];

	$effect(() => () => timers.forEach(clearTimeout));

	let startX = 0;
	let startY = 0;
	let startT = 0;
	let axis: 'undecided' | 'x' | 'y' = 'undecided';
	let activePointer: number | null = null;

	const markSign = $derived(markDirection === 'rtl' ? -1 : 1);

	/** Leaving is quicker than arriving — the exit should feel like follow-through
	 *  on the thumb, the return like the next episode settling into place. */
	const EXIT_MS = 190;
	const RETURN_MS = 300;

	/** Distance that commits the mark. Proportional, but bounded so it stays
	 *  reachable with one thumb on a large phone. */
	function threshold(): number {
		const w = el?.offsetWidth ?? 360;
		return Math.max(72, Math.min(w * 0.32, 104));
	}

	/** 0 → 1 as the swipe approaches commit. Drives the reveal's intensity. */
	const armed = $derived(Math.min(1, Math.abs(dx) / threshold()));
	const willCommit = $derived(armed >= 1);

	function reset() {
		dx = 0;
		dragging = false;
		axis = 'undecided';
		activePointer = null;
	}

	function onpointerdown(e: PointerEvent) {
		if (phase !== 'idle' || activePointer !== null) return;
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		activePointer = e.pointerId;
		startX = e.clientX;
		startY = e.clientY;
		startT = performance.now();
		axis = 'undecided';
		dragging = true;
	}

	function onpointermove(e: PointerEvent) {
		if (!dragging || e.pointerId !== activePointer) return;

		const rawX = e.clientX - startX;
		const rawY = e.clientY - startY;

		if (axis === 'undecided') {
			// Wait for a clear intent before claiming the gesture. Requiring the
			// horizontal component to dominate keeps a diagonal flick during a
			// fast scroll from arming the mark.
			if (Math.abs(rawY) > 10 && Math.abs(rawY) >= Math.abs(rawX)) {
				// Vertical: hand the gesture back to the scroll container untouched.
				dragging = false;
				activePointer = null;
				return;
			}
			if (Math.abs(rawX) > 10) {
				axis = 'x';
				// Capture keeps the gesture alive if the finger leaves the row, but a
				// stale pointer id throws — never let that abort the swipe.
				try {
					el?.setPointerCapture(e.pointerId);
				} catch {
					/* capture is an optimisation, not a requirement */
				}
			} else {
				return;
			}
		}

		// Only the mark direction moves. The opposite direction is unbound (§4.2).
		const signed = rawX * markSign;
		if (signed <= 0) {
			dx = 0;
			return;
		}

		const t = threshold();
		// Past the threshold the row keeps responding, but heavily damped — the
		// resistance is what tells your thumb the gesture is already armed.
		const travel = signed <= t ? signed : t + (signed - t) * 0.3;
		dx = travel * markSign;
	}

	function onpointerup(e: PointerEvent) {
		if (e.pointerId !== activePointer) return;
		const wasDragging = dragging && axis === 'x';
		const movement = Math.hypot(e.clientX - startX, e.clientY - startY);
		const elapsed = performance.now() - startT;

		if (wasDragging && Math.abs(dx) >= threshold()) {
			commit();
			return;
		}

		// A short, still press is a tap. Routed by what was under the finger, so
		// the pill and the rest of the row keep their separate destinations.
		if (!wasDragging && movement < 8 && elapsed < 600) {
			const target = e.target as HTMLElement | null;
			if (target?.closest('[data-episode-pill]')) onepisode(row);
			else onshow(row);
		}

		reset();
	}

	function oncancel(e: PointerEvent) {
		if (e.pointerId !== activePointer) return;
		reset();
	}

	function commit() {
		dragging = false;
		axis = 'undecided';
		activePointer = null;

		const width = el?.offsetWidth ?? 360;
		const reduced =
			typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

		// Fire the write immediately — the animation is feedback, never a gate.
		onmark(row);

		if (reduced) {
			dx = 0;
			phase = 'idle';
			return;
		}

		phase = 'exiting';
		dx = width * markSign;

		timers.forEach(clearTimeout);
		timers = [
			// Off screen: hand the row back to its resting position, which the
			// 'returning' transition animates. By now the optimistic counts have
			// already moved, and the real next episode lands when the write returns.
			setTimeout(() => {
				phase = 'returning';
				dx = 0;
			}, EXIT_MS),
			setTimeout(() => (phase = 'idle'), EXIT_MS + RETURN_MS)
		];
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onshow(row);
		}
	}

	const epLabel = $derived(
		row.next
			? `S${String(row.next.season).padStart(2, '0')}E${String(row.next.episode).padStart(2, '0')}`
			: null
	);
	const pct = $derived(
		row.maxProgress && row.maxProgress > 0
			? Math.min(100, (row.progress / row.maxProgress) * 100)
			: 0
	);
</script>

<li class="row" class:pending>
	<!-- Reveal sits behind the content and is only visible through the gap the
	     content leaves as it slides. While dragging it holds a floor so the
	     intent is legible early; on commit it simply tracks the row, so it is
	     full-strength as the row clears the screen and fades as it returns. -->
	<div
		class="reveal"
		class:rtl={markDirection === 'rtl'}
		style:opacity={dragging ? Math.max(0.35, armed) : committing ? armed : 0}
		aria-hidden="true"
	>
		<div class="reveal-inner" style:transform={`scale(${0.9 + armed * 0.1})`}>
			<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8">
				<path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z" />
				<circle cx="12" cy="12" r="3.2" />
			</svg>
			<span class:strong={willCommit}>Mark as Watched</span>
		</div>
	</div>

	<div
		class="content"
		class:sliding={!dragging && phase === 'idle'}
		class:exiting={phase === 'exiting'}
		class:returning={phase === 'returning'}
		bind:this={el}
		style:transform={`translate3d(${dx}px,0,0)`}
		role="button"
		tabindex="0"
		aria-label={`${row.title}${epLabel ? `, next ${epLabel}` : ''}`}
		{onpointerdown}
		{onpointermove}
		{onpointerup}
		onpointercancel={oncancel}
		{onkeydown}
	>
		<Poster src={row.poster} width={68} height={102} />

		<div class="meta">
			<h3 class="title">{row.title}</h3>

			{#if row.next}
				<!-- §4.1: the episode line IS the episode affordance. Raised surface
				     and the info glyph are what keep the two destinations from
				     reading as a coin flip — do not flatten this. -->
				<div class="pill" data-episode-pill>
					<span class="ep tnum">{epLabel}</span>
					{#if row.next.title}<span class="sep">·</span><span class="ep-title">{row.next.title}</span>{/if}
					<svg class="info" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
						<circle cx="12" cy="12" r="9" />
						<path d="M12 11v5" />
						<circle cx="12" cy="7.75" r="0.9" fill="currentColor" stroke="none" />
					</svg>
				</div>
			{:else}
				<div class="pill caught-up" data-episode-pill><span class="ep">Caught up</span></div>
			{/if}

			<div class="progress-line">
				<div class="track" role="progressbar" aria-valuenow={row.progress} aria-valuemax={row.maxProgress ?? undefined}>
					<div class="fill" style:width={`${pct}%`}></div>
				</div>
				<span class="count tnum">{row.progress}{#if row.maxProgress}/{row.maxProgress}{/if}</span>
				{#if row.left !== null}
					<span class="left tnum">{row.left} left</span>
				{/if}
			</div>
		</div>
	</div>
</li>

<style>
	.row {
		position: relative;
		list-style: none;
		border-radius: var(--radius-lg);
		overflow: hidden;
		background: var(--bg);
	}

	.reveal {
		position: absolute;
		inset: 0;
		background: var(--signal);
		display: flex;
		align-items: center;
		justify-content: flex-start;
		padding: 0 12px;
		transition: opacity 140ms ease;
	}
	/* Right-to-left swipe uncovers the right edge, so the label belongs there. */
	.reveal.rtl {
		justify-content: flex-end;
	}

	.reveal-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		color: #fff;
		font-size: 12px;
		font-weight: 600;
		text-align: center;
		/* Must fit inside the committed travel distance (the 104px threshold) or
		   the label stays clipped at the moment it most needs to be readable. */
		width: 80px;
		line-height: 1.2;
		transition: transform 120ms ease;
	}
	.reveal-inner span {
		opacity: 0.82;
		transition: opacity 120ms ease;
	}
	.reveal-inner span.strong {
		opacity: 1;
	}

	.content {
		position: relative;
		display: grid;
		grid-template-columns: 68px 1fr;
		gap: 12px;
		padding: 10px 12px;
		background: var(--surface);
		border-radius: var(--radius-lg);
		/* Vertical scrolling stays with the browser; horizontal is ours. */
		touch-action: pan-y;
		will-change: transform;
	}
	.content.sliding {
		transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	/* Accelerating out — it is leaving, not settling. */
	.content.exiting {
		transition: transform 190ms cubic-bezier(0.4, 0, 1, 1);
	}
	/* Decelerating in, slower, so the new episode reads as arriving. */
	.content.returning {
		transition: transform 300ms cubic-bezier(0.16, 1, 0.3, 1);
	}


	.meta {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 7px;
		min-width: 0;
	}

	.title {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
		letter-spacing: -0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.pill {
		display: flex;
		align-items: center;
		gap: 6px;
		/* §4.1: a full 44px target. The height is the affordance, not decoration. */
		min-height: var(--tap);
		padding: 0 10px;
		border-radius: 10px;
		background: var(--surface-raised);
		font-size: 14px;
		color: var(--text);
		min-width: 0;
		align-self: flex-start;
		max-width: 100%;
	}
	.pill.caught-up {
		color: var(--text-dim);
	}
	.ep {
		font-weight: 600;
		flex: none;
	}
	.sep {
		color: var(--text-dim);
		flex: none;
	}
	.ep-title {
		color: var(--text-dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.info {
		flex: none;
		margin-left: auto;
		padding-left: 4px;
		color: var(--text-dim);
	}

	.progress-line {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 12px;
		color: var(--text-dim);
	}
	.track {
		flex: 1;
		height: 5px;
		border-radius: 3px;
		background: var(--surface-raised);
		overflow: hidden;
		min-width: 40px;
	}
	.fill {
		height: 100%;
		border-radius: 3px;
		background: var(--signal);
		transition: width 260ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.count {
		flex: none;
	}
	.left {
		flex: none;
	}

	.row.pending .content {
		opacity: 0.6;
	}
</style>
