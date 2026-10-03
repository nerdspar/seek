/**
 * Upcoming's three kinds of row — episodes (the Floppy calendar), films
 * (theater / digital dates) and books (release dates) — merged into one
 * timeline and filtered by kind. Client-safe.
 */
import type { UpcomingItem } from '$lib/types';

export type UpcomingKind = 'tv' | 'movie' | 'book';
export type UpcomingKinds = Record<UpcomingKind, boolean>;
export const ALL_KINDS: UpcomingKinds = { tv: true, movie: true, book: true };

export function kindOf(item: UpcomingItem): UpcomingKind {
	if (item.kind === 'book') return 'book';
	if (item.kind === 'movie' || (item.kind === undefined && item.mediaType === 'movie')) return 'movie';
	return 'tv';
}

const day = (iso: string) => iso.slice(0, 10);

/** The calendar plus films and books, in time order, filtered by kind. A film
 *  the calendar already lists for that day isn't repeated. */
export function mergeUpcoming(calendar: UpcomingItem[], extras: UpcomingItem[], kinds: UpcomingKinds = ALL_KINDS): UpcomingItem[] {
	const onCalendar = new Set(calendar.filter((i) => i.mediaId).map((i) => `${i.mediaId}:${day(i.start)}`));
	const merged = [...calendar, ...extras.filter((e) => !(e.mediaId && onCalendar.has(`${e.mediaId}:${day(e.start)}`)))];
	return merged.filter((i) => kinds[kindOf(i)]).sort((a, b) => a.start.localeCompare(b.start));
}

export const kindsFiltered = (k: UpcomingKinds) => !k.tv || !k.movie || !k.book;
