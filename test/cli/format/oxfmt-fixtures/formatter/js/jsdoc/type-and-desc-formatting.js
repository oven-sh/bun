// Bug C: Long union types should NOT be wrapped inside {type} annotations
/**
 * @param {Compiler.AST.SvelteNode} node
 * @returns {node is Compiler.AST.IfBlock | Compiler.AST.EachBlock | Compiler.AST.AwaitBlock | Compiler.AST.KeyBlock | Compiler.AST.SlotElement}
 */
function isBlock(node) {}

/**
 * @param {AST.SvelteNode} node
 * @returns {node is AST.Component | AST.RegularElement | AST.SlotElement | AST.SvelteComponent | AST.SvelteElement | AST.SvelteFragment | AST.SvelteSelf}
 */
function isElementNode(node) {}

// Bug D: Trailing description after multi-line type should stay on the same line
/**
 * @type {ProxyHandler<{
 * 	props: Record<string | symbol, unknown>;
 * 	exclude: (string | symbol)[];
 * 	name?: string;
 * }>} }
 */
const restPropsHandler = {};

// Bug E: @internal + blank line + description should NOT have continuation indent
/**
 * @internal
 *
 * Turn a Svelte component into a custom element.
 */
function createCustomElement() {}

// Bug E variant: @internal without blank line should be inline
/**
 * @internal Some inline description
 */
function internalInline() {}

// Bug F: {@link} tokens should not cause wrapping width miscalculation
/**
 * Skips or removes (depending on {@link remove}) all nodes starting at `hydrate_node` up until the next hydration end comment
 */
function skipNodes() {}

/**
 * It can be attached to an element with an `{@attach ...}` tag, or by spreading an object containing a property created with [`createAttachmentKey`](https://example.com).
 */
function attach() {}

// Bug G/H: Code blocks in descriptions should be preserved verbatim
/**
 * Example usage:
 *
 * ```ts
 * const dispatch = createEventDispatcher<{
 *  loaded: null;
 *  change: string;
 *  optional: number | null;
 * }>();
 * ```
 *
 * See docs for more.
 */
function withCodeBlock() {}
