export class Shape { area() { return 4; } }
export namespace Shape { export const unit = "cm"; }
export function parse(text: string) { return "parsed " + text; }
export namespace parse { export const version = 2; }
export enum Pieces { One = 1 }
export enum Pieces { Two = 2 }
export enum Level { High = "high" }
export namespace Level { export const describe = (level: Level) => "level " + level; }
export interface Config { port: number }
export const Config = { port: 81 };
class Default { name() { return "the default"; } }
namespace Default { export const label = "its label"; }
export default Default;
