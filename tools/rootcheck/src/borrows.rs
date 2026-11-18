//! What takes lifetimes to tell: borrows of memory that a cell owns outside itself, which do not keep the cell alive,
//! and borrows that promise that nothing is allocated.

use rustc_borrowck::consumers::{
    BodyWithBorrowckFacts, ConsumerOptions, get_bodies_with_borrowck_facts,
};
use rustc_data_structures::fx::{FxHashMap, FxHashSet};
use rustc_hir::def::DefKind;
use rustc_hir::def_id::DefId;
use rustc_index::IndexVec;
use rustc_index::bit_set::DenseBitSet;
use rustc_middle::mir::visit::{MutatingUseContext, NonUseContext, PlaceContext, Visitor};
use rustc_middle::mir::{
    BasicBlock, Body, Local, Location, Operand, Place, ProjectionElem, Rvalue, TerminatorKind,
};
use rustc_middle::ty::{self, Instance, RegionVid, Ty, TypeVisitableExt, TypingEnv};
use rustc_mir_dataflow::impls::MaybeInitializedPlaces;
use rustc_mir_dataflow::move_paths::MoveData;
use rustc_mir_dataflow::{Analysis, ResultsCursor};
use rustc_span::{Span, Spanned};

use crate::bodies::{Frame, deferred_blocks, field_of};
use crate::calls::{Calls, Instantiations, Way};
use crate::types::Types;

pub fn check<'a, 'tcx>(
    cx: &'a Types<'tcx>,
    calls: &Calls<'a, 'tcx>,
    trusting: &Calls<'a, 'tcx>,
    instantiations: &Instantiations<'tcx>,
) {
    let tcx = cx.tcx;
    let (mut lending_closures, mut reported) = (FxHashSet::default(), FxHashSet::default());
    for root in tcx.hir_body_owners().filter(|it| !tcx.is_typeck_child(it.to_def_id())) {
        let bodies = || tcx.nested_bodies_within(root).iter().chain([root]);
        let function = |def_id: DefId| Function::new(cx, def_id, instantiations);
        // What has been compiled already tells whether it is worth asking for the lifetimes.
        if bodies().map(|it| function(it.to_def_id())).all(|it| {
            let frame = calls.frame(calls.as_declared(it.def_id), it.env);
            frame.is_none_or(|frame| {
                let mut types = frame.body.local_decls.iter().map(|local| local.ty);
                it.sources(frame.body, &lending_closures).is_empty()
                    && !types.any(|ty| it.forbids_allocation(ty) || it.locks_out_collector(ty))
            })
        }) {
            continue;
        }
        let facts = get_bodies_with_borrowck_facts(tcx, root, ConsumerOptions::PoloniusInputFacts);
        for def_id in bodies() {
            let function = function(def_id.to_def_id());
            let Followed { loose, no_gc, locked } =
                function.follow(&facts[&def_id], &mut lending_closures);
            if !loose.is_empty() || !no_gc.is_empty() || !locked.is_empty() {
                let frames = function.frames(calls, &facts[&def_id].body);
                function.report_loose(calls, &frames, loose, &mut reported);
                let message = "a `NoGc` or a `GcRefMut` says that nothing does";
                function.report_calls(trusting, &frames, no_gc, message, &mut reported);
                let message = "what the collector has to see is borrowed exclusively";
                function.report_calls(calls, &frames, locked, message, &mut reported);
            }
        }
    }
}

