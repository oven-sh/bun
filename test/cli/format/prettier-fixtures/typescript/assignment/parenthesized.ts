// https://github.com/babel/babel/pull/12933/files
(<number>x) = null;
(x!) = null;
(a as any) = null;
(a as number) = 42;
((a as any) as string) = null;
