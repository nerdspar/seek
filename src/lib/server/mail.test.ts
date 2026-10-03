import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mailConfigured, sendMail, inviteMail, resetMail, verifyMail, MailError } from './mail';

beforeEach(() => {
	process.env.RESEND_API_KEY = 're_test';
	process.env.MAIL_FROM = 'Seek <seek@nerdspar.com>';
});
afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env.RESEND_API_KEY;
	delete process.env.MAIL_FROM;
});

describe('mail', () => {
	it('is configured only with both the key and a from address', () => {
		expect(mailConfigured()).toBe(true);
		delete process.env.MAIL_FROM;
		expect(mailConfigured()).toBe(false);
	});

	it('posts to Resend with the key and the message', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
		vi.stubGlobal('fetch', fetchMock);
		await sendMail(resetMail('a@b.co', 'https://seek.example/reset/tok'));

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.resend.com/emails');
		expect(init.headers.Authorization).toBe('Bearer re_test');
		const body = JSON.parse(init.body);
		expect(body).toMatchObject({ from: 'Seek <seek@nerdspar.com>', to: ['a@b.co'], subject: 'Reset your Seek password' });
		expect(body.text).toContain('https://seek.example/reset/tok');
	});

	it('surfaces a Resend error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => 'bad from' }));
		await expect(sendMail(verifyMail('a@b.co', 'https://x'))).rejects.toThrow(MailError);
	});

	it('refuses to send when not configured', async () => {
		delete process.env.RESEND_API_KEY;
		await expect(sendMail(resetMail('a@b.co', 'https://x'))).rejects.toThrow(/not set up/);
	});

	it('escapes names in the HTML so an invite can’t inject markup', () => {
		const m = inviteMail('a@b.co', 'https://seek.example/invite/t', '<script>x</script>', 'Home');
		expect(m.html).not.toContain('<script>x</script>');
		expect(m.html).toContain('&lt;script&gt;');
		expect(m.subject).toBe('<script>x</script> invited you to Seek');
	});
});