/// The functions whose callers are held to the rule, and those that are taken at their word.
pub fn list_lenders<'tcx>(cx: &Types<'tcx>) {
    let (tcx, nothing) = (cx.tcx, Instantiations::default());
    for def_id in tcx.hir_body_owners().map(|it| it.to_def_id()) {
        if !matches!(tcx.def_kind(def_id), DefKind::Fn | DefKind::AssocFn) {
            continue;
        }
        let function = Function::new(cx, def_id, &nothing);
        let signature = tcx.fn_sig(def_id).instantiate_identity().skip_normalization();
        let signature = tcx.liberate_late_bound_regions(def_id, signature);
        let inputs = || signature.inputs().iter().copied();
        let given: Vec<_> = inputs().flat_map(|it| function.cell_references(it)).collect();
        let tokens: Vec<_> = inputs().filter(|&it| function.is_token(it)).collect();
        let is_tied_to = |types: &[Ty<'tcx>], region| {
            types.iter().any(|it| matches!(*it.kind(), ty::Ref(own, ..) if own == region))
        };
        if (function.loose_regions(signature.output(), Some(&given)).into_iter())
            .any(|it| is_tied_to(&given, it) && !is_tied_to(&tokens, it))
        {
            let how = if cx.allows.stays(tcx, def_id) { "stays" } else { "lends" };
            let message = format!("{how} `{}`", signature.output());
            cx.report("lender", tcx.def_span(def_id).source_callsite(), message).emit();
        }
    }
}

struct Function<'a, 'tcx> {
    cx: &'a Types<'tcx>,
    def_id: DefId,
    env: TypingEnv<'tcx>,
    instances: &'a [Instance<'tcx>],
}

/// A statement or a call that borrows from a cell.
struct Source<'tcx> {
    location: Location,
    result: Ty<'tcx>,
    /// The references to cells that it goes through. None if it is a closure that borrows.
    through: Vec<Ty<'tcx>>,
    /// Each `&NoGc` that it is given. What is borrowed for no longer than that cannot meet a collection.
    tokens: Vec<Ty<'tcx>>,
}

struct LooseBorrow<'tcx> {
    source: Source<'tcx>,
    held_at_end_of: Vec<BasicBlock>,
    escapes: bool,
}

struct Followed<'tcx> {
    loose: Vec<LooseBorrow<'tcx>>,
    /// The blocks that end under a `NoGc` or a `GcRefMut`.
    no_gc: Vec<BasicBlock>,
    /// Those that end with a lock on what the collector has to see.
    locked: Vec<BasicBlock>,
}

impl<'a, 'tcx> Function<'a, 'tcx> {
    fn new(cx: &'a Types<'tcx>, def_id: DefId, instantiations: &'a Instantiations<'tcx>) -> Self {
        let instances = instantiations.get(&def_id).map_or(&[][..], |it| it);
        Function { cx, def_id, env: TypingEnv::post_analysis(cx.tcx, def_id), instances }
    }

