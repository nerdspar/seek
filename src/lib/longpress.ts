/**
 * Long-press, as a Svelte action: `use:longpress={() => openMenu()}`. Hold a
 * finger still for half a second and it fires — with a haptic tick — and the
 * tap that would follow (marking, opening a sheet, following a link) is
 * swallowed, so a hold never does what a tap does. Moving more than a few
 * pixels (a scroll) or lifting early cancels it; a plain tap is untouched.
 */
const HOLD_MS = 500;
const SLOP_PX = 10;

type Point = { clientX: number; clientY: number; button?: number; isPrimary?: boolean };

export function longpress(node: EventTarget, onlong: () => void) {
	let handler = onlong;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let from: Point | null = null;
	let swallowUntil = 0;

	const cancel = () => {
		if (timer) clearTimeout(timer);
		timer = null;
		from = null;
	};
	const down = (e: Event) => {
		const p = e as unknown as Point;
		if (p.isPrimary === false || (p.button ?? 0) !== 0) return;
		cancel();
		from = { clientX: p.clientX, clientY: p.clientY };
		timer = setTimeout(() => {
			timer = null;
			from = null;
			swallowUntil = Date.now() + 800;
			try {
				navigator.vibrate?.(10);
			} catch {
				/* no haptics here */
			}
			handler();
		}, HOLD_MS);
	};
	const move = (e: Event) => {
		if (!from) return;
		const p = e as unknown as Point;
		if (Math.hypot(p.clientX - from.clientX, p.clientY - from.clientY) > SLOP_PX) cancel();
	};
	const click = (e: Event) => {
		if (Date.now() > swallowUntil) return;
		swallowUntil = 0;
		e.preventDefault();
		e.stopImmediatePropagation();
	};
	// The browser's own long-press menu (copy, link preview) would cover ours.
	const menu = (e: Event) => {
		if (timer || Date.now() <= swallowUntil) e.preventDefault();
	};

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', cancel);
	node.addEventListener('pointercancel', cancel);
	node.addEventListener('pointerleave', cancel);
	node.addEventListener('click', click, true);
	node.addEventListener('contextmenu', menu);
	return {
		update(next: () => void) {
			handler = next;
		},
		destroy() {
			cancel();
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', cancel);
			node.removeEventListener('pointercancel', cancel);
			node.removeEventListener('pointerleave', cancel);
			node.removeEventListener('click', click, true);
			node.removeEventListener('contextmenu', menu);
		}
	};
}
