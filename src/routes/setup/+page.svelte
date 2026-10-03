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
	{#if data.missingSessionSecret}
		<p class="error">
			SEEK_SESSION_SECRET isn't set — accounts need it to sign the login cookie. Add it to the
			container environment and restart.
		</p>
	{:else}
		{#if data.missingTokenKey}
			<p class="note">
				Heads up: SEEK_TOKEN_KEY isn't set, so you won't be able to save account links (Floppy,
				BookOrbit) yet. Your existing env settings keep working until you add it.
			</p>
		{/if}
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
			{#if data.needsSetupToken}
				<input
					name="setupToken"
					type="password"
					placeholder="Setup passphrase (SEEK_PASSPHRASE)"
					autocomplete="off"
					required
					disabled={state.busy}
				/>
				<p class="note">The old Seek passphrase — it proves you're the one who deployed this.</p>
			{/if}
			{#if form?.error}<p class="error">{form.error}</p>{/if}
			{#if state.trouble}<p class="error">{state.trouble}</p>{/if}
			<button type="submit" disabled={state.busy}>{state.busy ? 'Creating…' : 'Create account'}</button>
		</form>
	{/if}
</AuthShell>
