import { bench } from "./run";
bench("tune.js", "ipc paced,ipc burst,ipc ping", ";13=0;13=1;13=2;13=4;13=16;13=32;0=0;11=1;13=2,0=0");
