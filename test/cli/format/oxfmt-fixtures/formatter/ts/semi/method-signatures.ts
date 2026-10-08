export interface MethodSignatures {
  (arg: string): void;
  (arg: number): null;
}

export type MethodSignaturesAndPropertyOnSameLine =
  | { json(): never; ok: false }
  | { json(): Promise<any>; ok: true }
