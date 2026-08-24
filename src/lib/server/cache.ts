/** Bounded in-memory cache. Process-local and deliberately not persisted —
 *  §1 says Floppy is the single source of truth; this only holds derived
 *  metadata that is cheap to re-fetch. */
export class TTLCache<V> {
	#map = new Map<string, { v: V; exp: number }>();

	constructor(
		private readonly ttlMs: number,
		private readonly max = 2000
	) {}

	get(key: string): V | undefined {
		const hit = this.#map.get(key);
		if (!hit) return undefined;
		if (hit.exp < Date.now()) {
			this.#map.delete(key);
			return undefined;
		}
		// Refresh LRU position.
		this.#map.delete(key);
		this.#map.set(key, hit);
		return hit.v;
	}

	set(key: string, v: V): void {
		if (this.#map.size >= this.max) {
			const oldest = this.#map.keys().next().value;
			if (oldest !== undefined) this.#map.delete(oldest);
		}
		this.#map.set(key, { v, exp: Date.now() + this.ttlMs });
	}

	delete(key: string): void {
		this.#map.delete(key);
	}
}
