<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import { SERVICE_GROUPS, type ServiceGroup } from '$lib/serviceFields';
	import StatusDot, { type DotState } from './StatusDot.svelte';

	/** The household's services — addresses and keys for Floppy, TMDB, BookOrbit,
	 *  Hardcover, Sonarr, Radarr, Jellyfin and email. Owner only. Secrets are
	 *  never sent back here: a secret shows only as "set", and is sent again only
	 *  when it's being replaced. */
	type Display = Record<string, { value?: string; set: boolean }>;
	type Props = {
		services: Display;
		openFirst?: string | null;
		/** More settings under a service's form (Sonarr/Radarr: defaults for new titles). */
		extra?: Snippet<[string]>;
	};
	let { services, openFirst = null, extra }: Props = $props();

	let current = $state<Display>({});
	$effect.pre(() => {
		current = services;
	});

	let open = $state<string | null>(null);
	$effect.pre(() => {
		if (openFirst) open = openFirst;
	});

	let draft = $state<Record<string, string>>({});
	let clearing = $state<Record<string, boolean>>({});
	let busy = $state<'save' | 'test' | null>(null);
	let result = $state<{ group: string; ok: boolean; message: string } | null>(null);
	/* The last test/save outcome per service this visit, so a failing one shows
	   red on its collapsed row too. */
	let lastCheck = $state<Record<string, boolean>>({});

	function toggle(g: ServiceGroup) {
		if (open === g.id) {
			open = null;
			return;
		}
		open = g.id;
		result = null;
		clearing = {};
		draft = Object.fromEntries(g.fields.filter((f) => !f.secret).map((f) => [f.key, current[f.key]?.value ?? '']));
	}

	/** Set up (everything it needs), part set up, not set up — or failing. */
	function dot(g: ServiceGroup): DotState {
		if (lastCheck[g.id] === false) return 'bad';
		const set = g.needs.filter((k) => current[k]?.set).length;
		return set === g.needs.length ? 'ok' : set ? 'partial' : 'off';
	}

	/** One line under each service: what's set, at a glance. */
	function summary(g: ServiceGroup): string {
		const set = g.fields.filter((f) => current[f.key]?.set);
		if (!set.length) return g.id === 'floppy' ? 'Not set up' : 'Off';
		const address = g.fields.find((f) => f.kind === 'url' && current[f.key]?.value)?.key;
		return address ? (current[address].value ?? '') : 'Set';
	}

	/** The form as typed. A secret left blank isn't sent (keep what's saved). */
	function typed(g: ServiceGroup): Record<string, string> {
		const values: Record<string, string> = {};
		for (const f of g.fields) {
			if (f.secret) {
				if (clearing[f.key]) values[f.key] = '';
				else if (draft[f.key]?.trim()) values[f.key] = draft[f.key];
			} else values[f.key] = draft[f.key] ?? '';
		}
		return values;
	}

	/** Check what's typed, without saving it. */
	async function test(g: ServiceGroup) {
		busy = 'test';
		result = null;
		try {
			const res = await fetch('/api/service-settings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ group: g.id, values: typed(g) })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
			result = { group: g.id, ...body.check };
			lastCheck[g.id] = body.check.ok;
		} catch (e) {
			result = { group: g.id, ok: false, message: `Couldn't test — ${(e as Error).message}` };
		} finally {
			busy = null;
		}
	}

	async function save(g: ServiceGroup) {
		busy = 'save';
		result = null;
		const values = typed(g);
		try {
			const res = await fetch('/api/service-settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ group: g.id, values })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
			current = body.services;
			for (const f of g.fields) if (f.secret) draft[f.key] = '';
			clearing = {};
			result = { group: g.id, ...(body.check ?? { ok: true, message: 'Saved.' }) };
			if (body.check) lastCheck[g.id] = body.check.ok;
			// Pages and toggles that depend on what's configured (Books, Sonarr…).
			await invalidateAll();
		} catch (e) {
			result = { group: g.id, ok: false, message: `Couldn't save — ${(e as Error).message}` };
		} finally {
			busy = null;
		}
	}
</script>

<section id="services">
	<h3>Services</h3>
	<p class="hint lead">Where Seek finds the household’s apps. Only you (the owner) see this.</p>

	{#each SERVICE_GROUPS as g (g.id)}
		<div class="svc">
			<button class="row" aria-expanded={open === g.id} onclick={() => toggle(g)}>
				<StatusDot state={dot(g)} />
				<span class="rowtext">
					<span class="label">{g.title}</span>
					<span class="hint addr">{summary(g)}</span>
				</span>
				<span class="chev">{open === g.id ? '−' : '+'}</span>
			</button>

			{#if open === g.id}
				<form class="stack" onsubmit={(e) => { e.preventDefault(); void save(g); }}>
					<p class="hint">{g.about}</p>
					{#each g.fields as f (f.key)}
						<label class="field">
							<span class="flabel">{f.label}</span>
							{#if f.secret}
								<div class="secret">
									<input
										type="password"
										bind:value={draft[f.key]}
										placeholder={clearing[f.key] ? 'Will be removed' : current[f.key]?.set ? '•••••••• set — type to replace' : 'Paste it here'}
										autocomplete="off"
										autocapitalize="off"
										spellcheck="false"
										disabled={busy !== null || clearing[f.key]}
									/>
									{#if current[f.key]?.set}
										<button type="button" class="link" onclick={() => (clearing[f.key] = !clearing[f.key])}>
											{clearing[f.key] ? 'Keep' : 'Remove'}
										</button>
									{/if}
								</div>
							{:else}
								<input
									type={f.kind === 'url' ? 'url' : 'text'}
									inputmode={f.kind === 'url' ? 'url' : undefined}
									bind:value={draft[f.key]}
									placeholder={f.placeholder ?? ''}
									autocomplete="off"
									autocapitalize="off"
									autocorrect="off"
									spellcheck="false"
									disabled={busy !== null}
								/>
							{/if}
							{#if f.hint}<span class="hint">{f.hint}</span>{/if}
						</label>
					{/each}
					<div class="buttons">
					<button type="submit" class="primary" disabled={busy !== null}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
					<button type="button" class="secondary" disabled={busy !== null} onclick={() => test(g)}>
						{busy === 'test' ? 'Testing…' : (g.testLabel ?? 'Test')}
					</button>
				</div>
					{#if result?.group === g.id}
						<p class="msg" class:bad={!result.ok}>{result.ok ? '✓ ' : ''}{result.message}</p>
					{/if}
				</form>
				{#if extra && current[g.needs[0]]?.set}
					<div class="extra">{@render extra(g.id)}</div>
				{/if}
			{/if}
		</div>
	{/each}
</section>

<style>
	h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--text-dim); }
	section { margin-bottom: 18px; }
	.lead { margin: -2px 0 10px; }
	.svc { margin-bottom: 8px; }
	.row {
		display: flex; align-items: center; justify-content: space-between; gap: 14px;
		width: 100%; min-height: var(--tap); padding: 9px 14px;
		border-radius: var(--radius); background: var(--surface-raised); text-align: left;
	}
	.rowtext { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.label { font-size: 15px; font-weight: 600; }
	.hint { font-size: 12px; opacity: 0.7; line-height: 1.4; }
	.addr { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.chev { flex: none; font-size: 20px; color: var(--text-dim); }
	.stack { display: flex; flex-direction: column; gap: 12px; margin: 10px 2px 4px; }
	.stack > .hint { margin: 0; }
	.field { display: flex; flex-direction: column; gap: 5px; }
	.flabel { font-size: 13px; font-weight: 600; }
	.secret { display: flex; align-items: center; gap: 12px; }
	input {
		width: 100%; min-width: 0; height: 40px; padding: 0 12px;
		border: none; border-radius: var(--radius);
		background: var(--surface-raised); color: var(--text);
		font: inherit; font-size: 16px; outline: none;
		-webkit-appearance: none; appearance: none;
	}
	input:disabled { opacity: 0.6; }
	.link { flex: none; font-size: 13px; font-weight: 600; color: var(--signal-solid); }
	.buttons { display: flex; flex-wrap: wrap; gap: 8px; }
	.secondary {
		min-height: 40px; padding: 0 16px; border-radius: var(--radius);
		background: var(--surface-raised); color: var(--text); font-size: 14px; font-weight: 600;
	}
	.secondary:disabled { opacity: 0.5; }
	.primary { min-height: 40px; padding: 0 20px; border-radius: var(--radius);
		background: var(--signal); color: #fff; font-size: 14px; font-weight: 600;
	}
	.primary:disabled { opacity: 0.5; }
	.msg { margin: 0; font-size: 13px; color: var(--text); }
	.extra { margin: 14px 2px 4px; padding-top: 12px; border-top: 1px solid color-mix(in srgb, var(--text) 8%, transparent); }
	.msg.bad { color: #ff8a8a; }
</style>
