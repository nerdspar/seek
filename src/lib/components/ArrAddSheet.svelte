<script lang="ts">
	import { confirmTitle } from '$lib/status.svelte';
	import Sheet from './Sheet.svelte';
	import { notify } from '$lib/notices.svelte';
	import {
		markInArr,
		arrServiceName,
		arrOptionsFor,
		arrOptionsLoaded,
		loadArrOptions,
		monitorOptions,
		defaultMonitor
	} from '$lib/arr.svelte';
	import { haptic } from '$lib/haptics';
	import { onMount } from 'svelte';

	/**
	 * The add form: Monitor, Quality Profile, Root Folder and Tags, each pre-filled
	 * from the Settings default and overridable per title, plus a "search now"
	 * toggle. Owned by the page (one instance), never nested in a browse tile.
	 */
	type Item = { mediaType: string; tmdbId: string; title: string };
	type Props = { item: Item; onclose: () => void };
	let { item, onclose }: Props = $props();

	const service = $derived(arrServiceName(item.mediaType));
	const opts = $derived(arrOptionsFor(item.mediaType));
	const ready = $derived(arrOptionsLoaded());
	const monitors = $derived(monitorOptions(item.mediaType));

	let busy = $state(false);
	let rootFolderPath = $state('');
	let qualityProfileId = $state<number>(-1);
	let monitor = $state('');
	let selected = $state<Set<string>>(new Set());
	let newTag = $state('');
	let search = $state(false);

	/* Together or solo, for a show in a household that shares (two people on
	   Floppy). Pre-picked from the household setting; with "Ask", neither is —
	   leave it and the show waits on the Watchlist for an answer. */
	let household = $state<{ mirroring: boolean; mode: 'ask' | 'together' | 'solo' } | null>(null);
	let together = $state<boolean | null>(null);

	onMount(() => {
		void loadArrOptions();
		if (item.mediaType === 'movie') return;
		fetch('/api/household/new-shows')
			.then((r) => (r.ok ? r.json() : null))
			.then((h) => {
				if (!h?.mirroring) return;
				household = h;
				together = h.mode === 'together' ? true : h.mode === 'solo' ? false : null;
			})
			.catch(() => {});
	});

	/* Seed the form from the saved default once options arrive. */
	let inited = false;
	$effect(() => {
		if (!ready || inited) return;
		const d = opts.default;
		/* A saved "—" (choose each time) leaves the field unpicked; with no
		   defaults saved at all, the first option keeps a first add one tap. */
		rootFolderPath = d ? d.rootFolderPath : (opts.rootFolders[0]?.path ?? '');
		qualityProfileId = d ? d.qualityProfileId : (opts.profiles[0]?.id ?? -1);
		monitor = d?.monitor || defaultMonitor(item.mediaType);
		selected = new Set(d?.tags ?? []);
		inited = true;
	});

	/* Existing tags plus any freshly-typed ones, so a new label still shows. */
	const tagLabels = $derived([
		...new Set([...opts.tags.map((t) => t.label), ...selected])
	]);

	function toggleTag(label: string) {
		const next = new Set(selected);
		if (next.has(label)) next.delete(label);
		else next.add(label);
		selected = next;
	}
	function addNewTag() {
		const t = newTag.trim();
		if (!t) return;
		selected = new Set(selected).add(t);
		newTag = '';
	}

	async function add() {
		if (busy) return;
		busy = true;
		try {
			const res = await fetch('/api/arr/add', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mediaType: item.mediaType,
					tmdbId: item.tmdbId,
					rootFolderPath,
					qualityProfileId,
					monitor,
					tags: [...selected],
					search,
					title: item.title,
					...(together === null ? {} : { together })
				})
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);

			markInArr(item.mediaType, item.tmdbId);
			// It's in your Floppy library now too: every + on screen shows it at once.
			if (body.tracked) confirmTitle('tmdb', item.tmdbId, { tracked: true });
			haptic();
			void notify(
				body.alreadyAdded
					? `${item.title} is already in ${service}`
					: search
						? `Added ${item.title} to ${service} and started searching`
						: `Added ${item.title} to ${service}`
			);
			onclose();
		} catch (err) {
			void notify(`Couldn't add ${item.title} — ${err instanceof Error ? err.message : err}`);
		} finally {
			busy = false;
		}
	}
</script>

