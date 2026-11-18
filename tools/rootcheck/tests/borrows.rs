//! Memory that a cell owns outside itself.

#![forbid(unsafe_code)]
#![feature(arbitrary_self_types, negative_impls)]

use std::cell::{Cell, OnceCell, Ref, RefCell};
use std::rc::Rc;

use bun_engine_macros::{Trace, cell};
use bun_engine_text::{Identifier, PropertyName, StringRef, Text};
use bun_engine_vm::heap::{Held, OnceBox, Owned};
use bun_engine_vm::*;

fn allocate(vm: &Vm) -> Value {
    JsString::from_literal(vm, "new").into()
}

fn see<T>(_: T) {}

#[derive(Default, Trace)]
pub struct Rare {
    count: Cell<u32>,
    other: Option<Gc<Owner>>,
}

#[derive(Trace)]
pub struct Part {
    other: Gc<Owner>,
}

impl Part {
    fn text(&self) -> Text<'_> {
        self.other.anchor().text()
    }

    fn loose_text(&self) -> Text<'_> {
        self.other.text() //~ borrow: it leaves the function
    }
}

#[cell]
pub struct Owner {
    base: JsCell,
    string: StringRef,
    names: Box<[Identifier]>,
    shared: Rc<Vec<u8>>,
    lazy: OnceCell<Vec<u8>>,
    rare: OnceBox<Rare>,
    count: Cell<u32>,
    taken: Cell<Option<StringRef>>,
    checked: RefCell<Vec<u8>>,
    list: TracedVec<Value>,
    state: GcCell<Vec<Value>>,
    other: Gc<Owner>,
    maybe: Option<Gc<Owner>>,
    part: Part,
    literal: &'static str,
}

#[cell]
pub struct Derived {
    base: Owner,
}

impl Owner {
    fn text(&self) -> Text<'_> {
        self.string.text()
    }

    fn string(&self) -> &StringRef {
        &self.string
    }

    fn name(&self, index: usize) -> PropertyName<'_> {
        self.names[index].name()
    }

    fn names(&self) -> impl Iterator<Item = PropertyName<'_>> {
        self.names.iter().map(|it| it.name())
    }

    fn count(&self) -> &Cell<u32> {
        &self.count
    }

    fn rare_count(&self) -> &Cell<u32> {
        &self.rare.get_or_default().count //~ borrow: it leaves the function
    }

    fn checked(&self) -> Ref<'_, Vec<u8>> {
        self.checked.borrow()
    }

    fn held(&self) -> Held<'_, [Identifier]> {
        Held::new(self, &self.names)
    }

    fn anchored_text(self: &Gc<Self>) -> Text<'_> {
        self.anchor().string.text()
    }

    fn not_anchored_text(self: &Gc<Self>) -> Text<'_> {
        self.string.text() //~ borrow: it leaves the function
    }

    fn into_list<'a>(&'a self, out: &mut Vec<Text<'a>>) {
        out.push(self.text()); //~ borrow: it leaves the function
    }

    pub fn fields(&self, vm: &Vm) {
        let string = &self.string; //~ borrow: held while this may collect
        let names = &*self.names; //~ borrow: held while this may collect
        let name = &self.names[0]; //~ borrow: held while this may collect
        let shared = self.shared.as_slice(); //~ borrow: held while this may collect
        let lazy = self.lazy.get(); //~ borrow: held while this may collect
        let rare = self.rare.get(); //~ borrow: held while this may collect
        allocate(vm);
        see((string, names, name, shared, lazy, rare));
    }

    pub fn fields_that_lend_nothing(&self, vm: &Vm) {
        let (count, taken, checked) = (&self.count, &self.taken, self.checked.borrow());
        let (list, state, literal) = (self.list(), self.state().borrow(vm), self.literal);
        let (base, other): (&JsCell, &Owner) = (self, &self.other);
        allocate(vm);
        see((count, taken, checked, list, state, literal, base, other));
    }

    pub fn anchored_fields(&self, vm: &Vm) {
        let this = anchor!(self);
        let all = (&this.string, &this.names[0], this.rare.get(), this.text(), this.other.text());
        allocate(vm);
        see(all);
    }
}