    fn erased(&self, ty: Ty<'tcx>) -> Ty<'tcx> {
        self.cx.normalize(self.env, ty::set_aliases_to_non_rigid(self.cx.tcx, ty))
    }

    fn is_cell(&self, ty: Ty<'tcx>) -> bool {
        let becomes_cell = |parameter: ty::ParamTy| {
            let mut arguments =
                self.instances.iter().map(|it| it.args.type_at(parameter.index as usize));
            arguments.any(|it| self.cx.is_cell(TypingEnv::fully_monomorphized(), it))
        };
        self.cx.is_cell(self.env, ty) || matches!(*ty.kind(), ty::Param(it) if becomes_cell(it))
    }

    fn is_token(&self, ty: Ty<'tcx>) -> bool {
        let pointee = ty.peel_refs().ty_adt_def();
        ty.is_ref() && pointee.is_some_and(|it| it.did() == self.cx.engine.no_gc)
    }

    fn forbids_allocation(&self, ty: Ty<'tcx>) -> bool {
        let engine = &self.cx.engine;
        let def = ty.peel_refs().ty_adt_def();
        def.is_some_and(|it| it.did() == engine.no_gc || it.did() == engine.gc_ref_mut)
    }

    /// As `RefMut<Vec<Value>>` does.
    fn locks_out_collector(&self, ty: Ty<'tcx>) -> bool {
        let (cx, ty::Adt(def, args)) = (self.cx, ty.kind()) else { return false };
        !cx.engine.is_upper(def.did())
            && args.regions().next().is_some()
            && cx.tcx.lang_items().deref_mut_trait().is_some_and(|it| cx.implements(ty, it))
            && args.types().any(|it| cx.hides(self.env, self.erased(it)).is_some())
    }

    /// Each `&C` in the type, where `C` is a cell.
    fn cell_references(&self, ty: Ty<'tcx>) -> impl Iterator<Item = Ty<'tcx>> {
        let types = ty.walk().filter_map(|it| it.as_type());
        types.filter(|it| matches!(*it.kind(), ty::Ref(_, inner, _) if self.is_cell(inner)))
    }

    fn sources(&self, body: &Body<'tcx>, lending_closures: &FxHashSet<DefId>) -> Vec<Source<'tcx>> {
        let tcx = self.cx.tcx;
        let is_lending_closure =
            |ty: Ty<'_>| matches!(ty.kind(), ty::Closure(it, _) if lending_closures.contains(it));
        let mut found = Vec::new();
        for (block, data) in body.basic_blocks.iter_enumerated().filter(|(_, it)| !it.is_cleanup) {
            for (statement_index, statement) in data.statements.iter().enumerate() {
                if let Some((_, rvalue)) = statement.kind.as_assign()
                    && let Rvalue::Ref(_, _, place) | Rvalue::Use(Operand::Copy(place), _) = *rvalue
                    && let result = rvalue.ty(body, tcx)
                    // After borrow checking, a box is copied to be looked into.
                    && (matches!(rvalue, Rvalue::Ref(..)) || result.is_box())
                    && let Some(reference) = self.lending_reference(body, place)
                {
                    let (location, through) =
                        (Location { block, statement_index }, vec![reference]);
                    found.push(Source { location, result, through, tokens: Vec::new() });
                }
            }
            let TerminatorKind::Call { func, args, destination, .. } = &data.terminator().kind
            else {
                continue;
            };
            let result = destination.ty(body, tcx).ty;
            if !result.has_free_regions() && !result.has_erased_regions() {
                continue;
            }
            let given = || args.iter().map(|it| it.node.ty(body, tcx));
            let lends =
                given().any(|it| it.walk().filter_map(|it| it.as_type()).any(is_lending_closure));
            let through = given().filter(|_| !lends).flat_map(|it| self.cell_references(it));
            let through: Vec<_> = through.collect();
            if (lends || !through.is_empty())
                && !self.loose_regions(result, Some(&through)).is_empty()
                && !self.stays(body, func)
            {
                let tokens = given().filter(|&it| self.is_token(it)).collect();
                found.push(Source {
                    location: body.terminator_loc(block),
                    result,
                    through,
                    tokens,
                });
            }
        }
        found
    }

    fn stays(&self, body: &Body<'tcx>, function: &Operand<'tcx>) -> bool {
        let tcx = self.cx.tcx;
        let ty::FnDef(def_id, args) = *self.erased(function.ty(body, tcx)).kind() else {
            return false;
        };
        let resolved = Instance::try_resolve(tcx, self.env, def_id, args.skip_binder());
        self.cx.allows.stays(tcx, resolved.ok().flatten().map_or(def_id, |it| it.def_id()))
    }

    /// The reference to the cell, if the place is outside the cell or leads there.
    fn lending_reference(&self, body: &Body<'tcx>, place: Place<'tcx>) -> Option<Ty<'tcx>> {
        let tcx = self.cx.tcx;
        let (mut reference, mut is_outside) = (None, false);
        for (base, projection) in place.iter_projections() {
            let base = base.ty(body, tcx).ty;
            match (projection, *base.kind()) {
                (ProjectionElem::Deref, ty::Ref(_, inner, _)) => {
                    (reference, is_outside) = (self.is_cell(inner).then_some(base), false);
                }
                (ProjectionElem::Deref, ty::RawPtr(..)) => reference = None,
                (ProjectionElem::Deref, _) => is_outside = true,
                _ => {}
            }
        }
        let reference = reference?;
        let ty = self.erased(place.ty(body, tcx).ty);
        let is_loose = is_outside || (!self.is_cell(ty) && self.cx.lends(self.env, ty));
        (is_loose && !self.is_in_field_that_stays(body, place)).then_some(reference)
    }

    fn is_in_field_that_stays(&self, body: &Body<'tcx>, place: Place<'tcx>) -> bool {
        let (tcx, places) = (self.cx.tcx, place.iter_projections());
        let mut fields = places.filter_map(|(base, it)| field_of(base.ty(body, tcx), it));
        fields.any(|it| self.cx.allows.stays(tcx, it))
    }

    /// The regions of what does not keep a cell alive by itself. If the type is that of what a function makes of
    /// `given`, what fits in one of these cells is taken to be there, which is checked where the function is defined.
    fn loose_regions(&self, ty: Ty<'tcx>, given: Option<&[Ty<'tcx>]>) -> Vec<ty::Region<'tcx>> {
        let mut regions = Vec::new();
        let mut walker = ty.walk();
        while let Some(argument) = walker.next() {
            let Some(ty) = argument.as_type() else { continue };
            let own_regions = match *ty.kind() {
                ty::Ref(region, ..) | ty::Dynamic(_, region) => vec![region],
                ty::Adt(_, args) | ty::Alias(_, ty::AliasTy { args, .. }) => {
                    args.regions().collect()
                }
                ty::FnPtr(..) | ty::FnDef(..) => {
                    walker.skip_current_subtree();
                    continue;
                }
                _ => continue,
            };
            if !own_regions.is_empty() && self.is_loose(self.erased(ty), given, 0) {
                regions.extend(own_regions);
            }
        }
        regions
    }

