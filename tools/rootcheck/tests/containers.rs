//! Memory of the Rust allocator.

#![forbid(unsafe_code)]

use std::borrow::Cow;
use std::cell::{Cell, OnceCell, RefCell};
use std::collections::{BTreeMap, BTreeSet, BinaryHeap, HashMap, HashSet, LinkedList, VecDeque};
use std::mem::ManuallyDrop;
use std::pin::Pin;
use std::rc::{Rc, Weak};
use std::sync::{Arc, Mutex, mpsc};

use bun_engine_vm::heap::{RootBox, root_box};
use bun_engine_vm::*;
use smallvec::SmallVec;

fn see<T: ?Sized>(_: &T) {}

pub fn each_container(value: Value, object: Gc<JsObject>) {
    let vec = vec![value]; //~ hidden: Vec<bun_engine_vm::Value>
    see(&vec);
    let boxed = Box::new(object); //~ hidden: Box<bun_engine_vm::Gc<
    see(&boxed);
    let slice: Box<[Value]> = Box::new([value]); //~ hidden: Box<[bun_engine_vm::Value]>
    see(&slice);
    let deque = VecDeque::from([value]); //~ hidden: VecDeque<
    see(&deque);
    let rc = Rc::new(value); //~ hidden: Rc<
    see(&rc);
    let weak = Weak::<Value>::new(); //~ hidden: Weak<
    see(&weak);
    let arc = Arc::new(value); //~ hidden: Arc<
    see(&arc);
    let tree = BTreeMap::from([(1, value)]); //~ hidden: BTreeMap<
    see(&tree);
    let tree_set = BTreeSet::<Value>::new(); //~ hidden: BTreeSet<
    see(&tree_set);
    let heap = BinaryHeap::<(u8, Value)>::with_capacity(1); //~ hidden: BinaryHeap<
    see(&heap);
    let list = LinkedList::from([value]); //~ hidden: LinkedList<
    see(&list);
    let map = HashMap::from([(object, 1)]); //~ hidden: HashMap<
    see(&map);
    let set = HashSet::from([object]); //~ hidden: HashSet<
    see(&set);
    let fast_map = FastHashMap::<u32, Value>::default(); //~ hidden: HashMap<
    see(&fast_map);
    let fast_set = FastHashSet::<Gc<JsObject>>::default(); //~ hidden: HashSet<
    see(&fast_set);
    let table = hashbrown::HashTable::<Value>::new(); //~ hidden: HashTable<
    see(&table);
    let small = SmallVec::<[Value; 4]>::new(); //~ hidden: SmallVec<
    see(&small);
    let (sender, _) = mpsc::channel::<Value>(); //~ hidden: Sender<
    see(&sender);
}

pub fn each_kind_of_reference(cx: &mut Cx, object: &JsObject, frame: &CallFrame, view: StringView) {
    let references = vec![object]; //~ hidden: Vec<&bun_engine_vm::JsObject>
    see(&references);
    let options = vec![Some(object.shape())]; //~ hidden: Vec<std::option::Option<
    see(&options);
    let storages = vec![Storage::NONE]; //~ hidden: Storage
    see(&storages);
    let calls = vec![CallData::NONE]; //~ hidden: CallData
    see(&calls);
    let frames = vec![frame]; //~ hidden: CallFrame
    see(&frames);
    let views = vec![view]; //~ hidden: StringView
    see(&views);
    let fields = vec![Field::new(Value::NULL)]; //~ hidden: Field<
    see(&fields);
    let realms = vec![cx]; //~ hidden: Cx
    see(&realms);
}

pub fn inside_other_types(value: Value) {
    let option = Some(vec![value]); //~ hidden: borrowed here
    see(&option);
    let tuple = (1, [Box::new(value)]); //~ hidden: borrowed here
    see(&tuple);
    let cell = RefCell::new(Vec::new()); //~ hidden: borrowed here
    cell.borrow_mut().push(value);
    let plain_cell = Cell::new(Box::new(value)); //~ hidden: borrowed here
    see(&plain_cell);
    let once = OnceCell::<Vec<Value>>::new(); //~ hidden: borrowed here
    see(&once);
    let mutex = Mutex::new(vec![value]); //~ hidden: borrowed here
    see(&mutex);
    let forgotten = ManuallyDrop::new(vec![value]); //~ hidden: borrowed here
    see(&forgotten);
    let pinned: Pin<Box<Value>> = Box::pin(value); //~ hidden: borrowed here
    see(&pinned);
    let cow: Cow<'_, [Value]> = Cow::Owned(vec![value]); //~ hidden: borrowed here
    see(&cow);
    let nested = vec![vec![Some((1, value))]]; //~ hidden: borrowed here
    see(&nested);
}

