/** Keep rejected work out of the native LockGrantedCallback promise. Firefox
 * can report that rejection as a page error even when locks.request is caught.
 * Re-throw after the native request has fulfilled so callers retain the exact
 * original failure and their existing retry/fallback policy. */
export async function withBrowserLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) return work();
  const result = await navigator.locks.request(name, async (): Promise<
    { ok: true; value: T } | { ok: false; error: unknown }
  > => {
    try { return { ok: true, value: await work() }; }
    catch (error) { return { ok: false, error }; }
  });
  if (!result.ok) throw result.error;
  return result.value;
}
