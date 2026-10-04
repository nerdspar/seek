<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	/** Your account, or the household (Settings has a page for each — `part`).
	 *  Owner-only controls — invite, remove, reset links — appear only for the owner. */
	type Member = { id: number; name: string; email: string; role: 'owner' | 'member'; emailVerified: boolean };
	type Props = {
		account: {
			me: Member;
			mail: boolean;
			household: { name: string; members: Member[]; invites: { email: string; expiresAt: string }[] };
		};
		part: 'account' | 'household';
	};
	let { account, part }: Props = $props();
	const me = $derived(account.me);
	const isOwner = $derived(me.role === 'owner');

	async function call(url: string, method: string, body: unknown): Promise<Record<string, unknown>> {
		const res = await fetch(url, {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
		return data;
	}

	/* ── Your name ───────────────────────────────────────────────────────── */
	let nameEdit = $state<string | null>(null);
	const nameValue = $derived(nameEdit ?? me.name);
	let nameMsg = $state<string | null>(null);
	async function saveName() {
		nameMsg = null;
		try {
			await call('/api/account', 'PATCH', { name: nameValue });
			nameEdit = null;
			await invalidateAll();
		} catch (e) {
			nameMsg = (e as Error).message;
		}
	}

	/* ── Email confirmation ─────────────────────────────────────────────── */
	let verifyMsg = $state<string | null>(null);
	async function sendVerify() {
		verifyMsg = null;
		try {
			await call('/api/account', 'POST', { action: 'verify' });
			verifyMsg = `Sent — check ${me.email}.`;
		} catch (e) {
			verifyMsg = (e as Error).message;
		}
	}

	/* ── Password ───────────────────────────────────────────────────────── */
	let pwOpen = $state(false);
	let pwCurrent = $state('');
	let pwNext = $state('');
	let pwConfirm = $state('');
	let pwBusy = $state(false);
	let pwMsg = $state<{ ok: boolean; text: string } | null>(null);
	async function changePassword() {
		pwMsg = null;
		if (pwNext !== pwConfirm) {
			pwMsg = { ok: false, text: "The new passwords don't match." };
			return;
		}
		pwBusy = true;
		try {
			await call('/api/account', 'POST', { action: 'password', current: pwCurrent, next: pwNext });
			pwCurrent = pwNext = pwConfirm = '';
			pwOpen = false;
			pwMsg = { ok: true, text: 'Password changed. Your other devices were signed out.' };
		} catch (e) {
			pwMsg = { ok: false, text: (e as Error).message };
		} finally {
			pwBusy = false;
		}
	}

	/* ── Shared shows (household mirroring) ───────────────────────────────── */
	type SharedState = {
		mirroring: boolean;
		waitingOn: string[];
		shows: { source: string; mediaId: string; title: string | null }[];
	};
	let sharedShows = $state<SharedState | null>(null);
	$effect(() => {
		fetch('/api/household/shared')
			.then((r) => (r.ok ? r.json() : null))
			.then((d) => (sharedShows = d))
			.catch(() => {});
	});
	async function unshareShow(show: { source: string; mediaId: string }) {
		try {
			await call('/api/household/shared', 'DELETE', show);
			if (sharedShows) sharedShows.shows = sharedShows.shows.filter((s) => s.mediaId !== show.mediaId || s.source !== show.source);
		} catch (e) {
			memberMsg = (e as Error).message;
		}
	}

	/* ── Household (owner) ──────────────────────────────────────────────── */
	let inviteEmail = $state('');
	let inviteBusy = $state(false);
	let inviteMsg = $state<string | null>(null);
	let shared = $state<{ label: string; link: string } | null>(null);
	let copied = $state(false);

	async function invite() {
		inviteMsg = null;
		shared = null;
		inviteBusy = true;
		try {
			const r = await call('/api/household', 'POST', { action: 'invite', email: inviteEmail });
			const link = String(r.link);
			if (r.emailed) {
				inviteMsg = `Invite emailed to ${r.email}.`;
			} else {
				inviteMsg = r.mailError
					? `Couldn't email it (${r.mailError}) — send this link yourself:`
					: `Send this link to ${r.email} — it works once, for 7 days:`;
			}
			shared = { label: `Invite for ${r.email}`, link };
			inviteEmail = '';
			await invalidateAll();
		} catch (e) {
			inviteMsg = (e as Error).message;
		} finally {
			inviteBusy = false;
		}
	}

	async function revoke(email: string) {
		try {
			await call('/api/household', 'POST', { action: 'revokeInvite', email });
			await invalidateAll();
		} catch (e) {
			inviteMsg = (e as Error).message;
		}
	}

	let memberMsg = $state<string | null>(null);
	let confirmRemove = $state<number | null>(null);
	async function remove(m: Member) {
		memberMsg = null;
		try {
			await call('/api/household', 'POST', { action: 'remove', userId: m.id });
			confirmRemove = null;
			await invalidateAll();
		} catch (e) {
			memberMsg = (e as Error).message;
		}
	}

	async function resetLink(m: Member) {
		memberMsg = null;
		shared = null;
		try {
			const r = await call('/api/household', 'POST', { action: 'resetLink', userId: m.id });
			memberMsg = `Send this to ${m.name} — it lets them choose a new password, once, within the hour:`;
			shared = { label: `Reset link for ${m.name}`, link: String(r.link) };
		} catch (e) {
			memberMsg = (e as Error).message;
		}
	}

	async function copyLink() {
		if (!shared) return;
		try {
			await navigator.clipboard.writeText(shared.link);
			copied = true;
			setTimeout(() => (copied = false), 1600);
		} catch {
			// Clipboard blocked: the link is selectable on screen anyway.
		}
	}

	const expires = (iso: string) =>
		new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
</script>

{#if part === 'account'}
<section>
	<h3>You</h3>
	<form
		class="addrow"
		onsubmit={(e) => {
			e.preventDefault();
			void saveName();
		}}
	>
		<input
			value={nameValue}
			oninput={(e) => (nameEdit = e.currentTarget.value)}
			aria-label="Your name"
			autocomplete="name"
		/>
		<button type="submit" disabled={nameEdit === null || nameEdit.trim() === me.name}>Save</button>
	</form>
	{#if nameMsg}<p class="error">{nameMsg}</p>{/if}
	<div class="row static">
		<span class="rowtext">
			<span class="label">{me.email}</span>
			<span class="hint">{me.emailVerified ? 'Email confirmed' : 'Email not confirmed yet'}</span>
		</span>
		{#if !me.emailVerified && account.mail}
			<button class="link" onclick={sendVerify}>Send confirmation</button>
		{/if}
	</div>
	{#if verifyMsg}<p class="hint msg">{verifyMsg}</p>{/if}
</section>

<section>
	<h3>Password</h3>
	{#if pwOpen}
		<form
			class="stack"
			onsubmit={(e) => {
				e.preventDefault();
				void changePassword();
			}}
		>
			<input type="email" value={me.email} autocomplete="username" readonly hidden />
			<input type="password" bind:value={pwCurrent} placeholder="Current password" autocomplete="current-password" required />
			<input type="password" bind:value={pwNext} placeholder="New password (8+ characters)" autocomplete="new-password" minlength="8" required />
			<input type="password" bind:value={pwConfirm} placeholder="Confirm new password" autocomplete="new-password" minlength="8" required />
			<div class="buttons">
				<button type="button" class="ghost" onclick={() => (pwOpen = false)}>Cancel</button>
				<button type="submit" class="primary" disabled={pwBusy}>{pwBusy ? 'Saving…' : 'Change password'}</button>
			</div>
		</form>
	{:else}
		<button class="row" onclick={() => ((pwOpen = true), (pwMsg = null))}>
			<span class="rowtext"><span class="label">Change password</span></span>
			<span class="chev">›</span>
		</button>
	{/if}
	{#if pwMsg}<p class={pwMsg.ok ? 'hint msg' : 'error'}>{pwMsg.text}</p>{/if}
</section>

<section>
	<div class="buttons">
		<form method="POST" action="/logout"><button class="ghost" type="submit">Sign out</button></form>
		<form method="POST" action="/logout?everywhere=1">
			<button class="ghost" type="submit">Sign out everywhere</button>
		</form>
	</div>
</section>

{:else}
<section>
	<h3>{account.household.name}</h3>
	<ul class="members">
		{#each account.household.members as m (m.id)}
			<li>
				<span class="rowtext">
					<span class="label">{m.name}{m.id === me.id ? ' (you)' : ''}</span>
					<span class="hint">{m.email} · {m.role === 'owner' ? 'Owner' : 'Member'}</span>
				</span>
				{#if isOwner && m.role !== 'owner'}
					{#if confirmRemove === m.id}
						<span class="actions">
							<button class="link danger" onclick={() => remove(m)}>Remove</button>
							<button class="link" onclick={() => (confirmRemove = null)}>Keep</button>
						</span>
					{:else}
						<span class="actions">
							<button class="link" onclick={() => resetLink(m)}>Reset link</button>
							<button class="link" onclick={() => (confirmRemove = m.id)}>Remove</button>
						</span>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>
	{#if confirmRemove !== null}
		<p class="hint msg">Removing someone deletes their Seek account and its links. Their own Floppy and BookOrbit data aren't touched.</p>
	{/if}
	{#if memberMsg}<p class="hint msg">{memberMsg}</p>{/if}
</section>

{#if sharedShows && account.household.members.length > 1}
	<section>
		<h3>Shared shows</h3>
		{#if !sharedShows.mirroring}
			<p class="hint">
				Mark a show <strong>Together</strong> and a play by either of you counts for both — once
				{sharedShows.waitingOn.join(' and ')}
				{sharedShows.waitingOn.length === 1 && sharedShows.waitingOn[0] !== 'you' ? 'links' : 'link'} a Floppy account under Your accounts.
			</p>
		{:else if !sharedShows.shows.length}
			<p class="hint">
				None yet. Mark a show <strong>Together</strong> on its page and plays of it count for you both —
				including ones Jellyfin logs. Episodes one of you has already seen are filled in for the other.
			</p>
		{:else}
			<ul class="members">
				{#each sharedShows.shows as sh (sh.source + sh.mediaId)}
					<li>
						<a class="rowtext" href={`/show/${sh.source}/${sh.mediaId}`}>
							<span class="label">{sh.title ?? `Show ${sh.mediaId}`}</span>
						</a>
						<button class="link" onclick={() => unshareShow(sh)}>Stop sharing</button>
					</li>
				{/each}
			</ul>
			<p class="hint msg">Plays of these count for everyone here. Stopping keeps what's already been shared.</p>
		{/if}
	</section>
{/if}

{#if isOwner}
	<section>
		<h3>Invite someone</h3>
		<form
			class="addrow"
			onsubmit={(e) => {
				e.preventDefault();
				void invite();
			}}
		>
			<input
				type="email"
				bind:value={inviteEmail}
				placeholder="Their email"
				autocapitalize="off"
				autocorrect="off"
				required
			/>
			<button type="submit" disabled={inviteBusy || !inviteEmail.trim()}>{inviteBusy ? '…' : 'Invite'}</button>
		</form>
		{#if inviteMsg}<p class="hint msg">{inviteMsg}</p>{/if}
		{#if !account.mail}
			<p class="hint">Email isn’t set up, so Seek gives you the link to send yourself.</p>
		{/if}
		{#if account.household.invites.length}
			<ul class="members invites">
				{#each account.household.invites as inv (inv.email)}
					<li>
						<span class="rowtext">
							<span class="label">{inv.email}</span>
							<span class="hint">Invited · link expires {expires(inv.expiresAt)}</span>
						</span>
						<button class="link" onclick={() => revoke(inv.email)}>Revoke</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

{#if shared}
	<section class="shared">
		<p class="hint">{shared.label}</p>
		<div class="linkbox">
			<code>{shared.link}</code>
			<button class="primary small" onclick={copyLink}>{copied ? 'Copied' : 'Copy'}</button>
		</div>
	</section>
{/if}
{/if}

<style>
	h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--text-dim); }
	section { margin-bottom: 18px; }

	.row {
		display: flex; align-items: center; justify-content: space-between; gap: 14px;
		width: 100%; min-height: var(--tap); padding: 9px 14px;
		border-radius: var(--radius); background: var(--surface-raised); text-align: left;
	}
	.row.static { margin-top: 8px; }
	.rowtext { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.label { font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
	.hint { font-size: 12px; opacity: 0.7; }
	.msg { margin: 8px 0 0; }
	.chev { color: var(--text-dim); font-size: 16px; }

	input {
		width: 100%; height: 40px; padding: 0 12px;
		border: none; border-radius: var(--radius);
		background: var(--surface-raised); color: var(--text);
		font: inherit; font-size: 16px; outline: none;
		-webkit-appearance: none; appearance: none;
	}
	.addrow { display: flex; gap: 8px; }
	.addrow input { flex: 1; min-width: 0; }
	.addrow button, .primary {
		flex: none; min-height: 40px; padding: 0 16px; border-radius: var(--radius);
		background: var(--signal); color: #fff; font-size: 14px; font-weight: 600;
	}
	.addrow button:disabled, .primary:disabled { opacity: 0.5; }
	.primary.small { min-height: 34px; padding: 0 12px; font-size: 13px; }
	.stack { display: flex; flex-direction: column; gap: 8px; }
	.buttons { display: flex; flex-wrap: wrap; gap: 8px; }
	.buttons form { display: contents; }
	.ghost {
		min-height: 40px; padding: 0 16px; border-radius: var(--radius);
		background: var(--surface-raised); color: var(--text); font-size: 14px; font-weight: 600;
	}
	.link { flex: none; font-size: 13px; font-weight: 600; color: var(--signal-solid); }
	.link.danger { color: #ff8a8a; }

	.members { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
	.members li {
		display: flex; align-items: center; justify-content: space-between; gap: 12px;
		min-height: var(--tap); padding: 9px 14px;
		border-radius: var(--radius); background: var(--surface-raised);
	}
	.invites { margin-top: 10px; }
	.actions { display: flex; gap: 14px; flex: none; }

	.shared { margin-top: -6px; }
	.linkbox {
		display: flex; align-items: center; gap: 8px;
		padding: 8px 8px 8px 12px; border-radius: var(--radius); background: var(--surface-raised);
	}
	.linkbox code {
		flex: 1; min-width: 0; font-size: 12px; overflow-wrap: anywhere;
		user-select: all; -webkit-user-select: all;
	}
	.error { margin: 8px 0 0; font-size: 13px; color: #ff8a8a; }
</style>
