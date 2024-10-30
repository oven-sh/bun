export type SpawnOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
};

export type SpawnResult = {
  exitCode: number;
  signalCode?: string;
  stdout: string;
  stderr: string;
};

export function spawnNoThrow(command: string[], options?: SpawnOptions): Promise<SpawnResult> {
  return undefined!; // TODO
}

export function spawn(command: string[], options?: SpawnOptions): Promise<SpawnResult> {
  return undefined!; // TODO
}
