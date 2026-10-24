export type Call = {
  readonly useId: string | undefined;
  readonly signal: number;
  readonly abort: (reason: string) => void;
  readonly timing?: number;
};
export function createTool(deps: { name: string }) {
  return {
    async call(input: { q: string }, { signal, timing }: Call): Promise<string> {
      return input.q + ":" + signal + ":" + timing + ":" + deps.name;
    },
    describe(call: Call): string {
      return call.useId + ":" + call.signal;
    },
  };
}
