# Public contract

Export `resolveConfig(...layers)` from `src/index.js`. Each layer is a plain JavaScript object. Later layers override earlier layers, nested plain objects merge recursively, arrays replace earlier arrays, and an `undefined` value does not override an earlier value.

The returned object and every nested array/object must be independent from all inputs. Validate the final `port` as an integer from 1 through 65535 and `endpoint` as a non-empty string. Invalid values must throw an error whose message names the invalid field. Other fields are unrestricted.
