import { describe, it, expect } from 'vitest';
import { relayRefusal, uploadId } from './http';
import { BookOrbitError } from './bookorbit';

describe('uploadId', () => {
	it('accepts a UUID and refuses anything that could reshape the URL', () => {
		expect(uploadId('6f1c6a3e-0000-4000-8000-000000000001')).toBe('6f1c6a3e-0000-4000-8000-000000000001');
		expect(() => uploadId('../libraries/1')).toThrow();
		expect(() => uploadId('6f1c6a3e-0000-4000-8000-000000000001/complete')).toThrow();
	});
});

describe('relayRefusal', () => {
	it("passes BookOrbit's refusals on with its message, and real failures through", () => {
		expect(() => relayRefusal(new BookOrbitError(422, 'Not a valid EPUB'))).toThrow(
			expect.objectContaining({ status: 400, body: { message: 'Not a valid EPUB' } })
		);
		expect(() => relayRefusal(new BookOrbitError(403, 'No upload permission'))).toThrow(expect.objectContaining({ status: 403 }));
		const boom = new BookOrbitError(502, 'Bad gateway');
		expect(() => relayRefusal(boom)).toThrow(boom);
	});
});