    fn is_loose(&self, ty: Ty<'tcx>, given: Option<&[Ty<'tcx>]>, depth: usize) -> bool {
        let (cx, engine) = (self.cx, &self.cx.engine);
        let fits = |part: Ty<'tcx>| {
            let mut cells = given.into_iter().flatten().map(|it| self.erased(it.peel_refs()));
            cells.any(|cell| cx.contains_inline(self.env, cell, part))
        };
        match *ty.kind() {
            ty::Ref(_, inner, _) => {
                !self.is_cell(inner)
                    && !inner.ty_adt_def().is_some_and(|it| engine.outlives_cells(it.did()))
                    && (cx.lends(self.env, inner) || !fits(inner))
            }
            ty::RawPtr(..) | ty::Dynamic(..) => true,
            ty::Adt(def, args) if def.did() == engine.owned => !fits(args.type_at(1)),
            ty::Adt(def, _) if cx.is_guard(def) => false,
            ty::Adt(def, _) if engine.ref_cell_guards.contains(&Some(def.did())) => {
                given.is_none_or(|it| it.is_empty())
            }
            _ => {
                depth < 8
                    && (cx.constituents(self.env, ty).into_iter())
                        .filter(|it| it.has_erased_regions() || it.is_raw_ptr())
                        .any(|it| self.is_loose(it, given, depth + 1))
            }
        }
    }

    /// Where a reference to a cell is made that something else keeps alive, and where a borrow stops being loose.
    fn anchors_and_releases(
        &self,
        body: &Body<'tcx>,
    ) -> (FxHashMap<Location, Ty<'tcx>>, FxHashSet<Location>) {
        let (cx, tcx) = (self.cx, self.cx.tcx);
        let (mut anchors, mut releases) = (FxHashMap::default(), FxHashSet::default());
        for (block, data) in body.basic_blocks.iter_enumerated() {
            for (statement_index, statement) in data.statements.iter().enumerate() {
                if let Some((target, rvalue)) = statement.kind.as_assign()
                    && let Rvalue::Ref(_, _, place)
                    | Rvalue::Use(Operand::Copy(place) | Operand::Move(place), _) = *rvalue
                    && self.is_in_field_that_stays(body, place)
                {
                    anchors.insert(Location { block, statement_index }, target.ty(body, tcx).ty);
                }
            }
            if let TerminatorKind::Call { func, destination, .. } = &data.terminator().kind
                && let Some((callee, args)) = func.const_fn_def()
            {
                let (location, result) = (body.terminator_loc(block), destination.ty(body, tcx).ty);
                if self.cell_references(result).next().is_some() && self.stays(body, func) {
                    anchors.insert(location, result);
                } else if result.ty_adt_def().is_some_and(|it| cx.is_guard(it))
                    || (tcx.trait_of_assoc(callee) == tcx.lang_items().deref_trait()
                        && args.type_at(0).ty_adt_def().is_some_and(|it| it.did() == cx.engine.gc))
                {
                    releases.insert(location);
                }
            }
        }
        (anchors, releases)
    }

    fn follow(
        &self,
        facts: &BodyWithBorrowckFacts<'tcx>,
        lending_closures: &mut FxHashSet<DefId>,
    ) -> Followed<'tcx> {
        let (tcx, body) = (self.cx.tcx, &facts.body);
        let input = facts.input_facts.as_ref().expect("asked for");
        let table = facts.location_table.as_ref().expect("asked for");
        let mut constraints = FxHashMap::<Location, Vec<(RegionVid, RegionVid)>>::default();
        for &(from, to, at) in &input.subset_base {
            constraints.entry(table.to_location(at)).or_default().push((from.into(), to.into()));
        }
        let flow_except = |is_cut: &dyn Fn(&Location) -> bool| {
            Flow::new(constraints.iter().filter(|it| !is_cut(it.0)).flat_map(|it| it.1).copied())
        };
        let universal: FxHashSet<RegionVid> =
            input.universal_region.iter().map(|&it| it.into()).collect();
        let (anchors, releases) = self.anchors_and_releases(body);

        let flow = flow_except(&|it| anchors.contains_key(it));
        let borrows_of_locals = facts.borrow_set.iter().filter(|it| {
            let place = it.borrowed_place();
            place.iter_projections().all(|(base, projection)| {
                projection != ProjectionElem::Deref || base.ty(body, tcx).ty.is_box()
            }) && self.cx.lends(self.env, self.erased(place.ty(body, tcx).ty))
        });
        let not_anchored = universal.iter().copied().chain(borrows_of_locals.map(|it| it.region()));
        let not_anchored = flow.reached_from(not_anchored, |_| false);
        let anchored = anchors.values().flat_map(|&it| self.cell_references(it));
        let anchored = flow.reached_from(outer_regions(anchored), |_| false);

        let flow = flow_except(&|it| releases.contains(it));
        let returned = variables(body.return_ty().walk().filter_map(|it| it.as_region()));
        let held_by: IndexVec<Local, Vec<RegionVid>> =
            body.local_decls.iter().map(|it| variables(self.loose_regions(it.ty, None))).collect();
        // At this stage what has been moved away is still dropped at the end of its scope.
        let moves = MoveData::gather_moves(body, tcx, |_| true);
        let initialized =
            MaybeInitializedPlaces::new(tcx, body, &moves).iterate_to_fixpoint(tcx, body, None);
        let is_initialized = |block, local| {
            let mut cursor = ResultsCursor::new_borrowing(body, &initialized);
            cursor.seek_before_primary_effect(body.terminator_loc(block));
            moves.rev_lookup.find_local(local).is_none_or(|path| {
                (moves.find_in_move_path_or_its_descendants(path, |it| cursor.get().contains(it)))
                    .is_some()
            })
        };
        let blocks_that_hold = |held_by: &IndexVec<Local, Vec<_>>, regions: &FxHashSet<_>| {
            let mut holders = DenseBitSet::new_empty(body.local_decls.len());
            for (local, held) in held_by.iter_enumerated() {
                if held.iter().any(|it| regions.contains(it)) {
                    holders.insert(local);
                }
            }
            let mut read_when_dropped = DenseBitSet::new_empty(body.local_decls.len());
            for &(local, region) in &input.drop_of_var_derefs_origin {
                if regions.contains(&RegionVid::from(region)) {
                    read_when_dropped.insert(local);
                }
            }
            blocks_that_hold(body, &holders, &read_when_dropped, is_initialized)
        };
        let mut found = Vec::new();
        for source in self.sources(body, lending_closures) {
            let result = variables(self.loose_regions(source.result, Some(&source.through)));
            let mut through = outer_regions(source.through.iter().copied());
            through.retain(|it| !anchored.contains(it) || not_anchored.contains(it));
            let seeds = if source.through.is_empty() {
                result
            } else if source.location != body.terminator_loc(source.location.block) {
                outer_regions(through.iter().map(|_| source.result))
            } else {
                let here = constraints.get(&source.location).into_iter().flatten().copied();
                let here = Flow::new(here);
                let tokens = outer_regions(source.tokens.iter().copied());
                let (loose, safe) =
                    (here.reached_from(through, |_| false), here.reached_from(tokens, |_| false));
                result.into_iter().filter(|it| loose.contains(it) && !safe.contains(it)).collect()
            };
            let loose =
                flow.reached_from(seeds, |it| universal.contains(&it) || returned.contains(&it));
            let mut escapes = loose.iter().any(|it| universal.contains(it));
            if returned.iter().any(|it| loose.contains(it)) {
                if tcx.is_closure_like(self.def_id) {
                    lending_closures.insert(self.def_id);
                } else {
                    escapes |= !self.callers_can_tell(body, &loose);
                }
            }
            if !loose.is_empty() {
                let held_at_end_of = blocks_that_hold(&held_by, &loose);
                found.push(LooseBorrow { source, held_at_end_of, escapes });
            }
        }

        let regions = |ty: Ty<'tcx>| variables(ty.walk().filter_map(|it| it.as_region()));
        let types = || body.local_decls.iter().map(|it| it.ty);
        let (flow, held_by) = (flow_except(&|_| false), types().map(regions).collect());
        let while_alive = |is_wanted: &dyn Fn(Ty<'tcx>) -> bool| {
            let start = types().filter(|&it| is_wanted(it)).flat_map(regions);
            blocks_that_hold(&held_by, &flow.reached_from(start, |it| universal.contains(&it)))
        };
        let no_gc = if body.args_iter().any(|it| self.forbids_allocation(body.local_decls[it].ty)) {
            body.basic_blocks.indices().filter(|&it| !body[it].is_cleanup).collect()
        } else {
            while_alive(&|it| self.forbids_allocation(it))
        };
        Followed { loose: found, no_gc, locked: while_alive(&|it| self.locks_out_collector(it)) }
    }

    /// Whether a call looks like a source.
    fn callers_can_tell(&self, body: &Body<'tcx>, loose: &FxHashSet<RegionVid>) -> bool {
        let parameters = body.args_iter().map(|it| body.local_decls[it].ty);
        let given: Vec<_> = parameters.flat_map(|it| self.cell_references(it)).collect();
        let seen = variables(self.loose_regions(body.return_ty(), Some(&given)));
        let held = variables(self.loose_regions(body.return_ty(), None));
        held.iter().filter(|it| loose.contains(it)).all(|it| !given.is_empty() && seen.contains(it))
    }

    fn frames(&self, calls: &Calls<'_, 'tcx>, body: &Body<'tcx>) -> Vec<Frame<'a, 'tcx>> {
        let (cx, tcx, def_id) = (self.cx, self.cx.tcx, self.def_id);
        let body = &*tcx.arena.alloc(tcx.erase_and_anonymize_regions(body.clone()));
        let env = TypingEnv::fully_monomorphized();
        let mut frames: Vec<_> =
            self.instances.iter().map(|&instance| Frame { cx, instance, env, body }).collect();
        // Other crates do not have the lifetimes to go by.
        let root = tcx.typeck_root_def_id(def_id).expect_local();
        if frames.is_empty() || (calls.is_generic(def_id) && tcx.reachable_set(()).contains(&root))
        {
            frames.push(Frame { cx, instance: calls.as_declared(def_id), env: self.env, body });
        }
        frames
    }

    fn report_loose(
        &self,
        calls: &Calls<'_, 'tcx>,
        frames: &[Frame<'_, 'tcx>],
        loose: Vec<LooseBorrow<'tcx>>,
        reported: &mut FxHashSet<Span>,
    ) {
        let (cx, tcx, body) = (self.cx, self.cx.tcx, frames[0].body);
        let deferred = deferred_blocks(cx, body);
        let may_collect = |block: BasicBlock| {
            let terminator = body[block].terminator();
            let span = terminator.source_info.span;
            frames.iter().find_map(|&frame| match &terminator.kind {
                TerminatorKind::Call { args, .. }
                    if (args.iter().map(|it| frame.operand_type(&it.node)))
                        .any(|it| cx.has_callback(frame.env, it))
                        && !calls.is_inside_collection(frame.instance) =>
                {
                    Some((span, Way::At(span)))
                }
                _ => Some((span, calls.may_collect_at(frame, terminator)?)),
            })
        };
        for LooseBorrow { source, held_at_end_of, escapes } in loose {
            let mut blocks = held_at_end_of.into_iter().filter(|&it| !deferred.contains(it));
            let held = blocks.find_map(may_collect);
            let span = body.source_info(source.location).span.source_callsite();
            if (held.is_some() || (escapes && !cx.allows.stays(tcx, self.def_id)))
                && !cx.allows.covers_body(tcx, self.def_id)
                && reported.insert(span)
            {
                let ty = self.erased(source.result);
                let message =
                    format!("`{ty}` does not keep the cell alive that it is borrowed from");
                let mut diagnostic = cx.report("borrow", span, message);
                if let Some((span, way)) = held {
                    diagnostic.span_label(span.source_callsite(), "held while this may collect");
                    calls.explain(way, &mut diagnostic);
                } else {
                    diagnostic.note("it leaves the function, and the signature does not tell");
                }
                diagnostic.with_help("borrow it through `Gc::anchor` or `anchor!`").emit();
            }
        }
    }

    fn report_calls(
        &self,
        calls: &Calls<'_, 'tcx>,
        frames: &[Frame<'_, 'tcx>],
        blocks: Vec<BasicBlock>,
        conflict: &str,
        reported: &mut FxHashSet<Span>,
    ) {
        let deferred = deferred_blocks(self.cx, frames[0].body);
        for block in blocks.into_iter().filter(|&it| !deferred.contains(it)) {
            let terminator = frames[0].body[block].terminator();
            let span = terminator.source_info.span.source_callsite();
            if let Some(way) = frames.iter().find_map(|&it| calls.may_collect_at(it, terminator))
                && !self.cx.allows.covers_body(self.cx.tcx, self.def_id)
                && reported.insert(span)
            {
                let message = format!("this may collect while {conflict}");
                let mut diagnostic = self.cx.report("no_gc", span, message);
                calls.explain(way, &mut diagnostic);
                diagnostic.emit();
            }
        }
    }
}

