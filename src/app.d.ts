// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Error {
			message: string;
			/** Set when the failure is just "this person hasn't linked the account a
			 *  feature needs" — pages show a link-it prompt instead of an error. */
			notLinked?: 'floppy' | 'calendar' | 'bookorbit';
		}
		interface Locals {
			/** The signed-in account, or null. Requests run *as* this user (userctx). */
			user: import('$lib/server/users').User | null;
			/** Whether the request carried a valid session, for the few routes that
			 *  answer both gated and ungated callers. */
			authed: boolean;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
