import { describe, it, expect } from 'vitest';
import { describeWrite, rejectionNotice, replay, type Parked } from './queueReplay';

const body = (o: Record<string, unknown>) => JSON.stringify({ source: 'tmdb', mediaId: '95396', ...o });

describe('describeWrite', () => {
	it('says what a parked write was, in words, and which title it touched', () => {
		expect(describeWrite({ url: '/api/watch', method: 'POST', body: body({ title: 'Severance', season: 1, episode: 3 }) })).toEqual({
			label: 'mark Severance S1E3 watched',
			source: 'tmdb',
			mediaId: '95396'
		});
		expect(describeWrite({ url: '/api/watch', method: 'DELETE', body: body({ title: 'Dune', mediaType: 'movie' }) }).label).toBe('unmark Dune watched');
		expect(describeWrite({ url: '/api/season', method: 'POST', body: body({ season: 2 }), about: 'Severance' }).label).toBe('mark season 2 of Severance');
		expect(describeWrite({ url: '/api/library', method: 'DELETE', body: body({}), about: 'Dune' }).label).toBe('remove Dune from your list');
		expect(describeWrite({ url: '/api/library', method: 'POST', body: body({ title: 'Dune' }) }).label).toBe('add Dune to your list');
		expect(describeWrite({ url: '/api/tags', method: 'POST', body: body({ title: 'Dune', joint: true }) }).label).toBe('change who you watch Dune with');
		expect(describeWrite({ url: '/api/tracking', method: 'POST', body: body({ status: 2 }), about: 'Dune' }).label).toBe('update Dune');
	});

	it('copes with a write it does not know, or a body that is not JSON', () => {
		expect(describeWrite({ url: '/api/other', method: 'POST', body: 'x' })).toEqual({ label: 'save a change made offline', source: null, mediaId: null });
		expect(describeWrite({ url: '/api/watch', method: 'POST', body: null }).label).toBe('mark a title watched');
	});
});

describe('replay', () => {
	const entry = (target: string, at: number, url = '/api/watch'): Parked => ({
		target,
		key: `k-${target}`,
		at,
		url,
		method: 'POST',
		body: body({ title: target, season: 1, episode: at })
	});
	const reply = (status: number, message?: string) =>
		new Response(message ? JSON.stringify({ message }) : null, { status, headers: { 'content-type': 'application/json' } });

	it('sends oldest first; a landed or turned-down write leaves the queue, and the turned-down ones are reported', async () => {
		const sent: string[] = [];
		const left: string[] = [];
		const answers: Record<string, Response> = { a: reply(200), b: reply(404, 'Episode not found'), c: reply(200) };
		const rejected = await replay(
			[entry('c', 3), entry('a', 1), entry('b', 2)],
			async (e) => (sent.push(e.target), answers[e.target]),
			async (e) => void left.push(e.target)
		);
		expect(sent).toEqual(['a', 'b', 'c']);
		expect(left).toEqual(['a', 'b', 'c']);
		expect(rejected.map((r) => [r.entry.target, r.reason])).toEqual([['b', 'Episode not found']]);
		expect(rejectionNotice(rejected)).toBe('Couldn’t mark b S1E2 watched: Episode not found. Showing what Seek has now.');
	});

	it('stops on a server error or no network, keeping the rest in order for next time', async () => {
		const left: string[] = [];
		await replay([entry('a', 1), entry('b', 2)], async () => reply(502), async (e) => void left.push(e.target));
		expect(left).toEqual([]);
		await replay(
			[entry('a', 1), entry('b', 2)],
			async (e) => {
				if (e.target === 'b') throw new TypeError('offline');
				return reply(200);
			},
			async (e) => void left.push(e.target)
		);
		expect(left).toEqual(['a']);
	});

	it('one notice for several, with the server status when it gave no reason', async () => {
		const rejected = await replay([entry('a', 1), entry('b', 2, '/api/library')], async () => reply(409), async () => {});
		expect(rejectionNotice(rejected)).toBe('Couldn’t mark a S1E1 watched (and 1 more): HTTP 409. Showing what Seek has now.');
	});
});
