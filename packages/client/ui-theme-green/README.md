# @deepseek-ai/dsh-client-ui-theme-green

English | [中文](README.zh.md)

Green accent plugin over ThemeRuntime's override layer. The Host settings namespace `ui-theme-green.accent` stores `default` or `green`. Selecting `green` stacks logo-green alias tokens (`#35e888` as `--dsw-static-green-300`) over the built-in light/dark palettes; selecting `default` retracts that layer. The General settings row owns the write. The override is a plugin-fiber effect, so dispose and HMR remove it. Feature CSS that still reads `--dsw-static-deepseek-*` directly stays blue.

## Model Experience

None, as the plugin only stacks browser theme tokens.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Alias overrides only** — conversation shimmer and StateDot still bind `--dsw-static-deepseek-*` directly, so those surfaces stay blue until they consume alias tokens.