//! What a type says about where references to cells are.

use std::cell::{Cell, OnceCell, RefCell};
use std::rc::Rc;

use rustc_attr_ir::LangItem;
use rustc_data_structures::fx::{FxHashMap, FxHashSet};
use rustc_errors::{Diag, EmissionOverride, Level};
use rustc_hir::def_id::DefId;
use rustc_infer::infer::TyCtxtInferExt;
use rustc_middle::mir::{BasicBlockData, TerminatorKind};
use rustc_middle::ty::elaborate::supertrait_def_ids;
use rustc_middle::ty::{
    self, AdtDef, CallerBoundsIterator, EarlyBinder, GenericArgs, ImplPolarity, Ty, TyCtxt,
    TypeVisitableExt, TypingEnv, Unnormalized,
};
use rustc_span::{Span, Symbol, sym};
use rustc_trait_selection::traits::type_known_to_meet_bound_modulo_regions;

use crate::allow::Allows;
use crate::engine::Engine;

type Cache<'tcx, T> = RefCell<FxHashMap<(TypingEnv<'tcx>, Ty<'tcx>), T>>;

pub struct Types<'tcx> {
    pub tcx: TyCtxt<'tcx>,
    pub engine: Engine,
    pub allows: Allows,
    /// The types of this crate whose content the collector gets to see.
    pub traced: OnceCell<FxHashSet<DefId>>,
    refers: Cache<'tcx, bool>,
    points_to_references: Cache<'tcx, bool>,
    lends: Cache<'tcx, bool>,
    has_capability: Cache<'tcx, bool>,
    can_allocate: Cache<'tcx, bool>,
    has_unknown_code: Cache<'tcx, bool>,
    has_callback: Cache<'tcx, bool>,
    hides: Cache<'tcx, Option<Hidden<'tcx>>>,
    parts: RefCell<FxHashMap<DefId, Rc<[Part<'tcx>]>>>,
    incomplete_parts: Cell<usize>,
}

/// References to cells in memory that is neither scanned nor traced.
#[derive(Clone, Copy)]
pub struct Hidden<'tcx> {
    pub container: Ty<'tcx>,
}

/// What a struct, enum or union is made of, in terms of its parameters.
#[derive(Clone, Copy)]
enum Part<'tcx> {
    Inline(Ty<'tcx>),
    Behind(Pointee<'tcx>),
}

#[derive(Clone, Copy)]
struct Pointee<'tcx> {
    ty: Ty<'tcx>,
    container: Ty<'tcx>,
    allocator: Option<Ty<'tcx>>,
    ownership: Ownership,
}

#[derive(Clone, Copy, PartialEq)]
enum Ownership {
    /// A raw pointer. It owns if a type around it has a destructor and does not borrow what it points to.
    Pointer,
    /// A pointer beside a `PhantomData`, in a type that is `Copy`. It owns once a type around it is not.
    Marker,
    Owned,
}

/// Past this depth a type only goes on repeating itself with longer arguments.
const DEPTH_LIMIT: usize = 48;

impl<'tcx> Types<'tcx> {
    pub fn new(tcx: TyCtxt<'tcx>, engine: Engine) -> Types<'tcx> {
        Types {
            tcx,
            allows: Allows::new(tcx, &engine),
            engine,
            traced: OnceCell::new(),
            refers: Default::default(),
            points_to_references: Default::default(),
            lends: Default::default(),
            has_capability: Default::default(),
            can_allocate: Default::default(),
            has_unknown_code: Default::default(),
            has_callback: Default::default(),
            hides: Default::default(),
            parts: Default::default(),
            incomplete_parts: Cell::new(0),
        }
    }

    pub fn report(&self, rule: &str, span: Span, message: String) -> Diag<'tcx> {
        let level = Level::Warning(Some(EmissionOverride::Forced { lint_id: None }));
        let mut diagnostic = Diag::new(self.tcx.dcx(), level, message).with_span(span);
        diagnostic.is_lint(format!("rootcheck::{rule}"), false, None);
        diagnostic
    }

