import { redirect, notFound } from "next/navigation";
import { getCurrentUserWithRole } from "@/lib/session";
import { siteContentAddressSchema } from "@/lib/validations/site-content";
import { SiteContentEditor } from "@/components/content/site-content-editor";

export default async function ContentEditorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getCurrentUserWithRole(["ADMIN"]);
  if (!actor) redirect("/login");
  const input = await searchParams, result = siteContentAddressSchema.safeParse(input);
  if (!result.success || result.data.slug !== input.slug) notFound();
  return <main className="mx-auto max-w-5xl space-y-6 p-6">
    <h1 className="text-3xl font-bold">Edit {result.data.kind === "PAGE" ? "information page" : "article"}: {result.data.slug}</h1>
    <SiteContentEditor ownerId={actor.id} address={result.data} />
  </main>;
}
