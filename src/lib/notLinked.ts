/** Which account a failed load says this person still needs to link, if any.
 *  Streamed rejections arrive as the serialised App.Error (see handleError). */
export type LinkService = 'bookorbit' | 'hardcover';

export function notLinkedOf(err: unknown): LinkService | null {
	const v = err && typeof err === 'object' ? (err as { notLinked?: unknown }).notLinked : null;
	return v === 'bookorbit' || v === 'hardcover' ? v : null;
}
