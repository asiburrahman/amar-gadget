import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";

export const metadata = { title: "Email verification | Amar Gadget", robots: { index: false, follow: false } };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { email } = await searchParams;
  const parsed = z.string().trim().max(254).email().safeParse(email);
  if (parsed.success) redirect(`/verify-otp?${new URLSearchParams({ email: parsed.data })}`);
  return <main className="mx-auto max-w-xl space-y-5 p-6">
    <h1 className="text-3xl font-bold">Verify your email</h1>
    <p>Enter the email address you registered with to open the verification form. You can enter your emailed code or request another code there. Opening this page does not verify an account or send an email.</p>
    {email !== undefined && <p role="alert">Enter one valid registration email address.</p>}
    <form action="/verify-email" method="GET" className="space-y-3">
      <label className="grid gap-2">Registration email<input className="rounded border px-3 py-2" type="email" name="email" maxLength={254} autoComplete="email" required /></label>
      <button className="rounded border px-3 py-2">Continue to verification</button>
    </form>
    <nav className="flex gap-4"><Link href="/login" className="underline">Sign in</Link><Link href="/register" className="underline">Create an account</Link></nav>
  </main>;
}
