//! Follows calls: into generic functions, to see them with the types that they are used with, and towards the
//! collector.

use std::cell::RefCell;
use std::collections::VecDeque;

use rustc_ast::InlineAsmOptions;
use rustc_data_structures::fx::{FxHashMap, FxHashSet};
use rustc_errors::Diag;
use rustc_hir::def::DefKind;
use rustc_hir::def_id::DefId;
use rustc_middle::mir::visit::Visitor;
use rustc_middle::mir::{
    CastKind, Const, ConstOperand, InlineAsmOperand, Location, Rvalue, Terminator, TerminatorKind,
    traversal,
};
use rustc_middle::ty::adjustment::PointerCoercion;
use rustc_middle::ty::{
    self, GenericArgs, Instance, InstanceKind, ShimKind, Ty, TypeVisitableExt, TypingEnv, VtblEntry,
};
use rustc_span::Span;

use crate::bodies::{self, Finding, Frame};
use crate::types::Types;

pub struct Calls<'a, 'tcx> {
    cx: &'a Types<'tcx>,
    /// Code that cannot be followed is taken to allocate only with what it is given.
    goes_by_signatures: bool,
    collects: RefCell<FxHashMap<Instance<'tcx>, Option<Way<'tcx>>>>,
    mentions_upper: RefCell<FxHashMap<GenericArgs<'tcx>, bool>>,
}

/// How a function gets to the collector.
#[derive(Clone, Copy)]
pub enum Way<'tcx> {
    Through(Instance<'tcx>),
    At(Span),
}

impl<'a, 'tcx> Calls<'a, 'tcx> {
    pub fn new(cx: &'a Types<'tcx>) -> Self {
        let (collects, mentions_upper) = Default::default();
        Calls { cx, goes_by_signatures: false, collects, mentions_upper }
    }

    pub fn going_by_signatures(cx: &'a Types<'tcx>) -> Self {
        Calls { goes_by_signatures: true, ..Calls::new(cx) }
    }

    pub fn is_generic(&self, def_id: DefId) -> bool {
        let tcx = self.cx.tcx;
        tcx.generics_of(tcx.typeck_root_def_id(def_id)).requires_monomorphization(tcx)
    }

