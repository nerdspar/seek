import { json } from '@sveltejs/kit';
import { catalogStatus } from '$lib/server/catalog/store';
import type { RequestHandler } from './$types';

/** How full and fresh Seek's own show/movie info is (own-tracking plan, step 1). */
export const GET: RequestHandler = async () => json(catalogStatus(Date.now()));
