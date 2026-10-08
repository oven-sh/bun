type MutableRequired<T> = { 
-readonly [P in keyof T]-?:T[P] 
};  // Remove readonly and ?

type ReadonlyPartial<T> = {
+readonly [P in keyof T]+?:T[P] 
};  // Add readonly and ?
