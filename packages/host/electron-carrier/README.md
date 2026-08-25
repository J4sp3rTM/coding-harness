# @deepseek-ai/dsh-host-electron-carrier

The `webServer` service contract carried over an Electron custom scheme instead of a listening socket.

The shipped web composition registers its routes — the `/api` gateway, the client plugin bundles, the dist fallback — against `ctx.webServer`. That contract says nothing about TCP: it is a route table plus an index-transform tap. This package provides the same service, so the desktop shell reuses every one of those rows unchanged while opening no port at all. Requests arrive from the application's own renderer through `protocol.handle` and are answered in process.

## Service contract

The carrier mirrors [`@deepseek-ai/dsh-host-webserver`](../webserver/README.md)'s surface — same method names, same duplicate-registration rules — so composition rows cannot tell the two apart. Routes are `exact` (verbatim pathname) or `prefix` (the path and anything beneath it), and a handler owns the full response lifecycle, including responses held open for SSE.

`port` and `host` report the in-process facts: there is no socket. A caller that prints a reachable URL must be configured not to.

## Composition

```yaml
- id: electron-carrier
  name: '@deepseek-ai/dsh-host-electron-carrier'
```

Mount this instead of the socket webserver; never both, because they provide the same service.

## Model Experience

None, as this package only carries an existing route table over a different transport and registers no tool, prompt section, or session event.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No HTTP upgrade** — a custom scheme has no WebSocket. Upgrade registrations are accepted and recorded so composing rows still mount, but nothing dispatches to them; the desktop client reads its event streams as SSE over the same fetch path instead.
- **Same-process origin only** — requests are served to the application's own renderer through the registered scheme, so nothing outside the Electron process can reach these routes.
