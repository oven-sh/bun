export type UnwrappedResultRow<T> = {
    [P in keyof T]: (
        T[P] extends Req<infer a> ? (
            a
        ) : (
            T[P] extends Opt<infer b> ? (
                b
            ) : (
                // TEST
                never
            )
        )
    );
};
