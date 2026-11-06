import { taxonomyOptionsResponse } from "@/lib/taxonomy-options-response";
export async function GET(request: Request) {
  return taxonomyOptionsResponse("brand", request);
}