    pub fn as_declared(&self, def_id: DefId) -> Instance<'tcx> {
        let tcx = self.cx.tcx;
        let closure = tcx.is_closure_like(def_id).then(|| tcx.type_of(def_id).skip_binder());
        let args = match closure.map(|it| *it.kind()) {
            Some(ty::Closure(_, args) | ty::CoroutineClosure(_, args) | ty::Coroutine(_, args)) => {
                args
            }
            _ => GenericArgs::identity_for_item(tcx, def_id),
        };
        Instance::new_raw(def_id, tcx.erase_and_anonymize_regions(args))
    }

    /// Whether code that knows nothing of the engine is given something that does.
    fn mentions_upper(&self, args: GenericArgs<'tcx>) -> bool {
        *self.mentions_upper.borrow_mut().entry(args).or_insert_with(|| {
            let mut types = args.iter().flat_map(|it| it.walk()).filter_map(|it| it.as_type());
            types.any(|ty| self.cx.is_upper(ty))
        })
    }

    pub fn frame(&self, instance: Instance<'tcx>, env: TypingEnv<'tcx>) -> Option<Frame<'a, 'tcx>> {
        let tcx = self.cx.tcx;
        let has_body = match instance.def {
            InstanceKind::Item(def_id) => match tcx.def_kind(def_id) {
                DefKind::Ctor(..) | DefKind::GlobalAsm => false,
                kind if kind.is_fn_like() => tcx.is_mir_available(def_id),
                _ => !tcx.is_trivial_const(def_id),
            },
            InstanceKind::Shim(ShimKind::DropGlue(_, ty)) => ty.is_some(),
            InstanceKind::Shim(_) => true,
            _ => false,
        };
        has_body.then(|| Frame { cx: self.cx, instance, env, body: tcx.instance_mir(instance.def) })
    }

    pub fn resolve(&self, frame: Frame<'_, 'tcx>, function: Ty<'tcx>) -> Option<Instance<'tcx>> {
        let ty::FnDef(def_id, args) = *function.kind() else {
            return None;
        };
        Instance::try_resolve(self.cx.tcx, frame.env, def_id, args.no_bound_vars()?).ok()?
    }

    pub fn may_collect_at(
        &self,
        frame: Frame<'a, 'tcx>,
        terminator: &Terminator<'tcx>,
    ) -> Option<Way<'tcx>> {
        let mut callees = Vec::new();
        if self.is_inside_collection(frame.instance) {
            return None;
        }
        if self.collects_at(frame, terminator, &mut callees) {
            return Some(Way::At(terminator.source_info.span));
        }
        if !self.cx.engine.is_upper(frame.instance.def_id()) {
            let mentioned = self.mentioned(frame).into_iter();
            callees.extend(mentioned.filter(|it| !it.is_called).map(|it| it.instance));
        }
        callees.into_iter().find(|&callee| self.may_collect(callee)).map(Way::Through)
    }

    pub fn explain(&self, mut way: Way<'tcx>, diagnostic: &mut Diag<'_>) {
        let mut names = Vec::new();
        while let Way::Through(instance) = way {
            if self.cx.engine.is_upper(instance.def_id()) {
                names.push(format!("`{}`", self.cx.tcx.def_path_str(instance.def_id())));
            }
            way = self.collects.borrow()[&instance].expect("on the way");
        }
        if let (Way::At(span), false) = (way, names.is_empty()) {
            let names = names.join(", ");
            diagnostic.span_note(span, format!("it may collect here, through {names}"));
        }
    }

    /// False if it depends on `callees`.
    fn collects_at(
        &self,
        frame: Frame<'a, 'tcx>,
        terminator: &Terminator<'tcx>,
        callees: &mut Vec<Instance<'tcx>>,
    ) -> bool {
        let (cx, tcx) = (self.cx, self.cx.tcx);
        let (callee, given): (_, Vec<_>) = match &terminator.kind {
            TerminatorKind::Call { func, args, target: Some(_), .. }
            | TerminatorKind::TailCall { func, args, .. } => {
                let function = frame.operand_type(func);
                let types = args.iter().map(|it| frame.operand_type(&it.node)).chain([function]);
                (self.resolve(frame, function), types.collect())
            }
            TerminatorKind::Drop { place, .. } => {
                let ty = frame.place_type(*place);
                // What a cell can own is dropped by the sweeper too.
                if ty.is_trait() {
                    return !self.goes_by_signatures
                        && cx.has_unknown_code(frame.env, ty)
                        && !cx.is_gc_free(frame.env, ty);
                }
                if !cx.can_allocate(frame.env, ty) && !cx.has_unknown_code(frame.env, ty) {
                    return false;
                }
                ((!ty.has_param()).then(|| Instance::resolve_drop_glue(tcx, ty)), vec![ty])
            }
            TerminatorKind::InlineAsm { options, .. } => {
                return !options.contains(InlineAsmOptions::NOSTACK) && !self.goes_by_signatures;
            }
            _ => return false,
        };
        let is_upper = |instance: Instance<'tcx>| match instance.def {
            InstanceKind::Shim(ShimKind::DropGlue(_, Some(ty))) => cx.is_upper(ty),
            _ => cx.engine.is_upper(instance.def_id()),
        };
        let callee = callee.filter(|it| !it.args.has_param());
        if let Some(def_id) = callee.map(|it| it.def_id())
            && (def_id == cx.engine.collect
                || (tcx.is_foreign_item(def_id) && !self.goes_by_signatures))
        {
            return cx.engine.is_upper(def_id);
        }
        if let Some(callee) = callee
            && !self.calls_back(callee)
        {
            return false;
        }
        let has_unknown_code = |ty| !self.goes_by_signatures && cx.has_unknown_code(frame.env, ty);
        let followed = callee.and_then(|it| self.frame(it, frame.env));
        // What comes in through a type parameter is seen again inside.
        let hands_over_unknown_code = match followed {
            Some(callee) if is_upper(callee.instance) => false,
            Some(_) if matches!(terminator.kind, TerminatorKind::Drop { .. }) => false,
            Some(callee) => callee.declared_parameters().any(has_unknown_code),
            None => given.iter().copied().any(has_unknown_code),
        };
        // Code that knows nothing of the engine was given it from above, or has made it from what it mentions.
        if hands_over_unknown_code
            && (is_upper(frame.instance) || frame.instance.args.types().any(has_unknown_code))
        {
            return true;
        }
        let Some(Frame { instance: callee, .. }) = followed else {
            let suffices =
                if self.goes_by_signatures { Types::has_capability } else { Types::can_allocate };
            return given.iter().any(|&it| suffices(cx, frame.env, it));
        };
        if is_upper(callee)
            || self.mentions_upper(callee.args)
            || callee.args.types().any(has_unknown_code)
        {
            callees.push(callee);
        }
        false
    }

    pub fn is_inside_collection(&self, instance: Instance<'tcx>) -> bool {
        let (tcx, parts) = (self.cx.tcx, &self.cx.engine.collector_parts);
        let function = tcx.typeck_root_def_id(instance.def_id());
        matches!(tcx.def_kind(function), DefKind::Fn | DefKind::AssocFn)
            && (tcx.fn_sig(function).skip_binder().skip_binder().inputs().iter())
                .filter_map(|it| it.peel_refs().ty_adt_def())
                .any(|it| parts.contains(&it.did()))
    }

    fn calls_back(&self, callee: Instance<'tcx>) -> bool {
        match callee.def {
            InstanceKind::Intrinsic(_) | InstanceKind::LlvmIntrinsic(_) => false,
            InstanceKind::Shim(ShimKind::DropGlue(_, ty)) => ty.is_some(),
            InstanceKind::Item(def_id) => !self.cx.tcx.is_constructor(def_id),
            _ => true,
        }
    }

    fn may_collect(&self, start: Instance<'tcx>) -> bool {
        let mut caller_of = FxHashMap::from_iter([(start, None)]);
        let mut pending = VecDeque::from([start]);
        while let Some(instance) = pending.pop_front() {
            let known = self.collects.borrow().get(&instance).copied();
            let mut callees = Vec::new();
            if let Some(way) = known.unwrap_or_else(|| self.collects_in(instance, &mut callees)) {
                let mut collects = self.collects.borrow_mut();
                let mut step = Some((instance, way));
                while let Some((instance, way)) = step {
                    collects.entry(instance).or_insert(Some(way));
                    step = caller_of[&instance].map(|caller| (caller, Way::Through(instance)));
                }
                return true;
            }
            for callee in callees {
                caller_of.entry(callee).or_insert_with(|| {
                    pending.push_back(callee);
                    Some(instance)
                });
            }
        }
        self.collects.borrow_mut().extend(caller_of.into_keys().map(|it| (it, None)));
        false
    }

    fn collects_in(
        &self,
        instance: Instance<'tcx>,
        callees: &mut Vec<Instance<'tcx>>,
    ) -> Option<Way<'tcx>> {
        if self.is_inside_collection(instance) {
            return None;
        }
        let frame = self.frame(instance, TypingEnv::fully_monomorphized())?;
        if !self.cx.engine.is_upper(instance.def_id()) {
            let mentioned = self.mentioned(frame).into_iter();
            callees.extend(mentioned.filter(|it| !it.is_called).map(|it| it.instance));
        }
        let deferred = bodies::deferred_blocks(self.cx, frame.body);
        traversal::mono_reachable(frame.body, self.cx.tcx, instance)
            .filter(|&(block, data)| !data.is_cleanup && !deferred.contains(block))
            .find(|(_, data)| self.collects_at(frame, data.terminator(), callees))
            .map(|(_, data)| Way::At(data.terminator().source_info.span))
    }

    fn mentioned(&self, frame: Frame<'a, 'tcx>) -> Vec<Mention<'tcx>> {
        let mut mentions = Mentions { calls: self, frame, found: Vec::new() };
        for (block, data) in traversal::mono_reachable(frame.body, self.cx.tcx, frame.instance) {
            if !data.is_cleanup {
                mentions.visit_basic_block_data(block, data);
            }
        }
        if let InstanceKind::Item(def_id) = frame.instance.def {
            for body in self.cx.tcx.promoted_mir(def_id) {
                mentions.frame = Frame { body, ..frame };
                mentions.visit_body(body);
            }
        }
        mentions.found
    }
}

