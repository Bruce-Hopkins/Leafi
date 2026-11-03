import dns from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import net from 'node:net';
import { Agent } from 'undici';

/**
 * Destinations `web_fetch` must never reach: this machine, the local network,
 * cloud metadata addresses, and the reserved ranges that route to them. A
 * `BlockList` also matches IPv4 written in IPv6 form (`::ffff:127.0.0.1`), so
 * the mapped spelling of a blocked address is blocked too.
 */
const BLOCKED_IPV4: ReadonlyArray<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, including broadcast
];

const BLOCKED_IPV6: ReadonlyArray<[string, number]> = [
  ['::', 96], // unspecified, loopback and IPv4-compatible addresses
  ['64:ff9b::', 96], // NAT64, which embeds an IPv4 address
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard
  ['2001::', 32], // Teredo, which embeds an IPv4 address
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4, which embeds an IPv4 address
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // deprecated site-local
  ['ff00::', 8], // multicast
];

const BLOCKED = new net.BlockList();
for (const [prefix, bits] of BLOCKED_IPV4) {
  BLOCKED.addSubnet(prefix, bits, 'ipv4');
}
for (const [prefix, bits] of BLOCKED_IPV6) {
  BLOCKED.addSubnet(prefix, bits, 'ipv6');
}

export class BlockedAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedAddressError';
  }
}

/** True for an IP address `web_fetch` must refuse. Anything that is not an IP is refused too. */
export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) {
    return true;
  }
  return BLOCKED.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

/** Names that mean "this machine or this network" before any lookup happens. */
export function isLocalHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/\.$/, '');
  return (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  );
}

/**
 * Refuses a URL whose host is a local name or a blocked IP literal. A hostname
 * is checked later, when the connection resolves it: see `guardedLookup`.
 */
export function assertPublicHost(target: URL): void {
  const hostname = target.hostname.replace(/^\[|\]$/g, '');
  if (isLocalHostname(hostname)) {
    throw new BlockedAddressError(`"${hostname}" is a local address and cannot be fetched.`);
  }
  if (net.isIP(hostname) && isBlockedAddress(hostname)) {
    throw new BlockedAddressError(`"${hostname}" is a private address and cannot be fetched.`);
  }
}

export type Resolver = (hostname: string) => Promise<LookupAddress[]>;

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

interface LookupOptions {
  family?: number | string;
  all?: boolean;
}

const systemResolver: Resolver = (hostname) => dns.lookup(hostname, { all: true });

/**
 * A `net.connect` lookup that checks the very addresses the socket will use, so
 * a hostname cannot answer with a public address for the check and a local one
 * for the connection. Any blocked answer refuses the whole name, and a failed
 * or empty lookup refuses rather than letting the request through.
 */
export function guardedLookup(resolve: Resolver = systemResolver) {
  return (hostname: string, options: LookupOptions, callback: LookupCallback): void => {
    resolve(hostname)
      .then((records) => {
        if (records.length === 0) {
          throw new BlockedAddressError(`"${hostname}" did not resolve to any address.`);
        }
        const blocked = records.find((record) => isBlockedAddress(record.address));
        if (blocked) {
          throw new BlockedAddressError(
            `"${hostname}" resolves to ${blocked.address}, a private address, and cannot be fetched.`,
          );
        }
        const family = Number(options.family ?? 0);
        const usable = family === 4 || family === 6 ? records.filter((record) => record.family === family) : records;
        const [first] = usable;
        if (!first) {
          throw new BlockedAddressError(`"${hostname}" has no IPv${family} address.`);
        }
        if (options.all) {
          callback(null, usable);
        } else {
          callback(null, first.address, first.family);
        }
      })
      .catch((error: unknown) => {
        const failure =
          error instanceof BlockedAddressError
            ? error
            : new BlockedAddressError(
                `"${hostname}" could not be resolved (${error instanceof Error ? error.message : String(error)}).`,
              );
        callback(failure, '');
      });
  };
}

/** One connection pool for every `web_fetch`, with the address check at connect time. */
export const publicWebDispatcher = new Agent({ connect: { lookup: guardedLookup() } });
