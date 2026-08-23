# Public contract

Export `retry(operation, options?)` from `src/retry.js` and `TransientError` from `src/errors.js`. `operation(attempt)` is asynchronous and receives one-based attempt numbers.

Options are `retries` (additional attempts after the first, default 2), `baseDelay` in milliseconds (default 1), `delay(milliseconds, signal?)`, `signal`, and `isTransient(error)`. The default transient classifier recognizes `TransientError`. Before retry number `n`, wait `baseDelay * 2 ** (n - 1)`. Permanent errors return immediately. An aborted signal rejects with its reason before another delay or attempt.
