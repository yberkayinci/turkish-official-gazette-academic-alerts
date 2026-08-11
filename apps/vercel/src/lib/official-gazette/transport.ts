import * as tls from "node:tls";

import { Agent, type Dispatcher } from "undici";

import { assertOfficialGazetteUrl } from "./parser";

export type OfficialGazetteFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type DispatcherFetch = (
  input: string | URL | Request,
  init: RequestInit & { dispatcher: Dispatcher },
) => Promise<Response>;

export interface OfficialGazetteTransportOptions {
  fetchImpl?: DispatcherFetch;
  dispatcher?: Dispatcher;
  trustedRoots?: readonly string[];
  additionalIssuerCertificate?: string;
}

/**
 * The Official Gazette origin currently omits this issuer from its TLS
 * handshake. Keep the certificate and metadata together so expiry/rotation is
 * visible in code review. This certificate is not a replacement trust store:
 * it is appended to Node's normal roots by createOfficialGazetteDispatcher().
 *
 * Subject: GeoTrust TLS RSA CA G1
 * Issuer: DigiCert Global Root G2
 * SHA-256: C0:6E:30:7F:7C:FC:1D:32:FA:72:A4:C0:33:C8:7B:90:01:9A:F2:16:F0:77:5D:64:97:8A:2E:CA:6C:8A:23:0E
 * Valid until: 2027-11-02T12:23:37Z
 * AIA: http://cacerts.geotrust.com/GeoTrustTLSRSACAG1.crt
 */
export const GEOTRUST_TLS_RSA_CA_G1_PEM = `-----BEGIN CERTIFICATE-----
MIIEjTCCA3WgAwIBAgIQDQd4KhM/xvmlcpbhMf/ReTANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0xNzExMDIxMjIzMzdaFw0yNzExMDIxMjIzMzdaMGAxCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
b20xHzAdBgNVBAMTFkdlb1RydXN0IFRMUyBSU0EgQ0EgRzEwggEiMA0GCSqGSIb3
DQEBAQUAA4IBDwAwggEKAoIBAQC+F+jsvikKy/65LWEx/TMkCDIuWegh1Ngwvm4Q
yISgP7oU5d79eoySG3vOhC3w/3jEMuipoH1fBtp7m0tTpsYbAhch4XA7rfuD6whU
gajeErLVxoiWMPkC/DnUvbgi74BJmdBiuGHQSd7LwsuXpTEGG9fYXcbTVN5SATYq
DfbexbYxTMwVJWoVb6lrBEgM3gBBqiiAiy800xu1Nq07JdCIQkBsNpFtZbIZhsDS
fzlGWP4wEmBQ3O67c+ZXkFr2DcrXBEtHam80Gp2SNhou2U5U7UesDL/xgLK6/0d7
6TnEVMSUVJkZ8VeZr+IUIlvoLrtjLbqugb0T3OYXW+CQU0kBAgMBAAGjggFAMIIB
PDAdBgNVHQ4EFgQUlE/UXYvkpOKmgP792PkA76O+AlcwHwYDVR0jBBgwFoAUTiJU
IBiV5uNu5g/6+rkS7QYXjzkwDgYDVR0PAQH/BAQDAgGGMB0GA1UdJQQWMBQGCCsG
AQUFBwMBBggrBgEFBQcDAjASBgNVHRMBAf8ECDAGAQH/AgEAMDQGCCsGAQUFBwEB
BCgwJjAkBggrBgEFBQcwAYYYaHR0cDovL29jc3AuZGlnaWNlcnQuY29tMEIGA1Ud
HwQ7MDkwN6A1oDOGMWh0dHA6Ly9jcmwzLmRpZ2ljZXJ0LmNvbS9EaWdpQ2VydEds
b2JhbFJvb3RHMi5jcmwwPQYDVR0gBDYwNDAyBgRVHSAAMCowKAYIKwYBBQUHAgEW
HGh0dHBzOi8vd3d3LmRpZ2ljZXJ0LmNvbS9DUFMwDQYJKoZIhvcNAQELBQADggEB
AIIcBDqC6cWpyGUSXAjjAcYwsK4iiGF7KweG97i1RJz1kwZhRoo6orU1JtBYnjzB
c4+/sXmnHJk3mlPyL1xuIAt9sMeC7+vreRIF5wFBC0MCN5sbHwhNN1JzKbifNeP5
ozpZdQFmkCo+neBiKR6HqIA+LMTMCMMuv2khGGuPHmtDze4GmEGZtYLyF8EQpa5Y
jPuV6k2Cr/N3XxFpT3hRpt/3usU/Zb9wfKPtWpoznZ4/44c1p9rzFcZYrWkj3A+7
TNBJE0GmP2fhXhP1D/XVfIW/h0yCJGEiV9Glm/uGOa3DXHlmbAcxSyCRraG+ZBkA
7h4SeM6Y8l/7MBRpPCz6l8Y=
-----END CERTIFICATE-----`;

export function buildOfficialGazetteAgentOptions(
  options: Pick<
    OfficialGazetteTransportOptions,
    "trustedRoots" | "additionalIssuerCertificate"
  > = {},
): Agent.Options {
  const defaultAuthorities =
    typeof tls.getCACertificates === "function"
      ? tls.getCACertificates("default")
      : tls.rootCertificates;
  return {
    connect: {
      ca: [
        ...(options.trustedRoots ?? defaultAuthorities),
        options.additionalIssuerCertificate ?? GEOTRUST_TLS_RSA_CA_G1_PEM,
      ],
      rejectUnauthorized: true,
      allowPartialTrustChain: false,
    },
  };
}

/**
 * Creates a private dispatcher for the Gazette origin. Supplying `ca` replaces
 * Node's normal CA list, so the current default CAs are retained and the one
 * missing chain certificate is appended. Partial chains and unauthorized peers
 * remain rejected; normal hostname verification is untouched.
 */
export function createOfficialGazetteDispatcher(
  options: OfficialGazetteTransportOptions = {},
): Dispatcher {
  return new Agent(buildOfficialGazetteAgentOptions(options));
}

/**
 * Uses the scoped dispatcher without changing global Fetch or TLS state. Native
 * Fetch continues to provide redirect, decompression, abort, and Web Stream
 * semantics; the collector remains responsible for manual redirect validation
 * and response-size limits.
 */
export function createOfficialGazetteFetch(
  options: OfficialGazetteTransportOptions = {},
): OfficialGazetteFetch {
  const dispatcher = options.dispatcher ?? createOfficialGazetteDispatcher(options);
  const fetchImpl: DispatcherFetch =
    options.fetchImpl ??
    ((input, init) => globalThis.fetch(input, init));
  return async (input, init = {}) => {
    const value = input instanceof Request ? input.url : input;
    assertOfficialGazetteUrl(value);
    // Redirects must return to the collector so every Location target passes
    // the exact-host allowlist before another network request can start.
    return fetchImpl(input, { ...init, redirect: "manual", dispatcher });
  };
}

export const officialGazetteDispatcher = createOfficialGazetteDispatcher();
export const officialGazetteFetch = createOfficialGazetteFetch({
  dispatcher: officialGazetteDispatcher,
});
