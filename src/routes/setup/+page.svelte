<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthShell from '$lib/components/AuthShell.svelte';
	import { authSubmit } from '$lib/authForm';

	let { data, form } = $props();
	const state = $state({ busy: false, trouble: null as string | null });
</script>

<AuthShell
	title="Set up Seek"
	subtitle="Create the owner account. You'll invite the rest of your household from Settings afterwards."
>
	<form method="POST" use:enhance={authSubmit(state)}>
		<input name="name" type="text" placeholder="Your name" autocomplete="name" value={form?.name ?? ''} required disabled={state.busy} />
		<input
			name="email"
			type="email"
			placeholder="Email"
			autocomplete="username"
			autocapitalize="off"
			autocorrect="off"
			value={form?.email ?? ''}
			required
			disabled={state.busy}
		/>
		<input name="password" type="password" placeholder="Password (8+ characters)" autocomplete="new-password" minlength="8" required disabled={state.busy} />
		<input name="confirm" type="password" placeholder="Confirm password" autocomplete="new-password" minlength="8" required disabled={state.busy} />
		<input
			name="setupToken"
			type={data.passphrase ? 'password' : 'text'}
			placeholder={data.passphrase ? 'Setup code (your old Seek passphrase)' : 'Setup code'}
			autocomplete="off"
			autocapitalize={data.passphrase ? 'off' : 'characters'}
			autocorrect="off"
			spellcheck="false"
			required
			disabled={state.busy}
		/>
		<p class="note">
			{#if data.passphrase}
				Your old Seek passphrase — it proves you're the one who deployed this.
			{:else}
				Find it in Seek's log (TrueNAS → Apps → Seek → Logs): “First-run setup code”. It proves you're
				the one who deployed this.
			{/if}
		</p>
		{#if form?.error}<p class="error">{form.error}</p>{/if}
		{#if state.trouble}<p class="error">{state.trouble}</p>{/if}
		<button type="submit" disabled={state.busy}>{state.busy ? 'Creating…' : 'Create account'}</button>
	</form>
</AuthShell>
