<script lang="ts">
	import Sheet from './Sheet.svelte';

	/**
	 * Season-level download management, opened from the season header — the home
	 * for the monitored toggle + season search that used to sit in an inline bar.
	 * Presentational: the page owns the actions (monitor PUT, season search) and
	 * passes them in, so this stays a thin, testable surface.
	 */
	type Props = {
		title: string;
		seasonLabel: string;
		haveCount: number;
		total: number;
		monitored: boolean;
		busy?: boolean;
		onmonitor: () => void;
		onsearch: () => void;
		oninteractive: () => void;
		onclose: () => void;
	};
	let { title, seasonLabel, haveCount, total, monitored, busy = false, onmonitor, onsearch, oninteractive, onclose }: Props = $props();
</script>

<Sheet label={`Manage ${title} ${seasonLabel} downloads`} {onclose}>
	<div class="body">
		<h2>Downloads</h2>
		<p class="sub">{title} · {seasonLabel}</p>

		<div class="stat"><span class="flabel">Files</span><span class="val tnum">{haveCount}/{total}</span></div>

		<button type="button" class="row" role="switch" aria-checked={monitored} disabled={busy} onclick={onmonitor}>
			<span class="flabel">Monitored</span>
			<span class="toggle" class:on={monitored}><span class="knob"></span></span>
		</button>

		<div class="buttons">
			<button class="ghost" disabled={busy} onclick={onsearch}>Search season</button>
			<button class="ghost" onclick={oninteractive}>Interactive…</button>
		</div>
	</div>
</Sheet>

<style>
	.body { padding: 4px 16px 8px; display: flex; flex-direction: column; gap: 12px; }
	h2 { margin: 0; font-size: 19px; font-weight: 700; letter-spacing: -0.01em; }
	.sub { margin: 0; color: var(--text-dim); font-size: 13px; }
	.stat { display: flex; align-items: center; justify-content: space-between; }
	.val { font-size: 15px; }
	.flabel { font-size: 13px; font-weight: 600; color: var(--text-dim); }
	.row { display: flex; align-items: center; justify-content: space-between; min-height: var(--tap); }
	.toggle { position: relative; width: 46px; height: 28px; border-radius: 999px; background: var(--surface-raised); flex: none; transition: background 160ms ease; }
	.toggle.on { background: var(--signal); }
	.knob { position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; transition: transform 160ms ease; }
	.toggle.on .knob { transform: translateX(18px); }
	.buttons { display: flex; gap: 8px; }
	.ghost { flex: 1; min-height: 48px; border-radius: 12px; background: var(--surface-raised); color: var(--text); font-size: 15px; font-weight: 600; }
	.ghost:disabled { opacity: 0.6; }
</style>
