/* ==========================================
   NegaToPos — UI controller
   Negative film → positive (client-side only)
   ========================================== */

(function () {
    'use strict';

    const CFG = window.NegaToPosConfig;

    const state = {
        images: [],
        currentIndex: 0,
        filmType: 'color',
        autoCorrect: true,
        eyedropperActive: false,
        eyedropperWB: null,
        preset: 'auto',
        settings: {
            brightness: 0,
            contrast: 0,
            saturation: 0,
            temperature: 0,
            gamma: 100
        },
        viewMode: 'split',
        splitPosition: 50,
        isDraggingSplit: false,
        requestId: 0,
        busy: false
    };

    const dom = {
        uploadSection: document.getElementById('upload-section'),
        editorSection: document.getElementById('editor-section'),
        uploadZone: document.getElementById('upload-zone'),
        fileInput: document.getElementById('file-input'),
        selectBtn: document.getElementById('select-btn'),
        canvasOriginal: document.getElementById('canvas-original'),
        canvasResult: document.getElementById('canvas-result'),
        previewContainer: document.getElementById('preview-container'),
        previewSplit: document.getElementById('preview-split'),
        compareStack: document.getElementById('compare-stack'),
        splitDivider: document.getElementById('split-divider'),
        thumbnailStrip: document.getElementById('thumbnail-strip'),
        processingOverlay: document.getElementById('processing-overlay'),
        processingText: document.getElementById('processing-text'),
        emptyEditor: document.getElementById('empty-editor'),
        tabs: document.querySelectorAll('[data-tab]'),
        filmBtns: document.querySelectorAll('[data-film]'),
        presetBtns: document.querySelectorAll('[data-preset]'),
        orangeMaskGroup: document.getElementById('orange-mask-group'),
        sliders: {
            brightness: document.getElementById('brightness'),
            contrast: document.getElementById('contrast'),
            saturation: document.getElementById('saturation'),
            temperature: document.getElementById('temperature'),
            gamma: document.getElementById('gamma')
        },
        values: {
            brightness: document.getElementById('brightness-value'),
            contrast: document.getElementById('contrast-value'),
            saturation: document.getElementById('saturation-value'),
            temperature: document.getElementById('temperature-value'),
            gamma: document.getElementById('gamma-value')
        },
        resetBtn: document.getElementById('reset-btn'),
        downloadBtn: document.getElementById('download-btn'),
        downloadAllBtn: document.getElementById('download-all-btn'),
        addMoreBtn: document.getElementById('add-more-btn'),
        clearAllBtn: document.getElementById('clear-all-btn'),
        toast: document.getElementById('toast'),
        autoCorrectBtn: document.getElementById('auto-correct-btn'),
        eyedropperBtn: document.getElementById('eyedropper-btn'),
        imageCount: document.getElementById('image-count')
    };

    const ctxOriginal = dom.canvasOriginal.getContext('2d', { willReadFrequently: true });
    const ctxResult = dom.canvasResult.getContext('2d', { willReadFrequently: true });

    let worker = null;
    let workerReady = false;
    let processTimer = null;
    let toastTimeout = null;
    let fallbackWarned = false;

    function initWorker() {
        try {
            worker = new Worker('js/processor.worker.js');
            workerReady = true;
            worker.onmessage = onWorkerMessage;
            worker.onerror = () => {
                workerReady = false;
                showToast('Arka plan işleyici açılamadı; işlem ana iş parçacığında sürecek.', 'warn');
            };
        } catch (err) {
            workerReady = false;
        }
    }

    function onWorkerMessage(event) {
        const msg = event.data;
        if (!msg || msg.requestId !== state.requestId) return;

        setBusy(false);

        if (msg.type === 'error') {
            showToast(msg.message || 'Dönüştürme başarısız', 'error');
            return;
        }

        const imageData = new ImageData(
            new Uint8ClampedArray(msg.buffer),
            msg.width,
            msg.height
        );
        ctxResult.putImageData(imageData, 0, 0);
    }

    function showToast(message, tone) {
        dom.toast.textContent = message;
        dom.toast.dataset.tone = tone || 'info';
        dom.toast.classList.add('show');
        dom.toast.setAttribute('role', 'status');
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => dom.toast.classList.remove('show'), 3200);
    }

    function setBusy(busy, label) {
        state.busy = busy;
        if (!dom.processingOverlay) return;
        dom.processingOverlay.hidden = !busy;
        if (busy && label && dom.processingText) {
            dom.processingText.textContent = label;
        }
    }

    function formatBytes(bytes) {
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function isAcceptedFile(file) {
        if (file.type && CFG.ACCEPTED_MIME.includes(file.type)) return true;
        // Some browsers leave type empty; allow by extension fallback
        return /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name || '');
    }

    function setupUpload() {
        const openPicker = () => dom.fileInput.click();

        dom.uploadZone.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            openPicker();
        });

        dom.uploadZone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openPicker();
            }
        });

        dom.selectBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openPicker();
        });

        dom.fileInput.addEventListener('change', (e) => {
            handleFiles(e.target.files);
            dom.fileInput.value = '';
        });

        ['dragenter', 'dragover'].forEach((type) => {
            dom.uploadZone.addEventListener(type, (e) => {
                e.preventDefault();
                dom.uploadZone.classList.add('is-dragover');
            });
        });

        ['dragleave', 'drop'].forEach((type) => {
            dom.uploadZone.addEventListener(type, (e) => {
                e.preventDefault();
                if (type === 'dragleave' && e.target !== dom.uploadZone) return;
                dom.uploadZone.classList.remove('is-dragover');
            });
        });

        dom.uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dom.uploadZone.classList.remove('is-dragover');
            handleFiles(e.dataTransfer.files);
        });

        dom.addMoreBtn.addEventListener('click', openPicker);
        dom.clearAllBtn.addEventListener('click', clearAll);
    }

    async function handleFiles(fileList) {
        const incoming = Array.from(fileList || []);
        if (incoming.length === 0) return;

        const room = CFG.MAX_IMAGES - state.images.length;
        if (room <= 0) {
            showToast(`En fazla ${CFG.MAX_IMAGES} görsel yüklenebilir`, 'warn');
            return;
        }

        const files = incoming.slice(0, room);
        let loaded = 0;
        const errors = [];

        setBusy(true, 'Görseller okunuyor…');

        for (const file of files) {
            try {
                validateFile(file);
                const imageData = await loadImage(file);
                state.images.push({
                    name: (file.name || 'negatif').replace(/\.[^.]+$/, ''),
                    originalData: imageData
                });
                loaded++;
            } catch (err) {
                errors.push(`${file.name || 'dosya'}: ${err.message}`);
            }
        }

        setBusy(false);

        if (loaded === 0) {
            showToast(errors[0] || 'Geçerli görsel bulunamadı', 'error');
            return;
        }

        const startIndex = state.images.length - loaded;
        showEditor();
        renderThumbnails();
        selectImage(startIndex);
        updateImageCount();

        if (state.images.length > 1) {
            dom.downloadAllBtn.hidden = false;
        }

        if (errors.length) {
            showToast(`${loaded} yüklendi, ${errors.length} atlandı`, 'warn');
        } else {
            showToast(`${loaded} görsel hazır`);
        }
    }

    function validateFile(file) {
        if (!isAcceptedFile(file)) {
            throw new Error('Desteklenmeyen format (JPG, PNG, WebP, GIF, BMP, AVIF)');
        }
        if (file.size > CFG.MAX_FILE_BYTES) {
            throw new Error(`Dosya çok büyük (max ${formatBytes(CFG.MAX_FILE_BYTES)})`);
        }
    }

    function loadImage(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();

            img.onload = () => {
                try {
                    const w = img.naturalWidth || img.width;
                    const h = img.naturalHeight || img.height;

                    if (!w || !h) {
                        throw new Error('Görsel boyutları okunamadı');
                    }
                    if (w > CFG.MAX_DIMENSION || h > CFG.MAX_DIMENSION) {
                        throw new Error(`Kenar uzunluğu ${CFG.MAX_DIMENSION}px sınırını aşıyor`);
                    }
                    if (w * h > CFG.MAX_PIXELS) {
                        throw new Error('Görsel çok yüksek çözünürlüklü');
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });
                    ctx.drawImage(img, 0, 0);
                    const data = ctx.getImageData(0, 0, w, h);
                    URL.revokeObjectURL(url);
                    resolve(data);
                } catch (err) {
                    URL.revokeObjectURL(url);
                    reject(err);
                }
            };

            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Görsel açılamadı (TIFF çoğu tarayıcıda desteklenmez)'));
            };

            img.src = url;
        });
    }

    function showEditor() {
        dom.uploadSection.hidden = true;
        dom.editorSection.hidden = false;
        dom.uploadSection.classList.remove('is-visible');
        dom.editorSection.classList.add('is-visible');
        if (dom.emptyEditor) dom.emptyEditor.hidden = true;
    }

    function showUpload() {
        dom.editorSection.hidden = true;
        dom.uploadSection.hidden = false;
        dom.editorSection.classList.remove('is-visible');
        dom.uploadSection.classList.add('is-visible');
        dom.downloadAllBtn.hidden = true;
        updateImageCount();
    }

    function clearAll() {
        state.images = [];
        state.currentIndex = 0;
        state.eyedropperWB = null;
        state.requestId++;
        ctxOriginal.clearRect(0, 0, dom.canvasOriginal.width, dom.canvasOriginal.height);
        ctxResult.clearRect(0, 0, dom.canvasResult.width, dom.canvasResult.height);
        dom.thumbnailStrip.innerHTML = '';
        showUpload();
        showToast('Oturum temizlendi');
    }

    function updateImageCount() {
        if (!dom.imageCount) return;
        const n = state.images.length;
        dom.imageCount.textContent = n ? `${n} görsel` : '';
        dom.imageCount.hidden = !n;
    }

    function selectImage(index) {
        if (!state.images[index]) return;
        state.currentIndex = index;
        state.eyedropperWB = null;
        setEyedropperMode(false);

        const imgData = state.images[index].originalData;
        dom.canvasOriginal.width = imgData.width;
        dom.canvasOriginal.height = imgData.height;
        dom.canvasResult.width = imgData.width;
        dom.canvasResult.height = imgData.height;
        ctxOriginal.putImageData(imgData, 0, 0);

        document.querySelectorAll('.thumb').forEach((el, i) => {
            el.classList.toggle('is-active', i === index);
            el.setAttribute('aria-current', i === index ? 'true' : 'false');
        });

        queueProcess(true);
    }

    function renderThumbnails() {
        dom.thumbnailStrip.innerHTML = '';
        state.images.forEach((img, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `thumb${i === state.currentIndex ? ' is-active' : ''}`;
            btn.setAttribute('aria-label', `${img.name} görselini seç`);
            btn.setAttribute('aria-current', i === state.currentIndex ? 'true' : 'false');

            const canvas = document.createElement('canvas');
            const size = 96;
            const ratio = Math.min(size / img.originalData.width, size / img.originalData.height);
            canvas.width = Math.max(1, Math.round(img.originalData.width * ratio));
            canvas.height = Math.max(1, Math.round(img.originalData.height * ratio));

            const tmp = document.createElement('canvas');
            tmp.width = img.originalData.width;
            tmp.height = img.originalData.height;
            tmp.getContext('2d').putImageData(img.originalData, 0, 0);
            canvas.getContext('2d').drawImage(tmp, 0, 0, canvas.width, canvas.height);

            const image = document.createElement('img');
            image.src = canvas.toDataURL('image/jpeg', 0.55);
            image.alt = '';
            image.decoding = 'async';

            btn.appendChild(image);
            btn.addEventListener('click', () => selectImage(i));
            dom.thumbnailStrip.appendChild(btn);
        });
    }

    function queueProcess(immediate) {
        clearTimeout(processTimer);
        const delay = immediate ? 0 : 40;
        processTimer = setTimeout(runProcess, delay);
    }

    function runProcess() {
        const current = state.images[state.currentIndex];
        if (!current) return;

        const imgData = current.originalData;
        const options = {
            filmType: state.filmType,
            autoCorrect: state.autoCorrect,
            eyedropperWB: state.eyedropperWB,
            settings: { ...state.settings }
        };

        state.requestId += 1;
        const requestId = state.requestId;
        setBusy(true, 'Negatif dönüştürülüyor…');

        if (workerReady && worker) {
            const copy = imgData.data.buffer.slice(0);
            worker.postMessage(
                {
                    type: 'process',
                    requestId,
                    buffer: copy,
                    width: imgData.width,
                    height: imgData.height,
                    options
                },
                [copy]
            );
            return;
        }

        // Fallback: main thread (file:// or Worker blocked)
        try {
            fallbackProcess(imgData, options);
            if (requestId === state.requestId) setBusy(false);
        } catch (err) {
            setBusy(false);
            showToast(err.message || 'İşleme hatası', 'error');
        }
    }

    /** Minimal sync fallback if Worker unavailable. */
    function fallbackProcess(imgData, options) {
        // Dynamic import not available for worker code; inline thin path via Offscreen? skip
        // Re-run by creating a temporary worker blob is heavy — use simple invert+levels inline
        const src = imgData.data;
        const out = ctxResult.createImageData(imgData.width, imgData.height);
        const dst = out.data;
        const isColor = options.filmType === 'color';
        const brightness = options.settings.brightness || 0;
        const contrast = (options.settings.contrast || 0) / 100;
        const contrastFactor = 1 + contrast;
        const saturation = 1 + (options.settings.saturation || 0) / 100;
        const temperature = options.settings.temperature || 0;
        const gamma = (options.settings.gamma || 100) / 100;
        const invGamma = gamma !== 1 ? 1 / gamma : 1;

        for (let i = 0; i < src.length; i += 4) {
            let r = 255 - src[i];
            let g = 255 - src[i + 1];
            let b = 255 - src[i + 2];

            if (gamma !== 1) {
                r = 255 * Math.pow(r / 255, invGamma);
                g = 255 * Math.pow(g / 255, invGamma);
                b = 255 * Math.pow(b / 255, invGamma);
            }
            if (brightness) {
                r += brightness;
                g += brightness;
                b += brightness;
            }
            if (contrast) {
                r = (r - 128) * contrastFactor + 128;
                g = (g - 128) * contrastFactor + 128;
                b = (b - 128) * contrastFactor + 128;
            }
            if (temperature) {
                r += temperature * 0.5;
                b -= temperature * 0.5;
            }
            if (isColor && saturation !== 1) {
                const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                r = gray + saturation * (r - gray);
                g = gray + saturation * (g - gray);
                b = gray + saturation * (b - gray);
            }
            if (!isColor) {
                const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                r = g = b = lum;
            }

            dst[i] = Math.max(0, Math.min(255, Math.round(r)));
            dst[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
            dst[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
            dst[i + 3] = src[i + 3];
        }

        ctxResult.putImageData(out, 0, 0);
        if (!workerReady && !fallbackWarned) {
            fallbackWarned = true;
            showToast('Basit mod aktif — tam düzeltme için http sunucusu kullanın', 'warn');
        }
    }

    function setEyedropperMode(on) {
        state.eyedropperActive = !!on;
        dom.eyedropperBtn.classList.toggle('is-active', state.eyedropperActive);
        dom.eyedropperBtn.setAttribute('aria-pressed', String(state.eyedropperActive));
        dom.previewContainer.classList.toggle('is-eyedropper', state.eyedropperActive);
        if (state.eyedropperActive) {
            showToast('Filmin boş kenarına tıklayın');
        }
    }

    function setupEyedropper() {
        dom.eyedropperBtn.addEventListener('click', () => {
            if (state.filmType !== 'color') return;
            setEyedropperMode(!state.eyedropperActive);
        });

        const pickFromEvent = (e) => {
            if (!state.eyedropperActive || !state.images[state.currentIndex]) return;

            // Result canvas keeps a stable full-image box in split mode
            const box = state.viewMode === 'original'
                ? dom.canvasOriginal
                : dom.canvasResult;
            const rect = box.getBoundingClientRect();
            if (!rect.width || !rect.height) return;

            const scaleX = box.width / rect.width;
            const scaleY = box.height / rect.height;
            const x = Math.floor((e.clientX - rect.left) * scaleX);
            const y = Math.floor((e.clientY - rect.top) * scaleY);

            if (x < 0 || y < 0 || x >= box.width || y >= box.height) return;

            state.eyedropperWB = sampleWB(state.images[state.currentIndex].originalData, x, y);
            setEyedropperMode(false);
            queueProcess(true);
            showToast('Beyaz dengesi güncellendi');
        };

        dom.compareStack.addEventListener('click', pickFromEvent);
    }

    function sampleWB(imageData, x, y) {
        const w = imageData.width;
        const src = imageData.data;
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let count = 0;
        const radius = 5;

        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const px = Math.max(0, Math.min(w - 1, x + dx));
                const py = Math.max(0, Math.min(imageData.height - 1, y + dy));
                const idx = (py * w + px) * 4;
                rSum += 255 - src[idx];
                gSum += 255 - src[idx + 1];
                bSum += 255 - src[idx + 2];
                count++;
            }
        }

        const r = rSum / count;
        const g = gSum / count;
        const b = bSum / count;
        const maxVal = Math.max(r, g, b, 1);
        return {
            rScale: maxVal / Math.max(r, 1),
            gScale: maxVal / Math.max(g, 1),
            bScale: maxVal / Math.max(b, 1)
        };
    }

    function applySettingsToUI() {
        Object.keys(dom.sliders).forEach((key) => {
            const slider = dom.sliders[key];
            if (!slider) return;
            slider.value = String(state.settings[key]);
            if (key === 'gamma') {
                dom.values[key].textContent = (state.settings[key] / 100).toFixed(1);
            } else {
                dom.values[key].textContent = String(state.settings[key]);
            }
        });

        dom.autoCorrectBtn.classList.toggle('is-active', state.autoCorrect);
        dom.autoCorrectBtn.setAttribute('aria-pressed', String(state.autoCorrect));
        dom.autoCorrectBtn.querySelector('[data-autocorrect-label]').textContent = state.autoCorrect
            ? 'Otomatik düzeltme açık'
            : 'Otomatik düzeltme kapalı';

        dom.presetBtns.forEach((btn) => {
            btn.classList.toggle('is-active', btn.dataset.preset === state.preset);
            btn.setAttribute('aria-pressed', String(btn.dataset.preset === state.preset));
        });
    }

    function setupControls() {
        Object.keys(dom.sliders).forEach((key) => {
            const slider = dom.sliders[key];
            slider.addEventListener('input', () => {
                const val = parseInt(slider.value, 10);
                state.settings[key] = val;
                state.preset = 'custom';
                dom.presetBtns.forEach((btn) => {
                    btn.classList.remove('is-active');
                    btn.setAttribute('aria-pressed', 'false');
                });
                if (key === 'gamma') {
                    dom.values[key].textContent = (val / 100).toFixed(1);
                } else {
                    dom.values[key].textContent = String(val);
                }
                queueProcess(false);
            });
        });

        dom.filmBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                dom.filmBtns.forEach((b) => {
                    b.classList.remove('is-active');
                    b.setAttribute('aria-pressed', 'false');
                });
                btn.classList.add('is-active');
                btn.setAttribute('aria-pressed', 'true');
                state.filmType = btn.dataset.film;
                state.eyedropperWB = null;
                if (state.filmType === 'bw') setEyedropperMode(false);
                dom.orangeMaskGroup.hidden = state.filmType === 'bw';
                queueProcess(true);
            });
        });

        dom.presetBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.preset;
                const preset = CFG.PRESETS[key];
                if (!preset) return;
                state.preset = key;
                state.settings = {
                    brightness: preset.brightness,
                    contrast: preset.contrast,
                    saturation: preset.saturation,
                    temperature: preset.temperature,
                    gamma: preset.gamma
                };
                state.autoCorrect = preset.autoCorrect;
                applySettingsToUI();
                queueProcess(true);
            });
        });

        dom.autoCorrectBtn.addEventListener('click', () => {
            state.autoCorrect = !state.autoCorrect;
            state.preset = 'custom';
            applySettingsToUI();
            queueProcess(true);
        });

        dom.tabs.forEach((tab) => {
            tab.addEventListener('click', () => {
                dom.tabs.forEach((t) => {
                    t.classList.remove('is-active');
                    t.setAttribute('aria-selected', 'false');
                });
                tab.classList.add('is-active');
                tab.setAttribute('aria-selected', 'true');
                state.viewMode = tab.dataset.tab;
                updateViewMode();
            });
        });

        dom.resetBtn.addEventListener('click', resetSettings);
        dom.downloadBtn.addEventListener('click', downloadCurrent);
        dom.downloadAllBtn.addEventListener('click', downloadAll);
    }

    function resetSettings() {
        const preset = CFG.PRESETS.auto;
        state.preset = 'auto';
        state.settings = {
            brightness: preset.brightness,
            contrast: preset.contrast,
            saturation: preset.saturation,
            temperature: preset.temperature,
            gamma: preset.gamma
        };
        state.autoCorrect = true;
        state.eyedropperWB = null;
        applySettingsToUI();
        queueProcess(true);
        showToast('Ayarlar sıfırlandı');
    }

    function applySplitPosition() {
        const pct = `${state.splitPosition}%`;
        dom.compareStack.style.setProperty('--split', pct);
        dom.splitDivider.setAttribute('aria-valuenow', String(Math.round(state.splitPosition)));
    }

    function updateViewMode() {
        dom.previewSplit.dataset.mode = state.viewMode;
        if (state.viewMode === 'split') {
            applySplitPosition();
        }
    }

    function setupSplitDivider() {
        const startDrag = (e) => {
            if (state.viewMode !== 'split') return;
            e.preventDefault();
            state.isDraggingSplit = true;
            dom.splitDivider.classList.add('is-dragging');
            document.addEventListener('mousemove', onDrag);
            document.addEventListener('mouseup', stopDrag);
            document.addEventListener('touchmove', onDrag, { passive: false });
            document.addEventListener('touchend', stopDrag);
        };

        const onDrag = (e) => {
            if (!state.isDraggingSplit) return;
            e.preventDefault();
            const rect = dom.compareStack.getBoundingClientRect();
            if (!rect.width) return;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const pos = ((clientX - rect.left) / rect.width) * 100;
            state.splitPosition = Math.max(8, Math.min(92, pos));
            applySplitPosition();
        };

        const stopDrag = () => {
            state.isDraggingSplit = false;
            dom.splitDivider.classList.remove('is-dragging');
            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('mouseup', stopDrag);
            document.removeEventListener('touchmove', onDrag);
            document.removeEventListener('touchend', stopDrag);
        };

        dom.splitDivider.addEventListener('mousedown', startDrag);
        dom.splitDivider.addEventListener('touchstart', startDrag, { passive: false });

        dom.splitDivider.addEventListener('keydown', (e) => {
            if (state.viewMode !== 'split') return;
            if (e.key === 'ArrowLeft') {
                state.splitPosition = Math.max(8, state.splitPosition - 2);
                applySplitPosition();
            } else if (e.key === 'ArrowRight') {
                state.splitPosition = Math.min(92, state.splitPosition + 2);
                applySplitPosition();
            }
        });
    }

    function downloadCanvas(canvas, filename) {
        const link = document.createElement('a');
        link.download = filename;
        link.href = canvas.toDataURL('image/png');
        link.click();
    }

    function downloadCurrent() {
        if (!state.images.length) return;
        const name = state.images[state.currentIndex].name;
        downloadCanvas(dom.canvasResult, `${name}_pozitif.png`);
        showToast('PNG indirildi');
    }

    async function downloadAll() {
        if (state.images.length < 2) return;
        showToast(`${state.images.length} görsel sırayla indirilecek`);
        const originalIndex = state.currentIndex;

        for (let i = 0; i < state.images.length; i++) {
            selectImage(i);
            await waitForIdle();
            downloadCanvas(dom.canvasResult, `${state.images[i].name}_pozitif.png`);
            await sleep(350);
        }

        selectImage(originalIndex);
        showToast('Toplu indirme tamamlandı');
    }

    function sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }

    function waitForIdle() {
        return new Promise((resolve) => {
            const start = Date.now();
            const tick = () => {
                if (!state.busy || Date.now() - start > 8000) resolve();
                else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
    }

    function setupKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (state.images.length === 0) return;
            const tag = e.target.tagName;
            const typing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;

            if (e.key === 'ArrowLeft' && !typing) {
                if (state.currentIndex > 0) selectImage(state.currentIndex - 1);
            } else if (e.key === 'ArrowRight' && !typing) {
                if (state.currentIndex < state.images.length - 1) {
                    selectImage(state.currentIndex + 1);
                }
            }

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                downloadCurrent();
            }

            if (!typing && e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) {
                resetSettings();
            }

            if (!typing && e.key.toLowerCase() === 'e' && !e.ctrlKey && !e.metaKey) {
                if (state.filmType === 'color') dom.eyedropperBtn.click();
            }
        });
    }

    function setupEditorDrop() {
        document.addEventListener('dragover', (e) => {
            if (dom.editorSection.hidden) return;
            e.preventDefault();
        });
        document.addEventListener('drop', (e) => {
            if (dom.editorSection.hidden) return;
            e.preventDefault();
            handleFiles(e.dataTransfer.files);
        });
    }

    function init() {
        initWorker();
        setupUpload();
        setupControls();
        setupEyedropper();
        setupSplitDivider();
        setupKeyboard();
        setupEditorDrop();
        applySettingsToUI();
        updateViewMode();
        showUpload();

        if (location.protocol === 'file:') {
            showToast('Tam özellik için yerel sunucu veya GitHub Pages kullanın', 'warn');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
