<script lang="ts">
	import '../app.css';
	import NavProgress from '$lib/components/NavProgress.svelte';
	let { children } = $props();
</script>

<NavProgress />
{@render children()}
