import { bench } from "./run";
bench(
  "stall.js",
  "old;;14=1;15=1;0=0,1=0,2=0,3=0;14=1,0=0,1=0,2=0,3=0,9=0;old,BUN_JSC_numberOfGCMarkers=1;BUN_JSC_numberOfGCMarkers=1;old,BUN_JSC_useConcurrentGC=0;BUN_JSC_useConcurrentGC=0;old,MIMALLOC_SCAVENGER=0;MIMALLOC_SCAVENGER=0;old;",
);
