<script lang="ts">
	/**
	 * Monthly hours as a smooth area chart, with an All / TV / Movies toggle.
	 * Every number is Floppy's (combined_plays_charts.by_month) — this only draws.
	 *
	 * The x-axis is trimmed to the last month any series has activity, so a
	 * part-way year shows Jan→now rather than a flat tail of empty months, and it
	 * stays put when you switch type.
	 */
	type Monthly = { labels: string[]; all: number[]; tv: number[]; movie: number[] };
	let { monthly }: { monthly: Monthly } = $props();

	const TABS = [
		{ id: 'all', label: 'All' },
		{ id: 'tv', label: 'TV Shows' },
		{ id: 'movie', label: 'Movies' }
	] as const;
	let type = $state<'all' | 'tv' | 'movie'>('all');

	// Last month with activity across any series — the shared right edge.
	const lastIdx = $derived.by(() => {
		let last = -1;
		for (let i = 0; i < monthly.labels.length; i++) {
			if ((monthly.all[i] ?? 0) || (monthly.tv[i] ?? 0) || (monthly.movie[i] ?? 0)) last = i;
		}
		return last;
	});

	const labels = $derived(monthly.labels.slice(0, lastIdx + 1));
	const series = $derived(monthly[type].slice(0, lastIdx + 1));
	const peak = $derived(Math.max(1, ...series));

	// Geometry (viewBox units; the SVG scales to its container).
	const W = 700;
	const H = 320;
	const PAD_X = 30;
	const PAD_TOP = 52;
	const PAD_BOTTOM = 46;
	const plotW = W - PAD_X * 2;
	const plotH = H - PAD_TOP - PAD_BOTTOM;
	const baseY = PAD_TOP + plotH;

	const points = $derived(
		series.map((v, i) => ({
			x: PAD_X + (series.length <= 1 ? plotW / 2 : (plotW * i) / (series.length - 1)),
			y: PAD_TOP + (1 - v / peak) * plotH,
			v,
			label: labels[i]
		}))
	);

	/** Catmull-Rom → cubic bezier for a smooth curve through the points. */
	function smooth(pts: { x: number; y: number }[]): string {
		if (!pts.length) return '';
		if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
		let d = `M ${pts[0].x} ${pts[0].y}`;
		for (let i = 0; i < pts.length - 1; i++) {
			const p0 = pts[i - 1] ?? pts[i];
			const p1 = pts[i];
			const p2 = pts[i + 1];
			const p3 = pts[i + 2] ?? p2;
			const c1x = p1.x + (p2.x - p0.x) / 6;
			const c1y = p1.y + (p2.y - p0.y) / 6;
			const c2x = p2.x - (p3.x - p1.x) / 6;
			const c2y = p2.y - (p3.y - p1.y) / 6;
			d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
		}
		return d;
	}

	const linePath = $derived(smooth(points));
	const areaPath = $derived(
		points.length ? `${linePath} L ${points[points.length - 1].x} ${baseY} L ${points[0].x} ${baseY} Z` : ''
	);
</script>

{#if points.length >= 2}
	<section class="chart">
		<div class="tabs" role="tablist">
			{#each TABS as t (t.id)}
				<button role="tab" aria-selected={type === t.id} class:on={type === t.id} onclick={() => (type = t.id)}>
					{t.label}
				</button>
			{/each}
		</div>

		<svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Monthly hours watched">
			<defs>
				<linearGradient id="statsfill" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="var(--signal)" stop-opacity="0.5" />
					<stop offset="55%" stop-color="var(--signal)" stop-opacity="0.14" />
					<stop offset="100%" stop-color="var(--signal)" stop-opacity="0" />
				</linearGradient>
			</defs>

			<path d={areaPath} fill="url(#statsfill)" />
			<path d={linePath} fill="none" stroke="var(--signal)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />

			{#each points as p (p.label)}
				<circle cx={p.x} cy={p.y} r="6.5" fill="var(--signal)" stroke="var(--bg)" stroke-width="2.5" />
				<text class="val" x={p.x} y={p.y - 16} text-anchor="middle">{p.v}h</text>
				<text class="mon" x={p.x} y={H - 16} text-anchor="middle">{p.label}</text>
			{/each}
		</svg>
	</section>
{/if}

<style>
	.chart {
		margin: 0 0 24px;
	}
	.tabs {
		display: flex;
		gap: 20px;
		margin-bottom: 8px;
	}
	.tabs button {
		font-size: 17px;
		font-weight: 700;
		color: var(--text-dim);
		letter-spacing: -0.01em;
	}
	.tabs button.on {
		color: var(--signal-text, var(--signal));
	}
	svg {
		width: 100%;
		height: auto;
		display: block;
		overflow: visible;
	}
	.val {
		fill: var(--text);
		font-size: 20px;
		font-weight: 700;
	}
	.mon {
		fill: var(--text-dim);
		font-size: 20px;
		font-weight: 500;
	}
</style>
