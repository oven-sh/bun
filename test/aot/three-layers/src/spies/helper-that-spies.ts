import { spyOn, mock } from "bun:test";
import * as own from "./own";
export function spyOnOwn(answer: string) { return spyOn(own, "own").mockImplementation(() => answer); }
export function spyOnAny(object: any, name: string, answer: unknown) { return spyOn(object, name).mockImplementation(() => answer); }
export function mockAny(name: string, factory: () => unknown) { mock.module(name, factory); }
