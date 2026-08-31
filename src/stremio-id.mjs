export function decodeStremioPathId(id) {
    if (!id) return id;

    try {
        return decodeURIComponent(id);
    } catch (error) {
        return id;
    }
}

export function encodeBase64Url(value) {
    const bytes = new TextEncoder().encode(value || '');
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeBase64Url(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

export function createBasicMetaFromFsId(type, id) {
    if (!id?.startsWith('fs:')) return null;

    try {
        const title = decodeBase64Url(id.slice(3));
        if (!title) return null;

        return {
            id,
            type,
            name: title,
            posterShape: 'poster',
            behaviorHints: type === 'movie' ? { defaultVideoId: id, hasScheduledVideos: false } : undefined
        };
    } catch (error) {
        return null;
    }
}
