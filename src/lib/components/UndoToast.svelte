<script lang="ts">
	/** §4.3 — ~6s to undo a mis-swipe. Sits above the tab bar so it never covers
	 *  the row it refers to. */
	type Props = {
		message: string;
		detail?: string | null;
		busy?: boolean;
		onundo: () => void;
		ondismiss: () => void;
	};

	let { message, detail = null, busy = false, onundo, ondismiss }: Props = $props();

	const DURATION = 6000;
	let remaining = $state(1);

	$effect(() => {
		const start = performance.now();
		let raf = 0;
		const tick = () => {
			const elapsed = performance.now() - start;
			remaining = Math.max(0, 1 - elapsed / DURATION);
			if (remaining <= 0) ondismiss();
			else raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});
</script>

<div class="toast" role="status" aria-live="polite">
	<div class="text">
		<span class="msg">{message}</span>
		{#if detail}<span class="detail">{detail}</span>{/if}
	</div>
	<button class="undo" onclick={onundo} disabled={busy}>
		{busy ? 'Undoing…' : 'Undo'}
	</button>
	<div class="timer" style:transform={`scaleX(${remaining})`}></div>
</div>

<style>
	.toast {
		position: fixed;
		left: var(--gutter);
		right: var(--gutter);
		bottom: calc(var(--tabbar-h) + var(--safe-b) + 12px);
		z-index: 60;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 8px 12px 16px;
		border-radius: var(--radius);
		background: var(--surface-raised);
		box-shadow: var(--shadow-lg);
		overflow: hidden;
		animation: rise 180ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
	}

	.text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}
	.msg {
		font-size: 14px;
		font-weight: 600;
	}
	.detail {
		font-size: 12px;
		color: var(--text-dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.undo {
		flex: none;
		min-height: var(--tap);
		padding: 0 16px;
		border-radius: 10px;
		font-size: 15px;
		font-weight: 600;
		color: var(--signal-solid);
	}
	.undo:disabled {
		opacity: 0.5;
	}

	.timer {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 2px;
		width: 100%;
		background: var(--signal);
		transform-origin: left;
	}
</style>