struct Mention<'tcx> {
    instance: Instance<'tcx>,
    span: Span,
    /// Otherwise its address is taken.
    is_called: bool,
}

/// The code that has to do with the engine and that a function calls or takes the address of.
struct Mentions<'a, 'b, 'tcx> {
    calls: &'a Calls<'b, 'tcx>,
    frame: Frame<'b, 'tcx>,
    found: Vec<Mention<'tcx>>,
}

impl<'tcx> Mentions<'_, '_, 'tcx> {
    fn add(&mut self, instance: Option<Instance<'tcx>>, location: Location) {
        let (calls, body) = (self.calls, self.frame.body);
        if let Some(instance) = instance
            && (calls.cx.engine.is_upper(instance.def_id()) || calls.mentions_upper(instance.args))
        {
            let is_called = location == body.terminator_loc(location.block);
            self.found.push(Mention { instance, span: body.source_info(location).span, is_called });
        }
    }

    fn add_function(&mut self, function: Ty<'tcx>, location: Location) {
        self.add(self.calls.resolve(self.frame, function), location);
    }

    fn add_drop(&mut self, ty: Ty<'tcx>, location: Location) {
        self.add(Some(Instance::resolve_drop_glue(self.calls.cx.tcx, ty)), location);
    }

    fn add_vtable(&mut self, from: Ty<'tcx>, to: Ty<'tcx>, location: Location) {
        let tcx = self.calls.cx.tcx;
        match (*from.kind(), *to.kind()) {
            (ty::Dynamic(..), _) => {}
            (_, ty::Dynamic(bounds, _)) => {
                self.add_drop(from, location);
                let Some(principal) = bounds.principal() else {
                    return;
                };
                let trait_ref = principal.with_self_ty(tcx, from);
                let trait_ref = tcx.instantiate_bound_regions_with_erased(trait_ref);
                for entry in tcx.vtable_entries(trait_ref) {
                    if let VtblEntry::Method(method) = *entry {
                        self.add(Some(method), location);
                    }
                }
            }
            (ty::Ref(_, from, _) | ty::RawPtr(from, _), ty::Ref(_, to, _) | ty::RawPtr(to, _)) => {
                self.add_vtable(from, to, location);
            }
            (ty::Adt(_, from), ty::Adt(_, to)) => {
                for (from, to) in from.types().zip(to.types()).filter(|(from, to)| from != to) {
                    self.add_vtable(from, to, location);
                }
            }
            _ => {}
        }
    }
}

