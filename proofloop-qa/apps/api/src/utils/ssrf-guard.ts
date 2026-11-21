import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { LookupFunction } from 'node:net';

/**
 * SSRF protection for the API execution engine (ISSUE-LOG API-06).
 *
 * Three layers, all required:
 *  1. assertSafeUrl()   – before the call: http(s) only, every DNS answer checked.
 *  2. safeAgents        – at CONNECT time: the agents' DNS lookup rejects blocked addresses,
 *                         so the IP that was checked is the IP that is used (defeats DNS
 *                         rebinding) and every redirect hop to a hostname is checked too.
 *  3. checkRedirect()   – redirects to literal IPs (no DNS lookup happens) and non-http(s).
 */

export class SsrfBlockedError extends Error {
  readonly code = 'ESSRF_BLOCKED';
  constructor(message: string) {
    super(`SSRF Blocked: ${message}`);
    this.name = 'SsrfBlockedError';
  }
}

export class InvalidEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEndpointError';
  }
}

// Non-public ranges (IANA special-purpose registries). Everything here is unreachable from the
// public internet or points at this host / its network / cloud metadata.
const blocked = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local incl. 169.254.169.254 cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + 255.255.255.255 broadcast
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // NAT64 (embeds IPv4)
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local (fc00::/8 + fd00::/8)
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

/** ::ffff:127.0.0.1 and ::ffff:7f00:1 -> 127.0.0.1; anything else unchanged. */
function unmapIPv4(ip: string): string {
  const lower = ip.toLowerCase();
  if (!lower.startsWith('::ffff:')) return ip;
  const rest = lower.slice('::ffff:'.length);
  if (net.isIPv4(rest)) return rest;
  const hex = rest.split(':');
  if (hex.length === 2 && hex.every((h) => /^[0-9a-f]{1,4}$/.test(h))) {
    const [hi, lo] = hex.map((h) => parseInt(h, 16));
    return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
  }
  return ip;
}

export function isBlockedAddress(address: string): boolean {
  const ip = unmapIPv4(address);
  if (net.isIPv4(ip)) return blocked.check(ip, 'ipv4');
  if (net.isIPv6(ip)) return blocked.check(ip, 'ipv6');
  return true; // not an IP at all: never connect to it
}

/**
 * TEST-ONLY escape hatch: exact "host:port" targets that bypass the denylist, e.g.
 * SSRF_ALLOWED_TARGETS=127.0.0.1:4999 for the local Playwright target server.
 * Must never be set in production.
 */
const allowedTargets = new Set(
  (process.env.SSRF_ALLOWED_TARGETS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);
if (allowedTargets.size > 0 && process.env.NODE_ENV !== 'test') {
  console.error('[ssrf-guard] SSRF_ALLOWED_TARGETS is only permitted when NODE_ENV === "test"');
  allowedTargets.clear();
}

const defaultPort = (protocol: string) => (protocol === 'https:' ? '443' : '80');

function isAllowedTarget(hostname: string, port: string, protocol: string): boolean {
  if (allowedTargets.size === 0) return false;
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return allowedTargets.has(`${host}:${port || defaultPort(protocol)}`);
}

/** Layer 1: parse + protocol check + resolve ALL addresses. Returns the parsed URL. */
export async function assertSafeUrl(target: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new InvalidEndpointError('Endpoint must be an absolute http(s) URL (after variable substitution)');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InvalidEndpointError('Endpoint must use http or https');
  }

  if (isAllowedTarget(url.hostname, url.port, url.protocol)) return url;

  const host = url.hostname.replace(/^\[|\]$/g, ''); // IPv6 literals come bracketed
  const addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
  const bad = addresses.find((a) => isBlockedAddress(a.address));
  if (bad) throw new SsrfBlockedError(`endpoint resolves to a non-public address (${bad.address})`);
  return url;
}

/**
 * Same check as assertSafeUrl for non-HTTP targets (e.g. a Database Sentinel postgres host):
 * resolves ALL addresses and rejects any non-public one. SSRF_ALLOWED_TARGETS (host:port) applies.
 */
export async function assertSafeHost(hostname: string, port: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (allowedTargets.has(`${host}:${port}`)) return;
  const addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
  const bad = addresses.find((a) => isBlockedAddress(a.address));
  if (bad) throw new SsrfBlockedError(`host resolves to a non-public address (${bad.address})`);
}

/** Layer 2: DNS lookup used by the sockets themselves. */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, '', 4);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => isBlockedAddress(a.address));
    if (bad) {
      return callback(new SsrfBlockedError(`${hostname} resolves to a non-public address (${bad.address})`), '', 4);
    }
    if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    return callback(null, list[0].address, list[0].family);
  });
};

/** Agents whose connections go through safeLookup. keepAlive off: no socket reuse across checks. */
export const safeAgents = {
  httpAgent: new http.Agent({ lookup: safeLookup }),
  httpsAgent: new https.Agent({ lookup: safeLookup }),
};

/** Layer 3: called by axios before following each redirect. Throwing aborts the request. */
export function checkRedirect(options: { protocol?: string; hostname?: string; host?: string; port?: string | number }): void {
  const protocol = options.protocol ?? '';
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new SsrfBlockedError(`redirect to unsupported protocol (${protocol})`);
  }
  const hostname = (options.hostname ?? options.host ?? '').replace(/^\[|\]$/g, '');
  const port = options.port === undefined ? '' : String(options.port);
  if (isAllowedTarget(hostname, port, protocol)) return;
  // Hostnames are checked at connect time by safeLookup; literal IPs skip DNS, so check here.
  if (net.isIP(hostname) && isBlockedAddress(hostname)) {
    throw new SsrfBlockedError(`redirect to a non-public address (${hostname})`);
  }
}

/** True if an error (possibly wrapped by axios) was raised by this guard. */
export function isSsrfError(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; e && depth < 5; depth++) {
    if (e instanceof SsrfBlockedError) return true;
    if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'ESSRF_BLOCKED') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return typeof (error as { message?: unknown })?.message === 'string' && (error as Error).message.startsWith('SSRF Blocked:');
}
