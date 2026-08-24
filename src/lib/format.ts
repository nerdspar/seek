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