/// `'a: 'b` is an edge from `'a` to `'b`: what is borrowed for the one flows to the other.
#[derive(Default)]
struct Flow {
    edges: FxHashMap<RegionVid, Vec<RegionVid>>,
}

impl Flow {
    fn new(pairs: impl Iterator<Item = (RegionVid, RegionVid)>) -> Flow {
        let mut flow = Flow::default();
        for (from, to) in pairs.collect::<FxHashSet<_>>() {
            flow.edges.entry(from).or_default().push(to);
        }
        flow
    }

    /// Does not go on from where `stops`.
    fn reached_from(
        &self,
        start: impl IntoIterator<Item = RegionVid>,
        stops: impl Fn(RegionVid) -> bool,
    ) -> FxHashSet<RegionVid> {
        let mut reached = FxHashSet::default();
        let mut pending: Vec<_> = start.into_iter().collect();
        while let Some(region) = pending.pop() {
            if reached.insert(region) && !stops(region) {
                pending.extend(self.edges.get(&region).into_iter().flatten());
            }
        }
        reached
    }
}

fn variables<'tcx>(regions: impl IntoIterator<Item = ty::Region<'tcx>>) -> Vec<RegionVid> {
    let variable = |region: ty::Region<'_>| match region.kind() {
        ty::ReVar(variable) => Some(variable),
        _ => None,
    };
    regions.into_iter().filter_map(variable).collect()
}