pub fn accessors(vm: &Vm, owner: Gc<Owner>, derived: &Derived) {
    let text = owner.text(); //~ borrow: held while this may collect
    let string = owner.string(); //~ borrow: held while this may collect
    let name = owner.name(0); //~ borrow: held while this may collect
    let names = owner.names(); //~ borrow: held while this may collect
    let inherited = derived.text(); //~ borrow: held while this may collect
    let (count, checked, held) = (owner.count(), owner.checked(), owner.held());
    allocate(vm);
    see((text, string, name, names, inherited, count, checked, held));
}

pub fn anchored(vm: &Vm, owner: Gc<Owner>, derived: Gc<Derived>, part: Part) {
    let all = (owner.anchor().text(), owner.anchored_text(), derived.anchor().name(0), part.text());
    allocate(vm);
    see(all);
}

pub fn passed(vm: &Vm, owner: Gc<Owner>) -> Gc<JsString> {
    JsString::from_text(vm, owner.text()) //~ borrow: held while this may collect
}

pub fn passed_anchored(vm: &Vm, owner: Option<Gc<Owner>>) -> Option<Gc<JsString>> {
    Some(JsString::from_text(vm, owner?.anchor().text()))
}

pub fn done_before(vm: &Vm, owner: Gc<Owner>) -> usize {
    let length = owner.text().len();
    let copy = owner.string().clone();
    allocate(vm);
    length + copy.len()
}

pub fn deferred(vm: &Vm, owner: Gc<Owner>) -> Gc<JsString> {
    let _defer = vm.heap.defer_collection();
    JsString::from_text(vm, owner.text())
}

pub fn used_later_is_not_enough(vm: &Vm, owner: Gc<Owner>) -> Gc<Owner> {
    JsString::from_text(vm, owner.text()); //~ borrow: held while this may collect
    owner
}

pub fn derived_borrow(vm: &Vm, owner: Gc<Owner>) -> u16 {
    let rest = owner.string().text().slice(1..2); //~ borrow: held while this may collect
    allocate(vm);
    rest.at(0)
}

pub fn in_a_loop(vm: &Vm, owner: &Owner) {
    for name in owner.names.iter() { //~ borrow: held while this may collect
        allocate(vm);
    }
}

pub fn in_a_container(vm: &Vm, owner: &Owner) -> usize {
    let mut texts = Vec::new();
    texts.push(owner.text()); //~ borrow: held while this may collect
    allocate(vm);
    texts[0].len()
}

pub fn only_dropped_afterwards(vm: &Vm, owner: &Owner) {
    let texts = vec![owner.text()];
    allocate(vm);
}

pub fn through_a_closure(vm: &Vm, owner: Option<Gc<Owner>>, other: Option<&Owner>) {
    let by_closure = owner.as_ref().map(|it| it.text()); //~ borrow: held while this may collect
    let by_path = other.map(Owner::text); //~ borrow: held while this may collect
    let anchored = owner.as_ref().map(|it| it.anchor().text());
    allocate(vm);
    see((by_closure, by_path, anchored));
}

pub fn captured(vm: &Vm, owner: &Owner) {
    let text = owner.text(); //~ borrow: held while this may collect
    let run = || see((allocate(vm), text));
    run();
}

pub fn captured_field(vm: &Vm, owner: &Owner) {
    let run = || see((owner.string.text(), allocate(vm))); //~ borrow: held while this may collect
    run();
}

pub fn as_a_trait_object(vm: &Vm, owner: &Owner) {
    let text = owner.text(); //~ borrow: held while this may collect
    let length = || text.len();
    let length: &dyn Fn() -> usize = &length;
    allocate(vm);
    length();
}

pub fn through_a_function_pointer(vm: &Vm, owner: &Owner, get: fn(&Owner) -> Text<'_>) {
    let text = get(owner); //~ borrow: held while this may collect
    allocate(vm);
    see(text);
}

