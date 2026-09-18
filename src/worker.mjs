import * as cheerio from 'cheerio';
import configureHtml from '../public/configure.html';
import { resolveCinemetaMeta } from './cinemeta.mjs';
import { fetchFrenchStreamDescription } from './french-stream-meta.mjs';
import { createBasicMetaFromFsId, decodeBase64Url, decodeStremioPathId, encodeBase64Url } from './stremio-id.mjs';
import { buildFrenchPulseMeta } from './frenchpulse-meta.mjs';

const CATALOG_CACHE_TTL = 6 * 60 * 60;
const META_CACHE_TTL = 24 * 60 * 60;
const MANIFEST_CACHE_TTL = 24 * 60 * 60;
const CACHE_VERSION = 'v13';
const SEARCH_ENRICH_LIMIT = 12;
const FRENCH_STREAM_ORIGIN = 'https://french-stream.pink';