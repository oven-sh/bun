// Case-insensitive sorting: Sha256Source should come before SSRContext
/**
 * @import {
 *   Csp,
 *   HydratableContext,
 *   RenderOutput,
 *   Sha256Source,
 *   SSRContext,
 *   SyncRenderOutput
 * } from "./types.js"
 */
function foo() {}

// Already sorted case-insensitively — should be preserved
/**
 * @import {Alpha, beta, Charlie} from "module"
 */
const x = 1;

// Unsorted — should be reordered case-insensitively
/**
 * @import {SSRContext, Sha256Source} from "./types.js"
 */
const y = 2;

// Merging imports from the same module — merged result should be sorted
/**
 * @import {Z, A} from "mod"
 * @import {M} from "mod"
 */
const z = 3;
