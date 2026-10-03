import { json, error } from '@sveltejs/kit';
import { lastSend, listDevices, sendToDevice } from '$lib/server/books/bookorbit';
import { relayRefusal } from '$lib/server/books/http';
import type { RequestHandler } from './$types';

const bookIdOf = (v: unknown) => {
	const id = Number(v);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Bad book id.');
	return id;
};

/** Your devices (BookOrbit email recipients) and how this book's last send went. */
export const GET: RequestHandler = async ({ url }) => {
	const bookId = bookIdOf(url.searchParams.get('bookId'));
	const [devices, last] = await Promise.all([
		listDevices().catch(relayRefusal),
		lastSend(bookId).catch(() => null)
	]);
	return json({ devices, last });
};

/** Send a book you own to one of your devices. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const bookId = bookIdOf(body.bookId);
	const deviceId = Number(body.deviceId);
	if (!Number.isInteger(deviceId) || deviceId <= 0) error(400, 'Pick a device.');
	await sendToDevice(bookId, deviceId).catch(relayRefusal);
	return json({ ok: true });
};
