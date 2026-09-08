import assert from 'node:assert/strict';
import { betterPosterUrl, choosePoster } from '../src/fs15-posters.mjs';

assert.equal(
    betterPosterUrl('tt1234567'),
    'https://btttr.cc/poster-qa/imdb/poster-default/tt1234567.jpg?lang=fr'
);
assert.equal(betterPosterUrl('not-an-imdb-id'), null);
assert.equal(
    choosePoster({ imdbId: 'tt1234567', tmdbPoster: 'https://tmdb/poster.jpg' }),
    'https://btttr.cc/poster-qa/imdb/poster-default/tt1234567.jpg?lang=fr'
);
assert.equal(
    choosePoster({ tmdbPoster: 'https://tmdb/poster.jpg', fsPoster: 'https://fs/poster.jpg' }),
    'https://tmdb/poster.jpg'
);

console.log('FS15 poster tests passed');