<Sheet label={`Add ${item.title} to ${service}`} scrollable {onclose}>
	<div class="body">
		<h2>{item.title}</h2>
		<p class="sub">Add to {service} for monitoring.</p>

		{#if !ready}
			<p class="sub">Loading options…</p>
		{:else}
			<label class="field">
				<span class="flabel">Monitor</span>
				<select bind:value={monitor}>
					{#each monitors as m (m.value)}<option value={m.value}>{m.label}</option>{/each}
				</select>
			</label>

			<label class="field">
				<span class="flabel">Quality profile</span>
				<select bind:value={qualityProfileId}>
					{#if qualityProfileId < 0}<option value={-1} disabled>Choose…</option>{/if}
					{#each opts.profiles as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
				</select>
			</label>

			<label class="field">
				<span class="flabel">Root folder</span>
				<select bind:value={rootFolderPath}>
					{#if !rootFolderPath}<option value="" disabled>Choose…</option>{/if}
					{#each opts.rootFolders as rf (rf.path)}<option value={rf.path}>{rf.path}</option>{/each}
				</select>
			</label>

			<div class="field tags">
				<span class="flabel">Tags</span>
				<div class="chips">
					{#each tagLabels as label (label)}
						<button type="button" class="tag" class:on={selected.has(label)} onclick={() => toggleTag(label)}>{label}</button>
					{/each}
					{#if !tagLabels.length}<span class="sub">No tags yet</span>{/if}
				</div>
				<div class="newtag">
					<input placeholder="New tag…" bind:value={newTag} onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addNewTag())} />
					<button type="button" class="addtag" onclick={addNewTag} disabled={!newTag.trim()}>Add</button>
				</div>
			</div>

			{#if household}
				<div class="field">
					<span class="flabel">Watching</span>
					<div class="chips">
						<button type="button" class="tag" class:on={together === true} onclick={() => (together = together === true ? null : true)}>Together</button>
						<button type="button" class="tag" class:on={together === false} onclick={() => (together = together === false ? null : false)}>Solo</button>
					</div>
					{#if together === null}<span class="sub small">Not sure yet? Leave it — it'll wait on your Watchlist.</span>{/if}
				</div>
			{/if}

			<button type="button" class="row" role="switch" aria-checked={search} onclick={() => (search = !search)}>
				<span class="flabel">Search on add</span>
				<span class="toggle" class:on={search}><span class="knob"></span></span>
			</button>

			<button class="submit" disabled={busy || qualityProfileId < 0 || !rootFolderPath} onclick={add}>
				{busy ? 'Adding…' : `Add to ${service}`}
			</button>
		{/if}
	</div>
</Sheet>

<style>
	.body {
		padding: 4px 16px 8px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	h2 {
		margin: 0;
		font-size: 19px;
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.sub {
		margin: 0;
		color: var(--text-dim);
		font-size: 14px;
	}
	.sub.small { font-size: 12.5px; }
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.flabel {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-dim);
	}
	select,
	input {
		width: 100%;
		min-height: var(--tap);
		padding: 0 12px;
		border-radius: 12px;
		background: var(--surface-raised);
		color: var(--text);
		font-size: 15px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.tag {
		padding: 7px 12px;
		border-radius: 999px;
		background: var(--surface-raised);
		color: var(--text);
		font-size: 14px;
	}
	.tag.on {
		background: var(--signal);
		color: #fff;
	}
	.newtag {
		display: flex;
		gap: 8px;
	}
	.newtag input {
		flex: 1;
	}
	.addtag {
		padding: 0 16px;
		border-radius: 12px;
		background: var(--surface-raised);
		color: var(--text);
		font-weight: 600;
	}
	.addtag:disabled {
		opacity: 0.5;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: var(--tap);
	}
	.toggle {
		position: relative;
		width: 46px;
		height: 28px;
		border-radius: 999px;
		background: var(--surface-raised);
		transition: background 160ms ease;
		flex: none;
	}
	.toggle.on {
		background: var(--signal);
	}
	.knob {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: #fff;
		transition: transform 160ms ease;
	}
	.toggle.on .knob {
		transform: translateX(18px);
	}
	.submit {
		min-height: var(--tap);
		border-radius: 14px;
		background: var(--signal);
		color: #fff;
		font-size: 16px;
		font-weight: 600;
		margin-top: 4px;
	}
	.submit:disabled {
		opacity: 0.6;
	}
</style>
