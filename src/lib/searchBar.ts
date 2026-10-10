/**
 * When the watchlist's library search gets out of the way by itself: an empty
 * box goes once you scroll the list a little (you've moved on); a box you've
 * typed in stays until you clear it or switch tabs.
 */
export const SCROLL_CLOSE_PX = 40;

export function closesOnScroll(open: boolean, query: string, openedAtY: number, nowY: number): boolean {
	return open && !query.trim() && Math.abs(nowY - openedAtY) > SCROLL_CLOSE_PX;
}

export function closesOnBlur(open: boolean, query: string): boolean {
	return open && !query.trim();
}