impl<'tcx> Visitor<'tcx> for Mentions<'_, '_, 'tcx> {
    fn visit_rvalue(&mut self, rvalue: &Rvalue<'tcx>, location: Location) {
        if let Rvalue::Cast(CastKind::PointerCoercion(coercion, _), operand, to) = rvalue {
            let from = self.frame.operand_type(operand);
            match (coercion, *from.kind()) {
                (PointerCoercion::Unsize, _) => {
                    self.add_vtable(from, self.frame.instantiate(*to), location);
                }
                (PointerCoercion::ReifyFnPointer(_), _) => self.add_function(from, location),
                (PointerCoercion::ClosureFnPointer(_), ty::Closure(def_id, args)) => {
                    self.add(Some(Instance::new_raw(def_id, args)), location);
                }
                _ => {}
            }
        }
        self.super_rvalue(rvalue, location);
    }

    fn visit_terminator(&mut self, terminator: &Terminator<'tcx>, location: Location) {
        match &terminator.kind {
            TerminatorKind::Call { func, .. } | TerminatorKind::TailCall { func, .. } => {
                self.add_function(self.frame.operand_type(func), location);
            }
            TerminatorKind::Drop { place, .. } => {
                self.add_drop(self.frame.place_type(*place), location);
            }
            TerminatorKind::InlineAsm { operands, .. } => {
                for operand in operands {
                    if let InlineAsmOperand::SymFn { value } = operand {
                        self.add_function(self.frame.instantiate(value.ty()), location);
                    }
                }
            }
            _ => {}
        }
        self.super_terminator(terminator, location);
    }

    /// A constant can hold the address of a function.
    fn visit_const_operand(&mut self, constant: &ConstOperand<'tcx>, location: Location) {
        let (tcx, frame) = (self.calls.cx.tcx, self.frame);
        if let Const::Unevaluated(constant, _) = constant.const_
            && constant.promoted.is_none()
            && let bound = ty::EarlyBinder::bind(tcx, constant.args)
            && let Ok(args) = (frame.instance)
                .try_instantiate_mir_and_normalize_erasing_regions(tcx, frame.env, bound)
            && let Ok(instance) = Instance::try_resolve(tcx, frame.env, constant.def, args)
        {
            self.add(instance, location);
        }
    }
}

