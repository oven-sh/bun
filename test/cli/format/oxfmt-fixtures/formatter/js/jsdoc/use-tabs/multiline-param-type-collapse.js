// Multi-line @param type with double braces should NOT be collapsed
// when collapsing would cause an overlong line or merge with next tag.
// Reproduces svelte renderer.js issue with tab indentation.

class Renderer {
	/**
	 * Render children inside an error boundary. If the children throw and the
	 * API-level `transformError` transform handles the error (doesn't re-throw),
	 * the `failed` snippet is rendered instead. Otherwise the error propagates.
	 *
	 * @param {{
	 * 	failed?: (renderer: Renderer, error: unknown, reset: () => void) => void;
	 * }} props
	 * @param {(renderer: Renderer) => MaybePromise<void>} children_fn
	 */
	boundary(props, children_fn) {}
}
