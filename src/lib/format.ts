/** Presentation helpers shared by the row, sheet, show page and season list. */

export const epLabel = (season: number, episode: number) =>
	`S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;

/**
 * Floppy pads a date with no known time as 11:59:59 — roughly 60% of calendar
 * events and many `air_date` values. Rendering that as "11:59 PM" would be
 * wrong, so a time is shown only when one is genuinely known.
 */
export function hasRealAirTime(iso: string): boolean {
	if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false; // date-only
	return !/T11:59:59/.test(iso);
}

export function formatAirDate(iso: string, opts: { withTime?: boolean } = {}): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;

	const datePart = date.toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	});

	if (opts.withTime === false || !hasRealAirTime(iso)) return datePart;
	const timePart = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
	return `${datePart} · ${timePart}`;
}

export function formatRuntime(minutes: number): string {
	if (minutes < 60) return `${minutes} min`;
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Relative marker for the Upcoming rail (§5.2) — "9 Hours", "2 Days".
 * Deliberately coarse: an exact countdown on a release three weeks out is noise,
 * and half of these events have no real time anyway.
 */
export function relativeWhen(iso: string, from: Date = new Date()): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return '';

	const mins = Math.round((then - from.getTime()) / 60000);
	// Nothing useful to say about something already past, and roughly 60% of
	// these have a padded time anyway — "Now" would be asserting more than we know.
	if (mins <= 0) return '';
	if (mins < 60) return `${mins} Min`;

	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours} Hour${hours === 1 ? '' : 's'}`;

	const days = Math.round(hours / 24);
	if (days < 7) return `${days} Day${days === 1 ? '' : 's'}`;

	const weeks = Math.round(days / 7);
	if (days < 30) return `${weeks} Week${weeks === 1 ? '' : 's'}`;

	const months = Math.round(days / 30);
	return `${months} Month${months === 1 ? '' : 's'}`;
}

/** Groups by local calendar day, so the rail reads as a schedule. */
export function dayKey(iso: string): string {
	const d = new Date(iso);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dayLabel(iso: string, from: Date = new Date()): string {
	const d = new Date(iso);
	if (dayKey(iso) === dayKey(from.toISOString())) return 'Today';
	const tomorrow = new Date(from);
	tomorrow.setDate(tomorrow.getDate() + 1);
	if (dayKey(iso) === dayKey(tomorrow.toISOString())) return 'Tomorrow';

	return d.toLocaleDateString(undefined, {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		year: d.getFullYear() === from.getFullYear() ? undefined : 'numeric'
	});
}