struct Node<'tcx> {
    instance: Instance<'tcx>,
    findings: Vec<Finding<'tcx>>,
    callers: Vec<(usize, Span)>,
}

impl Node<'_> {
    fn is_local(&self) -> bool {
        matches!(self.instance.def, InstanceKind::Item(def_id) if def_id.is_local())
    }
}

pub type Instantiations<'tcx> = FxHashMap<DefId, Vec<Instance<'tcx>>>;

/// Returns what has become of the generic functions.
pub fn check<'a, 'tcx>(calls: &Calls<'a, 'tcx>, cx: &'a Types<'tcx>) -> Instantiations<'tcx> {
    let tcx = cx.tcx;
    tcx.par_hir_body_owners(|def_id| {
        if tcx.def_kind(def_id).is_fn_like() {
            tcx.instance_mir(InstanceKind::Item(def_id.to_def_id()));
        }
    });
    let mut nodes = Vec::new();
    let mut index_of = FxHashMap::default();
    let node = |instance| Node { instance, findings: Vec::new(), callers: Vec::new() };
    let (generic, plain): (Vec<_>, Vec<_>) =
        tcx.hir_body_owners().map(|it| it.to_def_id()).partition(|&it| calls.is_generic(it));
    for def_id in generic {
        let instance = calls.as_declared(def_id);
        if let Some(frame) = calls.frame(instance, TypingEnv::post_analysis(tcx, def_id)) {
            nodes.push(Node { findings: bodies::check(frame, calls), ..node(instance) });
        }
    }
    let as_declared = nodes.len();
    let mut next = as_declared;
    nodes.extend(plain.into_iter().map(|it| node(calls.as_declared(it))));
    while next < nodes.len() {
        let instance = nodes[next].instance;
        if let Some(frame) = calls.frame(instance, TypingEnv::fully_monomorphized()) {
            nodes[next].findings = bodies::check(frame, calls);
            for Mention { instance: callee, span, .. } in calls.mentioned(frame) {
                if !calls.is_generic(callee.def_id()) {
                    continue;
                }
                let index = *index_of.entry(callee).or_insert_with(|| {
                    nodes.push(node(callee));
                    nodes.len() - 1
                });
                nodes[index].callers.push((next, span));
            }
        } else if let InstanceKind::Item(def_id) = instance.def
            && matches!(tcx.def_kind(def_id), DefKind::Fn | DefKind::AssocFn | DefKind::Closure)
            && !tcx.is_foreign_item(def_id)
        {
            let name = tcx.def_path_str(def_id);
            tcx.dcx()
                .fatal(format!("rootcheck: no MIR for `{name}`; it takes `-Zalways-encode-mir`"));
        }
        next += 1;
    }
    report(calls, &nodes);
    let mut instantiations = Instantiations::default();
    for node in nodes[as_declared..].iter().filter(|it| it.is_local()) {
        instantiations.entry(node.instance.def_id()).or_default().push(node.instance);
    }
    instantiations
}

