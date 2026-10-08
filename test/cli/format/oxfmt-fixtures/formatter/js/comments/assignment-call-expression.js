// Minimum repro from issue #19436:
// Comments before call expressions must be preserved
const r = /* THIS */ f()

// @__PURE__ comments must not be deleted
export const globalRegistry = /*@__PURE__*/ registry();
