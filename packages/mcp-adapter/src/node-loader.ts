import { readFileSync } from 'node:fs';
import type { ReplayFixture } from './fixture.ts';

/**
 * Node-only helper. Kept out of `fixture.ts` so the browser bundle never pulls
 * in `node:fs` (see `browser.ts`).
 */
export function loadFixture(path: string): ReplayFixture {
  return JSON.parse(readFileSync(path, 'utf8')) as ReplayFixture;
}