pub fn unknown_callback(owner: &Owner, run: impl FnOnce(Text<'_>)) {
    run(owner.text()); //~ borrow: held while this may collect
}

pub fn unknown_callback_through_the_standard_library(owner: &Owner, run: impl FnMut(u8)) {
    owner.shared.iter().copied().for_each(run); //~ borrow: held while this may collect
}

fn known_callback(owner: &Owner, run: impl FnOnce(Text<'_>)) {
    run(owner.text()); //~ borrow: held while this may collect
}

fn harmless_callback(owner: &Owner, run: impl FnOnce(Text<'_>)) {
    run(owner.text());
}

fn reached_from_another_crate(owner: &Owner, run: impl FnOnce(Text<'_>)) {
    run(owner.text()); //~ borrow: held while this may collect
}

pub fn callbacks(vm: &Vm, owner: &Owner) {
    known_callback(owner, |text| see(text));
    known_callback(owner, |text| see(JsString::from_text(vm, text)));
    harmless_callback(owner, |text| see(text));
}

pub fn passes_on(owner: &Owner, run: impl FnOnce(Text<'_>)) {
    reached_from_another_crate(owner, run);
}

pub static IN_A_STATIC: fn(&Vm, &Owner) -> Gc<JsString> =
    |vm, owner| JsString::from_text(vm, owner.text()); //~ borrow: held while this may collect

pub fn beside_a_constant(vm: &Vm, owner: &Owner) -> Gc<JsString> {
    const { assert!(size_of::<Owner>() != 0) };
    JsString::from_text(vm, owner.text()) //~ borrow: held while this may collect
}

pub fn closure_that_lends_what_would_fit(vm: &Vm, owner: Option<&Owner>) {
    let count = owner.map(|it| &it.rare.get_or_default().count); //~ borrow: held while this may collect
    allocate(vm);
    see(count);
}

pub fn pattern(vm: &Vm, owner: &Owner) {
    let Owner { string, count, .. } = owner; //~ borrow: held while this may collect
    allocate(vm);
    see((string, count));
}

struct InDestructor<'a>(&'a Vm, &'a Owner);

impl Drop for InDestructor<'_> {
    fn drop(&mut self) {
        JsString::from_text(self.0, self.1.text()); //~ borrow: held while this may collect
    }
}

impl AsRef<StringRef> for Owner {
    fn as_ref(&self) -> &StringRef {
        &self.string
    }
}

fn knows_nothing_of_cells<T: AsRef<StringRef>>(vm: &Vm, value: &T) -> Gc<JsString> {
    JsString::from_text(vm, value.as_ref().text()) //~ borrow: held while this may collect
}

pub fn gives_it_a_cell(vm: &Vm, owner: &Owner) -> Gc<JsString> {
    knows_nothing_of_cells(vm, owner)
}

pub trait Named: CellKind {
    fn name(&self) -> Text<'_>;
}

pub fn generic_cell<T: Named>(vm: &Vm, cell: &T) -> Gc<JsString> {
    JsString::from_text(vm, cell.name()) //~ borrow: held while this may collect
}

pub fn anchored_on_one_path(vm: &Vm, a: Gc<Owner>, b: Gc<Owner>, flag: bool) -> Gc<JsString> {
    let owner = if flag { a.anchor() } else { &*b };
    JsString::from_text(vm, owner.text()) //~ borrow: held while this may collect
}

pub fn anchor_inside_a_cell(vm: &Vm, owner: &Owner) {
    let direct = owner.other.anchor().text(); //~ borrow: held while this may collect
    let optional = owner.maybe.as_ref().map(|it| it.anchored_text()); //~ borrow: held while this may collect
    let nested = owner.part.text(); //~ borrow: held while this may collect
    let copy = owner.other;
    let copied = copy.anchor().text();
    allocate(vm);
    see((direct, optional, nested, copied));
}

pub fn anchor_in_root_memory(vm: &Vm, owners: &RootVec<Gc<Owner>>) {
    for owner in owners {
        JsString::from_text(vm, owner.anchor().text());
    }
}

pub struct Context<'a> {
    owner: &'a Owner,
}

impl<'a> Context<'a> {
    fn text(&self) -> Text<'a> {
        self.owner.text() //~ borrow: it leaves the function
    }

    fn list(&self) -> Owned<'a, TracedVec<Value>> {
        self.owner.list()
    }
}

pub fn from_the_engine(cx: &mut Cx, object: Gc<JsObject>, symbol: Gc<JsSymbol>) -> JsResult<Value> {
    object.get(cx, symbol.name())?; //~ borrow: held while this may collect
    object.get(cx, symbol.anchor().name())?;
    object.get(cx, PropertyKey::from_symbol(symbol).name())
}
