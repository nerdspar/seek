<script lang="ts">
	/** A search box with a clear (×) button on the right, shown once there's text.
	 *  Clearing empties the box, keeps the keyboard up, and tells the page via
	 *  `onclear` so it can drop its results. */
	type Props = {
		value: string;
		placeholder?: string;
		oninput?: () => void;
		onclear?: () => void;
		onsubmit?: () => void;
		onblur?: () => void;
		/** The input itself, for a page that must focus it inside a tap (iOS only
		 *  raises the keyboard for a focus made during the tap). */
		input?: HTMLInputElement;
	};
	let { value = $bindable(''), placeholder = 'Search', oninput, onclear, onsubmit, onblur, input = $bindable() }: Props = $props();

	function clear() {
		value = '';
		onclear?.();
		input?.focus();
	}
</script>

<form
	class="field"
	role="search"
	onsubmit={(e) => {
		e.preventDefault();
		onsubmit?.();
		input?.blur();
	}}
>
	<input
		bind:this={input}
		bind:value
		type="search"
		{placeholder}
		{oninput}
		{onblur}
		autocapitalize="off"
		autocorrect="off"
		enterkeyhint="search"
	/>
	{#if value}
		<button type="button" class="clear" aria-label="Clear search" onclick={clear}>
			<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
		</button>
	{/if}
</form>

<style>
	.field { position: relative; }
	input {
		width: 100%; height: var(--tap); padding: 0 44px 0 14px;
		border: none; border-radius: var(--radius);
		background: var(--surface); color: var(--text);
		font: inherit; font-size: 16px; outline: none;
		-webkit-appearance: none; appearance: none;
	}
	input::-webkit-search-cancel-button { display: none; }
	/* A full-size tap target around a small glyph. */
	.clear {
		position: absolute; top: 50%; right: 6px; transform: translateY(-50%);
		display: grid; place-items: center; width: 34px; height: 34px;
	}
	.clear svg {
		box-sizing: content-box; padding: 5px; border-radius: 50%;
		background: var(--surface-raised); color: var(--text-dim);
	}
</style>
