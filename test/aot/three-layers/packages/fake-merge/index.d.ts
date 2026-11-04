export function mergeWith(object: any, ...sourcesAndCustomizer: any[]): any;
export function assignAll(object: any, source: any): any;
export function set(object: any, key: PropertyKey, value: unknown): any;
export function makeTheirs(i: number): any;
export class Theirs {
  a: number;
  b?: string;
  nested: any;
  constructor(i: number);
}
export const copiers: Record<string, (object: any) => any>;
export const packageText: string;
export const packageTextReadAboveFirst: string;
export let packageMode: string;
export function setPackageMode(mode: string): void;
export function codeFromText(parameters: string[], body: string): (...all: any[]) => any;
export function importByPath(path: string): Promise<any>;
export function requireByPath(path: string): any;
export function payloadOfThePackage(value: unknown): { value: unknown; issues: unknown[] };
export function readPayloadInThePackage(payload: { value: unknown; issues: unknown[] }): unknown[];
export class StaticsOfThePackage { static limit: number; static label: string; static twice(): number; }
