//! State that a cell owns.

#![forbid(unsafe_code)]
#![feature(negative_impls)]

use std::collections::VecDeque;
use std::mem;

use bun_engine_macros::{Trace, cell};
use bun_engine_vm::heap::OnceBox;
use bun_engine_vm::*;

fn allocate(vm: &Vm) -> Value {
    JsString::from_literal(vm, "new").into()
}

#[derive(Default, Trace)]
pub struct Entry {
    key: Option<Value>,
    values: Vec<Value>,
}

#[derive(Default, Trace)]
pub struct State {
    list: Vec<Value>,
    queue: VecDeque<Entry>,
    done: Vec<Entry>,
    by_id: FastHashMap<u32, Entry>,
    rare: Option<Box<Entry>>,
}

#[derive(Trace)]
pub struct Lists {
    first: TracedVec<Value>,
    second: TracedMap<u32, Value>,
}

#[cell]
pub struct Owner {
    base: JsCell,
    list: TracedVec<Value>,
    map: TracedMap<u32, Value>,
    state: GcCell<State>,
    once: OnceBox<Entry>,
    lists: Lists,
    bytes: Vec<u8>,
}

#[cell]
pub struct FilledTooEarly {
    base: JsCell,
    values: Box<[Value]>, //~ hidden: `Vm::allocate` may collect
    entry: Entry, //~ hidden: `Vm::allocate` may collect
}

#[cell]
pub struct Derived {
    base: FilledTooEarly,
}

impl Owner {
    pub fn create(vm: &Vm) -> Gc<Owner> {
        vm.allocate::<Owner>(OwnerInit {
            base: vm.shape_for::<Owner>(),
            once: OnceBox::new(),
            lists: Lists { first: TracedVec::empty(), second: TracedMap::empty() },
            bytes: Vec::new(),
        })
    }

    pub fn read(&self, vm: &Vm) -> usize {
        let state = self.state().borrow(vm);
        for value in state.list.iter().chain(state.rare.iter().flat_map(|it| &it.values)) {
            allocate(vm);
        }
        state.done.len() + self.list().take().len() + self.map().entries().len()
    }

    pub fn fill(&self, cx: &mut Cx, value: Value) {
        self.state().borrow_mut(cx).list.push(value);
        self.state().borrow_mut(cx).list = vec![value, value];
        self.state().borrow_mut(cx).rare = Some(Box::new(Entry { key: Some(value), values: Vec::new() }));
        *self.state().borrow_mut(cx) = State::default();
        let mut state = self.state().borrow_mut(cx);
        state.done.push(Entry { key: None, values: vec![value; 3] });
        state.by_id.entry(1).or_default().values.push(value);
        state.by_id.insert(2, Entry::default());
        state.rare.get_or_insert_default().values.push(value);
    }

    pub fn rearrange(&self, cx: &mut Cx) {
        let mut state = self.state().borrow_mut(cx);
        if let Some(entry) = state.queue.pop_front() {
            state.done.push(entry);
        }
        let Entry { key, values } = state.done.swap_remove(0);
        state.list = values;
        state.by_id.remove(&1);
        state.queue.clear();
        let State { list, done, .. } = &mut *state;
        mem::swap(list, &mut done[0].values);
    }

    pub fn move_to_root_memory(&self, cx: &mut Cx) {
        let mut list = root_vec();
        list.extend(mem::take(&mut self.state().borrow_mut(cx).list));
        for value in list {
            allocate(cx);
        }
    }

    pub fn take(&self, cx: &mut Cx) -> usize {
        let list = mem::take(&mut self.state().borrow_mut(cx).list); //~ hidden: borrowed here
        list.iter().len()
    }

    pub fn take_all(&self, cx: &mut Cx) -> usize {
        let state = mem::take(&mut *self.state().borrow_mut(cx)); //~ hidden: borrowed here
        state.list.iter().len()
    }

    pub fn take_and_iterate(&self, cx: &mut Cx) {
        for value in mem::take(&mut self.state().borrow_mut(cx).list) {} //~ hidden: IntoIter<
    }

    pub fn replace(&self, cx: &mut Cx) -> Value {
        let list = mem::replace(&mut self.state().borrow_mut(cx).list, Vec::new()); //~ hidden: borrowed here
        list[0]
    }

    pub fn swap(&self, cx: &mut Cx) {
        let mut list = Vec::new(); //~ hidden: borrowed here
        mem::swap(&mut self.state().borrow_mut(cx).list, &mut list);
    }

    pub fn take_option(&self, cx: &mut Cx) -> Option<Value> {
        let rare = self.state().borrow_mut(cx).rare.take()?; //~ hidden: looked into here
        rare.key
    }

    pub fn split(&self, cx: &mut Cx) -> bool {
        let tail = self.state().borrow_mut(cx).list.split_off(1); //~ hidden: borrowed here
        tail.first().is_none()
    }

    pub fn copy(&self, vm: &Vm) -> bool {
        let list = self.state().borrow(vm).list.clone(); //~ hidden: borrowed here
        list.first().is_none()
    }

    pub fn put_back_later(&self, cx: &mut Cx) {
        let list = mem::take(&mut self.state().borrow_mut(cx).list); //~ hidden: held while this may collect
        allocate(cx);
        self.state().borrow_mut(cx).list = list;
    }

    pub fn put_back_on_one_path(&self, cx: &mut Cx, function: Value) -> JsResult<()> {
        let entry = self.state().borrow_mut(cx).queue.pop_back(); //~ hidden: held while this may collect
        if function.get(cx, bun_engine_text::names::length)?.is_cell() {
            self.state().borrow_mut(cx).done.extend(entry);
        }
        Ok(())
    }

    pub fn allocate_while_building(&self, cx: &mut Cx) {
        let list = vec![allocate(cx), allocate(cx)]; //~ hidden: held while this may collect
        self.state().borrow_mut(cx).list = list;
    }

    pub fn collect_while_allocating(&self, cx: &mut Cx) {
        let list = (0..9).map(|_| allocate(cx)).collect(); //~ hidden: which this leads to
        self.state().borrow_mut(cx).list = list;
    }

    pub fn glance(&self, cx: &mut Cx) -> bool {
        let old = self.state().borrow_mut(cx).done.pop();
        let list = mem::take(&mut self.state().borrow_mut(cx).list);
        allocate(cx);
        old.is_some() || list.is_empty() || self.state().borrow_mut(cx).by_id.remove(&1).is_none()
    }

    pub fn discard_late(&self, cx: &mut Cx) {
        let old = self.state().borrow_mut(cx).done.pop();
        allocate(cx);
    }
}

struct AllocatesWhenDropped<'a>(&'a Vm);

impl Drop for AllocatesWhenDropped<'_> {
    fn drop(&mut self) {
        allocate(self.0);
    }
}

pub fn returned_past_a_destructor(vm: &Vm, value: Value) -> Vec<Value> { //~ hidden: held while this may collect
    let _guard = AllocatesWhenDropped(vm);
    vec![value]
}
