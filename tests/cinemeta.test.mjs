import assert from 'node:assert/strict';
import { chooseBestCinemetaMatch, resolveCinemetaMeta } from '../src/cinemeta.mjs';

const skinMatch = chooseBestCinemetaMatch('Skin', 'movie', [
    { id: 'tt6043142', name: 'Skin', year: '2018', type: 'movie' },
    { id: 'tt1441395', name: 'Under the Skin', year: '2013', type: 'movie' }
]);

assert.equal(skinMatch.id, 'tt6043142');

const wrongTypeMatch = chooseBestCinemetaMatch('Skin', 'series', [
    { id: 'tt6043142', name: 'Skin', year: '2018', type: 'movie' }
]);

assert.equal(wrongTypeMatch, null);

const fetchedUrls = [];
const resolvedMeta = await resolveCinemetaMeta('Chantage', 'movie', async url => {
    fetchedUrls.push(url);

    if (url.includes('/catalog/movie/top/search=Chantage.json')) {
        return {
            ok: true,
            async json() {
                return {
                    metas: [
                        { id: 'tt11859510', name: 'Chantage', type: 'movie' }
                    ]
                };
            }
        };
    }

    if (url.includes('/meta/movie/tt11859510.json')) {
        return {
            ok: true,
            async json() {
                return {
                    meta: {
                        id: 'tt11859510',
                        name: 'Chantage',
                        type: 'movie',
                        year: '2021',
                        description: 'Full summary'
                    }
                };
            }
        };
    }

    throw new Error(`Unexpected URL: ${url}`);
});

assert.equal(resolvedMeta.id, 'tt11859510');
assert.equal(resolvedMeta.description, 'Full summary');
assert.equal(fetchedUrls.length, 2);
