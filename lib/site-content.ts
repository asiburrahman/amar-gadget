import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/session";
import { serviceUnavailable } from "@/lib/observability";
import { SiteContentError, siteContentDecisionHash, siteContentPath } from "@/lib/site-content-policy";
import { publishableSiteContentSchema, siteContentAddressSchema, siteContentFieldsSchema, siteContentMutationSchema, siteContentStateSchema, type SiteContentAddress, type SiteContentState } from "@/lib/validations/site-content";

const pageSchema = z.number().int().min(1).max(1_000_000);
const revisionSelect = { version: true, action: true, reviewed: true, after: true, createdAt: true } as const;
type Revision = { version: number; action: string; reviewed: boolean; after: Prisma.JsonValue; createdAt: Date };

function checkedState(value: unknown): SiteContentState {
  try { return siteContentStateSchema.parse(value); }
  catch (error) { throw serviceUnavailable("site_content.integrity", error); }
}
function stateOf(row: { kind: string; slug: string; version: number; draft: Prisma.JsonValue; publishedVersion: number | null }) {
  return checkedState({ kind: row.kind, slug: row.slug, version: row.version, draft: row.draft, publishedVersion: row.publishedVersion });
}
function publishedDocument(address: SiteContentAddress, revision: Revision) {
  const state = checkedState(revision.after);
  try {
    if (revision.action !== "PUBLISH" || !revision.reviewed || state.version !== revision.version ||
      state.publishedVersion !== revision.version || state.kind !== address.kind || state.slug !== address.slug) throw Error("Publication evidence mismatch");
    return { ...address, ...publishableSiteContentSchema.parse(state.draft), version: revision.version,
      publishedAt: revision.createdAt.toISOString(), path: siteContentPath(address) };
  } catch (error) { throw serviceUnavailable("site_content.publication", error); }
}
async function transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, actor?: AuthenticatedUser, write = false) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout='2000ms'`;
    await tx.$executeRaw`SET LOCAL statement_timeout='5000ms'`;
    if (actor) {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR SHARE`;
      const current = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, isVerified: true, sessionVersion: true } });
      if (!current?.isVerified || current.role !== "ADMIN" || actor.role !== "ADMIN" || current.sessionVersion !== actor.sessionVersion) {
        throw new SiteContentError("Administrator access changed. Sign in again.", 403, "SITE_CONTENT_FORBIDDEN");
      }
    }
    return work(tx);
  }, { isolationLevel: write ? "ReadCommitted" : "RepeatableRead", maxWait: 5000, timeout: 10_000 });
}

export async function readPublishedSiteContent(raw: SiteContentAddress) {
  const address = siteContentAddressSchema.parse(raw);
  try {
    return await transaction(async (tx) => {
      // Never select or return the current draft for a public read. Publication
      // points at a retained reviewed snapshot, independent of later edits.
      const saved = await tx.siteContent.findUnique({ where: { kind_slug: address }, select: { publication: { select: revisionSelect } } });
      return saved?.publication ? publishedDocument(address, saved.publication) : null;
    });
  } catch (error) { throw serviceUnavailable("site_content.public_read", error); }
}

const articleSummarySchema = z.object({
  slug: z.string(), version: z.number().int().positive(), publishedVersion: z.number().int().positive().nullable(),
  title: z.string(), summary: z.string(), byline: z.string(), timestamp: z.string().datetime(),
}).strict().superRefine((row, context) => {
  if (!siteContentAddressSchema.safeParse({ kind: "ARTICLE", slug: row.slug }).success ||
    !siteContentFieldsSchema.safeParse({ title: row.title, summary: row.summary, byline: row.byline, sections: [] }).success) {
    context.addIssue({ code: "custom", message: "Invalid article summary" });
  }
});
type ArticleSummaryRow = z.infer<typeof articleSummarySchema>;

