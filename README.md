# Conduit

English | [中文](README.zh.md)

Conduit is an open-source agent harness for coding agents. It is a fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

Everything in Conduit is a plugin. The plugin system is [Cordis](https://github.com/cordiverse/cordis).

## Why Conduit

- **Lower cost.** Conduit builds each request by appending to the last request. The request prefix stays stable, so the provider cache serves most input tokens. Measured on our own traffic: 95.6% of tokens came from the cache.
- **Better results.** On our benchmark suite, Conduit completed 79.5% of tasks. The Codex harness completed 59.0%. A blind reviewer also scored Conduit's results higher: 85.7 against 74.8 of 100.
- **Faster runs.** The median task took 5.0 minutes on Conduit, against 8.9 minutes on the Codex harness.

See [BENCHMARKS.md](BENCHMARKS.md) for details.

## Status

Conduit is in early development. Releases can break compatibility.

## Run from source

Install Node.js 22.19 or later (or Node.js 24 or later) and pnpm.

```sh
git clone https://github.com/J4sp3rTM/coding-harness.git conduit
cd conduit
pnpm install
pnpm run build
pnpm dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080`. See the [Web UI guide](docs/user/guide/index.md).

## Documentation

- Architecture: [docs/architecture.md](docs/architecture.md)
- Development guide: [docs/development.md](docs/development.md)
- Instructions for coding agents: [AGENTS.md](AGENTS.md)

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
