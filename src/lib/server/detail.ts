/**
 * Show, season, episode and film detail (§4.4, §6.1), from Seek's own data:
 * your plays from Seek's tables, everything else from Seek's TMDB copy (see
 * tracking/detail.ts). Same exports the pages have always used.
 */
import { error } from '@sveltejs/kit';
import { db } from './db';
import { currentUser } from './userctx';
import { tmdbIdOf } from './tracking/write';
import { seekEpisode, seekMovie, seekSeason, seekShow } from './tracking/detail';
import type { EpisodeDetail, MovieDetail, SeasonDetail, ShowDetail } from '$lib/types';

function ids(source: string, mediaId: string): { userId: number; id: number } {
	const id = tmdbIdOf(source, mediaId);
	if (id === null) error(404, 'Only TMDB titles are supported');
	return { userId: currentUser()?.id ?? 0, id };
}

const found = <T>(v: T | null): T => {
	if (v === null) error(404, 'Not found');
	return v;
};

export async function getMovie(source: string, mediaId: string): Promise<MovieDetail> {
	const { userId, id } = ids(source, mediaId);
	return found(await seekMovie(userId, id));
}

export async function getShow(source: string, mediaId: string): Promise<ShowDetail> {
	const { userId, id } = ids(source, mediaId);
	return found(await seekShow(userId, id));
}

export async function getSeason(source: string, mediaId: string, seasonNumber: number): Promise<SeasonDetail> {
	const { userId, id } = ids(source, mediaId);
	return found(await seekSeason(userId, id, seasonNumber));
}

export async function getEpisode(source: string, mediaId: string, seasonNumber: number, episodeNumber: number): Promise<EpisodeDetail> {
	const { userId, id } = ids(source, mediaId);
	return found(await seekEpisode(userId, id, seasonNumber, episodeNumber));
}

/** A show's name, from Seek's TMDB copy. */
export async function showTitle(source: string, mediaId: string): Promise<string | null> {
	const id = tmdbIdOf(source, mediaId);
	if (id === null) return null;
	const r = db().prepare("SELECT title FROM titles WHERE media_type = 'tv' AND tmdb_id = ?").get(id) as { title: string } | undefined;
	return r?.title || null;
}