    pub fn normalize(&self, env: TypingEnv<'tcx>, ty: Unnormalized<'tcx, Ty<'tcx>>) -> Ty<'tcx> {
        let normalized = self.tcx.try_normalize_erasing_regions(env, ty);
        normalized.unwrap_or_else(|_| self.tcx.erase_and_anonymize_regions(ty.skip_normalization()))
    }

    fn instantiate(&self, env: TypingEnv<'tcx>, ty: Ty<'tcx>, args: GenericArgs<'tcx>) -> Ty<'tcx> {
        self.normalize(env, EarlyBinder::bind(self.tcx, ty).instantiate(self.tcx, args))
    }

    pub fn implements(&self, ty: Ty<'tcx>, trait_id: DefId) -> bool {
        self.tcx.non_blanket_impls_for_ty(trait_id, ty).next().is_some()
    }

    pub fn is_cell(&self, env: TypingEnv<'tcx>, ty: Ty<'tcx>) -> bool {
        match *ty.kind() {
            ty::Param(_) | ty::Alias(..) => {
                let ty = self.normalize(env, ty::set_aliases_to_non_rigid(self.tcx, ty));
                !ty.has_escaping_bound_vars() && self.meets(env, ty, self.engine.cell_kind)
            }
            ty::Adt(def, args) if def.is_struct() => {
                self.implements(ty, self.engine.cell_kind)
                    || def.all_fields().next().is_some_and(|first| {
                        first.name.as_str() == "base"
                            && self.engine.is_upper(def.did())
                            && self.is_cell(env, first.ty(self.tcx, args).skip_normalization())
                    })
            }
            _ => false,
        }
    }

    /// Of an `impl GcFree` or `impl !GcFree` that is written out.
    pub fn declared_polarity(&self, ty: Ty<'tcx>) -> Option<ImplPolarity> {
        let mut impls = self.tcx.non_blanket_impls_for_ty(self.engine.gc_free, ty);
        Some(self.tcx.impl_trait_header(impls.next()?).polarity)
    }

    /// The types that an auto trait looks at.
    pub fn constituents(&self, env: TypingEnv<'tcx>, ty: Ty<'tcx>) -> Vec<Ty<'tcx>> {
        let tcx = self.tcx;
        match *ty.kind() {
            ty::Adt(def, args) if def.is_phantom_data() => vec![args.type_at(0)],
            ty::Adt(def, args) => {
                def.all_fields().map(|field| self.normalize(env, field.ty(tcx, args))).collect()
            }
            ty::RawPtr(inner, _) | ty::Ref(_, inner, _) => vec![inner],
            ty::Pat(inner, _) | ty::Array(inner, _) | ty::Slice(inner) => vec![inner],
            ty::Tuple(members) => members.to_vec(),
            ty::Closure(_, args) => args.as_closure().upvar_tys().to_vec(),
            ty::CoroutineClosure(_, args) => args.as_coroutine_closure().upvar_tys().to_vec(),
            ty::Coroutine(def_id, args) => {
                let held = tcx.coroutine_hidden_types(def_id).instantiate(tcx, args);
                let held = tcx.instantiate_bound_regions_with_erased(held.skip_normalization());
                (held.types.iter().map(|it| self.normalize(env, Unnormalized::new(it))))
                    .chain(args.as_coroutine().upvar_tys())
                    .collect()
            }
            ty::UnsafeBinder(inner) => vec![tcx.instantiate_bound_regions_with_erased(*inner)],
            _ => Vec::new(),
        }
    }

    /// Whether `decide` says yes to anything that can be reached. Where it says no the search goes no deeper.
    fn reaches(
        &self,
        cache: &Cache<'tcx, bool>,
        env: TypingEnv<'tcx>,
        ty: Ty<'tcx>,
        decide: impl Fn(Ty<'tcx>) -> Option<bool>,
    ) -> bool {
        let key = |ty: Ty<'tcx>| (env_for(env, ty), ty);
        let mut seen = FxHashSet::default();
        let mut pending = vec![(ty, 0)];
        while let Some((current, depth)) = pending.pop() {
            let known = cache.borrow().get(&key(current)).copied();
            match known.or_else(|| decide(current)) {
                Some(true) => {
                    cache.borrow_mut().insert(key(ty), true);
                    return true;
                }
                None if depth < DEPTH_LIMIT && seen.insert(current) => {
                    let constituents = self.constituents(env, current);
                    pending.extend(constituents.into_iter().map(|it| (it, depth + 1)));
                }
                _ => {}
            }
        }
        cache.borrow_mut().extend(seen.into_iter().map(|it| (key(it), false)));
        false
    }

    fn meets(&self, env: TypingEnv<'tcx>, ty: Ty<'tcx>, bound: DefId) -> bool {
        let (infcx, param_env) = self.tcx.infer_ctxt().build_with_typing_env(env);
        type_known_to_meet_bound_modulo_regions(&infcx, param_env, ty, bound)
    }

    pub fn is_gc_free(&self, env: TypingEnv<'tcx>, ty: Ty<'tcx>) -> bool {
        self.meets(env, ty, self.engine.gc_free)
    }

    /// Not `GcFree`, and not just for want of knowing: a type parameter is judged where it is instantiated and a trait
    /// object where it is made.
    pub fn refers(&self, env: TypingEnv<'tcx>, ty: Ty<'tcx>) -> bool {
        self.reaches(&self.refers, env, ty, |ty| match self.declared_polarity(ty)? {
            ImplPolarity::Negative => Some(true),
            ImplPolarity::Positive => {
                let mut arguments = ty.walk().skip(1).filter_map(|it| it.as_type());
                Some(!self.is_gc_free(env, ty) && arguments.any(|it| self.refers(env, it)))
            }
        })
    }

    /// Whether it has the address of a reference to a cell, and not just such references.
    pub fn points_to_references(&self, env: TypingEnv<'tcx>, ty: Ty<'tcx>) -> bool {
        self.reaches(&self.points_to_references, env, ty, |ty| match *ty.kind() {
            ty::Ref(_, inner, _) | ty::RawPtr(inner, _) => {
                Some(!self.is_cell(env, inner) && self.refers(env, inner))
            }
            _ => self.declared_polarity(ty).map(|_| false),
        })
    }

    /// Whether a borrow of it leads to memory that it owns, or to a `&Gc<T>`.
    pub fn lends(&self, env: TypingEnv<'tcx>, ty: Ty<'tcx>) -> bool {
        self.reaches(&self.lends, env, ty, |ty| match *ty.kind() {
            ty::Adt(def, _) if def.did() == self.engine.gc => Some(true),
            ty::Adt(def, _)
                if def.is_phantom_data()
                    || self.engine.lend_nothing.contains(&Some(def.did()))
                    || self.allows.stays(self.tcx, def.did()) =>
            {
                Some(false)
            }
            ty::Adt(def, _) => def.has_dtor(self.tcx).then_some(true),
            ty::Ref(..) | ty::RawPtr(..) => Some(false),
            _ => None,
        })
    }

    /// Keeps a cell alive until it is dropped.
    pub fn is_guard(&self, def: AdtDef<'tcx>) -> bool {
        let tcx = self.tcx;
        let keeps_alive = |block: &BasicBlockData<'_>| match &block.terminator().kind {
            TerminatorKind::Call { func, .. } => func.const_fn_def().is_some_and(|(callee, _)| {
                self.engine.is_upper(callee) && tcx.item_name(callee).as_str() == "keep_alive"
            }),
            _ => false,
        };
        self.engine.is_upper(def.did())
            && (self.allows.stays(tcx, def.did())
                || (def.destructor(tcx)).is_some_and(|it| {
                    tcx.optimized_mir(it.did).basic_blocks.iter().any(keeps_alive)
                }))
    }

    pub fn contains_inline(&self, env: TypingEnv<'tcx>, whole: Ty<'tcx>, part: Ty<'tcx>) -> bool {
        whole == part
            || (!whole.is_any_ptr()
                && !whole.is_phantom_data()
                && (self.constituents(env, whole).into_iter())
                    .any(|it| self.contains_inline(env, it, part)))
    }

    /// Whether it has a `Vm`, a `Cx` or a `Heap` in it.
    pub fn has_capability(&self, env: TypingEnv<'tcx>, ty: Ty<'tcx>) -> bool {
        self.reaches(&self.has_capability, env, ty, |ty| match *ty.kind() {
            ty::Adt(def, _) if self.engine.capabilities.contains(&def.did()) => Some(true),
            _ => self.gives_no_access(ty).then_some(false),
        })
    }

    /// As `&Vm` and `Option<&Heap>` do.
    pub fn names_capability(&self, ty: Ty<'tcx>) -> bool {
        let mut walker = ty.walk();
        while let Some(argument) = walker.next() {
            match argument.as_type().map(|it| it.kind()) {
                Some(ty::Adt(def, _)) if self.engine.capabilities.contains(&def.did()) => {
                    return true;
                }
                Some(ty::FnPtr(..) | ty::Dynamic(..)) => walker.skip_current_subtree(),
                _ => {}
            }
        }
        false
    }

    /// Whether code that is given such a value may be able to allocate in the heap.
    pub fn can_allocate(&self, env: TypingEnv<'tcx>, ty: Ty<'tcx>) -> bool {
        self.has_capability(env, ty)
            || self.reaches(&self.can_allocate, env, ty, |ty| {
                if self.gives_no_access(ty) {
                    return Some(false);
                }
                let mut inside = self.is_upper(ty).then(|| self.constituents(env, ty))?.into_iter();
                inside.any(|it| self.has_unknown_code(env, it)).then_some(true)
            })
    }

    fn gives_no_access(&self, ty: Ty<'tcx>) -> bool {
        ty.is_phantom_data() || self.declared_polarity(ty) == Some(ImplPolarity::Negative)
    }

    /// Whether code that knows nothing of the engine finds something in it to call, of which the type does not say
    /// what it has brought along.
    pub fn has_unknown_code(&self, env: TypingEnv<'tcx>, ty: Ty<'tcx>) -> bool {
        let is_any = |def_id| self.tcx.is_diagnostic_item(Symbol::intern("Any"), def_id);
        let is_static = |def_id| supertrait_def_ids(self.tcx, def_id).any(is_any);
        self.reaches(&self.has_unknown_code, env, ty, |ty| match *ty.kind() {
            ty::Dynamic(bounds, _) => Some(!bounds.principal_def_id().is_some_and(is_static)),
            ty::FnPtr(_, header) => Some(header.safety().is_unsafe()),
            // Judged where they are put together.
            ty::Adt(def, _) if self.engine.formatting.contains(&Some(def.did())) => Some(false),
            _ => (ty.is_phantom_data() || self.is_upper(ty)).then_some(false),
        })
    }

    /// Whether it has a value of a type parameter in it that can be called.
    pub fn has_callback(&self, env: TypingEnv<'tcx>, ty: Ty<'tcx>) -> bool {
        let tcx = self.tcx;
        let calls_back = |bound: DefId| {
            tcx.is_fn_trait(bound)
                || tcx.is_lang_item(bound, LangItem::Iterator)
                || tcx.is_diagnostic_item(sym::IntoIterator, bound)
                || self.engine.is_upper(bound)
        };
        self.reaches(&self.has_callback, env, ty, |ty| match *ty.kind() {
            _ if !ty.has_param() || ty.is_phantom_data() || self.is_cell(env, ty) => Some(false),
            ty::Param(_) | ty::Alias(..) => {
                let bounds = env.param_env.caller_bounds().trait_clauses(tcx).iter();
                let mut bounds = bounds.filter(|it| it.skip_binder().self_ty() == ty);
                Some(bounds.any(|it| calls_back(it.def_id())) && !self.is_gc_free(env, ty))
            }
            _ => self.declared_polarity(ty).map(|_| false),
        })
    }

    /// Declared in a crate that knows the engine.
    pub fn is_upper(&self, ty: Ty<'tcx>) -> bool {
        match *ty.kind() {
            ty::Adt(def, _) => self.engine.is_upper(def.did()),
            ty::FnDef(def_id, _)
            | ty::Closure(def_id, _)
            | ty::CoroutineClosure(def_id, _)
            | ty::Coroutine(def_id, _) => self.engine.is_upper(def_id),
            _ => false,
        }
    }

    /// Whether a value of the type owns such memory.
    pub fn hides(&self, env: TypingEnv<'tcx>, ty: Ty<'tcx>) -> Option<Hidden<'tcx>> {
        let key = (env_for(env, ty), ty);
        if let Some(&known) = self.hides.borrow().get(&key) {
            return known;
        }
        let hidden = self.find_hidden(env, ty, &mut FxHashSet::default(), 0);
        if self.incomplete_parts.get() == 0 {
            self.hides.borrow_mut().insert(key, hidden);
        }
        hidden
    }

