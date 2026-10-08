// Type arguments with speculative formatting should not lose comments
export const globalRegistry: $ZodRegistry = /*@__PURE__*/ registry();

// Comments before call expressions with type arguments should be preserved
const r = /* THIS */ f<Type>()
const s = /* comment */ foo<A | B | C>()
