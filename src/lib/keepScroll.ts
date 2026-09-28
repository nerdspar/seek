/**
 * Preserve a scroll container's vertical position across navigation.
 *
 * With the chrome shell (docs/pwa-chrome-spec.md) the scroll lives in `<main>`,
 * not the window — so SvelteKit's own scroll restoration (which only knows the
 * window) no longer applies. This action stands in for it: it remembers each
 * keyed container's offset and reapplies it when the container mounts, retrying
 * briefly because a page's content streams in and may not be tall enough to hold
 * the offset on the first frame.
 *
 * Keyed by a caller-supplied string (a route is the natural key), stored in a
 * module map so it survives the component unmount/remount a back-navigation
 * causes, for this session.
 */
const positions = new Map<string, number>();

export function keepScroll(node: HTMLElement, key: string) {
	let k = key;
	const save = () => {
		positions.set(k, node.scrollTop);
	};
	let tries = 0;
	const apply = () => {
		const want = positions.get(k);
		if (want && node.scrollHeight > node.clientHeight + 4) {
			node.scrollTop = want;
			if (Math.abs(node.scrollTop - want) < 2) return;
		}
		if (tries++ < 40) requestAnimationFrame(apply);
	};
	requestAnimationFrame(apply);
	node.addEventListener('scroll', save, { passive: true });

	return {
		update(next: string) {
			k = next;
		},
		destroy() {
			node.removeEventListener('scroll', save);
		}
	};
}
