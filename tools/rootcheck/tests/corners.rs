//! One case for each condition that the other files leave alone.

#![feature(negative_impls)]

use std::cell::RefCell;
use std::marker::PhantomData;

use bun_engine_macros::cell;
use bun_engine_text::StringRef;
use bun_engine_vm::*;

fn allocate(vm: &Vm) -> Value {
    JsString::from_literal(vm, "new").into()
}

fn see<T>(_: T) {}

pub fn across_an_unsafe_function(run: unsafe fn(), list: Vec<Value>) -> Vec<Value> { //~ hidden: held
    // SAFETY: a test.
    unsafe { run() };
    list
}

pub fn across_a_safe_function(run: fn(), list: Vec<Value>) -> Vec<Value> {
    run();
    list
}

pub fn only_matched_on(vm: &Vm, list: Option<Vec<Value>>) -> bool {
    allocate(vm);
    matches!(list, Some(_))
}

pub struct FreeIfContentIs<T>(T);

// SAFETY: a test.
unsafe impl<T: GcFree> GcFree for FreeIfContentIs<T> {}

pub fn content_refers(vm: &Vm, list: Vec<FreeIfContentIs<Value>>) -> Vec<FreeIfContentIs<Value>> { //~ hidden: held
    allocate(vm);
    list
}

pub fn content_does_not(vm: &Vm, list: Vec<FreeIfContentIs<u8>>) -> Vec<FreeIfContentIs<u8>> {
    allocate(vm);
    list
}

#[cell]
pub struct Owner {
    base: JsCell,
    boxed: Box<(u8, u8)>,
    bytes: Vec<u8>,
    checked: RefCell<Vec<u8>>,
    elsewhere: *const StringRef,
    vm: *const Vm,
}

pub struct Raw<'a>(*const u8, PhantomData<fn() -> &'a ()>);

impl Owner {
    fn raw(&self) -> Raw<'_> {
        Raw(self.bytes.as_ptr(), PhantomData)
    }

    fn erased(&self) -> Box<dyn Iterator<Item = u8> + '_> {
        Box::new(std::iter::empty())
    }

    fn vm(&self) -> &Vm {
        // SAFETY: a test.
        unsafe { &*self.vm }
    }
}

pub fn part_of_a_box(vm: &Vm, owner: Gc<Owner>) {
    let part = &owner.boxed.0; //~ borrow: does not keep
    allocate(vm);
    see(part);
}

pub fn behind_a_raw_pointer(vm: &Vm, owner: Gc<Owner>) {
    // SAFETY: a test.
    let string = unsafe { &*owner.elsewhere };
    allocate(vm);
    see(string);
}

pub fn raw_with_a_lifetime(vm: &Vm, owner: Gc<Owner>) {
    let raw = owner.raw(); //~ borrow: does not keep
    allocate(vm);
    see(raw);
}

pub fn trait_object_with_a_lifetime(vm: &Vm, owner: Gc<Owner>) {
    let erased = owner.erased(); //~ borrow: does not keep
    allocate(vm);
    see(erased);
}

pub fn what_outlives_cells(owner: &Owner, _: &Vm) {
    let vm = owner.vm();
    allocate(vm);
    see(vm);
}

/// A cell all the same.
#[repr(C)]
pub struct Extended {
    base: Owner,
    name: StringRef,
}

pub fn without_cell_kind(vm: &Vm, extended: &Extended) {
    let name = &extended.name; //~ borrow: does not keep
    allocate(vm);
    see(name);
}

pub trait Step {
    fn step(&self);
}

pub fn across_an_iterator<I: Iterator>(symbol: Gc<JsSymbol>, mut it: I, _: &Vm) {
    let name = symbol.name(); //~ borrow: does not keep
    it.next();
    see(name);
}

pub fn across_an_iterable<I: IntoIterator>(symbol: Gc<JsSymbol>, it: I, _: &Vm) {
    let name = symbol.name(); //~ borrow: does not keep
    it.into_iter();
    see(name);
}

pub fn across_a_trait_of_ours<S: Step>(symbol: Gc<JsSymbol>, it: S, _: &Vm) {
    let name = symbol.name(); //~ borrow: does not keep
    it.step();
    see(name);
}

pub fn across_what_has_no_access<I: Iterator + GcFree>(symbol: Gc<JsSymbol>, mut it: I, _: &Vm) {
    let name = symbol.name();
    it.next();
    see(name);
}

pub fn inside_a_collection<I: Iterator>(symbol: Gc<JsSymbol>, mut it: I, _: &mut Visitor) {
    let name = symbol.name();
    it.next();
    see(name);
}

fn conjure<'a>(address: usize) -> &'a Vm {
    // SAFETY: a test.
    unsafe { Cx::from_global(Gc::from_address(address)) }
}

pub extern "C" fn for_foreign_code(global: Gc<GlobalObject>) -> u64 {
    allocate(conjure(global.address())).to_bits()
}

pub fn given_no_cell(address: usize) -> u64 {
    allocate(conjure(address)).to_bits()
}

pub struct Marked<T> {
    value: Value,
    marker: PhantomData<T>,
    also: PhantomData<Value>,
}

// SAFETY: a test.
unsafe impl<T> Trace for Marked<T> {
    fn trace(&self, visitor: &mut Visitor) {
        self.value.trace(visitor);
    }
}

pub struct Unrelated {
    list: Vec<Value>, //~ hidden: hides
}

pub struct OnlyNamesIt {
    value: Value,
    callback: fn(&Unrelated),
}

// SAFETY: a test.
unsafe impl Trace for OnlyNamesIt {
    fn trace(&self, visitor: &mut Visitor) {
        self.value.trace(visitor);
    }
}
