/**
 * Deterministic PRNG for the seeder.
 *
 * `Math.random()` would make every `make seed` produce a different database,
 * which breaks the one property that makes seeded data useful for debugging: a
 * bug someone hits on their machine has to be reproducible on yours. Everything
 * random in the seed derives from this generator, so the whole dataset is a
 * pure function of `SEED`.
 *
 * mulberry32 — a 32-bit generator that is small, fast and has a long enough
 * period for the ~2M values a full seed run consumes. Cryptographic quality is
 * explicitly not wanted here; reproducibility is.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max], inclusive at both ends. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Uniform element of `items`. Throws on an empty array rather than returning undefined. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("Rng.pick called with an empty array");
    }
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** `n` distinct elements of `items`, or all of them when `n` exceeds the length. */
  sample<T>(items: readonly T[], n: number): T[] {
    const pool = [...items];
    const take = Math.min(n, pool.length);
    for (let i = 0; i < take; i++) {
      const j = this.int(i, pool.length - 1);
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    return pool.slice(0, take);
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /**
   * Fisher-Yates, returning a new array. Used to shuffle basket line order so
   * the seeded data does not accidentally encode a consistent variant ordering
   * that a lock-ordering test could pass against by luck (§11.3, test 21).
   */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /**
   * Skewed integer in [min, max] — squaring the uniform pulls values toward
   * `min`. Real marketplaces are not uniform: most orders are small, most
   * products have few variants, and a couple of vendors carry most of the
   * catalogue. A uniform seed hides exactly the hot-partition behaviour the
   * load tests in §11.5 are meant to find.
   */
  skewed(min: number, max: number): number {
    return min + Math.floor(this.next() ** 2 * (max - min + 1));
  }

  /** A date uniformly between the two bounds. */
  date(from: Date, to: Date): Date {
    return new Date(
      from.getTime() + this.next() * (to.getTime() - from.getTime()),
    );
  }
}
