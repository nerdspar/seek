/**
 * The household's service settings — what used to be compose-file env vars,
 * now set by the owner in Settings → Services. Client-safe (labels and shape
 * only); values live server-side in server/services.ts. Keys keep their old env
 * names so an existing deployment's values are recognised and copied over.
 */
export type ServiceKey =
	| 'FLOPPY_URL'
	| 'FLOPPY_PUBLIC_URL'
	| 'TMDB_API_KEY'
	| 'BOOKORBIT_URL'
	| 'HARDCOVER_TOKEN'
	| 'SONARR_URL'
	| 'SONARR_API_KEY'
	| 'RADARR_URL'
	| 'RADARR_API_KEY'
	| 'JELLYFIN_URL'
	| 'JELLYFIN_API_KEY'
	| 'JELLYFIN_ANIME_LIBRARY'
	| 'RESEND_API_KEY'
	| 'MAIL_FROM';

export type ServiceField = {
	key: ServiceKey;
	label: string;
	/** Stored encrypted; shown only as "set", never sent back to the browser. */
	secret?: boolean;
	kind?: 'url' | 'text';
	placeholder?: string;
	hint?: string;
};

export type ServiceGroup = {
	id: string;
	title: string;
	about: string;
	fields: ServiceField[];
	/** What must be set for the service to count as set up. */
	needs: ServiceKey[];
	/** What the Test button says (email's sends a real message). */
	testLabel?: string;
};

export const SERVICE_GROUPS: ServiceGroup[] = [
	{
		id: 'floppy',
		needs: ['FLOPPY_URL'],
		title: 'Floppy',
		about: 'Your TV and movie tracker. Each person links their own Floppy token under Your accounts.',
		fields: [
			{
				key: 'FLOPPY_URL',
				label: 'Address',
				kind: 'url',
				placeholder: 'http://10.0.1.14:8007',
				hint: 'How Seek reaches Floppy (a LAN address is fine).'
			},
			{
				key: 'FLOPPY_PUBLIC_URL',
				label: 'Address from your phone',
				kind: 'url',
				placeholder: 'https://floppy.example.com',
				hint: 'Optional — for the "Open in Floppy" links.'
			}
		]
	},
	{
		id: 'tmdb',
		needs: ['TMDB_API_KEY'],
		title: 'TMDB',
		about: 'Artwork, cast, recommendations and Discover for shows and movies.',
		fields: [{ key: 'TMDB_API_KEY', label: 'API key', secret: true, hint: 'themoviedb.org → Settings → API.' }]
	},
	{
		id: 'books',
		needs: ['BOOKORBIT_URL', 'HARDCOVER_TOKEN'],
		title: 'Books',
		about: 'BookOrbit is your library; Hardcover powers book discovery. Each person links their own BookOrbit login under Your accounts.',
		fields: [
			{ key: 'BOOKORBIT_URL', label: 'BookOrbit address', kind: 'url', placeholder: 'https://bookorbit.example.com' },
			{
				key: 'HARDCOVER_TOKEN',
				label: 'Hardcover token',
				secret: true,
				hint: 'hardcover.app → Settings → API. One for the household — it only searches the catalog.'
			}
		]
	},
	{
		id: 'sonarr',
		needs: ['SONARR_URL', 'SONARR_API_KEY'],
		title: 'Sonarr',
		about: 'Optional — add shows to Sonarr and manage downloads.',
		fields: [
			{ key: 'SONARR_URL', label: 'Address', kind: 'url', placeholder: 'http://10.0.1.14:8989' },
			{ key: 'SONARR_API_KEY', label: 'API key', secret: true }
		]
	},
	{
		id: 'radarr',
		needs: ['RADARR_URL', 'RADARR_API_KEY'],
		title: 'Radarr',
		about: 'Optional — add movies to Radarr and manage downloads.',
		fields: [
			{ key: 'RADARR_URL', label: 'Address', kind: 'url', placeholder: 'http://10.0.1.14:7878' },
			{ key: 'RADARR_API_KEY', label: 'API key', secret: true }
		]
	},
	{
		id: 'jellyfin',
		needs: ['JELLYFIN_URL', 'JELLYFIN_API_KEY'],
		title: 'Jellyfin',
		about: 'Optional — its Anime library decides which shows count as anime.',
		fields: [
			{ key: 'JELLYFIN_URL', label: 'Address', kind: 'url', placeholder: 'http://10.0.1.14:8096' },
			{ key: 'JELLYFIN_API_KEY', label: 'API key', secret: true },
			{ key: 'JELLYFIN_ANIME_LIBRARY', label: 'Anime library name', placeholder: 'Anime' }
		]
	},
	{
		id: 'email',
		needs: ['RESEND_API_KEY', 'MAIL_FROM'],
		testLabel: 'Send me a test email',
		title: 'Email',
		about: 'Optional — send invites and password resets by email (Resend). Without it, Seek gives you the links to pass on.',
		fields: [
			{ key: 'RESEND_API_KEY', label: 'Resend API key', secret: true },
			{ key: 'MAIL_FROM', label: 'From', placeholder: 'Seek <seek@example.com>', hint: 'Must be on a domain verified in Resend.' }
		]
	}
];

export const SERVICE_FIELDS: ServiceField[] = SERVICE_GROUPS.flatMap((g) => g.fields);
export const SERVICE_KEYS = new Set<string>(SERVICE_FIELDS.map((f) => f.key));
