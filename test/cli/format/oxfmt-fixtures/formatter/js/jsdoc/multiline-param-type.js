// Fix 4: Multi-line @param type expression should not collapse

/**
 * @param {{
 * 	failed?: (renderer: Renderer, error: unknown, reset: () => void) => void;
 * }} props
 * @param {(renderer: Renderer) => MaybePromise<void>} children_fn
 */
function multiLineType(props, children_fn) {}

/**
 * @param {{
 *   name: string;
 *   value: number;
 * }} options The options object
 */
function withDesc(options) {}
