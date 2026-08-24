/**
 * Haptic feedback on commit (§4.2).
 *
 * Honest limitation: iOS Safari — including standalone home-screen PWAs, which
 * is Seek's actual target — does not implement the Vibration API. There is no
 * supported web haptic on iPhone today. This calls navigator.vibrate where it
 * exists (Android, desktop Chrome) and is a no-op on iOS.
 *
 * The commit still gets non-haptic confirmation the user will actually perceive
 * on an iPhone: the row snaps, the progress bar advances, and the toast appears.
 * Keeping this seam here means the day WebKit ships a haptic API, it is one
 * function to change.
 */
export function haptic(pattern: number | number[] = 12): void {
	if (typeof navigator === 'undefined') return;
	const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
	try {
		nav.vibrate?.(pattern);
	} catch {
		// Never let feedback break the interaction it is confirming.
	}
}
