<script lang="ts">
	import { enhance } from '$app/forms';
	let { form } = $props();

	let busy = $state(false);
	/* A rejected request never reaches `form`, so without this the page would sit
	   there saying nothing at all — which is exactly how it looks when the origin
	   check fails and every submission 403s. Silence reads as a broken app. */
	let trouble = $state<string | null>(null);

	const submit = () => {
		busy = true;
		trouble = null;
		return async ({
			result,
			update
		}: {
			result: { type: string; status?: number };
			update: () => Promise<void>;
		}) => {
			busy = false;
			/* A wrong passphrase and a lockout both come back as `failure` and render
			   through `form`. Anything else means the request never reached the
			   action, and the operator is the one who has to fix it — so say what it
			   almost always is rather than showing a bare status. */
			if (result.type !== 'failure' && result.type !== 'redirect' && result.type !== 'success') {
				trouble =
					'Seek could not process the sign-in. If Seek sits behind a reverse proxy, ORIGIN is probably unset or wrong — see DEPLOY.md.';
			}
			await update();
		};
	};
</script>

<main>
	<h1>Seek</h1>
	<form method="POST" use:enhance={submit}>
		<input
			name="passphrase"
			type="password"
			placeholder="Passphrase"
			autocomplete="current-password"
			autocapitalize="off"
			autocorrect="off"
			disabled={busy}
		/>
		{#if form?.error}<p class="error">{form.error}</p>{/if}
		{#if trouble}<p class="error">{trouble}</p>{/if}
		<button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Unlock'}</button>
	</form>
</main>

<style>
	main {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 20px;
		padding: var(--gutter);
	}
	h1 {
		margin: 0;
		font-size: 26px;
		background: var(--signal);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		width: 100%;
		max-width: 300px;
	}
	input {
		min-height: var(--tap);
		padding: 0 14px;
		border: none;
		border-radius: var(--radius);
		background: var(--surface-raised);
		color: var(--text);
		font: inherit;
	}
	button {
		min-height: var(--tap);
		border-radius: var(--radius);
		background: var(--signal);
		color: #fff;
		font-weight: 600;
	}
	.error {
		margin: 0;
		font-size: 13px;
		color: #ff8a8a;
	}
</style>
