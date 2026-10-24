#!/usr/bin/env python3
"""long-concatenations.py <folder>: A concatenation takes in no more than 256 parts at once: around 256 and its multiples; parts that are strings, numbers, booleans, null, undefined, bigints; by `+=`, by one expression, by a template, as a key of a Map and of a record."""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
H = os.getcwd()
HEAD='declare const console: { log(...values: unknown[]): void };\nlet hash = 0; function see(s: string): void { hash = 0; for (let i = 0; i < s.length; i++) hash = (Math.imul(hash, 31) + s.charCodeAt(i)) | 0; console.log(s.length, hash, s.slice(0, 30), s.slice(-30)) }\nfunction str(i: number): string { return "s" + i } function num(i: number): number { return i % 3 ? i + 0.5 : -i } function boo(i: number): boolean { return i % 2 === 0 } function nul(): null { return null } function und(): undefined { return undefined } function big(i: number): bigint { return BigInt(i) * 1000000007n }\nfunction either(i: number): string | number { return i % 2 ? "e" + i : i }\n'
TS='{ "compilerOptions": { "strict": true, "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "noEmit": true, "types": [], "lib": ["esnext"] }, "include": ["main.ts"] }\n'
def part(i): return ('str(%d)','num(%d)','"t%d"','boo(%d)','%d','nul()','und()','big(%d)','either(%d)','%d.25','"é%d"','"\\ud800"')[i%12].replace('%d',str(i))
cases={}
for n in (254,255,256,257,258,510,511,512,513,514,767,768,769,1000,3000):
    b=HEAD
    b+='function expression(): string { return "" + '+' + '.join(part(i) for i in range(n))+' }\nsee(expression());\n'
    b+='function template(): string { return `'+''.join('${%s}|'%part(i) for i in range(n))+'` }\nsee(template());\n'
    b+='function steps(q: string): string { let s = "";\n'+''.join('s += q + %s;\n'%part(i) for i in range(n))+'return s }\nsee(steps("~"));\n'
    b+='function right(): string { return '+''.join('%s + ('%(part(i) if part(i).startswith(('str','"')) else '"" + '+part(i)) for i in range(min(n,600)))+'"end"'+')'*min(n,600)+' }\nsee(right());\n'
    b+='const m = new Map<string, number>(); function key(i: number): string { return "" + '+' + '.join(('str(i + %d)'%k,'num(i + %d)'%k,'"k%d"'%k)[k%3] for k in range(n))+' }\nm.set(key(1), 1); m.set(key(2), 2); console.log(m.get(key(1)), m.get(key(2)), m.get(key(3)), m.size);\n'
    b+='const r: Record<string, number> = {}; r["" + '+' + '.join(('str(%d)'%k,'num(%d)'%k)[k%2] for k in range(n))+'] = 5; see(Object.keys(r)[0]!);\n'
    cases['n%04d'%n]=b
for name,body in cases.items():
    d=os.path.join(H,name); os.makedirs(d,exist_ok=True)
    open(os.path.join(d,'main.ts'),'w').write(body); open(os.path.join(d,'tsconfig.json'),'w').write(TS)
print(len(cases),'folders')
