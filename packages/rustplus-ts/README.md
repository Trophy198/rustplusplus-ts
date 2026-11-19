# rustplus-ts

This local npm workspace is based on [alexemanuelol/rustplus-ts 0.0.10](https://github.com/alexemanuelol/rustplus-ts/tree/d8fb2aa3db48d4cfd9d1217c7d04c16ebf750316). The upstream copyright notices and GPL license are included.

Run `npm run protogen --workspace rustplus-ts` after changing `src/protos/rustplus.proto`, then `npm run build --workspace rustplus-ts`. Generated code represents protobuf uint64 fields as decimal strings. The client also accepts safe integer inputs for existing device callers.

Wire presence matters for two fields in the [November 2026 Rust+ web build](https://app.playrust.com/static/app.7dd3c04bdfaf4cb6351e.js). Read `sellOrder.receivedQuantityMultiplier ?? 1` for the effective multiplier, preserving an explicit zero. Validate decoded clan leaderboards with `isValidClanLeaderboard` to require the name tag on every entry, including entries with an empty name.

The exported `AppTeamInfo_Note_Type`, `AppTeamInfo_Note_Icon` and `AppTeamInfo_Note_ColourIndex` enums name known map UI values. Incoming notes accept the full signed int32 range. The two entity-type enums keep a zero placeholder for proto3, which their validators reject.
