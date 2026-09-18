import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { betterPosterUrl, getFrenchPoster } = require('../addon.js');

assert.equal(
    betterPosterUrl('tt1234567', 'DUB'),
    'https://btttr.cc/poster/imdb/poster-default/tt1234567.jpg'
);
assert.equal(betterPosterUrl('invalid', 'DUB'), null);

assert.equal(
    getFrenchPoster({
        poster_path: '/default.jpg',
        images: {
            posters: [
                { iso_639_1: 'en', file_path: '/english.jpg' },
                { iso_639_1: 'fr', file_path: '/french.jpg' }
            ]
        }
    }),
    'https://image.tmdb.org/t/p/w500/french.jpg'
);

assert.equal(
    getFrenchPoster({
        poster_path: '/default.jpg',
        images: {
            posters: [
                { iso_639_1: 'en', file_path: '/english.jpg' },
                { iso_639_1: null, file_path: '/neutral.jpg' }
            ]
        }
    }),
    'https://image.tmdb.org/t/p/w500/default.jpg'
);

assert.equal(getFrenchPoster({ images: { posters: [] } }), null);
