/**
 * The "together or alone?" picker, opened from the add confirmation's one-tap
 * action and hosted once in +layout — so it survives the navigation that often
 * follows adding a show. Global for the same reason the notices are: the add
 * button is buried deep and threading a handler up is more than it's worth.
 */
export type TogetherShow = { source: string; mediaId: string; title: string; shared: boolean };

export const togetherPick = $state<{ show: TogetherShow | null }>({ show: null });

export function openTogetherPicker(show: TogetherShow): void {
	togetherPick.show = show;
}
export function closeTogetherPicker(): void {
	togetherPick.show = null;
}
