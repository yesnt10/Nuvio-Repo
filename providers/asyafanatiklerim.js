var cheerio = require("cheerio-without-node-native");

var BASE_URL = 'https://asyafanatiklerim.com';

var HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': BASE_URL + '/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

// Dizi adlarını URL'de kullanılabilecek slug formatına çeviren yardımcı fonksiyon
function slugify(text) {
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')           // Boşlukları tireye (-) çevir
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ı/g, 'i')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c')
        .replace(/[^\w\-]+/g, '')       // Alfanümerik olmayan karakterleri sil
        .replace(/\-\-+/g, '-')         // Tekrarlayan tireleri tek tire yap
        .replace(/^-+/, '')             // Baştaki tireleri sil
        .replace(/-+$/, '');            // Sondaki tireleri sil
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    return new Promise(function(resolve, reject) {
        if (mediaType !== 'tv') return resolve([]);

        // 1. TMDB'den dizi bilgilerini çekiyoruz
        var tmdbUrl = 'https://api.themoviedb.org/3/tv/' + tmdbId + '?language=tr-TR&api_key=4ef0d7355d9ffb5151e987764708ce96';

        fetch(tmdbUrl, { headers: { 'User-Agent': HEADERS['User-Agent'] } })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                var diziIsmi = (data.name || '').trim();
                var orgName = (data.original_name || '').trim();
                
                // Asya dizilerinde genellikle Orijinal isim veya İngilizce isim URL'de yer alır.
                // İhtiyaca göre orgName yerine diziIsmi de kullanabilirsiniz.
                var slug = slugify(orgName || diziIsmi);
                
                // 2. Tahmini site URL'sini oluşturuyoruz
                // AsyaFanatiklerim'de url genelde: dizi-adi-X-bolum şeklindedir (Örn: squid-game-1-bolum)
                var episodeUrl = BASE_URL + '/' + slug + '-' + episodeNum + '-bolum/';

                console.log('[AsyaFanatiklerim Search] URL Deneniyor: ' + episodeUrl);

                // 3. Bölüm sayfasına istek atıyoruz
                return fetch(episodeUrl, { headers: HEADERS })
                    .then(function(res) {
                        if (res.status === 404) throw new Error("Bölüm sayfası bulunamadı.");
                        return res.text(); 
                    })
                    .then(function(html) {
                        var $ = cheerio.load(html);
                        var streams = [];

                        // 4. Sayfa içerisindeki video oynatıcıyı (iframe) buluyoruz.
                        // NOT: Eğer site videoları farklı bir class/id ile tutuyorsa, $('iframe') kısmını güncellemeniz gerekir.
                        var videoSrc = $('iframe').attr('src'); 

                        if (videoSrc) {
                            streams.push({
                                name: diziIsmi,
                                title: '⌜ AsyaFanatiklerim ⌟ | 🌐 Türkçe Altyazılı',
                                url: videoSrc, // Eğer m3u8/mp4 değil de ok.ru, vidmoly vb ise oynatıcı çözücü gerekebilir
                                quality: '1080p',
                                headers: { 'Referer': BASE_URL + '/' }
                            });
                        }

                        // Eğer hiç stream bulunamazsa boş array döndür
                        resolve(streams.map(function(s) {
                            return {
                                name: s.name,
                                title: s.title,
                                url: s.url,
                                quality: s.quality,
                                headers: s.headers
                            };
                        }));
                    });
            })
            .catch(function(err) {
                console.error('[AsyaFanatiklerim Hata]: ' + err.message);
                resolve([]);
            });
    });
}

module.exports = { getStreams };
