import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startLiveRefresh } from './liveRefresh';

function fakeDoc() {
	const listeners = new Set<() => void>();
	return {
		visibilityState: 'visible' as DocumentVisibilityState,
		addEventListener: (_: string, fn: () => void) => void listeners.add(fn),
		removeEventListener: (_: string, fn: () => void) => void listeners.delete(fn),
		show() {
			this.visibilityState = 'visible';
			for (const fn of listeners) fn();
		},
		hide() {
			this.visibilityState = 'hidden';
			for (const fn of listeners) fn();
		}
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('live refresh', () => {
	it('re-reads on coming back to the app and on a timer while on screen', () => {
		const doc = fakeDoc();
		const refresh = vi.fn();
		startLiveRefresh({ refresh, busy: () => false, everyMs: 1000, doc: doc as never });
		doc.hide();
		vi.advanceTimersByTime(3000);
		expect(refresh).not.toHaveBeenCalled(); // backgrounded: nothing
		doc.show();
		expect(refresh).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(1000);
		expect(refresh).toHaveBeenCalledTimes(2);
	});

	it('waits while a mark or undo is in progress, and stops when the screen goes', () => {
		const doc = fakeDoc();
		const refresh = vi.fn();
		let busy = true;
		const stop = startLiveRefresh({ refresh, busy: () => busy, everyMs: 1000, doc: doc as never });
		vi.advanceTimersByTime(1000);
		expect(refresh).not.toHaveBeenCalled();
		busy = false;
		vi.advanceTimersByTime(1000);
		expect(refresh).toHaveBeenCalledTimes(1);
		stop();
		vi.advanceTimersByTime(5000);
		doc.show();
		expect(refresh).toHaveBeenCalledTimes(1);
	});
});
