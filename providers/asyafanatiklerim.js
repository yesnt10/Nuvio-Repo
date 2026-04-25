var cheerio = require("cheerio-without-node-native");

var BASE_URL = 'https://asyafanatiklerim.com';

var HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': BASE_URL + '/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

// URL'den kaynağın adını (ok.ru, vidmoly vb.) almak için basit yardımcı fonksiyon
function getHostName(url) {
    try {
        var hostname = new URL(url).hostname;
        return hostname.replace('www.', '');
    } catch (e) {
        return 'Oynatıcı';
    }
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    return new Promise(function(resolve, reject) {
        if (mediaType !== 'tv') return resolve([]);

        var tmdbUrl = 'https://api.themoviedb.org/3/tv/' + tmdbId + '?language=tr-TR&api_key=4ef0d7355d9ffb5151e987764708ce96';

        fetch(tmdbUrl, { headers: { 'User-Agent': HEADERS['User-Agent'] } })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                var diziIsmi = (data.name || '').trim();
                var orgName = (data.original_name || '').trim();
                
                // Sitede nokta atışı arama yapmak için: "Dizi Adı X Bölüm"
                var searchQuery = (orgName || diziIsmi) + " " + episodeNum + " bölüm";
                var searchUrl = BASE_URL + '/?s=' + encodeURIComponent(searchQuery);

                console.log('[AsyaFanatiklerim] Aranıyor: ' + searchUrl);

                // 1. Arama sonuçlarını çek
                return fetch(searchUrl, { headers: HEADERS })
                    .then(function(res) { return res.text(); })
                    .then(function(html) {
                        var $ = cheerio.load(html);
                        var episodeLink = null;

                        // WordPress sitelerindeki yaygın başlık class'ları
                        var results = $('.post-title a, .entry-title a, h2 a, .title a, .item-title a');

                        if (results.length > 0) {
                            // Arama sonucundaki ilk linki al
                            episodeLink = results.first().attr('href');
                        }

                        if (!episodeLink) {
                            throw new Error("Sitede bölüm araması sonuç vermedi.");
                        }

                        console.log('[AsyaFanatiklerim] Bölüm Linki Bulundu: ' + episodeLink);

                        // 2. Bulunan bölüm sayfasına gir ve iframe'i çek
                        return fetch(episodeLink, { headers: HEADERS })
                            .then(function(res) { return res.text(); })
                            .then(function(epHtml) {
                                var _$ = cheerio.load(epHtml);
                                var streams = [];
                                var videoSrc = null;

                                // Sayfadaki iframe'leri tara
                                _$('iframe').each(function() {
                                    var src = _$(this).attr('src');
                                    // Sık kullanılan video kaynaklarını filtrele (reklamları vb. elemek için)
                                    if (src && (src.includes('ok.ru') || src.includes('vidmoly') || src.includes('mail.ru') || src.includes('fembed') || src.includes('vk.com'))) {
                                        videoSrc = src;
                                        return false; // Döngüyü kır, ilk bulduğunu al
                                    }
                                });

                                // Eğer özel bir kaynak bulamadıysa, sayfadaki ilk iframe'i al
                                if (!videoSrc && _$('iframe').length > 0) {
                                    videoSrc = _$('iframe').first().attr('src');
                                }

                                if (videoSrc) {
                                    // Protokolsüz (//ok.ru/..) linkleri https ile tamamla
                                    if (videoSrc.startsWith('//')) {
                                        videoSrc = 'https:' + videoSrc;
                                    }

                                    streams.push({
                                        name: diziIsmi,
                                        title: '⌜ AsyaFanatiklerim ⌟ | ' + getHostName(videoSrc),
                                        url: videoSrc, // DİKKAT: Stremio iframe oynatamaz, bu linkin çözülmesi (resolve) gerekebilir.
                                        quality: '1080p',
                                        headers: { 'Referer': episodeLink }
                                    });
                                }

                                resolve(streams);
                            });
                    });
            })
            .catch(function(err) {
                console.error('[AsyaFanatiklerim Hata]: ' + err.message);
                resolve([]);
            });
    });
}

module.exports = { getStreams };
