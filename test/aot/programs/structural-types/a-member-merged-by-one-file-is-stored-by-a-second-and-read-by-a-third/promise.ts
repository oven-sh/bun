export {};

declare module "./account.ts" {
  interface Account {
    balance: number;
    owner: string;
    history: number[];
  }
}
