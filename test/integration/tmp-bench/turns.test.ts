import { bench } from "./run";
bench("begin.js", "4", "2", "read 4 MB;read 4 KB;stat;readFile;text;immediate;pbkdf2", "3");
