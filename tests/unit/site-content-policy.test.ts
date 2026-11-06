import { randomUUID } from "node:crypto";
import { publishableSiteContentSchema, siteContentAddressSchema, siteContentFieldsSchema, siteContentMutationSchema, siteContentStateSchema } from "@/lib/validations/site-content";
import { siteContentDecisionHash, siteContentPath } from "@/lib/site-content-policy";

const fields = { title: "Marketplace guide", summary: "Information reviewed by the operator.", byline: "", sections: [{ heading: "Getting help", body: "Use the contact form for order questions.\nKeep your order reference available." }] };
const decision = { kind: "PAGE", slug: "about", requestId: randomUUID(), version: 0, reason: "Update the operator's introduction", action: "DRAFT", fields };

it("allows private incomplete drafts while requiring complete reviewed publication", () => {
  const blank = { title: "", summary: "", byline: "", sections: [] };
  expect(siteContentFieldsSchema.parse(blank)).toEqual(blank);
  expect(publishableSiteContentSchema.safeParse(blank).success).toBe(false);
  expect(publishableSiteContentSchema.parse(fields)).toEqual(fields);
  expect(siteContentMutationSchema.safeParse({ ...decision, action: "PUBLISH", reviewed: true }).success).toBe(false);
  const { fields: _fields, ...publish } = decision; void _fields;
  expect(siteContentMutationSchema.safeParse({ ...publish, action: "PUBLISH", reviewed: false }).success).toBe(false);
  expect(siteContentMutationSchema.parse({ ...publish, action: "PUBLISH", reviewed: true })).toMatchObject({ reviewed: true });
});

it("keeps information routes closed and article URLs inside the blog path", () => {
  for (const slug of ["about", "faq", "returns", "privacy-policy", "terms"]) {
    expect(siteContentPath(siteContentAddressSchema.parse({ kind: "PAGE", slug }))).toBe(`/${slug}`);
  }
  expect(siteContentPath(siteContentAddressSchema.parse({ kind: "ARTICLE", slug: "operator-update-2026" }))).toBe("/blog/operator-update-2026");
  for (const slug of ["admin", "../admin", "https://external.example", "a/b", "a?token=1", "a#part", "a%2fb", "a--b", "-post", "Post"]) {
    expect(siteContentAddressSchema.safeParse({ kind: "PAGE", slug }).success).toBe(false);
  }
  for (const slug of ["../admin", "a/b", "a?token=1", "a%2fb", "Post"]) {
    expect(siteContentAddressSchema.safeParse({ kind: "ARTICLE", slug }).success).toBe(false);
  }
});

it("bounds total text, sections and controls without discarding Unicode or paragraph breaks", () => {
  const unicode = { ...fields, title: "আমার গ্যাজেট", sections: [{ heading: "সহায়তা", body: "প্রশ্ন থাকলে যোগাযোগের ফর্ম ব্যবহার করুন।\nআপনার অর্ডারের তথ্য দিন।" }] };
  expect(publishableSiteContentSchema.parse(unicode)).toEqual(unicode);
  expect(siteContentFieldsSchema.safeParse({ ...fields, title: "Forged\nheading" }).success).toBe(false);
  expect(siteContentFieldsSchema.safeParse({ ...fields, sections: [{ heading: "Title", body: "Invalid\u0001text" }] }).success).toBe(false);
  expect(siteContentFieldsSchema.safeParse({ ...fields, sections: Array.from({ length: 25 }, () => fields.sections[0]) }).success).toBe(false);
  expect(siteContentFieldsSchema.safeParse({ ...fields, sections: Array.from({ length: 13 }, () => ({ heading: "Long section", body: "x".repeat(8000) })) }).success).toBe(false);
  expect(siteContentFieldsSchema.safeParse({ ...fields, sections: Array.from({ length: 4 }, () => ({ heading: "Unicode section", body: "ক".repeat(8000) })) }).success).toBe(false);
  expect(siteContentFieldsSchema.safeParse({ ...fields, title: "Invalid\ud800" }).success).toBe(false);
  expect(siteContentFieldsSchema.safeParse({ ...fields, html: "<script>executable</script>" }).success).toBe(false);
});

it("binds retry hashes to the normalized target, reviewed revision and complete decision", () => {
  const parsed = siteContentMutationSchema.parse(decision), digest = siteContentDecisionHash(parsed);
  expect(siteContentDecisionHash(siteContentMutationSchema.parse({ ...decision, requestId: randomUUID() }))).toBe(digest);
  for (const changes of [{ slug: "faq" }, { version: 1 }, { reason: "A different reviewed change" }, { fields: { ...fields, title: "Different content" } }]) {
    expect(siteContentDecisionHash(siteContentMutationSchema.parse({ ...decision, ...changes }))).not.toBe(digest);
  }
  expect(siteContentMutationSchema.safeParse({ ...decision, actorId: "forged" }).success).toBe(false);
  expect(siteContentMutationSchema.safeParse({ ...decision, version: 2_147_483_647 }).success).toBe(false);
});

it("rejects publication pointers beyond the retained state revision", () => {
  expect(siteContentStateSchema.safeParse({ kind: "PAGE", slug: "about", version: 2, draft: fields, publishedVersion: 3 }).success).toBe(false);
  expect(siteContentStateSchema.parse({ kind: "PAGE", slug: "about", version: 2, draft: fields, publishedVersion: 1 }).publishedVersion).toBe(1);
});
