import { bench } from "./run";
bench("cond.js", "all", "8 workers", ";BUN_TMP_RING=1;BUN_TMP_RING=2", "5");
