/**
 * `PUT /:name` — the write side of the registry.
 *
 * npm overloads this one endpoint. The `_attachments` key is what
 * distinguishes the cases:
 *
 *   - With `_attachments`: `npm publish` / `bun publish`. The body
 *     carries one or more new versions plus their tarballs, base64
 *     encoded. The registry decodes each tarball, verifies the
 *     integrity the client claimed, and refuses to overwrite a version
 *     that already exists.
 *
 *   - Without `_attachments`: a metadata update. `npm deprecate` sends
 *     the whole packument back with `versions[v].deprecated` changed;
 *     legacy dist-tag and unpublish flows send it with tags or
 *     versions changed. The registry diffs against what it has.
 *
 * Unpublish is its own pair of routes:
 *   - `DELETE /:name/-rev/:rev` removes the whole package.
 *   - `PUT /:name/-rev/:rev` replaces the version set (npm sends the
 *     packument minus the versions to remove), after which the client
 *     `DELETE`s each orphaned tarball.
 */

import { json, npmError, packageNotFound } from "./errors";
import { checkIntegrity, computeIntegrity } from "./integrity";
import {
  manifestFromValue,
  revString,
  tarballFromBytes,
  touchRecord,
  type Manifest,
  type PackageRecord,
  type StoredVersion,
} from "./package-store";
import type { PublishBody } from "./types";

/** Manifest fields the registry owns and therefore never stores from a client. */
const REGISTRY_OWNED_FIELDS = ["dist", "_id"] as const;

function storedFromPublished(manifest: Manifest, tarball: Uint8Array): StoredVersion {
  const cleaned: Manifest = { ...manifest };
  for (const field of REGISTRY_OWNED_FIELDS) delete cleaned[field];
  return { manifest: manifestFromValue(cleaned), tarball: tarballFromBytes(async () => tarball) };
}

function ok(record: PackageRecord, extra: Record<string, unknown> = {}): Response {
  return json({ ok: true, id: record.name, rev: revString(record), ...extra }, { status: 201 });
}

/**
 * Applies a publish body to a record. The record must already be the
 * registry's own mutable copy; this function only mutates, it never
 * decides what to mutate.
 */
export async function handlePublish(record: PackageRecord, body: PublishBody): Promise<Response> {
  if (body.name !== undefined && body.name !== record.name) {
    return npmError(400, `package name mismatch: URL says ${record.name}, body says ${body.name}`);
  }
  if (body._attachments != null && Object.keys(body._attachments).length > 0) {
    return publishVersions(record, body);
  }
  // A metadata-only PUT updates something that already exists; on a
  // name the registry has never seen it must 404 like its sibling
  // write handlers, not commit a fresh empty record.
  return record.versions.size === 0 ? packageNotFound(record.name) : updateMetadata(record, body);
}

async function publishVersions(record: PackageRecord, body: PublishBody): Promise<Response> {
  const attachments = body._attachments!;
  const versions = body.versions ?? {};

  // Validate everything before mutating anything, so a rejected publish
  // leaves the record exactly as it was.
  const staged: Array<{ version: string; stored: StoredVersion }> = [];
  for (const [version, manifest] of Object.entries(versions)) {
    if (manifest == null || typeof manifest !== "object") {
      return npmError(400, `versions[${JSON.stringify(version)}] must be an object`);
    }
    if (record.versions.has(version)) {
      // registry.npmjs.org's exact wording; clients surface it verbatim.
      return npmError(403, `You cannot publish over the previously published versions: ${version}.`);
    }
    const filename = `${unscoped(record.name)}-${version}.tgz`;
    const attachment = attachments[filename] ?? attachments[`${record.name}-${version}.tgz`];
    if (attachment == null || typeof attachment !== "object") {
      return npmError(400, `missing _attachments[${JSON.stringify(filename)}]`);
    }
    if (typeof attachment.data !== "string") {
      return npmError(400, `_attachments[${JSON.stringify(filename)}].data must be a base64 string`);
    }
    const tarball: Uint8Array = Buffer.from(attachment.data, "base64");
    // The client declares the tarball's integrity in `dist`; a registry
    // that accepted bytes that don't match would serve a package every
    // installer then rejects, so catch it at the door. `dist.integrity`
    // is a W3C SRI string (whitespace-separated list, optional padding),
    // so parse it and accept when any token proves the uploaded bytes.
    const claimed = (manifest as { dist?: { integrity?: string } }).dist?.integrity;
    if (claimed !== undefined && !checkIntegrity(claimed, tarball)) {
      return npmError(
        400,
        `integrity mismatch for ${record.name}@${version}: ` +
          `the manifest claims ${claimed} but the attached tarball is ${computeIntegrity(tarball).integrity}`,
      );
    }
    staged.push({ version, stored: storedFromPublished(manifest as Manifest, tarball) });
  }

  if (staged.length === 0) return npmError(400, "no versions to publish");

  const now = new Date().toISOString();
  for (const { version, stored } of staged) {
    record.versions.set(version, stored);
    record.time[version] = now;
  }
  // registry.npmjs.org sets `created` at first publish and never moves it.
  record.time.created ??= now;
  Object.assign(record.distTags, body["dist-tags"]);
  if (body.description !== undefined) record.extra.description = body.description;
  if (body.readme !== undefined) record.extra.readme = body.readme;
  touchRecord(record);
  return ok(record, { success: true });
}

/**
 * A `PUT /:name` with no attachments: the client sent back the whole
 * packument with something changed. The only change npm's own CLI makes
 * this way today is `deprecated`, so that is what is diffed; dist-tags
 * in the body are merged too since older clients wrote them here.
 */
async function updateMetadata(record: PackageRecord, body: PublishBody): Promise<Response> {
  const versions = body.versions ?? {};
  for (const [version, incoming] of Object.entries(versions)) {
    const existing = record.versions.get(version);
    if (existing === undefined || incoming == null || typeof incoming !== "object") continue;
    const deprecated = (incoming as { deprecated?: string }).deprecated;
    const current = await existing.manifest();
    if (deprecated === current.deprecated) continue;
    const updated: Manifest = { ...current };
    // `npm deprecate <pkg> ""` clears a deprecation by sending "".
    if (deprecated === undefined || deprecated === "") delete updated.deprecated;
    else updated.deprecated = deprecated;
    record.versions.set(version, { ...existing, manifest: manifestFromValue(updated) });
  }
  if (body["dist-tags"] !== undefined) Object.assign(record.distTags, body["dist-tags"]);
  touchRecord(record);
  return ok(record);
}

/**
 * `PUT /:name/-rev/:rev` — replace the version set. npm's unpublish
 * flow sends the packument with the removed versions absent; anything
 * the body no longer lists is deleted.
 */
export function handleReplaceVersions(record: PackageRecord, body: PublishBody): Response {
  const keep = new Set(Object.keys(body.versions ?? {}));
  for (const version of [...record.versions.keys()]) {
    if (!keep.has(version)) {
      record.versions.delete(version);
      delete record.time[version];
    }
  }
  record.distTags = { ...(body["dist-tags"] ?? {}) };
  for (const [tag, version] of Object.entries(record.distTags)) {
    if (!record.versions.has(version)) delete record.distTags[tag];
  }
  touchRecord(record);
  return ok(record);
}

function unscoped(name: string): string {
  return name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name;
}
