/* Shared limits and app constants (loaded before app.js). */
window.NegaToPosConfig = Object.freeze({
    MAX_FILE_BYTES: 40 * 1024 * 1024,
    MAX_DIMENSION: 8192,
    MAX_PIXELS: 36_000_000,
    MAX_IMAGES: 40,
    ACCEPTED_MIME: Object.freeze([
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'image/bmp',
        'image/avif'
    ]),
    SITE_URL: 'https://negatopos.burakkutlu.com/',
    PRESETS: Object.freeze({
        auto: {
            label: 'Otomatik',
            brightness: 0,
            contrast: 0,
            saturation: 0,
            temperature: 0,
            gamma: 100,
            autoCorrect: true
        },
        soft: {
            label: 'Yumuşak',
            brightness: 8,
            contrast: -12,
            saturation: -8,
            temperature: 6,
            gamma: 110,
            autoCorrect: true
        },
        punch: {
            label: 'Canlı',
            brightness: 4,
            contrast: 18,
            saturation: 14,
            temperature: 0,
            gamma: 95,
            autoCorrect: true
        },
        cool: {
            label: 'Soğuk',
            brightness: 0,
            contrast: 6,
            saturation: 4,
            temperature: -18,
            gamma: 100,
            autoCorrect: true
        }
    })
});
