<script lang="ts">
	import { enhance } from '$app/forms';
	let { form } = $props();
</script>

<main>
	<h1>Seek</h1>
	<form method="POST" use:enhance>
		<input
			name="passphrase"
			type="password"
			placeholder="Passphrase"
			autocomplete="current-password"
			autocapitalize="off"
			autocorrect="off"
		/>
		{#if form?.error}<p class="error">{form.error}</p>{/if}
		<button type="submit">Unlock</button>
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
