import { bench } from "./run";
bench(
  "tune.js",
  "Bun.file.stream,FileSink,createReadStream,worker ping,ipc ping,named pipe ping,shell echo,Bun.write 512",
  ";1=1;0=0;11=1",
);
