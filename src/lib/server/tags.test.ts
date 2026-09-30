import { describe, it, expect } from 'vitest';
import { companyQuery, animeTagQuery, JOINT_TAG, ANIME_TAG } from './tags';

describe('companyQuery', () => {
	it('joint filters to the joint tag', () => {
		expect(companyQuery('joint')).toEqual({ tag: JOINT_TAG });
	});
	it('solo inverts the joint tag', () => {
		expect(companyQuery('solo')).toEqual({ tag: JOINT_TAG, tag_mode: 'not' });
	});
	it('all applies no filter', () => {
		expect(companyQuery('all')).toEqual({});
	});
});

describe('animeTagQuery', () => {
	it('only keeps the anime-tagged shows', () => {
		expect(animeTagQuery('only')).toEqual({ tag: ANIME_TAG });
	});
	it('hide keeps the rest (inverts the tag)', () => {
		expect(animeTagQuery('hide')).toEqual({ tag: ANIME_TAG, tagMode: 'not' });
	});
	it('all applies no filter', () => {
		expect(animeTagQuery('all')).toEqual({});
	});
});
