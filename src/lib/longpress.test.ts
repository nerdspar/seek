import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { longpress } from './longpress';

const fire = (node: EventTarget, type: string, props: Record<string, unknown> = {}) => {
	const e = Object.assign(new Event(type, { cancelable: true }), { clientX: 0, clientY: 0, button: 0, isPrimary: true, ...props });
	node.dispatchEvent(e);
	return e;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('long-press', () => {
	it('fires after holding still, and swallows the tap that follows', () => {
		const node = new EventTarget();
		const onlong = vi.fn();
		const tapped = vi.fn();
		longpress(node, onlong);
		// In the page the tap lands on a button inside the row, after the row's
		// capture listener; a flat EventTarget runs listeners in the order added.
		node.addEventListener('click', tapped);
		fire(node, 'pointerdown');
		vi.advanceTimersByTime(499);
		expect(onlong).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(onlong).toHaveBeenCalledTimes(1);
		fire(node, 'pointerup');
		const click = fire(node, 'click');
		expect(click.defaultPrevented).toBe(true);
		expect(tapped).not.toHaveBeenCalled();
	});

	it('a plain tap is a tap', () => {
		const node = new EventTarget();
		const onlong = vi.fn();
		const tapped = vi.fn();
		node.addEventListener('click', tapped);
		longpress(node, onlong);
		fire(node, 'pointerdown');
		vi.advanceTimersByTime(150);
		fire(node, 'pointerup');
		fire(node, 'click');
		vi.advanceTimersByTime(1000);
		expect(onlong).not.toHaveBeenCalled();
		expect(tapped).toHaveBeenCalledTimes(1);
	});

	it('scrolling (moving past a few pixels) cancels it; a wobble does not', () => {
		const node = new EventTarget();
		const onlong = vi.fn();
		longpress(node, onlong);
		fire(node, 'pointerdown', { clientX: 100, clientY: 100 });
		fire(node, 'pointermove', { clientX: 104, clientY: 103 });
		vi.advanceTimersByTime(500);
		expect(onlong).toHaveBeenCalledTimes(1);
		fire(node, 'pointerdown', { clientX: 100, clientY: 100 });
		fire(node, 'pointermove', { clientX: 100, clientY: 140 });
		vi.advanceTimersByTime(1000);
		expect(onlong).toHaveBeenCalledTimes(1);
	});

	it('ignores a second finger or a right click, and stops when destroyed', () => {
		const node = new EventTarget();
		const onlong = vi.fn();
		const action = longpress(node, onlong);
		fire(node, 'pointerdown', { isPrimary: false });
		fire(node, 'pointerdown', { button: 2 });
		vi.advanceTimersByTime(1000);
		expect(onlong).not.toHaveBeenCalled();
		fire(node, 'pointerdown');
		action.destroy();
		vi.advanceTimersByTime(1000);
		expect(onlong).not.toHaveBeenCalled();
	});
});
