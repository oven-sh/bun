#!/usr/bin/env python3
"""same-literals-one-under-external-type.py <folder>: Two literals alike, one under a type that is given (made as a plain object), the other ordinary (laid out): they are one type by identity, and no cast lies between them. The plain one is handed to typed code that is written against the type of the other (`typeof b`): does that code read a field out of an object that is not laid out? And the object of a JSON module beside a literal that is alike."""
import os, shutil, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
H = os.getcwd()
TS='{ "compilerOptions": { "strict": true, "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "resolveJsonModule": true, "noEmit": true, "types": [], "lib": ["esnext"] }, "include": ["main.ts"] }\n'
HEAD='declare const console: { log(...values: unknown[]): void };\n'
def fields(n,base): return ', '.join(['timeout: %d'%base,'retries: %d'%(base+1)]+['f%d: %d'%(i,base+i) for i in range(n)])
def config(n): return 'interface Config { timeout?: number; retries?: number; '+' '.join('f%d?: number;'%i for i in range(n))+' }\n'
def reads(n): return 'o.timeout * 10 + o.retries'+''.join(' + o.f%d'%i for i in range(n))
for d in os.listdir(H):
    if os.path.isdir(os.path.join(H,d)): shutil.rmtree(os.path.join(H,d))
def w(d,name,text):
    os.makedirs(os.path.join(H,d),exist_ok=True); open(os.path.join(H,d,name),'w').write(text)
for n in (0,6,40):
    G=config(n)+'const parsed = JSON.parse(\'{"timeout":5}\') as Config;\n'
    a='const a = { '+fields(n,1)+' } satisfies Config;\n'; b='const b = { '+fields(n,100)+' };\n'
    read='function read(o: typeof b): number { return '+reads(n)+' }\n'
    use='console.log(read(a), read(b), parsed.timeout);\nconst list = [b]; list.push(a); let s = 0; for (const o of list) s += o.timeout + o.retries; console.log(s);\nlet v = b; v = a; console.log(v.timeout, v === a); v.retries = 7.5; console.log(a.retries, b.retries, Object.keys(a).length);\n'
    w('g%02d_ab'%n,'main.ts',HEAD+G+a+b+read+use); w('g%02d_ba'%n,'main.ts',HEAD+G+b+a+read+use)
    w('g%02d_the_ordinary_one_elsewhere'%n,'main.ts',HEAD+'import { b, read } from "./other";\n'+G+a+use); w('g%02d_the_ordinary_one_elsewhere'%n,'other.ts','export '+b+'export '+read)
    w('g%02d_the_given_one_elsewhere'%n,'main.ts',HEAD+'import { a, parsed } from "./other";\n'+b+read+use); w('g%02d_the_given_one_elsewhere'%n,'other.ts',config(n)+'export const parsed = JSON.parse(\'{"timeout":5}\') as Config;\nexport '+a)
    # the parsed data itself as the type of the ordinary literal
    w('p%02d_parsed_as_typeof'%n,'main.ts',HEAD+b+read+'const d = JSON.parse(JSON.stringify({ '+fields(n,7)+' })) as typeof b;\nconst c = { '+fields(n,50)+' };\nconsole.log(read(d), read(b), read(c));\n')
    # a JSON module beside an alike literal
    j='{ '+', '.join('"%s": %s'%tuple(x.split(': ')) for x in fields(n,30).split(', '))+' }\n'
    w('j%02d_json_first'%n,'main.ts',HEAD+'import data from "./data.json";\n'+b+read+'console.log(read(data), read(b), Object.keys(data).length);\n'); w('j%02d_json_first'%n,'data.json',j)
    w('j%02d_typed_against_the_json'%n,'main.ts',HEAD+'import data from "./data.json";\n'+b+'function read(o: typeof data): number { return '+reads(n)+' }\nconsole.log(read(data), read(b));\n'); w('j%02d_typed_against_the_json'%n,'data.json',j)
for d in os.listdir(H):
    if os.path.isdir(os.path.join(H,d)): w(d,'tsconfig.json',TS)
print(len([d for d in os.listdir(H) if os.path.isdir(os.path.join(H,d))]),'folders')
