import { JSON, type Schema } from "bun";
import { validate } from "bun:bundle";
import { accepts, both, changing, changingProxy, finish, handsBack, holdsItsOwnCopy, refuses, refusesSaying } from "./check";

type NotOne = number & Schema.Not<1>;
type NotAdmin = { role: string & Schema.Not<"admin" | "root"> };
type WithoutPassword = Record<string, unknown> & Schema.Not<{ password: unknown }>;
type NotNotShort = string & Schema.Not<string & Schema.Not<string & Schema.MaxLength<2>>>;
type NotAnything = number & Schema.Not<unknown>;
type NotNothing = number & Schema.Not<never>;
type NoListOfNumbers = unknown[] & Schema.Not<number[]>;
type NotAdminByRole = { role: string } & Schema.Not<{ role: "admin" }>;

both("not one", value => validate<NotOne>(value), text => JSON.parse<NotOne>(text), {
  "1": false,
  "1.0": false,
  "2": true,
  '"2"': false,
  "1e999": false,
});
both("not admin", value => validate<NotAdmin>(value), text => JSON.parse<NotAdmin>(text), {
  '{"role":"user"}': true,
  '{"role":"admin"}': false,
  '{"role":"root"}': false,
  '{"role":"user","role":"admin"}': false,
  '{"role":"admin","role":"user"}': true,
  '{"role":1}': false,
  "{}": false,
});
both("without password", value => validate<WithoutPassword>(value), text => JSON.parse<WithoutPassword>(text), {
  "{}": true,
  '{"name":"a"}': true,
  '{"password":"a"}': false,
  '{"password":null}': false,
});
both("not not short", value => validate<NotNotShort>(value), text => JSON.parse<NotNotShort>(text), {
  '"ab"': true,
  '"abc"': false,
  '"💩💩"': true,
});
both("not anything", value => validate<NotAnything>(value), text => JSON.parse<NotAnything>(text), { "1": false });
both("not nothing", value => validate<NotNothing>(value), text => JSON.parse<NotNothing>(text), { "1": true, '"a"': false });

both("no list of numbers", value => validate<NoListOfNumbers>(value), text => JSON.parse<NoListOfNumbers>(text), {
  '["a"]': true,
  '[1,"a"]': true,
  "[1]": false,
  "[]": false,
  "[1e999]": false,
});
both("not admin by role", value => validate<NotAdminByRole>(value), text => JSON.parse<NotAdminByRole>(text), {
  '{"role":"user"}': true,
  '{"role":"admin"}': false,
  '{"role":"admin","x":1}': false,
});

refuses("a hole fails the operand, and the array too", () => validate<NoListOfNumbers>([,]));
refuses("a hole that only unknown meets", () => validate<NoListOfNumbers>(["a", ,]));
refuses("what is not a number fails the operand, and the array too", () => validate<NoListOfNumbers>([NaN]));
refuses("a getter is judged by what it first answers", () => validate<WithoutPassword>(changing("password", "a", undefined)));
handsBack("the rule and the copy read the same", { role: "user" }, () => validate<NotAdminByRole>(changing("role", "user", "admin")));
refuses("the rule reads what the copy reads", () => validate<NotAdminByRole>(changing("role", "admin", "user")));
handsBack("a Proxy is read once", { role: "user" }, () => validate<NotAdminByRole>(changingProxy({ role: "user" }, { role: "admin" })));
refuses("a Proxy is judged by what it first answers", () => validate<NotAdminByRole>(changingProxy({ role: "admin" }, { role: "user" })));
refuses("a Proxy whose keys come later", () => validate<WithoutPassword>(changingProxy({ password: "a" }, {})));
handsBack("a Proxy whose keys come later is what it first was", {}, () => validate<WithoutPassword>(changingProxy({}, { password: "a" })));

type NoAdminInside = { a: object & Schema.Not<{ admin: true }> };
handsBack("a getter in a member that is any object is read once", { a: { admin: undefined } }, () => validate<NoAdminInside>({ a: changing("admin", undefined, true) }));
refuses("a getter in a member that is any object is judged by what it first answers", () => validate<NoAdminInside>({ a: changing("admin", true, undefined) }));
holdsItsOwnCopy("a member that is any object is copied", { a: { admin: false } }, { a: { admin: false } }, value => validate<NoAdminInside>(value), value => (value.a.admin = true));

refusesSaying("the message of a pattern with the u flag", "/^.$/u", () => validate<string & Schema.Pattern<"^.$", "u">>("ab"));
refusesSaying("the message of a pattern without a flag", "/^.$/", () => validate<string & Schema.Pattern<"^.$">>("ab"));

finish();
