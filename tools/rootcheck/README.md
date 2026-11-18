# rootcheck

The engine's collector finds references to cells on the native stack, in memory of `RootAlloc`, and in what cells and the `Vm` show it (`src/engine/CLAUDE.md`, "The heap"). A reference that is anywhere else keeps nothing alive, and neither does a borrow of memory that a cell owns outside itself. rustc has no way to say so; this compiler driver checks it on the MIR.

```sh
rustup component add rustc-dev llvm-tools     # once for each toolchain
bun run rust:rootcheck                        # bun_engine_vm and the crates that name it as a dependency, tests included
bun run rust:rootcheck -p bun_engine_vm --lib # other arguments go to `cargo check`
bun run rust:rootcheck --lenders              # lists the functions that lend what a cell owns
bun run rust:rootcheck --test                 # tests/*.rs
```

It works in `target/rootcheck` and is incremental like `cargo check`.

## Terms

- A type **refers** to cells if it is not `GcFree`. A type parameter is judged where it is instantiated, and a trait object where it is made.
- A type **hides** references if it owns memory, from an allocator other than `RootAlloc`, that holds a type which refers. There is no list of containers. A type owns what it has a raw pointer and a `PhantomData<T>` for, or a raw pointer and a destructor, unless its lifetimes say that it borrows. The memory of `RootAlloc` is looked into: `RootVec<Vec<Value>>` hides.

## Rules

| Rule        | Reports                                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `hidden`    | a local, parameter or temporary whose type hides, unless it is only passing through (below)                                                  |
| `hidden`    | a field whose type hides, unless the type around it is a cell, `Trace`, a `Service`, `GcFree` by hand, or a part of one of these             |
| `hidden`    | the `Init` of a cell that hides: `Vm::allocate` may collect                                                                                  |
| `hidden`    | a safe function of a crate below `vm` that lends out a type which refers from memory whose type does not, as an arena does                   |
| `borrow`    | a loose borrow (below) that is alive while something may collect, or that leaves a function whose callers cannot tell                        |
| `no_gc`     | a call that may collect while a `NoGc` or `GcRefMut`, or what is borrowed under one, is alive, or a `RefMut` or lock on something that hides |
| `signature` | a safe function that other crates can call with a cell but no `Vm`, `Cx` or `Heap`, and that may collect or returns one                      |
| `hidden`    | a `repr(packed)` type that refers                                                                                                            |
| `unvisited` | a field that refers, in a type that is traced or visited by hand, which nothing touches that is given a `Visitor` or `Survivors`             |
| `static`    | a static or thread-local whose type refers                                                                                                   |
| `erased`    | `&Cell` made `&dyn Trait`                                                                                                                    |
| `guard`     | `ManuallyDrop` around a guard such as `StringView`                                                                                           |
| `allow`     | an opt-out that is misplaced, has no reason or allows nothing                                                                                |

References to a container are fine: whoever holds it is checked.

**Passing through.** The state of a cell is made of such containers, so they have to get there. A value may be moved, dropped, matched on and asked for its size (`len`, `is_some`), provided that nothing may collect before it is moved on. It may not be borrowed, looked into, leaked or made a trait object. So `state.list = vec![value]`, `state.done.push(state.queue.pop_front()?)` and `root_vec.extend(mem::take(&mut state.list))` pass, and `for value in mem::take(&mut state.list)` does not.

**Where `unsafe` is allowed** such a value may also be borrowed and looked into, for as long as nothing may collect. That is checked, which an opt-out would not be.

**Generic functions** are checked as declared and again with each set of types that they are called with, in whatever crate they are. Code from outside the repository may not make such a value a trait object or hold it while something may collect. That finds the scratch memory of `sort_by` and `splice` when the callback allocates.

**May collect** follows calls to `Heap::collect`, except where a `DeferCollection` is alive in a local. A call that cannot be followed may collect if it goes to foreign code or is given a `Vm`, `Cx`, `Heap`, trait object or `unsafe fn`. A destructor may collect only if its value has one of these, and what is given a `Visitor` or `Survivors` runs inside a collection. `no_gc` and `signature` look for code that gets at the `Vm` by the back door, so they take what cannot be followed at its signature.

**Loose borrows.** `symbol.name()` points into a string that the symbol releases when it dies, and nothing keeps `symbol` in a register once the name has been read, not even a later use: the optimizer may have no need for it. A borrow is loose if it is made through a `&` of a cell and

- goes through a `Box`, or is of a field that owns memory (`StringRef`, `Rc`, `Vec`, `OnceBox`) or has a plain `Gc` in it, or
- is what a call returns for the lifetime of that `&`, unless it is a cell, a guard (its `Drop` calls `keep_alive`, or that of a `RefCell`), something that fits in the cell and owns nothing, or also bound to a `&NoGc`.

It goes where the borrow checker says that its lifetime goes. `symbol.anchor().name()` and `anchor!(self).name()` are not loose: the `Gc` stays in its place on the stack until it goes out of scope, for a store and the loss of a tail call. A function that takes `&Gc<T>` and returns a borrow has to anchor it. A `Gc` in a field of a cell cannot be anchored where it is: copy it, or anchor the cell.

`unsafe` code is out of scope: casts, `transmute`, addresses kept as integers.

## Opting out

```rust
#[cfg_attr(rootcheck, rootcheck::allow("collection is deferred"))]
```

On a function (what is in it and what it instantiates), a static, a field (of a cell: that of its `Init`) or a type (it does not hide; a container of it still does).

```rust
#[cfg_attr(rootcheck, rootcheck::stays("the frame holds it"))]
```

On a function (what it returns is not loose), a field (what is borrowed through it is not) or a type (it lends nothing, or is a guard).

Both are only for where the `unsafe_code` lint is allowed, and like `unsafe` they are promises.

## Tests

Each file in `tests/` is a crate that is compiled against the real `bun_engine_vm`. A line that ends in `//~ rule: text` has a finding that says that, and no other line has any.

## A new toolchain

The compiler's interface changes with every nightly. Its source comes with `rustc-dev`: `$(rustc --print sysroot)/lib/rustlib/rustc-src`.
