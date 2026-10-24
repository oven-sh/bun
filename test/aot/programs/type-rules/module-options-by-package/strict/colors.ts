/// <reference path="../library.d.ts" />
import { red } from "./names.ts";
declare const enum Ambient { One = 1 }
export enum Color { Red = red }
export const one = Ambient.One;
export const version = Library.version;
