# NegaToPos

Negatif film tarama/fotoğraflarını **tarayıcıda** pozitife çeviren ücretsiz araç.

Görseller sunucuya gönderilmez — tüm işlem Canvas + Web Worker ile cihazınızda yapılır.

## Canlı demo

https://negatopos.burakkutlu.com/

Kaynak: https://github.com/burakkutlu27/NegaToPos

## Özellikler

- Renkli ve siyah-beyaz negatif desteği
- Kenar örneklemeli otomatik turuncu maske / beyaz dengesi
- Pipet ile film kenarından manuel WB
- Parlaklık, kontrast, doygunluk, renk sıcaklığı, gamma
- Ton presetleri (Otomatik, Yumuşak, Canlı, Soğuk)
- Önce/sonra karşılaştırma kaydırıcısı
- Çoklu görsel, tekli ve toplu PNG indirme
- Dosya boyutu / çözünürlük limitleri ve anlamlı hata mesajları

## Teknolojiler

- Vanilla HTML / CSS / JavaScript
- HTML5 Canvas (`ImageData`)
- Web Worker (ana iş parçacığını kilitlemeden piksel işleme)
- GitHub Pages (statik hosting)

## Yerel çalıştırma

Worker güvenliği nedeniyle `index.html` dosyasını doğrudan `file://` ile açmak yerine basit bir HTTP sunucusu kullanın:

```bash
# Python
python -m http.server 8080

# veya Node
npx --yes serve -l 8080
```

Tarayıcıda: http://localhost:8080

## Teknik kararlar

- **Gizlilik önce:** Backend yok; yükleme yalnızca bellek içi.
- **Worker pipeline:** Invert → WB → percentile levels (WB sonrası) → kullanıcı tonları. Levels’ın WB’den sonra hesaplanması önceki LUT uyumsuzluğunu giderir.
- **Darkroom kimliği:** Amber safelight + charcoal + serif marka tipi; jenerik mor-gradient SaaS görünümünden bilinçli uzak duruldu.
- **Sınırlar:** 40 MB / 8192 px kenar / ~36 MP — tarayıcı bellek doS riskini sınırlar.

## Klavye

| Kısayol | İşlev |
|---------|--------|
| `←` `→` | Görseller arası |
| `E` | Pipet |
| `R` | Ayarları sıfırla |
| `Ctrl/Cmd + S` | İndir |

## Testler

```bash
npm install
npx playwright install chromium
npm test
```

- `test:algo` — Worker pipeline smoke (Node)
- `test:e2e` — yükleme + canvas boyama (Playwright)

## Lisans

MIT — kişisel ve ticari kullanım serbest.
