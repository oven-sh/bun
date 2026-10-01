// Declares nothing itself: it only re-exports from other modules.
export { viaNamedReexport, renamedOnTheWay as underAnotherName } from "./pure2";
export * from "./middle";
export * as everything from "./pure4";
