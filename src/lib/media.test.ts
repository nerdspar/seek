import { describe, it, expect } from 'vitest';
import { landing, mediaOn } from './media';

describe('media on/off', () => {
	it('reads the three switches; books also need a backend', () => {
		expect(mediaOn({ showsEnabled: true, moviesEnabled: false, booksEnabled: true }, false)).toEqual({ tv: true, movie: false, book: false });
		expect(mediaOn({}, true)).toEqual({ tv: true, movie: true, book: true });
	});

	it('lands where you asked if it is on, else the first kind that is', () => {
		const on = { tv: false, movie: true, book: true };
		expect(landing('tv', on)).toBe('movie');
		expect(landing('book', on)).toBe('book');
		expect(landing(null, { tv: false, movie: false, book: true })).toBe('book');
		expect(landing('movie', { tv: false, movie: false, book: false })).toBe('tv');
	});
});
