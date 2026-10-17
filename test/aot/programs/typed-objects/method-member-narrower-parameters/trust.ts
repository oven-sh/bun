export type Trust = { readonly attested: boolean; readonly decidedByHost: boolean };
export const NONE: Trust = { attested: false, decidedByHost: false };
export type Constraints = { allowed: boolean; dir: string; said: string };
export type Policy = {
  name: string;
  constraints(tool: string, dir: string, call?: Pick<Trust, "attested">): Constraints;
};
