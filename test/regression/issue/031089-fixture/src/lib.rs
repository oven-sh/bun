//! Compile-only fixture for issue #31089.
//!
//! `Evil` is `Copy + !Send + !Sync` (via `PhantomData<*const ()>`). Before
//! the `AtomCrossThread` marker gated `AtomicCell<T>`'s `Send`/`Sync`
//! impls, wrapping `Evil` in `AtomicCell` laundered it across threads —
//! the coderabbit audit finding. This crate deliberately tries the
//! launder; with the fix in place `cargo check` fails with
//! `E0277` citing the missing `AtomCrossThread` bound. The companion
//! `031089.test.ts` asserts both the failure and the error text, so
//! reverting the production change flips the test red.
#![allow(dead_code)]

use core::marker::PhantomData;

#[derive(Copy, Clone)]
pub struct Evil {
    bits: u32,
    _p: PhantomData<*const ()>,
}

fn assert_send<T: Send>() {}
fn assert_sync<T: Sync>() {}

pub fn launder_send() {
    assert_send::<bun_core::AtomicCell<Evil>>();
}

pub fn launder_sync() {
    assert_sync::<bun_core::AtomicCell<Evil>>();
}
