<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthShell from '$lib/components/AuthShell.svelte';
	import { authSubmit } from '$lib/authForm';

	let { data, form } = $props();
	const state = $state({ busy: false, trouble: null as string | null });
</script>

<AuthShell>
	<form method="POST" use:enhance={authSubmit(state)}>
		<input type="hidden" name="next" value={data.next} />
		<input
			name="email"
			type="email"
			placeholder="Email"
			autocomplete="username"
			autocapitalize="off"
			autocorrect="off"
			value={form?.email ?? ''}
			disabled={state.busy}
			required
		/>
		<input
			name="password"
			type="password"
			placeholder="Password"
			autocomplete="current-password"
			disabled={state.busy}
			required
		/>
		{#if form?.error}<p class="error">{form.error}</p>{/if}
		{#if state.trouble}<p class="error">{state.trouble}</p>{/if}
		<button type="submit" disabled={state.busy}>{state.busy ? 'Signing in…' : 'Sign in'}</button>
	</form>
	<p class="links"><a href="/forgot">Forgot password?</a></p>
</AuthShell>
