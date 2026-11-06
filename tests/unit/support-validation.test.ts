import { supportQueueQuerySchema, supportStatusMutationSchema, supportSubmissionSchema, supportContactMutationSchema } from "@/lib/validations/support";

const requestId = "fb13b340-261c-4b42-a3b8-f50a6009f0ee";
const valid = {
  requestId, name: "  Test Customer  ", email: "  Customer@Example.Invalid  ",
  topic: "ORDER", subject: "Question about my order", message: "Please check my delivery.\nI am available tomorrow.", consent: true,
};

it("preserves Unicode and multiline message content while normalizing contact fields", () => {
  expect(supportSubmissionSchema.parse(valid)).toMatchObject({ name: "Test Customer", email: "customer@example.invalid", message: valid.message });
  const unicode = { ...valid, name: "আসিবুর রহমান", subject: "অর্ডার সম্পর্কে প্রশ্ন", message: "আমার অর্ডারটি কখন পাঠানো হবে?\nদয়া করে জানাবেন।" };
  expect(supportSubmissionSchema.parse(unicode).message).toBe(unicode.message);
});

it("requires explicit consent and rejects forged authority, unbounded content and unsafe controls", () => {
  for (const change of [
    { consent: false }, { consent: undefined }, { userId: requestId }, { status: "RESOLVED" },
    { email: "customer@example.invalid\r\nBcc: somebody@example.invalid" }, { name: "Name\nForged" },
    { message: "Some text\u0000in a message" }, { message: "a".repeat(8001) },
    { topic: "ADMIN" }, { requestId: "guessable" }, { orderReference: "x".repeat(121) },
  ]) expect(supportSubmissionSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  expect(supportSubmissionSchema.safeParse({ ...valid, message: "a".repeat(8000) }).success).toBe(true);
});

it("bounds real queue pages and requires observed revisions and reasoned status decisions", () => {
  expect(supportQueueQuerySchema.parse({})).toEqual({ status: "OPEN", topic: "ALL", page: 1 });
  for (const query of [{ page: 0 }, { page: 1.5 }, { page: 1000001 }, { status: "HIDDEN" }, { email: "private@example.invalid" }]) expect(supportQueueQuerySchema.safeParse(query).success).toBe(false);
  const decision = { requestId, id: requestId, version: 1, status: "IN_PROGRESS", reason: "Reviewing the delivery record" };
  expect(supportStatusMutationSchema.safeParse(decision).success).toBe(true);
  for (const change of [{ version: 0 }, { reason: "" }, { actorId: requestId }, { status: "SENT" }]) expect(supportStatusMutationSchema.safeParse({ ...decision, ...change }).success).toBe(false);
});
it("permits private blank drafts and requires verified safe contact values before public display", () => {
  const fields = { email: null, phone: null, address: null, hours: null, published: false }, intent = { requestId, version: 0, fields, verified: false, reason: "Preparing contact information" };
  expect(supportContactMutationSchema.safeParse(intent).success).toBe(true);
  for (const change of [
    { fields: { ...fields, published: true }, verified: true },
    { fields: { ...fields, email: "support@example.invalid", published: true } },
    { fields: { ...fields, phone: "javascript:alert(1)" } },
    { fields: { ...fields, address: "Injected\ncontrol" } },
    { fields: { ...fields, phone: "123456" } },
    { fields: { ...fields, phone: "+1234567890123456" } },
  ]) expect(supportContactMutationSchema.safeParse({ ...intent, ...change }).success).toBe(false);
  expect(supportContactMutationSchema.parse({ ...intent, fields: { ...fields, email: " Support@Example.Invalid ", phone: "+880 (1700) 123456", published: true }, verified: true }).fields.email).toBe("support@example.invalid");
});
