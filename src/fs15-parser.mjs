import * as cheerio from 'cheerio';

export const FS15_ORIGIN = 'https://fs15.lol';

function clean(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
}

function absoluteUrl(href, origin = FS15_ORIGIN) {
    if (!href) return null;
    try { return new URL(href, origin).toString(); } catch { return null; }
}

function languageFromText(value) {
    const text = clean(value).toUpperCase();
    const dub = /\bVF\b|\bFRENCH\b|\bTRUEFRENCH\b/.test(text);
    const sub = /\bVOSTFR\b/.test(text);
    if (dub && sub) return 'DUB_SUB';
    if (dub) return 'DUB';
    if (sub) return 'SUB';
    return 'NONE';
}

function qualityFromText(value) {
    const text = clean(value).toUpperCase();
    if (/\b4K\b|\b2160P\b/.test(text)) return '4K';
    if (/\b1080P\b|\bFULLHD\b|\bFHD\b/.test(text)) return '1080p';
    if (/\b720P\b|\bHD\b/.test(text)) return 'HD';
    if (/\bSD\b/.test(text)) return 'SD';
    return null;
}

function extractYear(value) {
    const match = clean(value).match(/\b(19\d{2}|20\d{2})\b/);
    return match ? match[1] : null;
}

function extractSeasonNumber(title) {
    const match = clean(title).match(/(?:Saison|Season|S)\s*(\d+)/i);
    return match ? Number(match[1]) : null;
}

function normalizeTitle(title) {
    return clean(title)
        .replace(/\s*[–-]\s*(?:Saison|Season)\s*\d+\s*$/i, '')
        .replace(/\s*\(?\d{4}\)?\s*$/i, '')
        .trim();
}

function pickListingNodes($) {
    const selectors = [
        '.short-in', '.movie-item', '.short', 'article.short', '.th-item',
        '.film-item', '.cat-item', '.item', '.movie-box'
    ];
    const seen = new Set();
    const nodes = [];
    for (const selector of selectors) {
        $(selector).each((_, el) => {
            if (seen.has(el)) return;
            const href = $(el).find('a[href]').first().attr('href');
            if (!href) return;
            seen.add(el);
            nodes.push(el);
        });
    }
    return nodes;
}

export function parseFs15Listing(html, type = 'movie', origin = FS15_ORIGIN) {
    if (!html) return [];
    const $ = cheerio.load(html);
    const items = [];

    for (const el of pickListingNodes($)) {
        const node = $(el);
        const link = node.find('a[href]').first();
        const href = absoluteUrl(link.attr('href'), origin);
        const title = clean(
            node.find('.short-title, .th-title, h2, h3, h4, .title').first().text()
            || link.attr('title')
            || link.text()
        );
        if (!href || !title) continue;

        const image = node.find('img').first();
        const poster = absoluteUrl(image.attr('data-src') || image.attr('data-lazy-src') || image.attr('src'), origin);
        const text = clean(node.text());
        const languageTag = languageFromText(text);

        items.push({
            id: href,
            type,
            name: normalizeTitle(title),
            sourceTitle: title,
            href,
            poster,
            languageTag,
            quality: qualityFromText(text),
            year: extractYear(title),
            sourceText: text
        });
    }

    const unique = new Map();
    for (const item of items) unique.set(item.href, item);
    return [...unique.values()];
}

function labelledValue(text, labels) {
    const source = clean(text);
    for (const label of labels) {
        const pattern = new RegExp(`${label}\\s*:?\\s*([^\\n]+?)(?=\\s+(?:Titre Original|Genre|Genres|Réalisateur|Acteurs|Avec|Version|Qualité|Date de sortie|Budget du Film|Langue d'origine|Image)\\s*:|$)`, 'i');
        const match = source.match(pattern);
        if (match) return clean(match[1]);
    }
    return null;
}

export function parseFs15Meta(html, type = 'movie', origin = FS15_ORIGIN) {
    if (!html) return null;
    const $ = cheerio.load(html);
    const bodyText = clean($('body').text());
    const h1 = clean($('h1').first().text());
    const title = h1 || clean($('title').first().text()).replace(/\s*[-|].*$/, '');
    if (!title) return null;

    const poster = absoluteUrl(
        $('meta[property="og:image"]').attr('content')
        || $('meta[name="twitter:image"]').attr('content')
        || $('img').filter((_, el) => /Image/i.test($(el).attr('alt') || '')).first().attr('src'),
        origin
    );

    const originalTitle = labelledValue(bodyText, ['Titre Original']);
    const genres = labelledValue(bodyText, ['Genre', 'Genres']);
    const director = labelledValue(bodyText, ['Réalisateur']);
    const cast = labelledValue(bodyText, ['Acteurs', 'Avec']);
    const version = labelledValue(bodyText, ['Version']);
    const quality = labelledValue(bodyText, ['Qualité']);
    const releaseDate = labelledValue(bodyText, ['Date de sortie']);
    const originalLanguage = labelledValue(bodyText, ["Langue d'origine"]);
    const budget = labelledValue(bodyText, ['Budget du Film']);
    const languageTag = languageFromText(version || bodyText);

    const season = extractSeasonNumber(title);
    const episodeMatch = bodyText.match(/Ep\s*(\d+)\s*sur\s*(\d+)/i);

    const description = clean(
        $('.fdesc, #s-desc, .description, .full-text').first().text()
        || $('meta[name="description"]').attr('content')
    );

    const originalYear = extractYear(title) || extractYear(releaseDate) || null;

    return {
        type,
        name: normalizeTitle(title),
        sourceTitle: title,
        poster,
        description: description || null,
        originalTitle,
        genres: genres ? genres.split(/\s*,\s*/).map(clean).filter(Boolean) : [],
        director,
        cast: cast ? cast.split(/\s*,\s*/).map(clean).filter(Boolean) : [],
        languageTag,
        version,
        quality,
        year: originalYear,
        releaseDate,
        originalLanguage,
        budget,
        season,
        episodesAvailable: episodeMatch ? Number(episodeMatch[1]) : null,
        episodesTotal: episodeMatch ? Number(episodeMatch[2]) : null,
        sourceUrl: null
    };
}

export { clean, languageFromText, qualityFromText, normalizeTitle };