/// `NoGc` and `GcRefMut` count on other crates having no safe way from a cell to an allocation.
pub fn check_signatures<'tcx>(calls: &Calls<'_, 'tcx>, instantiations: &Instantiations<'tcx>) {
    let (cx, tcx, env) = (calls.cx, calls.cx.tcx, TypingEnv::fully_monomorphized());
    for def_id in tcx.hir_body_owners() {
        if !matches!(tcx.def_kind(def_id), DefKind::Fn | DefKind::AssocFn)
            || !tcx.effective_visibilities(()).is_reachable(def_id)
            || tcx.fn_sig(def_id).skip_binder().safety().is_unsafe()
            || !tcx.fn_sig(def_id).skip_binder().abi().is_rustic_abi()
        {
            continue;
        }
        let instances = instantiations.get(&def_id.to_def_id()).into_iter().flatten();
        for frame in instances.filter_map(|&it| calls.frame(it, env)) {
            let given = || frame.declared_parameters().map(|it| frame.instantiate(it));
            if !given().any(|it| cx.refers(env, it))
                || given().any(|it| cx.can_allocate(env, it) || cx.has_unknown_code(env, it))
            {
                continue;
            }
            let collects = calls.may_collect(frame.instance);
            if (collects || cx.names_capability(frame.instantiate(frame.body.return_ty())))
                && !cx.allows.is_on(tcx, def_id.to_def_id())
            {
                let message =
                    "this allocates, or lets its caller, without being given the right to";
                let span = tcx.def_span(def_id).source_callsite();
                let mut diagnostic = cx.report("signature", span, message.into());
                if collects {
                    calls.explain(Way::Through(frame.instance), &mut diagnostic);
                }
                diagnostic.with_help("take a `&Vm`, a `&Cx` or a `&mut Cx`").emit();
                break;
            }
        }
    }
}

fn report<'tcx>(calls: &Calls<'_, 'tcx>, nodes: &[Node<'tcx>]) {
    let cx = calls.cx;
    let is_allowed = |node: &Node<'_>| cx.allows.covers_body(cx.tcx, node.instance.def_id());
    let mut reported = FxHashSet::default();
    for (index, node) in nodes.iter().enumerate() {
        if node.findings.is_empty() || is_allowed(node) {
            continue;
        }
        let sites =
            if node.is_local() { vec![None] } else { local_callers(nodes, index, is_allowed) };
        for finding in &node.findings {
            for site in &sites {
                let span = site.unwrap_or(finding.span).source_callsite();
                if !reported.insert(span) {
                    continue;
                }
                let mut diagnostic = cx.report(finding.rule, span, finding.message.clone());
                if site.is_some() {
                    let callee = cx.tcx.def_path_str(node.instance.def_id());
                    diagnostic
                        .span_note(finding.span, format!("in `{callee}`, which this leads to"));
                }
                if let Some((span, label)) = finding.cause {
                    if site.is_some() {
                        diagnostic.span_note(span, label);
                    } else {
                        diagnostic.span_label(span.source_callsite(), label);
                    }
                }
                if let Some(way) = finding.way {
                    calls.explain(way, &mut diagnostic);
                }
                let mut current = node;
                let mut seen = FxHashSet::default();
                while site.is_none()
                    && let Some(&(caller, span)) = current.callers.first()
                    && seen.insert(caller)
                {
                    current = &nodes[caller];
                    if current.is_local() {
                        diagnostic.span_note(span.source_callsite(), "as instantiated here");
                    }
                }
                diagnostic.with_help(finding.help).emit();
            }
        }
    }
}

/// The calls in this crate that lead to code of another.
fn local_callers<'tcx>(
    nodes: &[Node<'tcx>],
    start: usize,
    is_allowed: impl Fn(&Node<'tcx>) -> bool,
) -> Vec<Option<Span>> {
    let (mut sites, mut pending) = (Vec::new(), vec![start]);
    let mut seen = FxHashSet::from_iter([start]);
    while let Some(index) = pending.pop() {
        for &(caller, span) in &nodes[index].callers {
            if is_allowed(&nodes[caller]) {
            } else if nodes[caller].is_local() {
                sites.push(Some(span));
            } else if seen.insert(caller) {
                pending.push(caller);
            }
        }
    }
    sites
}
