/**
 * Floppy's calendar feed (§5.1). Not on /api/v1/ — it lives at
 * /calendar/download/{token} and the token is itself the credential, so the URL
 * never leaves the server.
 *
 * The feed is deliberately thin. Every event carries only:
 *
 *     SUMMARY:House of the Dragon Season 3 S3 E6
 *     DTSTART:20260727T010000Z
 *     UID:8603
 *
 * No poster, no synopsis, and UID is a Floppy row id rather than a TMDB id — so
 * artwork and links have to be recovered by matching the title back to the
 * library. See upcoming.ts.
 */

export type IcalEvent = {
	/** Show title with any trailing "Season N" and "Sx Ey" stripped. */
	title: string;
	season: number | null;
	episode: number | null;
	/** UTC instant. */
	start: string;
	/** False when Floppy padded a date it has no time for (see hasRealAirTime). */
	hasTime: boolean;
	uid: string;
};

/**
 * Reverses RFC 5545 TEXT escaping. Commas, semicolons and backslashes are
 * escaped in the feed, so "Life\, Larry and the Pursuit of Unhappiness" arrives
 * with a literal backslash and fails to match the library title. This was the
 * single mismatch out of 163 events before it was handled.
 */
function unescapeText(value: string): string {
	return value
		.replace(/\\n/gi, '\n')
		.replace(/\\([,;\\])/g, '$1');
}

/** Unfolds RFC 5545 line continuations, which begin with a space or tab. */
function unfold(text: string): string {
	return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}

/** `20260727T010000Z` → ISO. Also accepts date-only `20260727`. */
function parseIcalDate(raw: string): { iso: string; hasTime: boolean } | null {
	const v = raw.trim();
	const dt = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
	if (dt) {
		const [, y, mo, d, h, mi, s, z] = dt;
		// 11:59:59 is Floppy's marker for "date known, time not" — roughly 60% of
		// this feed. Surfacing it as an air time would be wrong (§5.2).
		const hasTime = !(h === '11' && mi === '59' && s === '59');
		const iso = z
			? `${y}-${mo}-${d}T${h}:${mi}:${s}Z`
			: `${y}-${mo}-${d}T${h}:${mi}:${s}`;
		const parsed = new Date(iso);
		if (Number.isNaN(parsed.getTime())) return null;
		return { iso: parsed.toISOString(), hasTime };
	}

	const dateOnly = v.match(/^(\d{4})(\d{2})(\d{2})$/);
	if (dateOnly) {
		const [, y, mo, d] = dateOnly;
		const parsed = new Date(`${y}-${mo}-${d}T00:00:00Z`);
		if (Number.isNaN(parsed.getTime())) return null;
		return { iso: parsed.toISOString(), hasTime: false };
	}

	return null;
}

/**
 * Splits "Title Season 3 S3 E6" into its parts.
 *
 * The "Season N" segment is optional and redundant with the SxEy that follows,
 * so it is dropped. Titles containing digits survive because only a trailing
 * `S<n> E<n>` is consumed.
 */
export function parseSummary(summary: string): { title: string; season: number | null; episode: number | null } {
	const m = summary.match(/^(.*?)\s+S(\d+)\s*E(\d+)\s*$/);
	if (!m) return { title: summary.trim(), season: null, episode: null };

	const [, head, s, e] = m;
	return {
		title: head.replace(/\s+Season\s+\d+\s*$/i, '').trim(),
		season: Number(s),
		episode: Number(e)
	};
}

export function parseIcal(text: string): IcalEvent[] {
	const body = unfold(text);
	const out: IcalEvent[] = [];

	for (const block of body.split('BEGIN:VEVENT').slice(1)) {
		const chunk = block.split('END:VEVENT')[0];
		const field = (name: string) => {
			// Property parameters (e.g. DTSTART;VALUE=DATE:) sit before the colon.
			const m = chunk.match(new RegExp(`^${name}(?:;[^:\\n]*)?:(.*)$`, 'm'));
			return m ? m[1].trim() : null;
		};

		const summary = field('SUMMARY');
		const dtstart = field('DTSTART');
		if (!summary || !dtstart) continue;

		const when = parseIcalDate(dtstart);
		if (!when) continue;

		const { title, season, episode } = parseSummary(unescapeText(summary));
		out.push({ title, season, episode, start: when.iso, hasTime: when.hasTime, uid: field('UID') ?? '' });
	}

	return out.sort((a, b) => a.start.localeCompare(b.start));
}
