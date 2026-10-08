// Fix 6: @param should not get extra indent after @example

/**
 * @example
 * ```ts
 * defineWxtModule({
 *   name: "my-module",
 *   setup(wxt) {},
 * });
 * ```
 * @param wxt The module setup context
 */
function defineWxtModule(wxt) {}