// Project only the small summary fields inside PostgreSQL. A collection never
// retrieves private paragraphs or twenty complete 96 KB publication snapshots.
async function articlePage(tx: Prisma.TransactionClient, page: number, administrator: boolean) {
  const total = await tx.siteContent.count({ where: { kind: "ARTICLE", ...(administrator ? {} : { publishedVersion: { not: null } }) } });
  const totalPages = Math.max(1, Math.ceil(total / 20));
  if (page > totalPages) throw new SiteContentError("This article page does not exist.", 404, "SITE_CONTENT_NOT_FOUND");
  const offset = (page - 1) * 20;
  const rows = administrator ? await tx.$queryRaw<ArticleSummaryRow[]>`
    SELECT c.slug,c.version,c."publishedVersion",c.draft->>'title' AS title,
      c.draft->>'summary' AS summary,c.draft->>'byline' AS byline,
      to_char(c."updatedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS timestamp
    FROM "SiteContent" c WHERE c.kind='ARTICLE'
    ORDER BY c."updatedAt" DESC,c.slug ASC LIMIT 20 OFFSET ${offset}`
    : await tx.$queryRaw<ArticleSummaryRow[]>`
    SELECT c.slug,r.version,c."publishedVersion",r.after->'draft'->>'title' AS title,
      r.after->'draft'->>'summary' AS summary,r.after->'draft'->>'byline' AS byline,
      to_char(r."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS timestamp
    FROM "SiteContent" c JOIN "SiteContentRevision" r
      ON r.kind=c.kind AND r.slug=c.slug AND r.version=c."publishedVersion"
    WHERE c.kind='ARTICLE' AND c."publishedVersion" IS NOT NULL
      AND r.action='PUBLISH' AND r.reviewed=true
    ORDER BY c."publishedAt" DESC,c.slug ASC LIMIT 20 OFFSET ${offset}`;
  try {
    if (rows.length !== Math.min(20, total - offset)) throw Error("Article publication count mismatch");
    const summaries = rows.map((raw) => {
      const row = articleSummarySchema.parse(raw);
      if (!administrator && (row.version !== row.publishedVersion || row.title.length < 3 || row.summary.length < 10)) throw Error("Invalid published article summary");
      return { ...row, path: siteContentPath({ kind: "ARTICLE", slug: row.slug }) };
    });
    return { page, total, totalPages, rows: summaries };
  } catch (error) { throw serviceUnavailable("site_content.article_integrity", error); }
}

export async function listPublicSiteArticles(rawPage = 1) {
  const page = pageSchema.parse(rawPage);
  try {
    const result = await transaction((tx) => articlePage(tx, page, false));
    return { ...result, rows: result.rows.map(({ timestamp, ...row }) => ({ ...row, publishedAt: timestamp })) };
  }
  catch (error) {
    if (error instanceof SiteContentError) throw error;
    throw serviceUnavailable("site_content.article_list", error);
  }
}

export async function listAdminSiteArticles(actor: AuthenticatedUser, rawPage = 1) {
  const page = pageSchema.parse(rawPage);
  return transaction(async (tx) => {
    const result = await articlePage(tx, page, true);
    return { ownerId: actor.id, articles: { ...result, rows: result.rows.map(({ timestamp, ...row }) => ({ ...row, updatedAt: timestamp })) } };
  }, actor);
}

export async function readAdminSiteContent(actor: AuthenticatedUser, raw: SiteContentAddress, rawPage = 1) {
  const address = siteContentAddressSchema.parse(raw), page = pageSchema.parse(rawPage);
  return transaction(async (tx) => {
    const saved = await tx.siteContent.findUnique({ where: { kind_slug: address }, include: { publication: { select: revisionSelect } } });
    const total = await tx.siteContentRevision.count({ where: address }), totalPages = Math.max(1, Math.ceil(total / 20));
    if (page > totalPages) throw new SiteContentError("This content history page does not exist.", 404, "SITE_CONTENT_NOT_FOUND");
    const rows = await tx.siteContentRevision.findMany({ where: address, take: 20, skip: (page - 1) * 20, orderBy: { version: "desc" },
      select: { version: true, action: true, actorId: true, reason: true, reviewed: true, createdAt: true } });
    return { ownerId: actor.id, address,
      document: saved ? { ...stateOf(saved), publishedAt: saved.publishedAt?.toISOString() ?? null, updatedAt: saved.updatedAt.toISOString() } : null,
      publication: saved?.publication ? publishedDocument(address, saved.publication) : null,
      history: { page, total, totalPages, rows: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) } };
  }, actor);
}

