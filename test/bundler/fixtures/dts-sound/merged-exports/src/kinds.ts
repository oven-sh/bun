import type * as Kind_ from "./kinds_";
export * as Kind from "./kinds_";
export type Kind = (typeof Kind_)[keyof typeof Kind_];
