# FS15 Catalog rebuild

This branch is an isolated rebuild path for turning the existing French Stream addon into a dynamic FS15 catalogue addon.

## Goals

- Keep the current `main` addon untouched.
- Use FS15 as the catalogue source, with the origin configurable through `FS15_BASE_URL`.
- Keep the catalogue dynamic: fetch current FS15 pages on demand with bounded caching and pagination.
- Preserve source language/quality labels such as VF, TrueFrench, French, VOSTFR and combined labels as structured metadata.
- Resolve titles to TMDB/IMDb IDs where possible so Nuvio/Stremio receives normal `tt...` IDs.
- Return rich movie and series metadata without making stream extraction part of this first phase.
- Keep BetterPoster available as the poster layer, with a configurable fallback policy rather than changing French Poster.
- Leave AIOStreams integration for a separate second phase.

## Proposed resources

- `catalog/movie/*`
- `catalog/series/*`
- `meta/movie/*`
- `meta/series/*`

The manifest should expose search/pagination/filter extras only after the FS15 parser has been validated against real pages.

## Language model

Normalize source labels into:

- `DUB` for VF / French / TrueFrench / HDTrueFrench / HDFrench
- `SUB` for VOSTFR
- `DUB_SUB` when both are present
- `NONE` when the source gives no reliable language marker

Keep the original source label in a separate metadata field so no information is lost.

## Safety / compatibility rule

No change is made to `main` from this branch. Do not merge until a real FS15 page fixture has been captured and the parser tests pass for both movies and series.

## Next implementation steps

1. Capture representative FS15 HTML fixtures for: movie, series, VF, VOSTFR, combined language, and pagination.
2. Implement `src/fs15.mjs` parser with deterministic selectors and normalization helpers.
3. Add unit tests for title/year/poster/language/episode extraction.
4. Wire the parser into catalog handlers.
5. Validate returned objects against the Stremio addon protocol.
6. Test in Nuvio with the branch deployed to a separate Space.
7. Only then consider making this the replacement catalogue.
