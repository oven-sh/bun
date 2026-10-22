// A module that augments the global scope. The program has it first, and TypeScript 6 merges it after every script.
export {};
declare global {
  interface GlobalMerged {
    zAugment: number;
    aAugment: string;
  }
}
