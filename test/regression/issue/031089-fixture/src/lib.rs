//! Compile-only fixture for issue #31089.
//!
//! Two `Copy + !Send + !Sync` payloads (`PhantomData<*const ()>`) that a
//! downstream crate might plausibly produce: `Evil` is plain `Copy`, and
//! `EvilAtom` additionally gets `unsafe_impl_atom!`'d. Before the
//! `AtomCrossThread` marker gated `AtomicCell<T>`'s `Send`/`Sync` impls
//! the plain wrap laundered `Evil` across threads; before
//! `AtomCrossThread` was decoupled from `unsafe_impl_atom!` the macro
//! path laundered `EvilAtom`. Both must fail to compile with the fix in
//! place. The companion `031089.test.ts` asserts `cargo check` fails
//! citing the missing `AtomCrossThread` bound — so reverting either
//! half of the production change flips the test red.
#![allow(dead_code)]

use core::marker::PhantomData;

// Plain `Copy + !Send + !Sync`, no `Atom` impl. Exercises the
// `AtomicCell<T>: Send/Sync where T: Copy + AtomCrossThread` bound
// directly.
#[derive(Copy, Clone)]
pub struct Evil {
    bits: u32,
    _p: PhantomData<*const ()>,
}

// Same shape as `Evil`, plus an `Atom` impl via `unsafe_impl_atom!`.
// Exercises the second half of the fix: the macro must NOT auto-grant
// `AtomCrossThread`, otherwise an `unsafe_impl_atom!` caller re-opens
// the hole even though the `AtomicCell<T>` bound is correctly
// tightened. See coderabbit's review on #31090.
#[derive(Copy, Clone)]
#[repr(C)]
pub struct EvilAtom {
    bits: u32,
    _p: PhantomData<*const ()>,
}
// SAFETY (test-only): `EvilAtom` is 4 bytes, no padding — the `Atom`
// contract is about bit patterns, not thread safety, so this is a
// deliberately sound `Atom` impl. Cross-thread publishing is a
// separate `AtomCrossThread` opt-in which this fixture intentionally
// does NOT declare.
bun_core::unsafe_impl_atom!(EvilAtom);

fn assert_send<T: Send>() {}
fn assert_sync<T: Sync>() {}

pub fn launder_send() {
    assert_send::<bun_core::AtomicCell<Evil>>();
}

pub fn launder_sync() {
    assert_sync::<bun_core::AtomicCell<Evil>>();
}

pub fn launder_send_via_atom_macro() {
    assert_send::<bun_core::AtomicCell<EvilAtom>>();
}

pub fn launder_sync_via_atom_macro() {
    assert_sync::<bun_core::AtomicCell<EvilAtom>>();
}
