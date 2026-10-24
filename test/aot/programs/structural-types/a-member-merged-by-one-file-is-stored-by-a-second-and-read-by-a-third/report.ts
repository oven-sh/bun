import type { Account } from "./account.ts";
import "./promise.ts";

export function balanceOf(account: Account): number {
  return account.balance;
}

export function line(account: Account): string {
  return account.owner.toUpperCase() + " " + (account.balance + 1) + " " + account.history.length;
}
