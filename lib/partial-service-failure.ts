import { serviceUnavailable } from "@/lib/observability";
/** Join an optional section's failure to the same safe incident used by its
 * reader; never copy provider/database exception data into page props. */
export function partialServiceFailure(label: string, operation: string, result: PromiseSettledResult<unknown>) {
  if (result.status === "fulfilled") return null;
  return { label, reference: serviceUnavailable(operation, result.reason).digest };
}
