/// <reference path="../other-library.d.ts" />
import { dark } from "./names.ts";
declare const enum Ambient { One = 1 }
export enum Shade { Dark = dark }
export const one = Ambient.One;
export const version = OtherLibrary.version;
