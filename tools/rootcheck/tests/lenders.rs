//! `--lenders`, and `rootcheck::stays`.

#![feature(negative_impls)]

use bun_engine_macros::cell;
use bun_engine_text::{StringRef, Text};
use bun_engine_vm::*;

#[cell]
pub struct Owner {
    base: JsCell,
    string: StringRef,
    #[cfg_attr(rootcheck, rootcheck::stays("a reason"))]
    immortal: StringRef,
    count: std::cell::Cell<u32>,
}

impl Owner {
    pub fn text(&self) -> Text<'_> { //~ lender: lends `bun_engine_text::Text<'_>`
        self.string.text()
    }

    #[cfg_attr(rootcheck, rootcheck::stays("a reason"))]
    pub fn trusted(&self) -> Text<'_> { //~ lender: stays
        self.string.text()
    }

    pub fn count(&self) -> &std::cell::Cell<u32> {
        &self.count
    }

    pub fn without_collection<'a>(&'a self, _: &'a NoGc<'_>) -> Text<'a> {
        self.string.text()
    }

    pub fn from_a_field_that_stays(&self, vm: &Vm) -> Gc<JsString> {
        JsString::from_text(vm, self.immortal.text())
    }

    pub fn from_a_function_that_stays(&self, vm: &Vm) -> Gc<JsString> {
        JsString::from_text(vm, self.trusted())
    }

    pub fn under_a_token(&self, cx: &mut Cx, read: impl FnOnce(Text<'_>)) {
        read(self.without_collection(&cx.no_gc()));
    }

    #[cfg_attr(rootcheck, rootcheck::allow("a reason"))]
    pub fn allowed(&self, vm: &Vm) -> Gc<JsString> {
        JsString::from_text(vm, self.text())
    }

    pub fn inside_a_collection(&self, visitor: &mut Visitor, run: &dyn Fn(Text<'_>)) {
        run(self.text());
    }
}

pub struct Frame<'a>(&'a Owner);

impl<'a> Frame<'a> {
    #[cfg_attr(rootcheck, rootcheck::stays("a reason"))]
    pub fn text(&self) -> Text<'a> {
        self.0.text()
    }

    #[cfg_attr(rootcheck, rootcheck::stays)] //~ allow: takes a reason
    pub fn no_reason(&self) {}
}

pub struct KeptElsewhere<'a> {
    #[cfg_attr(rootcheck, rootcheck::stays("a reason"))]
    kept: &'a Owner,
    other: &'a Owner,
}

impl<'a> KeptElsewhere<'a> {
    pub fn text(&self, vm: &Vm) -> Text<'a> {
        JsString::from_text(vm, self.kept.string.text());
        JsString::from_text(vm, self.other.string.text()); //~ borrow: held while this may collect
        self.kept.text()
    }
}

pub struct Guard<'a>(&'a Owner, Text<'a>);

impl Drop for Guard<'_> {
    fn drop(&mut self) {
        Gc::from(self.0).keep_alive();
    }
}

fn guard(owner: &Owner) -> Guard<'_> {
    Guard(owner, owner.text())
}

pub fn guarded(vm: &Vm, owner: &Owner) -> Gc<JsString> {
    JsString::from_text(vm, guard(owner).1)
}
