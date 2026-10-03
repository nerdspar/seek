<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthShell from '$lib/components/AuthShell.svelte';
	import { authSubmit } from '$lib/authForm';

	let { data, form } = $props();
	const state = $state({ busy: false, trouble: null as string | null });
</script>

{#if !data.reset}
	<AuthShell title="This reset link has expired" subtitle="Reset links work once and last an hour.">
		<p class="links"><a href="/forgot">Get a new link</a><a href="/login">Sign in</a></p>
	</AuthShell>
{:else}
	<AuthShell title="Choose a new password" subtitle="For {data.reset.email}. Other devices will be signed out.">
		<form method="POST" use:enhance={authSubmit(state)}>
			<input type="email" value={data.reset.email} autocomplete="username" readonly hidden />
			<input name="password" type="password" placeholder="New password (8+ characters)" autocomplete="new-password" minlength="8" required disabled={state.busy} />
			<input name="confirm" type="password" placeholder="Confirm password" autocomplete="new-password" minlength="8" required disabled={state.busy} />
			{#if form?.error}<p class="error">{form.error}</p>{/if}
			{#if state.trouble}<p class="error">{state.trouble}</p>{/if}
			<button type="submit" disabled={state.busy}>{state.busy ? 'Saving…' : 'Save password'}</button>
		</form>
	</AuthShell>
{/if}
