# gRPC peers and etcd discovery

Paths are relative to `packages/cache/`.

## Wiring and ownership

`src/client-picker.ts` implements `PeerPicker`. Its `start()` adds self to the
ring, fetches registered addresses, adds valid remote peers, and starts the
etcd watcher. It can be assigned to a group before startup; await startup
before relying on discovered peers for traffic. `pickPeer(key)` returns
`[peerOrNull, found, isSelf]`.

Use the same exact advertised address string for `ServerOptions.advertiseAddr`
and the `ClientPicker` constructor, and the same service name for server and
picker. `register()` normalizes `:port` and `0.0.0.0:port` to a local IPv4
address, falling back to `127.0.0.1`. A picker compares self by string equality.

The address filter in `src/utils.ts` accepts `localhost`, dotted hostnames,
and bracketed strings matching its IPv6-shaped pattern, with ports 1–65535.
Other single-label hosts are rejected. It is a syntactic filter, not a DNS or
reachability check.

## Reads, writes, and metadata

`src/proto/yukino.proto` defines `pb.YukinoCache` with `Get`, `Set`, and
`Delete`. Requests carry `group`, `key`, and `value`; response fields are
respectively `value` bytes, `success` boolean, and `value` boolean. The
server's Delete handler returns true after `Group.delete()` completes,
regardless of whether the key was present.

`Client` (`src/client.ts`) uses insecure credentials and a 3000 ms default
per-call deadline. Configure `deadlineMs` directly or `peerDeadlineMs` through
`ClientPicker`. There is no caller AbortSignal parameter on peer methods.

Picker-created clients set `peerRequest: true`, adding
`x-peer-request: "true"` metadata. Server Set/Delete handlers translate it
into the group's `isPeerRequest` flag, which suppresses another owner write.
Retain this guard when changing peer mutation paths.

Group writes update the local cache and start one remote-owner write when
applicable. They resolve without waiting for that remote write; remote errors
are logged. No broadcast, replica repair, or persistent backing store is
implemented. A peer read failure is logged and the local Getter is tried.

The gRPC server finds groups through the registry. An absent group returns
`NOT_FOUND`; group errors return `INTERNAL`. Call cancellation aborts the
signal passed to Group methods. The health service implements
`grpc.health.v1.Health/Check`, returning `SERVING` for its configured service
name and `UNKNOWN` for other names.

## Server lifecycle (`src/server.ts`)

`await server.start()` waits for gRPC binding. It starts etcd registration
without awaiting completion; registration errors are logged and do not stop
the bound server. It is not a discovery-readiness barrier.

Server defaults are etcd endpoints `["localhost:2379"]`, `maxMsgSize: 4 << 20`
(receive limit), and `tls: false`. SSL server credentials are used only when
`tls`, `certFile`, and `keyFile` are all provided; the other cases use insecure
credentials. The supplied Client always uses insecure credentials.

`server.stop()` aborts registration and calls `tryShutdown`; it returns void
without waiting for either cleanup to complete. Close the picker separately
with `await picker.close()`, and close groups to stop their cache timers.

## Registration and discovery (`src/register.ts`)

Registry keys are `/services/{svcName}/{addr}`, with the address also stored
as the value. `defaultRegisterConfig` declares endpoints
`["localhost:2379"]`, `dialTimeout: 5000`, and `leaseTTL: 10`. The implementation
passes endpoints to `Etcd3` and TTL to `lease`; it does not apply `dialTimeout`
to the client.

`register()` acquires a lease and stores the address. A lease `lost` event
schedules reacquisition after one second. A failed reacquisition is logged;
there is no separate retry loop for that failure. An abort event revokes the
lease, deletes the key, and closes the client. The function listens for future
abort events without checking an already-aborted signal.

`ServiceDiscovery.fetchAll()` and `watch()` use the prefix
`/services/${svcName}` without a trailing slash. Put events use the value or
key suffix; delete events recover the address from the key suffix. On watcher
reconnection a fetch replays discovered addresses through `onPut`; it does
not remove previously known addresses absent from that snapshot.

`ClientPicker.close()` closes its ring timer, clients, and discovery watcher.
`Group.close()` does not cascade to those resources. Logs can be redirected
through `setLogger({ info, warn, error })` from `src/logger.ts`.
