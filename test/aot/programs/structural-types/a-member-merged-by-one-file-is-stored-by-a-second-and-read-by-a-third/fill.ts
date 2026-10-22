import { Account } from "./account.ts";
import "./promise.ts";

export function opened(id: number): Account {
  const account = new Account(id);
  account.balance = id * 1.5;
  account.owner = "owner" + (id % 3);
  account.history = [id];
  return account;
}

export function half(id: number): Account {
  const account = new Account(id);
  account.owner = "half";
  return account;
}