export async function readAdminSiteContentRevision(actor: AuthenticatedUser, raw: SiteContentAddress, version: number) {
  const address = siteContentAddressSchema.parse(raw); z.number().int().min(1).max(2_147_483_647).parse(version);
  return transaction(async (tx) => {
    const saved = await tx.siteContentRevision.findUnique({ where: { kind_slug_version: { ...address, version } } });
    if (!saved) throw new SiteContentError("This retained revision does not exist.", 404, "SITE_CONTENT_NOT_FOUND");
    return { ownerId: actor.id, revision: { ...address, version, action: saved.action, reviewed: saved.reviewed,
      actorId: saved.actorId, reason: saved.reason, before: saved.before === null ? null : checkedState(saved.before),
      after: checkedState(saved.after), createdAt: saved.createdAt.toISOString() } };
  }, actor);
}

async function receipt(tx: Prisma.TransactionClient, revision: Revision) {
  const state = checkedState(revision.after);
  const published = state.publishedVersion === null ? null : state.publishedVersion === revision.version ? revision
    : await tx.siteContentRevision.findUnique({ where: { kind_slug_version: { kind: state.kind, slug: state.slug, version: state.publishedVersion } }, select: revisionSelect });
  if (state.publishedVersion !== null && !published) throw serviceUnavailable("site_content.receipt", Error("Publication reference missing"));
  if (published) publishedDocument(state, published);
  return { ...state, publishedAt: published?.createdAt.toISOString() ?? null, updatedAt: revision.createdAt.toISOString(), path: siteContentPath(state) };
}

export async function mutateSiteContent(actor: AuthenticatedUser, raw: unknown) {
  const input = siteContentMutationSchema.parse(raw), hash = siteContentDecisionHash(input);
  const address = { kind: input.kind, slug: input.slug };
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`site-content:decision:${input.requestId}`},0))`;
    const prior = await tx.siteContentRevision.findUnique({ where: { requestId: input.requestId } });
    if (prior) {
      if (prior.actorId !== actor.id || prior.contentHash !== hash) throw new SiteContentError("This operation reference belongs to a different content decision.");
      return { ownerId: actor.id, result: await receipt(tx, prior) };
    }
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`site-content:document:${input.kind}:${input.slug}`},0))`;
    const saved = await tx.siteContent.findUnique({ where: { kind_slug: address }, include: { publication: { select: revisionSelect } } });
    if ((saved?.version ?? 0) !== input.version) throw new SiteContentError("This document changed. Load the latest saved revision before deciding again.");
    const before = saved ? stateOf(saved) : null;
    if (input.action !== "DRAFT" && !before) throw new SiteContentError("Save a private draft before publishing or unpublishing this document.");
    const draft = input.action === "DRAFT" ? input.fields : before!.draft;
    if (input.action === "DRAFT" && before && JSON.stringify(draft) === JSON.stringify(before.draft)) throw new SiteContentError("This draft is already saved. Change a field before saving again.");
    if (input.action === "PUBLISH") {
      if (!publishableSiteContentSchema.safeParse(draft).success) throw new SiteContentError("Complete the saved title, summary and sections before publishing.", 400, "SITE_CONTENT_REQUEST");
      if (saved?.publication) {
        const current = publishedDocument(address, saved.publication);
        if (current.title === draft.title && current.summary === draft.summary && current.byline === draft.byline &&
          JSON.stringify(current.sections) === JSON.stringify(draft.sections)) throw new SiteContentError("This reviewed draft is already the current publication.");
      }
    }
    if (input.action === "UNPUBLISH" && before!.publishedVersion === null) throw new SiteContentError("This document is already unpublished.");
    const version = input.version + 1;
    const publishedVersion = input.action === "PUBLISH" ? version : input.action === "UNPUBLISH" ? null : before?.publishedVersion ?? null;
    const after = { ...address, version, draft, publishedVersion };
    const revision = await tx.siteContentRevision.create({ data: {
      ...address, version, requestId: input.requestId, contentHash: hash, actorId: actor.id, action: input.action,
      reason: input.reason, reviewed: input.action === "PUBLISH", before: before ?? Prisma.DbNull, after,
    } });
    const data = { version, draft, publishedVersion,
      publishedAt: input.action === "PUBLISH" ? revision.createdAt : input.action === "UNPUBLISH" ? null : saved?.publishedAt ?? null };
    if (saved) await tx.siteContent.update({ where: { kind_slug: address }, data });
    else await tx.siteContent.create({ data: { ...address, ...data } });
    return { ownerId: actor.id, result: await receipt(tx, revision) };
  }, actor, true);
}

export type AdminSiteContentView = Awaited<ReturnType<typeof readAdminSiteContent>>;
export type SiteContentReceipt = Awaited<ReturnType<typeof mutateSiteContent>>["result"];
