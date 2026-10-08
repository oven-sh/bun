// https://github.com/babel/babel/pull/11850

let foo;

/* indirect eval calls */
eval?.(foo);

(eval)?.(foo);

eval?.()();

eval?.().foo;

/* direct eval calls */

eval()?.();

eval()?.foo;

/* plain function calls */

foo.eval?.(foo);

eval.foo?.(foo);
