import c2 from "console";
import c1 from "node:console";
import { expectType } from "./utilities";

c1.log();
c2.log();

async () => {
  // tslint:disable-next-line:await-promise
  for await (const line of c1) {
    console.log("Received:", line);
  }

  // tslint:disable-next-line:await-promise
  for await (const line of c2) {
    console.log("Received:", line);
  }

  // tslint:disable-next-line:await-promise
  for await (const line of console) {
    console.log("Received:", line);
  }

  return null;
};

const written = console.write("hello world!", "\n");
expectType(written).is<number | Promise<number>>();
expectType(await console.write(new Uint8Array(1))).is<number>();
