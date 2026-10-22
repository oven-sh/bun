// A script: its declarations are global. The program has it after merge-second.d.ts.
interface GlobalMerged {
  zFirst: number;
  shared: string;
  aFirst: boolean;
}
interface GlobalMerged {
  zFirstAgain: number;
}