pub fn inside_root_memory(value: Value) {
    let mut lists: RootVec<Vec<Value>> = root_vec(); //~ hidden: Vec<bun_engine_vm::Value>
    lists.push(Vec::new());
    let boxed: RootBox<Option<Rc<Value>>> = root_box(None); //~ hidden: Rc<
    see(&boxed);
}

pub fn temporaries(cx: &mut Cx, values: &[Value]) -> JsResult<usize> {
    cx.new_array_from(&values.to_vec())?; //~ hidden: borrowed here
    Ok(values.iter().copied().collect::<Vec<_>>().iter().len()) //~ hidden: borrowed here
}

pub fn iterators(value: Value, object: Gc<JsObject>) {
    for it in vec![value] {} //~ hidden: IntoIter<
    for it in VecDeque::from([value]) {} //~ hidden: IntoIter<
    for it in BTreeMap::from([(1, value)]) {} //~ hidden: IntoIter<
    for it in HashSet::from([object]) {} //~ hidden: IntoIter<
    for it in FastHashMap::from_iter([(1, value)]) {} //~ hidden: IntoIter<
    for it in SmallVec::from([value]) {} //~ hidden: IntoIter<
    for it in opaque(value) {} //~ hidden: IntoIter<
}

fn opaque(value: Value) -> impl Iterator<Item = Value> {
    vec![value].into_iter().rev()
}

pub fn parameter(list: Vec<Value>) -> usize { //~ hidden: borrowed here
    list.iter().len()
}

pub fn looked_into(boxed: Box<(u8, Value)>) -> Value { //~ hidden: looked into here
    boxed.1
}

pub fn moved_out_of(boxed: Box<StringView>) -> StringView { //~ hidden: looked into here
    *boxed
}

pub fn held(vm: &Vm, list: Vec<Value>) -> (Gc<JsString>, Vec<Value>) { //~ hidden: held while this may collect
    (JsString::from_literal(vm, "new"), list)
}

pub fn captured(value: Value) -> usize {
    let list = vec![value];
    let length = move || list.iter().len(); //~ hidden: borrowed here
    length()
}

pub struct Untraced {
    list: Vec<Value>, //~ hidden: `Untraced` is neither traced
    name: String,
}

pub enum AlsoUntraced {
    Empty,
    Boxed(Box<Gc<JsObject>>), //~ hidden: `AlsoUntraced` is neither traced
}

pub fn reported_once(untraced: Untraced) {
    see(&untraced);
}

pub struct Stack<T> {
    items: Vec<T>,
}

pub fn generic_type(value: Value) {
    let numbers = Stack { items: vec![1] };
    see(&numbers);
    let values = Stack { items: vec![value] }; //~ hidden: borrowed here
    see(&values);
}

pub struct Node {
    value: Value,
    next: Option<Box<Node>>, //~ hidden: `Node` is neither traced
}

pub async fn suspended(value: Value) -> Value {
    std::future::ready(()).await;
    value
}

pub fn future(value: Value) {
    let future = Box::pin(suspended(value)); //~ hidden: borrowed here
    see(&future);
}

pub trait Kind {
    type Storage: Default;
}

impl Kind for u8 {
    type Storage = Vec<Value>;
}

#[derive(Default)]
pub struct ByKind<K: Kind>(K::Storage);

pub fn associated_type() {
    let storage = ByKind::<u8>::default(); //~ hidden: borrowed here
    see(&storage);
}

pub fn results(cx: &Cx, values: &[Value], root: &RootVec<Value>) -> JsResult<()> {
    let checked = values.iter().map(|&it| Ok(it)).collect::<JsResult<Vec<_>>>()?; //~ hidden: borrowed here
    let (left, right): (Vec<_>, Vec<_>) = values.iter().map(|&it| (it, 1)).unzip(); //~ hidden: borrowed here
    let joined = [values, values].concat(); //~ hidden: borrowed here
    let copied = root.to_vec(); //~ hidden: borrowed here
    let uninit = Box::<[Value]>::new_uninit_slice(2); //~ hidden: borrowed here
    let lazy = std::cell::LazyCell::new(|| values.to_vec()); //~ hidden: borrowed here
    see(&(&checked, &left, &right, &joined, &copied, &uninit, &lazy));
    Ok(())
}

pub fn of_any_cell<T: CellKind>(cell: Gc<T>) {
    let list = vec![cell]; //~ hidden: borrowed here
    see(&list);
}

fn returned_closure(value: Value) -> impl Fn() -> bool {
    let list = vec![value];
    move || list.is_empty()
}

pub fn calls_returned_closure(value: Value) -> bool {
    returned_closure(value)() //~ hidden: borrowed here
}
