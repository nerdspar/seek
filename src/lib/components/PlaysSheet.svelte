<script lang="ts" module>
	export type Play = { id: number; season: number | null; episode: number | null; watchedAt: string; source: string };
</script>

<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { notify } from '$lib/notices.svelte';
	import { haptic } from '$lib/haptics';

	/**
	 * The long-press menu on an episode or a season row: rewatches without
	 * cluttering the rows. A tap still marks and unmarks; holding opens this —
	 * watched again (now, or on a day you pick), take the last play back, and
	 * every play with its date.
	 */
	type Props = {
		/** "S01E03 · Little Woody", or "Season 2". */
		title: string;
		/** The show's name, above the title. */
		showTitle: string | null;
		source: string;
		mediaId: string;
		season: number;
		/** An episode; omitted for the whole season. */
		episode?: number;
		/** Something changed; here are the plays now, so the row can update. */
		onchanged: (plays: Play[]) => void;
		onclose: () => void;
	};
	let { title, showTitle, source, mediaId, season, episode, onchanged, onclose }: Props = $props();

	const isSeason = $derived(episode === undefined);
	let plays = $state<Play[] | null>(null);
	let busy = $state(false);
	let picking = $state(false);
	const today = () => new Date().toLocaleDateString('en-CA');
	let day = $state(today());
	let error = $state<string | null>(null);

	async function load() {
		const q = new URLSearchParams({ source, mediaId, season: String(season) });
		if (episode !== undefined) q.set('episode', String(episode));
		try {
			const res = await fetch(`/api/plays?${q}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			plays = (await res.json()).plays;
		} catch (err) {
			error = `Couldn't load the history — ${err instanceof Error ? err.message : err}`;
			plays = [];
		}
	}
	$effect(() => {
		void load();
	});

	async function send(url: string, method: string, body: Record<string, unknown>, done: string) {
		if (busy) return;
		busy = true;
		error = null;
		try {
			const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			haptic();
			void notify(done);
			picking = false;
			await load();
			onchanged(plays ?? []);
		} catch (err) {
			error = `Couldn't do that — ${err instanceof Error ? err.message : err}`;
		} finally {
			busy = false;
		}
	}

	/** A picked day as an evening watch — or now, if that evening hasn't come yet. */
	function atFor(d: string): string {
		const evening = new Date(`${d}T20:00:00`);
		return new Date(Math.min(evening.getTime(), Date.now())).toISOString();
	}

	function watched(at?: string) {
		const when = at ? ` on ${new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ' again';
		if (isSeason) {
			// A play for every episode is a lot to add by accident.
			if (!confirm(`Mark every aired episode of ${title} watched${when}?`)) return;
			void send('/api/season', 'POST', { source, mediaId, season, rewatch: true, ...(at ? { at } : {}) }, `${title} watched${when}`);
		} else {
			void send('/api/watch', 'POST', { source, mediaId, mediaType: 'tv', season, episode, ...(at ? { at } : {}) }, `${title} watched${when}`);
		}
	}

	const removeLast = () =>
		send('/api/watch', 'DELETE', { source, mediaId, mediaType: 'tv', season, episode }, 'Last play removed');
	const removeOne = (id: number) => send('/api/plays', 'DELETE', { id }, 'Play removed');
	/** A season's plays from one day — how a whole-season "watched again" is undone. */
	function removeDay(d: string, ids: number[]) {
		if (!confirm(`Remove the ${ids.length} play${ids.length === 1 ? '' : 's'} of ${title} from ${d}?`)) return;
		void send('/api/plays', 'DELETE', { ids }, `Removed ${ids.length} play${ids.length === 1 ? '' : 's'}`);
	}

	const when = (iso: string) =>
		new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

	/** A season's plays by day: "Oct 1, 2026 · 10 episodes", with their ids. */
	const days = $derived.by(() => {
		const m = new Map<string, number[]>();
		for (const p of plays ?? []) {
			const d = new Date(p.watchedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
			m.set(d, [...(m.get(d) ?? []), p.id]);
		}
		return [...m];
	});
</script>

<Sheet label={title} {onclose} scrollable>
	<div class="pad">
		{#if showTitle}<p class="kicker">{showTitle}</p>{/if}
		<h2>{title}</h2>

		<div class="rows">
			<button disabled={busy} onclick={() => watched()}>
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></svg>
				<span>Watched again</span>
				<span class="aside">{isSeason ? 'Every episode, now' : 'Now'}</span>
			</button>
			{#if picking}
				<div class="pick">
					<input type="date" bind:value={day} max={today()} aria-label="The day you watched it" />
					<button class="save" disabled={busy || !day} onclick={() => watched(atFor(day))}>Save</button>
				</div>
			{:else}
				<button disabled={busy} onclick={() => (picking = true)}>
					<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>
					<span>Watched on…</span>
				</button>
			{/if}
			{#if !isSeason && plays?.length}
				<button class="danger" disabled={busy} onclick={removeLast}>
					<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
					<span>Remove last play</span>
				</button>
			{/if}
		</div>

		{#if error}<p class="error">{error}</p>{/if}

		<h3>{plays === null ? 'History' : plays.length ? `Watched ${plays.length} time${plays.length === 1 ? '' : 's'}` : 'Not watched yet'}</h3>
		{#if plays === null}
			<p class="dim">Loading…</p>
		{:else if isSeason}
			<ul class="history">
				{#each days as [d, ids] (d)}
					<li>
						<span>{d}</span>
						<span class="dim">{ids.length} episode{ids.length === 1 ? '' : 's'}</span>
						<button class="x" disabled={busy} aria-label={`Remove the plays from ${d}`} onclick={() => removeDay(d, ids)}>×</button>
					</li>
				{/each}
			</ul>
		{:else}
			<ul class="history">
				{#each plays as p (p.id)}
					<li>
						<span>{when(p.watchedAt)}</span>
						{#if p.source === 'jellyfin'}<span class="dim">Jellyfin</span>{/if}
						<button class="x" disabled={busy} aria-label={`Remove the play on ${when(p.watchedAt)}`} onclick={() => removeOne(p.id)}>×</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</Sheet>

<style>
	.pad { padding: 0 var(--gutter) 12px; }
	.kicker { margin: 0 0 2px; font-size: 12.5px; color: var(--text-dim); }
	h2 { margin: 0 0 14px; font-size: 18px; font-weight: 600; }
	h3 { margin: 18px 0 6px; font-size: 13px; font-weight: 600; color: var(--text-dim); }
	.rows { display: flex; flex-direction: column; gap: 4px; }
	.rows > button, .pick {
		display: flex; align-items: center; gap: 12px;
		min-height: var(--tap); padding: 0 14px;
		border-radius: var(--radius); background: var(--surface-raised);
		font-size: 15px; color: var(--text); text-align: left;
	}
	.pick { padding-right: 6px; }
	.pick input {
		flex: 1; min-width: 0; background: none; border: 0; color: var(--text);
		font: inherit; font-size: 16px; color-scheme: dark light;
	}
	.save {
		padding: 7px 14px; border-radius: 999px;
		background: var(--signal); color: #fff; font-size: 14px; font-weight: 600;
	}
	.rows .danger { color: #ff8a8a; }
	button:disabled { opacity: 0.5; }
	.aside { margin-left: auto; font-size: 12.5px; color: var(--text-dim); }
	.history { list-style: none; margin: 0; padding: 0; }
	.history li {
		display: flex; align-items: center; gap: 10px;
		min-height: 40px; border-bottom: 1px solid var(--hairline, rgba(127, 127, 127, 0.15));
		font-size: 14px;
	}
	.history li > span:first-child { flex: 1; }
	.dim { color: var(--text-dim); font-size: 12.5px; }
	.x {
		width: 32px; height: 32px; border-radius: 50%;
		color: var(--text-dim); font-size: 20px; line-height: 1;
	}
	.error { margin: 10px 0 0; font-size: 13px; color: #ff8a8a; }
</style>
