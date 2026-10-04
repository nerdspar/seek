<script lang="ts">
	import { onMount } from 'svelte';
	import Sheet from './Sheet.svelte';
	import { answerTogether } from '$lib/together';
	import { notify } from '$lib/notices.svelte';

	/** New shows waiting for "together or solo?" — a banner on the Watchlist and
	 *  the sheet where you answer. Shows up only in a household that shares and
	 *  asks; a push about new shows opens straight to it (#new-shows). */
	type Show = { source: string; mediaId: string; title: string | null };
	let pending = $state<Show[]>([]);
	let open = $state(false);
	let busy = $state<string | null>(null);

	onMount(() => {
		fetch('/api/household/new-shows')
			.then((r) => (r.ok ? r.json() : null))
			.then((d) => {
				pending = d?.pending ?? [];
				if (pending.length && location.hash === '#new-shows') open = true;
			})
			.catch(() => {});
	});

	const key = (s: Show) => `${s.source}:${s.mediaId}`;

	async function answer(s: Show, choice: 'together' | 'solo') {
		busy = key(s);
		try {
			await answerTogether({ source: s.source, mediaId: s.mediaId, title: s.title ?? 'This show' }, choice);
			pending = pending.filter((p) => key(p) !== key(s));
			if (!pending.length) close();
			if (choice === 'together') void notify(`Watching ${s.title ?? 'it'} together`);
		} catch (e) {
			void notify(`Couldn't save that — ${(e as Error).message}`);
		} finally {
			busy = null;
		}
	}

	function close() {
		open = false;
		if (location.hash === '#new-shows') history.replaceState(history.state, '', location.pathname + location.search);
	}
</script>

{#if pending.length}
	<button class="banner" onclick={() => (open = true)}>
		<span class="dot" aria-hidden="true"></span>
		<span class="text">
			{pending.length === 1 ? `${pending[0].title ?? 'A new show'}` : `${pending.length} new shows`} — together or solo?
		</span>
		<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
	</button>
{/if}

{#if open}
	<Sheet label="New shows" scrollable onclose={close}>
		<div class="body">
			<h2>Together or solo?</h2>
			<p class="hint">
				Together: a play by either of you counts for both, starting with what's already been watched. Solo: it stays
				yours. You can change it later from the show's page.
			</p>
			<ul>
				{#each pending as s (key(s))}
					<li>
						<a class="title" href={`/show/${s.source}/${s.mediaId}`} onclick={close}>{s.title ?? `Show ${s.mediaId}`}</a>
						<span class="btns">
							<button class="together" disabled={busy !== null} onclick={() => answer(s, 'together')}>Together</button>
							<button class="solo" disabled={busy !== null} onclick={() => answer(s, 'solo')}>Solo</button>
						</span>
					</li>
				{/each}
			</ul>
		</div>
	</Sheet>
{/if}

<style>
	.banner {
		display: flex; align-items: center; gap: 10px; width: 100%; margin: 0 0 10px;
		padding: 11px 14px; border-radius: var(--radius); background: var(--surface-raised);
		text-align: left; font-size: 14px; font-weight: 600; color: var(--text);
	}
	.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--signal); }
	.text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.body { padding: 4px 16px 12px; }
	h2 { margin: 0 0 6px; font-size: 19px; font-weight: 700; }
	.hint { margin: 0 0 12px; font-size: 13px; line-height: 1.4; color: var(--text-dim); }
	ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
	li {
		display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 14px;
		border-radius: var(--radius); background: var(--surface-raised);
	}
	.title { flex: 1; min-width: 0; font-size: 15px; font-weight: 600; color: var(--text); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.btns { display: flex; gap: 6px; flex: none; }
	.btns button { min-height: 36px; padding: 0 12px; border-radius: 10px; font-size: 13.5px; font-weight: 650; }
	.together { background: var(--signal); color: #fff; }
	.solo { background: var(--surface); color: var(--text); }
	.btns button:disabled { opacity: 0.5; }
</style>
