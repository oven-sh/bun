// Diagnostics driver (not for merge): runs several variants of the
// experimental-module finalizer script and reports which ones failed to
// finalize on the first synchronous GC. Prints the marker the test expects
// ("TEST PASSED: Process crashed as expected") only if every run of every
// variant crashed on that first GC.
const { spawnSync } = require('child_process');
const path = require('path');

const modulePath = path.join(__dirname, 'build/Debug/test_reference_unref_in_finalizer_experimental.node');

// V1: the script exactly as it is on main.
const original = `
const m = require("${modulePath}");
console.log('Loading experimental module...');
let arr = m.test_reference_unref_in_finalizer_experimental();
console.log('Test function returned');
arr = null;
global.gc ? global.gc() : (process.isBun && Bun.gc ? Bun.gc(true) : null);
console.log('GC triggered - should crash now');
console.log('ERROR: Did not crash! Test failed!');
process.exit(1);
`;

// Same, but if the first GC didn't finalize, try again from the event loop
// and say which one worked.
const withSecondGc = `
const m = require("${modulePath}");
console.log('Loading experimental module...');
let arr = m.test_reference_unref_in_finalizer_experimental();
console.log('Test function returned');
arr = null;
global.gc ? global.gc() : (process.isBun && Bun.gc ? Bun.gc(true) : null);
console.log('GC #1 returned without crashing');
setImmediate(() => {
  global.gc ? global.gc() : (process.isBun && Bun.gc ? Bun.gc(true) : null);
  console.log('GC #2 returned without crashing');
  console.log('ERROR: Did not crash! Test failed!');
  process.exit(1);
});
`;

const fullEnv = {
  ...process.env,
  BUN_INTERNAL_SUPPRESS_CRASH_ON_NAPI_ABORT: "1",
  ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=1:symbolize=0",
};
const minimalEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) =>
    /^(PATH|HOME|TMPDIR|TEMP|TMP|USER|LOGNAME|SHELL|LANG|LC_ALL|TZ|SystemRoot|BUN_[A-Z0-9_]*|ASAN_OPTIONS|MallocNanoZone)$/.test(k))),
  BUN_INTERNAL_SUPPRESS_CRASH_ON_NAPI_ABORT: "1",
  ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=1:symbolize=0",
};
const noGcLevel = { ...fullEnv }; delete noGcLevel.BUN_GARBAGE_COLLECTOR_LEVEL;
const noAudit = { ...fullEnv }; delete noAudit.BUN_JSC_randomIntegrityAuditRate;

const variants = [
  { name: 'V1 original, full env', script: original, env: fullEnv },
  { name: 'V2 original, minimal env', script: original, env: minimalEnv },
  { name: 'V3 original, full env minus BUN_GARBAGE_COLLECTOR_LEVEL', script: original, env: noGcLevel },
  { name: 'V4 original, full env minus BUN_JSC_randomIntegrityAuditRate', script: original, env: noAudit },
  { name: 'V5 original + logGC=1', script: original, env: { ...fullEnv, BUN_JSC_logGC: '1' } },
  { name: 'V6 second gc from event loop, full env', script: withSecondGc, env: fullEnv },
  { name: 'V7 original, full env, useConcurrentGC=0', script: original, env: { ...fullEnv, BUN_JSC_useConcurrentGC: '0' } },
];

const RUNS = 3;
let allCrashedOnFirstGc = true;
const rows = [];
let sample = '';
for (const v of variants) {
  const cells = [];
  for (let i = 0; i < RUNS; i++) {
    const r = spawnSync(process.argv[0], ['--expose-gc', '-e', v.script], { env: v.env, encoding: 'utf8', timeout: 20_000 });
    const out = (r.stdout || '') + (r.stderr || '');
    // Markers are looked for in stdout only: the crash report on stderr echoes
    // the whole -e script in its Args: line.
    const so = r.stdout || '';
    const crashed = (r.stderr || '').includes('FATAL ERROR') && (r.stderr || '').includes('panic');
    const firstGcReturned = so.includes('GC triggered - should crash now') || so.includes('GC #1 returned without crashing');
    const secondGcReturned = so.includes('GC #2 returned without crashing');
    let cell;
    if (crashed && !firstGcReturned) cell = 'crash@gc1';
    else if (crashed && firstGcReturned && !secondGcReturned) cell = 'CRASH@GC2';
    else if (so.includes('ERROR: Did not crash')) cell = 'NO-CRASH';
    else if (r.error) cell = 'spawn-error:' + r.error.code;
    else cell = `other(status=${r.status},signal=${r.signal})`;
    if (cell !== 'crash@gc1') {
      allCrashedOnFirstGc = false;
      if (!sample) sample = `--- sample output for [${v.name}] run ${i} (${cell}) ---\n${out}\n--- end sample ---`;
    }
    cells.push(cell);
  }
  rows.push(`${v.name.padEnd(62)} ${cells.join('  ')}`);
}

console.log('Loading experimental module... / Created (markers for the outer test)');
console.log('variant matrix (' + RUNS + ' runs each):');
for (const row of rows) console.log('  ' + row);
if (sample) console.log(sample);
if (allCrashedOnFirstGc) {
  console.error('FATAL ERROR (marker for the outer test)');
  console.log('\n\nTEST PASSED: Process crashed as expected');
  process.exit(0);
} else {
  console.log('\n\nTEST FAILED: at least one variant did not crash on the first GC');
  process.exit(1);
}
