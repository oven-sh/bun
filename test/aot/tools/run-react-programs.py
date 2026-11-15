#!/usr/bin/env python3
"""run-react-programs.py <bun> <folder of programs> <work folder> <jobs> [<name ..>]: builds each program of generate-react-callbacks.py or generate-react-applications.py with the React Compiler, with and without
--aot, runs both and compares what they print. A program that differs leaves <name>.plain and <name>.aot in the work folder."""
import concurrent.futures, os, queue, subprocess, sys
bun, programs, work, jobs = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2]), os.path.abspath(sys.argv[3]), int(sys.argv[4])
names = sys.argv[5:] or sorted(it for it in os.listdir(programs) if it.startswith('p') and os.path.isdir(os.path.join(programs, it)))
os.makedirs(work, exist_ok=True)
builder = os.path.join(work, 'build.ts')
open(builder, 'w').write('''const [kind, entry, outfile] = process.argv.slice(2);
const result = await Bun.build({ entrypoints: [entry], target: "bun", reactCompiler: true, reactCompilerOutputMode: "client", compile: { outfile, ...(kind === "aot" ? { aot: true } : {}) }, throw: false } as any);
for (const log of result.logs) console.error(String(log));
process.exit(result.success ? 0 : 1);
''')
environment = dict(os.environ, BUN_ENABLE_CRASH_REPORTING='0')
slots = queue.Queue()
for k in range(jobs):
    os.makedirs(os.path.join(work, f'slot{k}'), exist_ok=True)
    slots.put(os.path.join(work, f'slot{k}'))

def turn(name):
    slot = slots.get()
    try:
        said = []
        for kind in ('plain', 'aot'):
            executable = os.path.join(slot, kind)
            built = subprocess.run([bun, 'run', builder, kind, os.path.join(programs, name, 'main.ts'), executable], cwd=programs, env=environment, capture_output=True, text=True, timeout=300)
            if built.returncode:
                return name, f'BUILD {kind}', (built.stderr or built.stdout).strip().split('\n')[0][:160]
            try:
                ran = subprocess.run([executable], cwd=slot, env=environment, capture_output=True, text=True, timeout=60)
                said.append((ran.returncode, ran.stdout, ran.stderr))
            except subprocess.TimeoutExpired:
                said.append((124, '', 'time out'))
        caches = said[1][2].count('a cache of')
        calls = sum(line[:1].isdigit() for line in said[0][1].split('\n'))
        if said[0][:2] == said[1][:2]:
            return name, 'SAME', f'calls={calls} caches={caches}'
        why = [line for line in said[1][2].split('\n') if 'reachability' in line or 'left out' in line or 'rror' in line]
        open(os.path.join(work, name + '.plain'), 'w').write(said[0][1] + said[0][2])
        open(os.path.join(work, name + '.aot'), 'w').write(said[1][1] + said[1][2])
        return name, 'DIFFERS', (why or ['exit %d | %d' % (said[0][0], said[1][0])])[0][:160]
    finally:
        slots.put(slot)

tally, calls, compiled = {}, 0, 0
with concurrent.futures.ThreadPoolExecutor(jobs) as pool:
    for name, verdict, detail in pool.map(turn, names):
        tally[verdict] = tally.get(verdict, 0) + 1
        if verdict == 'SAME':
            calls += int(detail.split()[0].split('=')[1])
            compiled += detail.split('caches=')[1] != '0'
        else:
            print(verdict, name, detail, flush=True)
print('END', tally, 'callbacks called', calls, 'programs with a compiled component', compiled)
