import { z } from "zod";

import {
  authenticateOwnerPassword,
  getLoginIdentifierHash,
  getOwnerSession,
  issueOwnerSession,
  serializeExpiredSessionCookie,
} from "@/lib/auth";
import { assertSameOrigin } from "@/lib/csrf";
import { getServerEnv } from "@/lib/env";
import { ApiInputError, handleApiError, jsonError, jsonSuccess, readJsonBody } from "@/lib/http";
import { getStateRepository } from "@/lib/repositories/state";

export const dynamic = "force-dynamic";

const sessionMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sign_out") }).strict(),
  z
    .object({
      action: z.literal("sign_in"),
      password: z.string().min(12).max(1_024),
    })
    .strict(),
]);

function ownerData() {
  const env = getServerEnv();
  return {
    ...(env.ownerEmail ? { email: env.ownerEmail } : {}),
    ...(env.ownerName ? { name: env.ownerName } : {}),
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const session = getOwnerSession(request);
    return jsonSuccess({ authenticated: Boolean(session), owner: session ? ownerData() : null });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const mutation = sessionMutationSchema.parse(await readJsonBody(request, 4_096));

    if (mutation.action === "sign_out") {
      const response = jsonSuccess({ authenticated: false });
      response.headers.append("Set-Cookie", serializeExpiredSessionCookie());
      return response;
    }

    const identifier = getLoginIdentifierHash(request);
    const currentLimit = await getStateRepository().getLoginRateLimit(identifier);
    if (!currentLimit.allowed) {
      return jsonError(
        "Too many sign-in attempts. Wait before trying again.",
        429,
        "RATE_LIMITED",
      );
    }
    const authenticated = await authenticateOwnerPassword(mutation.password);
    if (!authenticated) {
      const decision = await getStateRepository().registerLoginFailure(identifier);
      if (!decision.allowed) {
        return jsonError(
          "Too many sign-in attempts. Wait before trying again.",
          429,
          "RATE_LIMITED",
        );
      }
      return jsonError("The password is incorrect.", 401, "INVALID_CREDENTIALS");
    }

    await getStateRepository().clearLoginFailures(identifier);
    const issued = issueOwnerSession();
    const response = jsonSuccess({ authenticated: true, owner: ownerData() });
    response.headers.append("Set-Cookie", issued.cookie);
    return response;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return handleApiError(new ApiInputError("The request body is invalid."));
    }
    return handleApiError(error);
  }
}
