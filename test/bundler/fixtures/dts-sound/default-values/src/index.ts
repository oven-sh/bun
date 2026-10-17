import resolvers from "./resolvers";

type Known = keyof typeof resolvers;

export function order(name: string): number {
  return name in resolvers ? resolvers[name as Known] : 0;
}