fn outer_regions<'tcx>(references: impl Iterator<Item = Ty<'tcx>>) -> Vec<RegionVid> {
    variables(references.filter_map(|it| match *it.kind() {
        ty::Ref(region, ..) => Some(region),
        _ => None,
    }))
}

/// Those whose terminator is given such a local or is followed by a use of it.
fn blocks_that_hold(
    body: &Body<'_>,
    tracked: &DenseBitSet<Local>,
    dropped: &DenseBitSet<Local>,
    is_initialized: impl Fn(BasicBlock, Local) -> bool,
) -> Vec<BasicBlock> {
    struct Transfer<'a> {
        tracked: &'a DenseBitSet<Local>,
        dropped: &'a DenseBitSet<Local>,
        live: DenseBitSet<Local>,
    }

    impl<'tcx> Visitor<'tcx> for Transfer<'_> {
        fn visit_place(&mut self, place: &Place<'tcx>, context: PlaceContext, _: Location) {
            use {MutatingUseContext::*, PlaceContext::*};
            match context {
                MutatingUse(Store | Call) | NonUse(NonUseContext::StorageLive)
                    if place.projection.is_empty() =>
                {
                    self.live.remove(place.local);
                }
                MutatingUse(Drop) if !self.dropped.contains(place.local) => {}
                NonUse(_) => {}
                _ if self.tracked.contains(place.local) => _ = self.live.insert(place.local),
                _ => {}
            }
        }

        fn visit_local(&mut self, local: Local, context: PlaceContext, location: Location) {
            self.visit_place(&local.into(), context, location);
        }
    }

    let nothing = DenseBitSet::new_empty(body.local_decls.len());
    let mut live_at_start = IndexVec::from_elem_n(nothing.clone(), body.basic_blocks.len());
    let mut live_at_end = live_at_start.clone();
    let mut has_changed = true;
    while std::mem::take(&mut has_changed) {
        for &block in body.basic_blocks.reverse_postorder().iter().rev() {
            let data = &body[block];
            if data.is_cleanup {
                continue;
            }
            let mut transfer = Transfer { tracked, dropped, live: nothing.clone() };
            for successor in data.terminator().successors() {
                transfer.live.union(&live_at_start[successor]);
            }
            match &data.terminator().kind {
                TerminatorKind::Call { destination, func, args, .. } => {
                    let location = body.terminator_loc(block);
                    let context = PlaceContext::MutatingUse(MutatingUseContext::Call);
                    transfer.visit_place(destination, context, location);
                    transfer.visit_operand(func, location);
                    for Spanned { node, .. } in args {
                        transfer.visit_operand(node, location);
                    }
                }
                _ => transfer.visit_terminator(data.terminator(), body.terminator_loc(block)),
            }
            live_at_end[block].union(&transfer.live);
            for (statement_index, statement) in data.statements.iter().enumerate().rev() {
                transfer.visit_statement(statement, Location { block, statement_index });
            }
            has_changed |= live_at_start[block].union(&transfer.live);
        }
    }
    (body.basic_blocks.reverse_postorder().iter().copied())
        .filter(|&block| live_at_end[block].iter().any(|local| is_initialized(block, local)))
        .collect()
}
