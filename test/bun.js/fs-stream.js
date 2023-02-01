import { createReadStream, createWriteStream, readFileSync } from "fs";

await new Promise((resolve, reject) => {
  createReadStream("fs-stream.js")
    .pipe(createWriteStream("/tmp/fs-stream.copy.js"))
    .once("error", err => reject(err))
    .once("finish", () => {
      try {
        const copied = readFileSync("/tmp/fs-stream.copy.js", "utf8");
        const real = readFileSync("/tmp/fs-stream.js", "utf8");
        if (copied !== real) {
          reject(new Error("fs-stream.js is not the same as fs-stream.copy.js"));
          return;
        }

        resolve(true);
      } catch (err) {
        reject(err);
      }
    });
});
