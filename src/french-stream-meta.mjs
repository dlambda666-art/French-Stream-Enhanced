import * as cheerio from 'cheerio';

const FRENCH_STREAM_ORIGIN = 'https://french-stream.pink';

function cleanDescription(value) {
    return (value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeFrenchStreamUrl(href) {
    if (!href) return null;

    try {
        return new URL(href, FRENCH_STREAM_ORIGIN).toString();
    } catch (error) {
        return null;
    }
}

export function extractFrenchStreamDescription(htmlBody) {
    if (!htmlBody) return null;

    const $ = cheerio.load(htmlBody);
    const $description = $('#s-desc, .fdesc').first().clone();
    if ($description.length) {
        $description.find('.desc-text, script, style').remove();
        const description = cleanDescription($description.text());
        if (description) return description;
    }

    const metaDescription = cleanDescription($('meta[name="description"]').attr('content'));
    return metaDescription || null;
}

export async function fetchFrenchStreamDescription(href, fetchImpl = fetch) {
    const url = normalizeFrenchStreamUrl(href);
    if (!url) return null;

    try {
        const response = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!response.ok) return null;
        return extractFrenchStreamDescription(await response.text());
    } catch (error) {
        return null;
    }
}
