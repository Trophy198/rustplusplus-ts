# rustplus-ts

This local npm workspace is based on [alexemanuelol/rustplus-ts 0.0.10](https://github.com/alexemanuelol/rustplus-ts/tree/d8fb2aa3db48d4cfd9d1217c7d04c16ebf750316). The upstream copyright notices and GPL license are included.

Run `npm run protogen --workspace rustplus-ts` after changing `src/protos/rustplus.proto`, then `npm run build --workspace rustplus-ts`. Generated code represents protobuf uint64 fields as decimal strings. The client also accepts safe integer inputs for existing device callers.
