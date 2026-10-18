import { imported, constant, reassigned } from "./helpers.ts";
import { probe } from "./probes.js";

function local(value: number): number {
  return value * 2;
}

export class Names {
  a = 1;
  f = (): number => this.a;
  viaImport = imported;
  viaLocal = local;
  z = 2;
}
export function sumOfNames(value: Names): number {
  return value.a + value.z + value.f() + value.viaImport(1) + value.viaLocal(2);
}
export function makeNames(): Names {
  return new Names();
}

export class OnlyExtended {
  a = 1;
  f = (): number => this.a;
  viaImport = imported;
  viaLocal = local;
  z = 2;
}
export function sumOfOnlyExtended(value: OnlyExtended): number {
  return value.a + value.z + value.f() + value.viaImport(1) + value.viaLocal(2);
}

export class StillRunsCode {
  a = 1;
  f = (): number => this.a;
  viaConstant = constant;
  viaVariable = reassigned;
  seen: string = probe(this);
  viaImport = imported;
  z = 2;
}
export function sumOfStillRunsCode(value: StillRunsCode): number {
  return value.a + value.z + value.viaConstant(1) + value.viaVariable(1) + value.viaImport(1);
}
export function makeStillRunsCode(): StillRunsCode {
  return new StillRunsCode();
}
