// ============================================================================
// AFFICHE + BADGE VF / VOSTFR EN VRAIE IMAGE (JPG)
// ----------------------------------------------------------------------------
// Les affiches SVG ne s'affichaient pas dans Nuvio : on colle donc le badge
// directement dans l'image avec sharp. Les badges sont des PNG pre-dessines
// (assets/), pour ne dependre d'aucune police installee sur le serveur.
// ============================================================================

const path = require('path');
const sharp = require('sharp');

const BADGE_FILES = {
    VF: path.join(__dirname, 'assets', 'badge-vf.png'),
    VOSTFR: path.join(__dirname, 'assets', 'badge-vostfr.png')
};

const BADGES = {
    DUB: ['VF'],
    SUB: ['VOSTFR'],
    DUB_SUB: ['VF', 'VOSTFR']
};

// Renvoie un JPG : l'affiche avec ses badges a gauche, sous le bandeau du haut.
async function addLanguageBadges(posterBuffer, tag) {
    const labels = BADGES[tag];
    if (!labels) return posterBuffer;

    const image = sharp(posterBuffer);
    const { width, height } = await image.metadata();
    const badgeHeight = Math.max(18, Math.round(height * 0.065));
    const margin = Math.round(width * 0.035);
    // Juste sous le bandeau du haut des affiches BetterPoster.
    const top = Math.round(height * 0.105);

    const overlays = [];
    let left = margin;
    for (const label of labels) {
        const { data, info } = await sharp(BADGE_FILES[label])
            .resize({ height: badgeHeight })
            .png()
            .toBuffer({ resolveWithObject: true });
        overlays.push({ input: data, left, top });
        left += info.width + Math.round(margin / 2);
    }

    return image.composite(overlays).jpeg({ quality: 88 }).toBuffer();
}

module.exports = { addLanguageBadges };
