/**
 * The sample programs now live in `@mealscript/content`, shared with the
 * single-file page. This module is kept as the Playground's import surface so
 * `app/page.tsx` does not need to know where the data comes from.
 */
export { EXAMPLES, LOCATIONS, PHASES, PHASE_HINTS } from '@mealscript/content';
export type { Example, ExampleId, Phase } from '@mealscript/content';