    fn find_hidden(
        &self,
        env: TypingEnv<'tcx>,
        ty: Ty<'tcx>,
        seen: &mut FxHashSet<Ty<'tcx>>,
        depth: usize,
    ) -> Option<Hidden<'tcx>> {
        if ty.is_any_ptr() || depth > DEPTH_LIMIT || !self.refers(env, ty) || !seen.insert(ty) {
            return None;
        }
        let ty::Adt(def, args) = *ty.kind() else {
            let mut constituents = self.constituents(env, ty).into_iter();
            return constituents.find_map(|it| self.find_hidden(env, it, seen, depth + 1));
        };
        let hidden = self.parts(def).iter().find_map(|part| match *part {
            Part::Inline(ty) => {
                self.find_hidden(env, self.instantiate(env, ty, args), seen, depth + 1)
            }
            Part::Behind(pointee) if pointee.ownership == Ownership::Owned => {
                let ty = self.instantiate(env, pointee.ty, args);
                let allocator = pointee.allocator.map(|it| self.instantiate(env, it, args));
                if allocator.is_some_and(|it| self.is_root_alloc(it)) {
                    return self.find_hidden(env, ty, seen, depth + 1);
                }
                let container = self.instantiate(env, pointee.container, args);
                self.refers(env, ty).then_some(Hidden { container })
            }
            Part::Behind(_) => None,
        });
        hidden.filter(|_| !self.allows.is_on(self.tcx, def.did()))
    }

    fn is_root_alloc(&self, ty: Ty<'tcx>) -> bool {
        let def = ty.peel_refs().ty_adt_def();
        def.is_some_and(|it| it.did() == self.engine.root_alloc)
    }

    /// What `items` reports where it is declared is not reported again wherever the type is used.
    pub fn hidden_by_field(&self, def: AdtDef<'tcx>, field: DefId) -> Option<Hidden<'tcx>> {
        if !def.did().is_local() || self.traced.get()?.contains(&def.did()) {
            return None;
        }
        let env = TypingEnv::post_analysis(self.tcx, def.did());
        self.hides(env, self.normalize(env, self.tcx.type_of(field).instantiate_identity()))
    }

    fn parts(&self, def: AdtDef<'tcx>) -> Rc<[Part<'tcx>]> {
        if let Some(parts) = self.parts.borrow().get(&def.did()) {
            return Rc::clone(parts);
        }
        // What a type that contains itself finds on the way.
        self.parts.borrow_mut().insert(def.did(), Rc::default());
        self.incomplete_parts.update(|count| count + 1);
        let parts: Rc<[Part<'tcx>]> = self.compute_parts(def).into();
        self.incomplete_parts.update(|count| count - 1);
        self.parts.borrow_mut().insert(def.did(), Rc::clone(&parts));
        parts
    }

    fn compute_parts(&self, def: AdtDef<'tcx>) -> Vec<Part<'tcx>> {
        let tcx = self.tcx;
        let env = TypingEnv::post_analysis(tcx, def.did());
        let this = self.normalize(env, tcx.type_of(def.did()).instantiate_identity());
        let (mut parts, mut markers) = (Vec::new(), Vec::new());
        for field in def.all_fields() {
            let ty = self.normalize(env, tcx.type_of(field.did).instantiate_identity());
            let is_allowed = self.allows.has(tcx, field.did)
                && (ty.has_param() || self.hides(env, ty).is_some())
                && self.allows.is_on(tcx, field.did);
            if !is_allowed && self.hidden_by_field(def, field.did).is_none() {
                self.expand(env, this, ty, &mut parts, &mut markers);
            }
        }
        if parts.iter().any(|it| matches!(it, Part::Behind(_))) {
            parts.extend(markers.into_iter().map(|ty| {
                let ownership = Ownership::Marker;
                Part::Behind(Pointee { ty, container: this, allocator: None, ownership })
            }));
        }
        let is_copy = tcx.lang_items().copy_trait().is_some_and(|it| self.implements(this, it));
        // `Drain<'a, T>` needs `T: 'a`. A vector in an arena does not.
        let clauses = tcx.clauses_of(def.did()).clauses.iter();
        let outliving: Vec<_> = (clauses.filter_map(|it| it.0.as_type_outlives_clause()))
            .map(|it| it.skip_binder().0.into())
            .collect();
        let borrows = |pointee: Ty<'tcx>| {
            tcx.generics_of(def.did()).own_counts().lifetimes != 0
                && (!pointee.has_param() || pointee.walk().any(|it| outliving.contains(&it)))
        };
        let is_ours = self.engine.is_in_workspace(def.did());
        // The private ones of other crates are guards that put things back in place.
        let frees = def.has_dtor(tcx) && (is_ours || tcx.visibility(def.did()).is_public());
        let allocator = (tcx.param_env(def.did()).caller_bounds().trait_clauses(tcx).iter())
            .find(|clause| tcx.item_name(clause.def_id()).as_str() == "Allocator")
            .map(|clause| clause.skip_binder().self_ty());
        parts.retain_mut(|part| {
            let Part::Behind(pointee) = part else {
                return true;
            };
            let takes_ownership = match pointee.ownership {
                Ownership::Pointer if borrows(pointee.ty) => return false,
                Ownership::Pointer => frees,
                Ownership::Marker => !is_copy,
                Ownership::Owned => !is_ours,
            };
            if takes_ownership {
                (pointee.ownership, pointee.container) = (Ownership::Owned, this);
            }
            pointee.allocator = pointee.allocator.or(allocator);
            true
        });
        parts
    }

    fn expand(
        &self,
        env: TypingEnv<'tcx>,
        this: Ty<'tcx>,
        ty: Ty<'tcx>,
        parts: &mut Vec<Part<'tcx>>,
        markers: &mut Vec<Ty<'tcx>>,
    ) {
        match *ty.kind() {
            ty::Adt(def, args) if def.is_phantom_data() => {
                owned_by_marker(args.type_at(0), markers)
            }
            ty::Adt(def, _)
                if self.declared_polarity(ty).is_some() || self.allows.has(self.tcx, def.did()) =>
            {
                parts.push(Part::Inline(ty));
            }
            ty::Adt(def, args) => {
                for part in self.parts(def).iter() {
                    match *part {
                        Part::Inline(inner) => {
                            let inner = self.instantiate(env, inner, args);
                            self.expand(env, this, inner, parts, markers);
                        }
                        Part::Behind(pointee) => parts.push(Part::Behind(Pointee {
                            ty: self.instantiate(env, pointee.ty, args),
                            container: self.instantiate(env, pointee.container, args),
                            allocator: pointee.allocator.map(|it| self.instantiate(env, it, args)),
                            ownership: pointee.ownership,
                        })),
                    }
                }
            }
            ty::RawPtr(ty, _) => {
                let ownership = Ownership::Pointer;
                parts.push(Part::Behind(Pointee {
                    ty,
                    container: this,
                    allocator: None,
                    ownership,
                }));
            }
            ty::Tuple(_) | ty::Array(..) | ty::Slice(_) | ty::Pat(..) => {
                for inner in self.constituents(env, ty) {
                    self.expand(env, this, inner, parts, markers);
                }
            }
            ty::Param(_) | ty::Alias(..) => parts.push(Part::Inline(ty)),
            _ => {}
        }
    }
}

/// `PhantomData<T>` owns a `T`. `PhantomData<&T>` and `PhantomData<*const T>` do not.
fn owned_by_marker<'tcx>(ty: Ty<'tcx>, markers: &mut Vec<Ty<'tcx>>) {
    match *ty.kind() {
        ty::Tuple(members) => members.iter().for_each(|it| owned_by_marker(it, markers)),
        _ if ty.is_any_ptr() => {}
        _ => markers.push(ty),
    }
}

fn env_for<'tcx>(env: TypingEnv<'tcx>, ty: Ty<'tcx>) -> TypingEnv<'tcx> {
    if ty.has_param() { env } else { TypingEnv::fully_monomorphized() }
}
