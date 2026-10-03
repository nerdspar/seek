<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthShell from '$lib/components/AuthShell.svelte';
	import { authSubmit } from '$lib/authForm';

	let { data, form } = $props();
	const state = $state({ busy: false, trouble: null as string | null });
</script>

{#if !data.mail}
	<AuthShell
		title="Reset your password"
		subtitle={`Email isn't set up on this Seek. Ask ${data.ownerName ?? 'the household owner'} for a reset link — it's in their Settings → Household.`}
	>
		<p class="links"><a href="/login">Back to sign in</a></p>
	</AuthShell>
{:else if form?.sent}
	<AuthShell title="Check your email" subtitle="If that address has a Seek account, a reset link is on its way. It works for an hour.">
		<p class="links"><a href="/login">Back to sign in</a></p>
	</AuthShell>
{:else}
	<AuthShell title="Reset your password" subtitle="We'll email you a link to choose a new one.">
		<form method="POST" use:enhance={authSubmit(state)}>
			<input name="email" type="email" placeholder="Email" autocomplete="username" autocapitalize="off" autocorrect="off" required disabled={state.busy} />
			{#if form?.error}<p class="error">{form.error}</p>{/if}
			{#if state.trouble}<p class="error">{state.trouble}</p>{/if}
			<button type="submit" disabled={state.busy}>{state.busy ? 'Sending…' : 'Send reset link'}</button>
		</form>
		<p class="links"><a href="/login">Back to sign in</a></p>
	</AuthShell>
{/if}
