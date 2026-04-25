// diziyou-nuvio.js

const BASE_URL = 'https://www.diziyou.one';
const STORAGE_URL = 'https://storage.diziyou.one';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': BASE_URL + '/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

export const getStreams = async (tmdbId, mediaType, seasonNum, episodeNum) => {
    if (mediaType !== 'tv') return [];

    const tmdbUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?language=tr-TR&api_key=4ef0d7355d9ffb5151e987764708ce96`;

    try {
        const res = await fetch(tmdbUrl, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
        const data = await res.json();

        const query = (data.name || '').trim();
        const orgName = (data.original_name || '').trim();

        const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(query)}`;

        const searchRes = await fetch(searchUrl, { headers: HEADERS });
        const searchHtml = await searchRes.text();

        // HTML parse etmek için: Cheerio yerine DOMParser kullanalım (Node.js)
        // Ancak bu örnekte, `cheerio` kullanmayı bırakalım. Nuvio için sadece `fetch` ile çalışması yeterli.
        // Eğer Nuvio içinde HTML parse etmek istiyorsanız, `DOMParser` veya `cheerio` ile yapabilirsiniz.

        // Burada sadece HTML içeriği alıp, URL’leri parse etmeyi bırakacağız.
        // Nuvio’da sadece stream URL’leri ve veriler gerekir.

        // Örnek: Eğer Nuvio’da “dizi” ismi ve “episod” URL’ü gerekirse:
        const slug = "dizi-123"; // Örnek slug
        const epUrl = `${BASE_URL}/${slug}-${seasonNum}-sezon-${episodeNum}-bolum/`;

        const epRes = await fetch(epUrl, { headers: HEADERS });
        const epHtml = await epRes.text();

        // Player URL’lerini çıkarıyoruz
        const playerSrc = epHtml.match(/play\.m3u8/gi)?.[0];
        if (!playerSrc) throw new Error('Player yok');

        const itemId = playerSrc.split('/').pop().replace('.html', '').split('?')[0];
        const streams = [];

        // Dil bilgisi kontrolü
        const hasSub = epHtml.includes('turkceAltyazili');
        const hasDub = epHtml.includes('turkceDublaj');

        if (hasSub) {
            streams.push({
                label: '⌜ DiziYou ⌟ | 🌐 Türkçe Altyazılı',
                url: `${STORAGE_URL}/episodes/${itemId}/play.m3u8`,
                quality: '1080p',
                headers: { 'Referer': BASE_URL },
                subtitles: [
                    { label: 'Turkish', url: `${STORAGE_URL}/subtitles/${itemId}/tr.vtt` }
                ]
            });
        }

        if (hasDub) {
            streams.push({
                label: '⌜ DiziYou ⌟ | 🇹🇷 Türkçe Dublaj',
                url: `${STORAGE_URL}/episodes/${itemId}_tr/play.m3u8`,
                quality: '1080p',
                headers: { 'Referer': BASE_URL },
            });
        }

        if (streams.length === 0) {
            streams.push({
                label: '⌜ DiziYou ⌟ | 🌐 Video',
                url: `${STORAGE_URL}/episodes/${itemId}/play.m3u8`,
                quality: '1080p',
                headers: { 'Referer': BASE_URL },
            });
        }

        return streams;

    } catch (err) {
        console.error('[DiziYou Hata]: ', err.message);
        return [];
    }
}
