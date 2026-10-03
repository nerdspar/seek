import { describe, it, expect, vi } from 'vitest';
import { uploadFile, precheck, extOf, type UploadSession } from './upload';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const bad = (status: number, message: string) => new Response(JSON.stringify({ message }), { status });
const sess = (received: number, status: UploadSession['status'] = 'receiving', extra: Partial<UploadSession> = {}): UploadSession => ({
	id: 'u1',
	filename: 'dune.epub',
	size: 10,
	received,
	status,
	error: null,
	bookId: null,
	...extra
});
const file = () => new File([new TextEncoder().encode('0123456789')], 'dune.epub');

describe('precheck', () => {
	it('catches wrong formats, empty and oversized files up front', () => {
		expect(extOf('Dune.EPUB')).toBe('epub');
		expect(precheck({ name: 'a.epub', size: 5 }, ['epub'], 100)).toBeNull();
		expect(precheck({ name: 'a.docx', size: 5 }, ['epub'], 100)).toMatch(/\.docx isn't/);
		expect(precheck({ name: 'a.epub', size: 0 }, ['epub'], 100)).toMatch(/empty/);
		expect(precheck({ name: 'a.epub', size: 3 * 1024 * 1024 }, ['epub'], 1024 * 1024)).toMatch(/limit is 1 MB/);
	});
});

describe('uploadFile', () => {
	it('sends the file in chunks at the right offsets, completes, and waits for the import', async () => {
		const f = vi
			.fn()
			.mockResolvedValueOnce(ok(sess(0)))
			.mockResolvedValueOnce(ok(sess(4)))
			.mockResolvedValueOnce(ok(sess(8)))
			.mockResolvedValueOnce(ok(sess(10)))
			.mockResolvedValueOnce(ok(sess(10, 'processing')))
			.mockResolvedValueOnce(ok(sess(10, 'completed', { bookId: 77 })));
		const seen: string[] = [];
		const out = await uploadFile(file(), { kind: 'library', libraryId: 3 }, {
			chunkBytes: 4,
			fetch: f,
			pollMs: 0,
			onProgress: (p) => seen.push(`${p.phase}:${p.sent}`)
		});
		expect(out).toMatchObject({ phase: 'done', bookId: 77 });
		const chunks = f.mock.calls.filter((c) => String(c[0]).endsWith('/chunks'));
		expect(chunks.map((c) => c[1].headers['upload-offset'])).toEqual(['0', '4', '8']);
		expect(await Promise.all(chunks.map((c) => (c[1].body as Blob).text()))).toEqual(['0123', '4567', '89']);
		expect(seen).toEqual(['sending:0', 'sending:4', 'sending:8', 'sending:10', 'importing:10', 'done:10']);
	});

	it('after a dropped connection, resumes from what BookOrbit actually received', async () => {
		const f = vi
			.fn()
			.mockResolvedValueOnce(ok(sess(0)))
			.mockRejectedValueOnce(new TypeError('Load failed')) // chunk 0 "fails"…
			.mockResolvedValueOnce(ok(sess(4))) // …but the probe shows it arrived
			.mockResolvedValueOnce(ok(sess(8)))
			.mockResolvedValueOnce(ok(sess(10)))
			.mockResolvedValueOnce(ok(sess(10, 'completed')));
		const out = await uploadFile(file(), { kind: 'book_dock' }, { chunkBytes: 4, fetch: f, onProgress: () => {} });
		expect(out.phase).toBe('done');
		const offsets = f.mock.calls.filter((c) => String(c[0]).endsWith('/chunks')).map((c) => c[1].headers['upload-offset']);
		expect(offsets).toEqual(['0', '4', '8']);
	});

	it("stops on a refusal and says BookOrbit's reason", async () => {
		const f = vi.fn().mockResolvedValueOnce(bad(400, 'This library does not accept pdf files'));
		const out = await uploadFile(file(), { kind: 'library', libraryId: 3 }, { chunkBytes: 4, fetch: f, onProgress: () => {} });
		expect(out).toMatchObject({ phase: 'failed', error: 'This library does not accept pdf files' });
	});

	it('does not retry a chunk BookOrbit refused', async () => {
		const f = vi
			.fn()
			.mockResolvedValueOnce(ok(sess(0)))
			.mockResolvedValueOnce(bad(409, 'Upload offset mismatch'))
			.mockResolvedValueOnce(ok(sess(0))); // probe: still at 0
		const out = await uploadFile(file(), { kind: 'library', libraryId: 3 }, { chunkBytes: 4, fetch: f, onProgress: () => {} });
		expect(out).toMatchObject({ phase: 'failed', error: 'Upload offset mismatch', sent: 0 });
		expect(f.mock.calls.filter((c) => String(c[0]).endsWith('/chunks'))).toHaveLength(1);
	});

	it('reports a failed import', async () => {
		const f = vi
			.fn()
			.mockResolvedValueOnce(ok(sess(0)))
			.mockResolvedValueOnce(ok(sess(10)))
			.mockResolvedValueOnce(ok(sess(10, 'failed', { error: 'Not a valid EPUB' })));
		const out = await uploadFile(file(), { kind: 'library', libraryId: 3 }, { chunkBytes: 16, fetch: f, onProgress: () => {} });
		expect(out).toMatchObject({ phase: 'failed', error: 'Not a valid EPUB' });
	});
});
