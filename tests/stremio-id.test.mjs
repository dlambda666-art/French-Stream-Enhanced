import assert from 'node:assert/strict';
import { createBasicMetaFromFsId, decodeStremioPathId, encodeBase64Url } from '../src/stremio-id.mjs';

const fsId = `fs:${encodeBase64Url('Nuremberg')}`;

assert.equal(decodeStremioPathId(encodeURIComponent(fsId)), fsId);

assert.deepEqual(createBasicMetaFromFsId('movie', fsId), {
    id: fsId,
    type: 'movie',
    name: 'Nuremberg',
    posterShape: 'poster',
    behaviorHints: { defaultVideoId: fsId, hasScheduledVideos: false }
});

assert.equal(createBasicMetaFromFsId('movie', 'tt29567915'), null);
