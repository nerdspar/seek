<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthShell from '$lib/components/AuthShell.svelte';
	import { authSubmit } from '$lib/authForm';

	let { data, form } = $props();
	const state = $state({ busy: false, trouble: null as string | null });
</script>

{#if !data.invite}
	<AuthShell title="This invite has expired" subtitle="Invite links work once and last 7 days. Ask for a new one.">
		<p class="links"><a href="/login">Sign in instead</a></p>
	</AuthShell>
{:else if data.signedInAs}
	<AuthShell
		title="You're signed in"
		subtitle={`As ${data.signedInAs}. Sign out first to accept this invite for ${data.invite.email}.`}
	>
		<form method="POST" action="/logout?next={encodeURIComponent(data.self)}">
			<button type="submit">Sign out</button>
		</form>
	</AuthShell>
{:else}
	<AuthShell
		title="Join {data.invite.household}"
		subtitle="You're joining as {data.invite.email}. Pick a name and a password."
	>
		<form method="POST" use:enhance={authSubmit(state)}>
			<input name="name" type="text" placeholder="Your name" autocomplete="name" value={form?.name ?? ''} required disabled={state.busy} />
			<input type="email" value={data.invite.email} autocomplete="username" readonly hidden />
			<input name="password" type="password" placeholder="Password (8+ characters)" autocomplete="new-password" minlength="8" required disabled={state.busy} />
			<input name="confirm" type="password" placeholder="Confirm password" autocomplete="new-password" minlength="8" required disabled={state.busy} />
			{#if form?.error}<p class="error">{form.error}</p>{/if}
			{#if state.trouble}<p class="error">{state.trouble}</p>{/if}
			<button type="submit" disabled={state.busy}>{state.busy ? 'Joining…' : 'Join'}</button>
		</form>
	</AuthShell>
{/if}
