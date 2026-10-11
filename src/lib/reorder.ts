/**
 * Drag to reorder a vertical list, on touch or mouse (Pointer Events, so it
 * works on iOS where HTML5 drag-and-drop does not). The action goes on the list
 * container; each item carries `data-reorder` and holds a grab handle marked
 * `data-handle`. As the dragged item passes a neighbour's midpoint, `onmove`
 * fires — reorder your array there and the keyed list reflows under the finger;
 * `ondrop` fires once on release, to persist the new order.
 *
 * Give the handle `touch-action: none` so dragging doesn't scroll the page.
 */
export function reorderable(
	node: HTMLElement,
	opts: { onmove: (from: number, to: number) => void; ondrop?: () => void }
) {
	let options = opts;
	let dragging: HTMLElement | null = null;
	let pointerId = -1;

	const items = () => [...node.querySelectorAll<HTMLElement>('[data-reorder]')];

	function down(e: PointerEvent) {
		const target = e.target as HTMLElement | null;
		const handle = target?.closest('[data-handle]');
		if (!handle || !node.contains(handle)) return;
		const item = handle.closest<HTMLElement>('[data-reorder]');
		if (!item) return;
		e.preventDefault();
		dragging = item;
		pointerId = e.pointerId;
		item.setPointerCapture(e.pointerId);
		item.classList.add('dragging');
		item.addEventListener('pointermove', move);
		item.addEventListener('pointerup', up);
		item.addEventListener('pointercancel', up);
	}

	function move(e: PointerEvent) {
		if (!dragging) return;
		const list = items();
		const from = list.indexOf(dragging);
		if (from === -1) return;
		const above = list[from - 1];
		const below = list[from + 1];
		if (above) {
			const r = above.getBoundingClientRect();
			if (e.clientY < r.top + r.height / 2) {
				options.onmove(from, from - 1);
				return;
			}
		}
		if (below) {
			const r = below.getBoundingClientRect();
			if (e.clientY > r.top + r.height / 2) {
				options.onmove(from, from + 1);
				return;
			}
		}
	}

	function up() {
		if (!dragging) return;
		const el = dragging;
		dragging = null;
		el.classList.remove('dragging');
		try {
			el.releasePointerCapture(pointerId);
		} catch {
			/* already released */
		}
		el.removeEventListener('pointermove', move);
		el.removeEventListener('pointerup', up);
		el.removeEventListener('pointercancel', up);
		options.ondrop?.();
	}

	node.addEventListener('pointerdown', down);
	return {
		update(next: typeof opts) {
			options = next;
		},
		destroy() {
			node.removeEventListener('pointerdown', down);
			up();
		}
	};
}
