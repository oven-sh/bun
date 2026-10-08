// Fix 25: @param dash preserved when description wraps to new line

/**
 * @param {"component" | "if" | "each" | "await" | "key" | "render"} type - Type of block/component
 */
function longTypeParamDash(type) {}

/**
 * @param {import("./types").VeryLongModuleType<GenericParam>} value - The value to process
 */
function longImportParamDash(value) {}
