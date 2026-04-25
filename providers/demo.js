var cheerio = require("cheerio-without-node-native");

var BASE_URL = 'https://asyafanatiklerim.com';

var HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': BASE_URL + '/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

// Türkçe karakterleri ve özel karakterleri slug formatına çevir
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

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    return new Promise(function(resolve, reject) {
        // Sadece tv (dizi) destekleniyor
        if (mediaType !== 'tv') return resolve([]);

        var tmdbUrl = 'https://api.themoviedb.org/3/tv/' + tmdbId + '?language=tr-TR&api_key=4ef0d7355d9ffb5151e987764708ce96';

        fetch(tmdbUrl, { headers: { 'User-Agent': HEADERS['User-Agent'] } })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                var query = (data.name || '').trim();
                var orgName = (data.original_name || '').trim();

                console.error('[AsyaFanatiklerim] Aranan: ' + query);

                // Önce arama yap
                var searchUrl = BASE_URL + '/?s=' + encodeURIComponent(query);
                return fetch(searchUrl, { headers: HEADERS }).then(function(res) {
                    return res.text().then(function(html) {
                        return { html: html, query: query, orgName: orgName };
                    });
                });
            })
            .then(function(obj) {
                var $ = cheerio.load(obj.html);
                var searchTitleLower = obj.query.toLowerCase().trim();
                var orgTitleLower = obj.orgName.toLowerCase().trim();
                var foundLink = null;

                // Sitenin arama sonuç seçicileri
                var results = $('article a, .post-title a, .entry-title a, h2 a, h3 a, .name a');

                results.each(function() {
                    var el = $(this);
                    var href = el.attr('href') || '';
                    // Sadece dizi sayfalarına bak (/dizi/ veya /bolum/ içermeyenleri atla)
                    if (!href || (!href.includes('/dizi/') && !href.includes(BASE_URL + '/'))) return;
                    if (href.includes('/bolum/') || href.includes('/tur/') || href.includes('/kategori/')) return;

                    var currentTitle = el.text().toLowerCase()
                        .replace('izle', '').replace('türkçe altyazılı', '').trim();

                    var isExact = (currentTitle === searchTitleLower || currentTitle === orgTitleLower);
                    var isBracket = (currentTitle.includes(searchTitleLower + ' (') || currentTitle.includes(orgTitleLower + ' ('));
                    var isSlug = (currentTitle.includes(searchTitleLower) || currentTitle.includes(orgTitleLower));

                    if (isExact || isBracket) {
                        foundLink = href;
                        return false;
                    }
                    if (isSlug && !foundLink) {
                        foundLink = href;
                    }
                });

                // Arama sonucu bulunamadıysa doğrudan slug ile dene
                if (!foundLink) {
                    var slug = toSlug(obj.query);
                    foundLink = BASE_URL + '/dizi/' + slug + '/';
                    console.error('[AsyaFanatiklerim] Arama sonucu yok, slug deneniyor: ' + foundLink);
                }

                console.error('[AsyaFanatiklerim] Dizi sayfası: ' + foundLink);

                // Dizi sayfasını çek, bölüm linklerini bul
                return fetch(foundLink, { headers: HEADERS }).then(function(res) {
                    return res.text().then(function(html) {
                        return { html: html, query: obj.query, orgName: obj.orgName, diziUrl: foundLink };
                    });
                });
            })
            .then(function(obj) {
                var $ = cheerio.load(obj.html);
                var targetEpLink = null;

                // Bölüm listesini tara: "1x3", "S01E03" veya "Sezon 1 / 3. Bölüm" formatındaki linkleri ara
                $('a[href*="/bolum/"]').each(function() {
                    var el = $(this);
                    var href = el.attr('href') || '';
                    var text = el.text().toLowerCase();

                    // Metin içinde sezon/bölüm numarası eşleşmesi: "1x3", "1 - 3", "s1e3" vb.
                    var seasonStr = String(seasonNum);
                    var epStr = String(episodeNum);

                    // data-* attribute veya "1x3" formatında bul
                    var seasonEpPattern = new RegExp('\\b' + seasonStr + '[x×]' + epStr + '\\b', 'i');
                    var textMatch = text.match(seasonEpPattern);

                    // Parent container içindeki küçük numaraya bak (ör: "1 - 3")
                    var parentText = el.closest('li, div').text().toLowerCase();
                    var numPattern = new RegExp('\\b' + seasonStr + '\\s*[-x]\\s*' + epStr + '\\b', 'i');
                    var parentMatch = parentText.match(numPattern);

                    if (textMatch || parentMatch) {
                        targetEpLink = href;
                        return false;
                    }
                });

                // Bulunamadıysa URL pattern ile dene
                if (!targetEpLink) {
                    var diziSlug = (obj.diziUrl || '').split('/').filter(Boolean).pop();
                    
                    // Olası bölüm URL'lerini dene (suffix varyasyonları)
                    var epNum = episodeNum;
                    var suffixes = ['', '-izle', '-tr', '-izle-tr', '-izle-new', '-1', '-tr1', '-izle-tr1'];
                    
                    // Sayfa üzerindeki mevcut linklerde slug'ı ara
                    var allEpLinks = [];
                    $('a[href*="/bolum/"]').each(function() {
                        var href = $(this).attr('href') || '';
                        if (href.includes(diziSlug)) allEpLinks.push(href);
                    });

                    // Sayfa üzerinde {episodeNum}-bolum varsa al
                    var epPattern = new RegExp(diziSlug + '-' + epNum + '-bolum', 'i');
                    for (var i = 0; i < allEpLinks.length; i++) {
                        if (epPattern.test(allEpLinks[i])) {
                            targetEpLink = allEpLinks[i];
                            break;
                        }
                    }

                    // Hâlâ bulunamadıysa URL'yi tahmin et
                    if (!targetEpLink) {
                        targetEpLink = BASE_URL + '/bolum/' + diziSlug + '-' + epNum + '-bolum-izle/';
                    }
                }

                console.error('[AsyaFanatiklerim] Bölüm URL: ' + targetEpLink);

                return fetch(targetEpLink, { headers: HEADERS }).then(function(res) {
                    return res.text().then(function(html) {
                        return { html: html, query: obj.query, epUrl: targetEpLink };
                    });
                });
            })
            .then(function(obj) {
                var $ = cheerio.load(obj.html);
                var streams = [];
                var diziIsmi = obj.query;

                // Player seçeneklerini bul: "Alternatif" sekmelerindeki iframe/embed src'leri
                // Sitenin player tab yapısı: #option-1, #option-2 vb.
                $('iframe, video source').each(function() {
                    var src = $(this).attr('src') || $(this).attr('data-src') || '';
                    if (src && src.length > 10) {
                        streams.push({ src: src, label: 'Video' });
                    }
                });

                // Alternatif sekme başlıklarını da topla (Türkçe Altyazılı, Türkçe Dublaj vb.)
                var tabLabels = [];
                $('.alternatif-tab, .player-tab, [id^="option-"]').each(function() {
                    var label = $(this).text().trim();
                    if (label) tabLabels.push(label);
                });

                // data-src veya src içindeki embed linklerini tara
                $('[data-src], [data-url]').each(function() {
                    var src = $(this).attr('data-src') || $(this).attr('data-url') || '';
                    if (src && src.length > 10 && streams.findIndex(function(s){ return s.src === src; }) === -1) {
                        streams.push({ src: src, label: 'Video' });
                    }
                });

                // Sekme etiketlerine göre dil bilgisi ekle
                var dil = 'Türkçe Altyazılı';
                var pageText = obj.html;
                if (pageText.indexOf('Dublaj') !== -1 || pageText.indexOf('dublaj') !== -1) {
                    dil = 'Türkçe Dublaj';
                }
                if (pageText.indexOf('Altyazılı') !== -1 || pageText.indexOf('altyazılı') !== -1) {
                    dil = 'Türkçe Altyazılı';
                }

                if (streams.length === 0) {
                    // Son çare: embed URL'si doğrudan sayfada string olarak geçiyorsa regex ile bul
                    var embedMatch = pageText.match(/src=["']([^"']*(?:player|embed|watch|stream)[^"']*)["']/i);
                    if (embedMatch) {
                        streams.push({ src: embedMatch[1], label: dil });
                    }
                }

                if (streams.length === 0) {
                    console.error('[AsyaFanatiklerim] Stream bulunamadı: ' + obj.epUrl);
                    return resolve([]);
                }

                resolve(streams.map(function(s, i) {
                    var label = tabLabels[i] || s.label || dil;
                    // Dil etiketine göre ikon ekle
                    var icon = label.toLowerCase().includes('dublaj') ? '🇹🇷 Türkçe Dublaj' : '🌐 Türkçe Altyazılı';
                    return {
                        name: diziIsmi,
                        title: '⌜ AsyaFanatikleri ⌟ | ' + icon,
                        url: s.src,
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

module.exports = { getStreams: getStreams };
