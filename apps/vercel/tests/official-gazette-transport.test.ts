import { X509Certificate } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";

import { fetchOfficialResource } from "@/lib/official-gazette/collector";
import {
  GEOTRUST_TLS_RSA_CA_G1_PEM,
  buildOfficialGazetteAgentOptions,
  createOfficialGazetteFetch,
} from "@/lib/official-gazette/transport";

const agents: MockAgent[] = [];

afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.close()));
});

function createMockTransport(): {
  agent: MockAgent;
  fetchImpl: ReturnType<typeof createOfficialGazetteFetch>;
} {
  const agent = new MockAgent();
  agent.disableNetConnect();
  agents.push(agent);
  return {
    agent,
    fetchImpl: createOfficialGazetteFetch({ dispatcher: agent }),
  };
}

describe("Official Gazette TLS transport", () => {
  it("retains the normal trust store and adds only the verified missing issuer", () => {
    const options = buildOfficialGazetteAgentOptions({
      trustedRoots: ["TEST ROOT A", "TEST ROOT B"],
      additionalIssuerCertificate: "TEST GEOTRUST ISSUER",
    });
    expect(options.connect).toMatchObject({
      ca: ["TEST ROOT A", "TEST ROOT B", "TEST GEOTRUST ISSUER"],
      rejectUnauthorized: true,
      allowPartialTrustChain: false,
    });

    const certificate = new X509Certificate(GEOTRUST_TLS_RSA_CA_G1_PEM);
    expect(certificate.ca).toBe(true);
    expect(certificate.subject).toContain("CN=GeoTrust TLS RSA CA G1");
    expect(certificate.issuer).toContain("CN=DigiCert Global Root G2");
    expect(certificate.fingerprint256).toBe(
      "C0:6E:30:7F:7C:FC:1D:32:FA:72:A4:C0:33:C8:7B:90:01:9A:F2:16:F0:77:5D:64:97:8A:2E:CA:6C:8A:23:0E",
    );
    expect(new Date(certificate.validTo).toISOString()).toBe("2027-11-02T12:23:37.000Z");
  });

  it("uses the scoped dispatcher while preserving native manual-redirect responses", async () => {
    const { agent, fetchImpl } = createMockTransport();
    agent
      .get("https://www.resmigazete.gov.tr")
      .intercept({ path: "/11.08.2026", method: "GET" })
      .reply(302, "redirecting", {
        headers: { location: "https://example.invalid/not-allowed" },
      });

    const response = await fetchImpl("https://www.resmigazete.gov.tr/11.08.2026", {
      method: "GET",
    });

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.invalid/not-allowed");
    expect(await response.text()).toBe("redirecting");
    agent.assertNoPendingInterceptors();
  });

  it("rejects off-host input before dispatch and keeps redirect confinement", async () => {
    const { agent, fetchImpl } = createMockTransport();
    await expect(fetchImpl("https://example.invalid/notice.pdf")).rejects.toThrow(
      "Only HTTPS resources on www.resmigazete.gov.tr are allowed.",
    );

    agent
      .get("https://www.resmigazete.gov.tr")
      .intercept({ path: "/start.pdf", method: "GET" })
      .reply(302, "", { headers: { location: "https://example.invalid/escape.pdf" } });
    await expect(
      fetchOfficialResource("https://www.resmigazete.gov.tr/start.pdf", {
        kind: "pdf",
        fetchImpl,
      }),
    ).rejects.toThrow("Only HTTPS resources on www.resmigazete.gov.tr are allowed.");
    agent.assertNoPendingInterceptors();
  });

  it("preserves the collector's response-size limit on the native response stream", async () => {
    const { agent, fetchImpl } = createMockTransport();
    agent
      .get("https://www.resmigazete.gov.tr")
      .intercept({ path: "/oversized.pdf", method: "GET" })
      .reply(200, "%PDF-this-response-is-too-large", {
        headers: { "content-type": "application/pdf" },
      });

    await expect(
      fetchOfficialResource("https://www.resmigazete.gov.tr/oversized.pdf", {
        kind: "pdf",
        fetchImpl,
        maxBytes: 8,
      }),
    ).rejects.toThrow("exceeds the configured size limit");
    agent.assertNoPendingInterceptors();
  });
});
