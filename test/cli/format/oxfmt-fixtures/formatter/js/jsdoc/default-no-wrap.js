// @default values on the same line should NOT be wrapped at printWidth.
// Upstream (stringify.ts:131-136) preserves description as-is for
// TAGS_PEV_FORMATE_DESCRIPTION tags.

/**
 * @example
 *   {{browser}} -mv{{manifestVersion}}
 *
 * @default <span v-pre>`"{{browser}}-mv{{manifestVersion}}{{modeSuffix}}"`</span>
 */
var outDirTemplate;

/**
 * @default { object: "value", nestingTest: { obj: "nested", anotherKey: "something" } }
 */
var anotherDefault;
