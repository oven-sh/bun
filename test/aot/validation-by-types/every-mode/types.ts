import type { Schema } from "bun";

export interface Item {
  sku: string & Schema.MinLength<1> & Schema.MaxLength<4>;
  quantity: number & Schema.Int & Schema.Min<1> & Schema.Max<99>;
  note?: string;
}
export interface Order {
  id: number;
  items: Item[] & Schema.MinItems<1> & Schema.MaxItems<3>;
  to: { name: string; city: string };
  kind: "gift" | "plain";
  coupon: string | null;
}
export type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number } | { kind: "dot" };
export type Loose = { a: number } | { b: string } | number[] | null;
export interface Tree {
  value: number;
  children: Tree[];
}
export enum Color {
  Red = "red",
  Green = "green",
}
export enum Level {
  Low,
  High,
}
export type UserId = string & { readonly __brand: "UserId" };
export interface Account {
  id: UserId;
  handle: `@${string}`;
  version: `v${number}`;
  color: Color;
  level: Level;
  email: string & Schema.Format<"email">;
  slug: string & Schema.Pattern<"^[a-z-]+$">;
  step: number & Schema.MultipleOf<5> & Schema.Message<"Steps of five">;
  port: number & Schema.Default<8080>;
  pair: [number, string];
  scores: Record<string, number>;
  options: Record<string, any>;
  anything: unknown;
  [extra: `x-${string}`]: unknown;
}
export type Closed = { a: number; inner: { b: number } } & Schema.Strict;
export type ClosedThroughout = { a: number; inner: { b: number } } & Schema.DeepStrict;
export type Page<T> = { items: T[]; next: number | null };
export type Orders = Page<Order>;
export interface WithIndex {
  id: number;
  [key: string]: number;
}
