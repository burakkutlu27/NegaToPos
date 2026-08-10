/**
 * Browser smoke: upload a synthetic orange-mask negative and ensure
 * the result canvas is painted after Worker processing.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.xml': 'application/xml',
    '.txt': 'text/plain; charset=utf-8'
};

function makeNegativePng(w = 180, h = 120) {
    const png = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (w * y + x) << 2;
            const edge = x < 12 || x > w - 13 || y < 12 || y > h - 13;
            if (edge) {
                png.data[i] = 215;
                png.data[i + 1] = 135;
                png.data[i + 2] = 55;
            } else {
                png.data[i] = 75;
                png.data[i + 1] = 100;
                png.data[i + 2] = 155;
            }
            png.data[i + 3] = 255;
        }
    }
    return PNG.sync.write(png);
}

function startStaticServer() {
    return new Promise((resolve) => {
        const server = createServer((req, res) => {
            const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
            const rel = urlPath === '/' ? '/index.html' : urlPath;
            const filePath = join(root, rel.replace(/^\//, ''));
            if (!filePath.startsWith(root) || !existsSync(filePath)) {
                res.writeHead(404);
                res.end('missing');
                return;
            }
            const ext = extname(filePath);
            res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
            res.end(readFileSync(filePath));
        });
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, port });
        });
    });
}

const { server, port } = await startStaticServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(String(err)));

try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });

    const title = await page.title();
    if (!/NegaToPos/i.test(title)) throw new Error(`Unexpected title: ${title}`);

    const h1 = await page.locator('h1').innerText();
    if (!h1.trim()) throw new Error('Missing h1');

    const png = makeNegativePng();
    await page.setInputFiles('#file-input', {
        name: 'test-negative.png',
        mimeType: 'image/png',
        buffer: png
    });

    await page.waitForSelector('#editor-section:not([hidden])', { timeout: 8000 });
    await page.waitForFunction(() => {
        const c = document.getElementById('canvas-result');
        if (!c || !c.width) return false;
        const ctx = c.getContext('2d');
        const sample = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
        return sample[3] === 255 && (sample[0] + sample[1] + sample[2]) > 0;
    }, { timeout: 10000 });

    await page.waitForSelector('#processing-overlay[hidden]', {
        state: 'attached',
        timeout: 10000
    });

    if (errors.length) throw new Error(`Page errors: ${errors.join(' | ')}`);

    console.log('PASS_E2E', { title, h1: h1.slice(0, 48) });
} finally {
    await browser.close();
    server.close();
}
