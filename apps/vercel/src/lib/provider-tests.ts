import { GeminiClient } from "./analysis/gemini";

const GEMINI_TEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
};

export async function testGeminiApiKey(apiKey: string, model = "gemini-3.6-flash") {
  const client = new GeminiClient({ apiKey, model, maxAttempts: 1, timeoutMs: 30_000 });
  const result = await client.generateJson<{ ok?: unknown }>(
    [
      {
        text: [
          "This is a connection test.",
          "Return JSON with ok=true. Do not include any other field.",
        ].join("\n"),
      },
    ],
    GEMINI_TEST_SCHEMA,
  );
  if (result.ok !== true) throw new Error("Gemini returned an unexpected connection-test result.");
}

export async function testResendApiKey(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetchImpl("https://api.resend.com/domains", {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "OfficialGazetteMonitor/1.0",
      },
    });
    if (response.ok) return;

    // Resend sending-only keys intentionally cannot list domains. A specific
    // restricted-key response proves that the credential is recognized while
    // letting production deployments keep least-privilege send-only keys.
    if (response.status === 401) {
      const payload = (await response.json().catch(() => null)) as
        | { name?: unknown; code?: unknown }
        | null;
      if (payload?.name === "restricted_api_key" || payload?.code === "restricted_api_key") {
        return;
      }
    }
    throw new Error(`Resend rejected the API key (HTTP ${response.status}).`);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("The Resend connection test timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
