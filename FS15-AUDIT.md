# FS15 Catalog — audit and architecture

## Audit conclusions

The current FS15 pages expose enough catalogue metadata to build a standalone Stremio/Nuvio catalogue without depending on the existing French Poster addon for language tags.

Observed fields:
- title and year
- original title
- genres
- synopsis/description
- director
- cast
- version/language availability (`VF`, `VOSTFR`, `VF+VOSTFR`, `French`, `TrueFrench`)
- quality (`HD`, etc.)
- release date
- original language on some movie pages
- budget on some movie pages
- series season/episode counts
- TMDB poster URLs on series detail pages
- source page URL / internal FS identifiers

## Language normalization

`VF`, `French`, and `TrueFrench` => `DUB`
`VOSTFR` => `SUB`
Both => `DUB_SUB`
No reliable marker => `NONE`

The raw source text should also be retained so future markers can be supported without losing information.

## Architecture

FS15 -> scraper/parser -> normalized metadata -> TMDB enrichment -> BetterPoster -> Stremio catalog/meta -> Nuvio

AIOStreams is intentionally a later phase. The catalogue must remain useful and testable without any stream extraction layer.

## Dynamic behaviour

The addon should not maintain a static movie/series database. Catalog requests should fetch current FS15 pages, with short-lived caching and pagination. Search should query FS15 search endpoints/pages and enrich only the requested results.

## Poster strategy

BetterPoster should be the primary poster for every item when an IMDb id is available. The requested endpoint pattern is:

`https://btttr.cc/poster-qa/imdb/poster-default/{imdb_id}.jpg?lang=fr`

Fallback order:
1. BetterPoster
2. TMDB poster
3. FS15 poster

Poster requests should be cached independently so a slow poster service does not block the catalogue response.

## Safety / non-regression

This work lives on the `fs15-catalog-rebuild` branch. The existing `main` branch and the working French Poster setup are not modified by this prototype.
