export type infer<T> = T extends readonly (infer Item)[] ? Item : never;
