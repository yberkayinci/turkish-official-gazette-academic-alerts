import { requireOwnerSession } from "@/lib/auth";
import { buildDashboardData } from "@/lib/dashboard";
import { handleApiError, jsonSuccess } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    requireOwnerSession(request);
    return jsonSuccess(await buildDashboardData());
  } catch (error) {
    return handleApiError(error);
  }
}
