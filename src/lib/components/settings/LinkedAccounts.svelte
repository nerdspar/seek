<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	/** "Your accounts" — the credentials Seek uses on *your* behalf: your own
	 *  Floppy (watchlist, stats), its calendar feed (Upcoming), and BookOrbit
	 *  (books). Each is checked against the real service before it's saved. */
	type Linked = {
		floppy: boolean;
		calendar: boolean;
		bookorbit: { username: string; libraryId: number | null } | null;
	};
	type Props = {
		account: {
			linked: Linked;
			canStore: boolean;
			bookorbit: boolean;
			envFallback: { floppy: boolean; calendar: boolean; bookorbit: boolean };
		};
	};
	let { account }: Props = $props();
	const linked = $derived(account.linked);

	type Service = 'floppy' | 'calendar' | 'bookorbit';
	let open = $state<Service | null>(null);
	let busy = $state(false);
	let msg = $state<{ service: Service; ok: boolean; text: string } | null>(null);

	let token = $state('');
	let boUser = $state('');
	let boPass = $state('');

	async function call(method: string, body: unknown): Promise<Record<string, unknown>> {
		const res = await fetch('/api/connections', {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
		return data;
	}

	function start(service: Service) {
		open = open === service ? null : service;
		msg = null;
		token = boUser = boPass = '';
	}

	async function link(service: Service) {
		busy = true;
		msg = null;
		try {
			const body =
				service === 'bookorbit'
					? { service, username: boUser, password: boPass }
					: { service, token };
			const r = await call('PUT', body);
			if (service === 'bookorbit' && Array.isArray(r.libraries)) {
				libraries = r.libraries as { id: number; name: string }[];
			}
			open = null;
			token = boPass = '';
			msg = { service, ok: true, text: 'Linked.' };
			await invalidateAll();
		} catch (e) {
			msg = { service, ok: false, text: (e as Error).message };
		} finally {
			busy = false;
		}
	}

	async function unlink(service: Service) {
		msg = null;
		try {
			await call('DELETE', { service });
			if (service === 'bookorbit') libraries = [];
			await invalidateAll();
		} catch (e) {
			msg = { service, ok: false, text: (e as Error).message };
		}
	}

	/* BookOrbit libraries, for choosing where your downloads and uploads land.
	   Fetched with your own BookOrbit session once you're linked. */
	let libraries = $state<{ id: number; name: string }[]>([]);
	$effect(() => {
		if (!linked.bookorbit || libraries.length) return;
		fetch('/api/books/libraries')
			.then((r) => (r.ok ? r.json() : { libraries: [] }))
			.then((b) => (libraries = b.libraries ?? []))
			.catch(() => {});
	});

	async function pickLibrary(id: number) {
		try {
			await call('PATCH', { service: 'bookorbit', libraryId: id });
			await invalidateAll();
		} catch (e) {
			msg = { service: 'bookorbit', ok: false, text: (e as Error).message };
		}
	}

	function status(service: Service): string {
		if (service === 'bookorbit' && linked.bookorbit) return `Linked as ${linked.bookorbit.username}`;
		if (service !== 'bookorbit' && linked[service]) return 'Linked';
		if (account.envFallback[service]) return "Using the server's default (from the deployment)";
		return 'Not linked';
	}
	const isLinked = (s: Service) => (s === 'bookorbit' ? Boolean(linked.bookorbit) : linked[s]);

	const SERVICES: { id: Service; label: string; what: string; how: string }[] = [
		{
			id: 'floppy',
			label: 'Floppy',
			what: 'Your watchlist, shows, stats and history',
			how: 'In Floppy: Settings → Integrations → Tokens. Give it watchlist:write, sync:read and progress access, then paste the flp_… token.'
		},
		{
			id: 'calendar',
			label: 'Floppy calendar',
			what: 'Upcoming, and the daily digest',
			how: 'In Floppy: copy your calendar feed link. Paste the whole link — Seek takes the token from it.'
		},
		{
			id: 'bookorbit',
			label: 'BookOrbit',
			what: 'Your books, reading progress and goals',
			how: 'Your own BookOrbit username and password.'
		}
	];
	const visible = $derived(SERVICES.filter((s) => s.id !== 'bookorbit' || account.bookorbit));
</script>

<section id="accounts">
	<h3>Your accounts</h3>
	<p class="hint lead">Seek reads your own data with these — nobody else's account is used for you.</p>
	{#if !account.canStore}
		<p class="error">SEEK_TOKEN_KEY isn't set on the server, so links can't be saved yet.</p>
	{/if}

	{#each visible as s (s.id)}
		<div class="svc">
			<div class="row static">
				<span class="rowtext">
					<span class="label">{s.label}</span>
					<span class="hint">{s.what} · <span class:ok={isLinked(s.id)}>{status(s.id)}</span></span>
				</span>
				<span class="actions">
					{#if isLinked(s.id)}
						<button class="link" onclick={() => unlink(s.id)}>Unlink</button>
					{/if}
					<button class="link" disabled={!account.canStore} onclick={() => start(s.id)}>
						{open === s.id ? 'Cancel' : isLinked(s.id) ? 'Replace' : 'Link'}
					</button>
				</span>
			</div>

			{#if open === s.id}
				<form
					class="stack"
					onsubmit={(e) => {
						e.preventDefault();
						void link(s.id);
					}}
				>
					<p class="hint">{s.how}</p>
					{#if s.id === 'bookorbit'}
						<input bind:value={boUser} placeholder="BookOrbit username" autocomplete="off" autocapitalize="off" autocorrect="off" required />
						<input bind:value={boPass} type="password" placeholder="BookOrbit password" autocomplete="off" required />
					{:else}
						<input
							bind:value={token}
							type="password"
							placeholder={s.id === 'floppy' ? 'flp_…' : 'Calendar feed link or token'}
							autocomplete="off"
							autocapitalize="off"
							autocorrect="off"
							required
						/>
					{/if}
					<button type="submit" class="primary" disabled={busy}>{busy ? 'Checking…' : 'Check & link'}</button>
				</form>
			{/if}

			{#if s.id === 'bookorbit' && linked.bookorbit && libraries.length > 1}
				<label class="row static sub">
					<span class="rowtext">
						<span class="label">Your library</span>
						<span class="hint">Where your downloads and uploads land</span>
					</span>
					<select
						value={linked.bookorbit.libraryId ?? ''}
						onchange={(e) => pickLibrary(Number(e.currentTarget.value))}
					>
						{#each libraries as lib (lib.id)}<option value={lib.id}>{lib.name}</option>{/each}
					</select>
				</label>
			{/if}

			{#if msg?.service === s.id}
				<p class={msg.ok ? 'hint msg' : 'error'}>{msg.text}</p>
			{/if}
		</div>
	{/each}
</section>

<style>
	h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--text-dim); }
	section { margin-bottom: 18px; }
	.svc { margin-bottom: 8px; }
	.lead { margin: -2px 0 10px; }
	.row {
		display: flex; align-items: center; justify-content: space-between; gap: 14px;
		width: 100%; min-height: var(--tap); padding: 9px 14px;
		border-radius: var(--radius); background: var(--surface-raised); text-align: left;
	}
	.row.sub { margin-top: 6px; }
	.rowtext { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.label { font-size: 15px; font-weight: 600; }
	.hint { font-size: 12px; opacity: 0.7; }
	.ok { color: var(--signal-solid); opacity: 1; font-weight: 600; }
	.msg { margin: 6px 0 0; }
	.actions { display: flex; gap: 14px; flex: none; }
	.link { font-size: 13px; font-weight: 600; color: var(--signal-solid); }
	.link:disabled { opacity: 0.4; }
	.stack { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
	.stack .hint { margin: 0; line-height: 1.4; }
	input {
		width: 100%; height: 40px; padding: 0 12px;
		border: none; border-radius: var(--radius);
		background: var(--surface-raised); color: var(--text);
		font: inherit; font-size: 16px; outline: none;
		-webkit-appearance: none; appearance: none;
	}
	.primary {
		min-height: 40px; padding: 0 16px; border-radius: var(--radius);
		background: var(--signal); color: #fff; font-size: 14px; font-weight: 600;
	}
	.primary:disabled { opacity: 0.5; }
	select {
		max-width: 55%; height: 34px; padding: 0 8px; border: none; border-radius: 8px;
		background: var(--surface); color: var(--text); font: inherit; font-size: 14px;
	}
	.error { margin: 6px 0 0; font-size: 13px; color: #ff8a8a; }
</style>
