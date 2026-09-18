import assert from 'node:assert/strict';
import { buildFrenchPulseMeta, normalizeFrenchPulseStatus } from '../src/frenchpulse-meta.mjs';

const meta = buildFrenchPulseMeta({
    tmdbId: 123,
    imdbId: 'tt1234567',
    title: 'Film test',
    year: '2026',
    poster: 'https://example.test/poster.jpg',
    backdrop: 'https://example.test/backdrop.jpg',
    originalTitle: 'Original Test',
    vf: true,
    vfSource: 'French Stream Enhanced',
    vfVerified: true,
    quality: 'HDLight'
});

assert.equal(meta.frenchpulse_meta_version, 1);
assert.equal(meta.tmdb_id, 123);
assert.equal(meta.imdb_id, 'tt1234567');
assert.equal(meta.title, 'Film test');
assert.equal(meta.year, '2026');
assert.equal(meta.poster, 'https://example.test/poster.jpg');
assert.equal(meta.backdrop, 'https://example.test/backdrop.jpg');
assert.equal(meta.original_title, 'Original Test');
assert.equal(meta.vf, true);
assert.equal(meta.quality, 'HDLight');

assert.equal(normalizeFrenchPulseStatus('nouveaute_vf'), 'nouveaute_vf');
assert.equal(normalizeFrenchPulseStatus('invalid'), null);
