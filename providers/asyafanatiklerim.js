var cheerio = require("cheerio-without-node-native");

var BASE_URL = 'https://asyafanatiklerim.com';

var HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': BASE_URL + '/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

// İsimden site slug'ı üret: "Perfect Crown" → "perfect-crown"
function toSlug(str) {
    return str
        .toLowerCase()
        .replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u')
        .replace(/ö/g, 'o').replace(/ı/g, 'i').replace(/ç/g, 'c')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

// Dizi sayfasından bölüm linklerini tara, hedef bölümü bul
function findEpisodeLink($, seasonNum, episodeNum) {
    var targetEpLink = null;

    // Bölüm linkleri: href="/bolum/..." olan tüm <a> etiketleri
    // Sayfada "1 - 3" veya "1x3" formatında numaralanmış listeler var
    $('a[href*="/bolum/"]').each(function() {
        var el = $(this);
        var href = el.attr('href') || '';

        // li veya parent kapsayıcısının tüm metnine bak
        var container = el.closest('li');
        var containerText = container.length ? container.text() : el.text();

        // "1 - 3" veya "1x3" veya "S1E3" formatlarını yakala
        var sn = parseInt(seasonNum, 10);
        var en = parseInt(episodeNum, 10);

        // Sezon-Bölüm formatları
        var patterns = [
            new RegExp('\\b' + sn + '\\s*-\\s*' + en + '\\b'),   // "1 - 3"
            new RegExp('\\b' + sn + '[xX]' + en + '\\b'),          // "1x3"
            new RegExp('\\bS' + sn + 'E' + en + '\\b', 'i'),       // "S1E3"
        ];

        for (var p = 0; p < patterns.length; p++) {
            if (patterns[p].test(containerText)) {
                targetEpLink = href;
                return false; // .each'i durdur
            }
        }
    });

    return targetEpLink;
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    return new Promise(function(resolve) {
        if (mediaType !== 'tv') return resolve([]);

        // TMDB'den dizi adını al
        var tmdbUrl = 'https://api.themoviedb.org/3/tv/' + tmdbId +
            '?language=tr-TR&api_key=4ef0d7355d9ffb5151e987764708ce96';

        fetch(tmdbUrl, { headers: { 'User-Agent': HEADERS['User-Agent'] } })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                var name    = (data.name          || '').trim();
                var orgName = (data.original_name || '').trim();

                console.error('[AsyaFanatiklerim] Dizi: ' + name + ' | Org: ' + orgName);

                // Slug adayları: önce TR ismi, sonra orijinal
                var slugCandidates = [];
                if (name)    slugCandidates.push(toSlug(name));
                if (orgName) slugCandidates.push(toSlug(orgName));
                // Tekrarları kaldır
                slugCandidates = slugCandidates.filter(function(v, i, a) { return a.indexOf(v) === i; });

                // Her slug adayı için /dizi/{slug}/ sayfasını dene
                return tryDiziSlugs(slugCandidates, 0, name);
            })
            .then(function(result) {
                if (!result) {
                    console.error('[AsyaFanatiklerim] Dizi sayfası bulunamadı.');
                    return resolve([]);
                }

                var $ = cheerio.load(result.html);
                var diziSlug = result.slug;
                var diziIsmi = result.name;

                // Dizi sayfasından hedef bölüm linkini bul
                var epLink = findEpisodeLink($, seasonNum, episodeNum);

                // Bulunamadıysa URL tahmini yap
                if (!epLink) {
                    epLink = BASE_URL + '/bolum/' + diziSlug + '-' + episodeNum + '-bolum-izle/';
                    console.error('[AsyaFanatiklerim] Bölüm link bulunamadı, tahmin: ' + epLink);
                } else {
                    console.error('[AsyaFanatiklerim] Bölüm linki: ' + epLink);
                }

                // Bölüm sayfasını çek
                return fetch(epLink, { headers: HEADERS })
                    .then(function(res) { return res.text(); })
                    .then(function(html) {
                        return { html: html, diziIsmi: diziIsmi, epLink: epLink };
                    });
            })
            .then(function(obj) {
                if (!obj) return resolve([]);

                var $ = cheerio.load(obj.html);
                var streams = [];
                var diziIsmi = obj.diziIsmi;
                var pageText = obj.html;

                // 1) iframe src / data-src
                $('iframe').each(function() {
                    var src = $(this).attr('src') || $(this).attr('data-src') || '';
                    src = src.trim();
                    if (src && src.startsWith('http') && streams.indexOf(src) === -1) {
                        streams.push(src);
                    }
                });

                // 2) <source> etiketleri
                $('source').each(function() {
                    var src = $(this).attr('src') || '';
                    src = src.trim();
                    if (src && src.startsWith('http') && streams.indexOf(src) === -1) {
                        streams.push(src);
                    }
                });

                // 3) data-src / data-url olan tüm elementler
                $('[data-src],[data-url],[data-embed]').each(function() {
                    var src = $(this).attr('data-src') || $(this).attr('data-url') || $(this).attr('data-embed') || '';
                    src = src.trim();
                    if (src && src.startsWith('http') && streams.indexOf(src) === -1) {
                        streams.push(src);
                    }
                });

                // 4) Regex fallback: sayfa HTML'inde gömülü embed/player URL'leri
                if (streams.length === 0) {
                    var patterns = [
                        /(?:src|url)\s*[:=]\s*["']?(https?:\/\/[^"'\s,]+\.m3u8[^"'\s,]*)/gi,
                        /(?:src|url)\s*[:=]\s*["']?(https?:\/\/[^"'\s,]*(?:embed|player|stream|video)[^"'\s,]*)/gi,
                        /["'](https?:\/\/[^"']*\.m3u8[^"']*)['"]/gi
                    ];
                    for (var pi = 0; pi < patterns.length; pi++) {
                        var m;
                        while ((m = patterns[pi].exec(pageText)) !== null) {
                            var url = m[1];
                            if (streams.indexOf(url) === -1) streams.push(url);
                        }
                        if (streams.length > 0) break;
                    }
                }

                if (streams.length === 0) {
                    console.error('[AsyaFanatiklerim] Stream bulunamadı: ' + obj.epLink);
                    return resolve([]);
                }

                // Dil etiketini belirle
                var hasDub = pageText.indexOf('Dublaj') !== -1 || pageText.indexOf('dublaj') !== -1;
                var hasSub = pageText.indexOf('Altyazılı') !== -1 || pageText.indexOf('altyazılı') !== -1;

                resolve(streams.map(function(url, i) {
                    var icon;
                    if (streams.length > 1) {
                        icon = (i === 0 && hasSub) ? '🌐 Türkçe Altyazılı' : '🇹🇷 Türkçe Dublaj';
                    } else {
                        icon = hasDub ? '🇹🇷 Türkçe Dublaj' : '🌐 Türkçe Altyazılı';
                    }
                    return {
                        name: diziIsmi,
                        title: '⌜ AsyaFanatikleri ⌟ | ' + icon,
                        url: url,
                        quality: '1080p',
                        headers: { 'Referer': BASE_URL + '/' }
                    };
                }));
            })
            .catch(function(err) {
                console.error('[AsyaFanatiklerim Hata]: ' + err.message);
                resolve([]);
            });
    });
}

// Slug adaylarını sırayla dene, ilk 200 dönen sayfayı kabul et
function tryDiziSlugs(slugs, index, name) {
    if (index >= slugs.length) return Promise.resolve(null);

    var slug = slugs[index];
    var url  = BASE_URL + '/dizi/' + slug + '/';
    console.error('[AsyaFanatiklerim] Deneniyor: ' + url);

    return fetch(url, { headers: HEADERS })
        .then(function(res) {
            if (res.status !== 200) {
                return tryDiziSlugs(slugs, index + 1, name);
            }
            return res.text().then(function(html) {
                // Sayfa gerçekten bir dizi sayfası mı? Bölüm linki var mı?
                if (html.indexOf('/bolum/') === -1) {
                    return tryDiziSlugs(slugs, index + 1, name);
                }
                return { html: html, slug: slug, name: name };
            });
        })
        .catch(function() {
            return tryDiziSlugs(slugs, index + 1, name);
        });
}

module.exports = { getStreams: getStreams };
