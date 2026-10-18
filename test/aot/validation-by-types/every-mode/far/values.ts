import { make } from "./made";
export const defaults = make();
export const limits: { low: number; high: number } = JSON.parse('{"low":0,"high":1}');
