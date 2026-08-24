# Branding

Drop-in product identity for the web client and the desktop installers.

## Sources of truth

| File        | Meaning                                              |
| ----------- | ---------------------------------------------------- |
| `name.json` | `{ "name", "shortName" }` — product display name      |
| `logo.svg`  | The master logo; any SVG with a square `viewBox`      |

## Apply branding

```sh
pnpm run branding
```

The generator rewrites every derived artifact (all committed, so plain builds
never need this step):

- `apps/web/public/favicon.svg`, `branding.json`, `manifest.webmanifest`, `icons/icon-{192,512}.png`
- `apps/web/index.html` `<title>` line
- `apps/desktop/build/icon.png` — electron-builder derives `.icns`/`.ico`/platform PNGs from it
- `apps/desktop/electron-builder.yml` `productName:` line

With the default inputs the run is idempotent and produces zero diffs. The
browser tab suffix (` — <name>`) follows automatically: the client shell
composes session titles over the static `<title>`.
