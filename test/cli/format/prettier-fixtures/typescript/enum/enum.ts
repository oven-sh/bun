enum Direction {
    Up = 1,
    Down,
    Left,
    Right
}

enum FileAccess {
    // constant members
    None,
    Read    = 1 << 1,
    Write   = 1 << 2,
    ReadWrite  = Read | Write,
    // computed member
    G = "123".length
}

enum Empty {
}

const enum Enum {
    A = 1,
    B = A * 2
}
