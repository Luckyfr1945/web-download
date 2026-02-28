// =============================================
// MediaKit — Frontend JavaScript
// =============================================

let currentTranscript = null;
let selectedFile = null;

// =============================================
// Tab Navigation
// =============================================
document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        document.getElementById(`content-${target}`).classList.add('active');
    });
});

// =============================================
// Radio Pill Selection
// =============================================
document.querySelectorAll('.radio-pills').forEach(group => {
    group.querySelectorAll('.pill').forEach(pill => {
        pill.addEventListener('click', () => {
            group.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
        });
    });
});

// Format change: hide quality when audio selected
document.querySelectorAll('input[name="format"]').forEach(radio => {
    radio.addEventListener('change', () => {
        const qualityGroup = document.getElementById('qualityGroup');
        if (radio.value === 'mp3') {
            qualityGroup.style.display = 'none';
        } else {
            qualityGroup.style.display = '';
        }
    });
});

// =============================================
// File Upload (Drag & Drop + Click)
// =============================================
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');

if (uploadZone) {
    uploadZone.addEventListener('click', () => fileInput.click());

    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    });
}

if (fileInput) {
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            handleFileSelect(fileInput.files[0]);
        }
    });
}

function handleFileSelect(file) {
    selectedFile = file;
    document.getElementById('fileName').textContent = file.name;
    document.getElementById('fileSize').textContent = formatFileSize(file.size);
    document.getElementById('fileSelected').style.display = 'flex';
    uploadZone.style.display = 'none';
}

function removeFile() {
    selectedFile = null;
    fileInput.value = '';
    document.getElementById('fileSelected').style.display = 'none';
    uploadZone.style.display = '';
}

// =============================================
// Fetch Video Info
// =============================================
async function fetchInfo() {
    const url = document.getElementById('downloadUrl').value.trim();
    if (!url) {
        showError('Masukkan URL terlebih dahulu');
        return;
    }

    const btn = document.getElementById('btnFetchInfo');
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div> <span>Loading...</span>`;

    hideError();
    document.getElementById('previewCard').style.display = 'none';
    document.getElementById('downloadOptions').style.display = 'none';
    document.getElementById('downloadResult').style.display = 'none';

    try {
        const res = await fetch('/api/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Gagal mengambil info');
        }

        // Show preview
        const previewCard = document.getElementById('previewCard');
        document.getElementById('previewImg').src = data.thumbnail || '';
        document.getElementById('previewTitle').textContent = data.title;
        document.getElementById('previewAuthor').textContent = `👤 ${data.uploader}`;
        document.getElementById('previewDuration').textContent = formatDuration(data.duration);
        document.getElementById('previewPlatform').textContent = data.platform.toUpperCase();
        document.getElementById('previewDesc').textContent = data.description || '';

        previewCard.style.display = 'flex';
        document.getElementById('downloadOptions').style.display = 'flex';
    } catch (err) {
        showError(err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>Cek</span>`;
    }
}

// =============================================
// Start Download
// =============================================
async function startDownload() {
    const url = document.getElementById('downloadUrl').value.trim();
    if (!url) {
        showError('Masukkan URL terlebih dahulu');
        return;
    }

    const format = document.querySelector('input[name="format"]:checked')?.value || 'mp4';
    const quality = document.querySelector('input[name="quality"]:checked')?.value || 'best';

    const btn = document.getElementById('btnDownload');
    btn.disabled = true;

    // Show progress
    const progressCard = document.getElementById('downloadProgress');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    document.getElementById('downloadResult').style.display = 'none';

    progressCard.style.display = '';
    progressText.textContent = 'Sedang mendownload...';
    progressBar.style.width = '0%';

    // Animate progress bar
    let fakeProgress = 0;
    const progressInterval = setInterval(() => {
        fakeProgress += Math.random() * 8;
        if (fakeProgress > 90) fakeProgress = 90;
        progressBar.style.width = `${fakeProgress}%`;
    }, 500);

    try {
        const res = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, format, quality: format === 'mp3' ? 'bestaudio' : quality })
        });

        clearInterval(progressInterval);
        progressBar.style.width = '100%';

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Gagal mendownload');
        }

        // Show result
        progressCard.style.display = 'none';
        const resultCard = document.getElementById('downloadResult');
        document.getElementById('resultInfo').textContent = `Ukuran: ${formatFileSize(data.size)}`;
        document.getElementById('resultDownloadLink').href = data.downloadUrl;
        resultCard.style.display = '';
    } catch (err) {
        clearInterval(progressInterval);
        progressCard.style.display = 'none';
        showError(err.message);
    } finally {
        btn.disabled = false;
    }
}

// =============================================
// Transcript Mode Switch
// =============================================
function switchTranscriptMode(mode) {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.mode-btn[data-mode="${mode}"]`).classList.add('active');

    if (mode === 'url') {
        document.getElementById('transcriptUrlMode').style.display = '';
        document.getElementById('transcriptFileMode').style.display = 'none';
    } else {
        document.getElementById('transcriptUrlMode').style.display = 'none';
        document.getElementById('transcriptFileMode').style.display = '';
    }
}

// =============================================
// Transcribe from URL
// =============================================
async function transcribeFromUrl() {
    const url = document.getElementById('transcriptUrl').value.trim();
    if (!url) {
        showError('Masukkan URL terlebih dahulu');
        return;
    }

    const language = document.getElementById('transcriptLang').value;

    showTranscriptProgress('Mendownload audio dari URL...');

    try {
        const res = await fetch('/api/transcribe-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, language })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Gagal mentranskrip');
        }

        currentTranscript = data;
        showTranscriptResult(data);
    } catch (err) {
        hideTranscriptProgress();
        showError(err.message);
    }
}

// =============================================
// Transcribe from File
// =============================================
async function transcribeFromFile() {
    if (!selectedFile) {
        showError('Pilih file terlebih dahulu');
        return;
    }

    const language = document.getElementById('transcriptFileLang').value;

    showTranscriptProgress('Mengupload dan memproses file...');

    try {
        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('language', language);

        const res = await fetch('/api/transcribe-file', {
            method: 'POST',
            body: formData
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Gagal mentranskrip');
        }

        currentTranscript = data;
        showTranscriptResult(data);
    } catch (err) {
        hideTranscriptProgress();
        showError(err.message);
    }
}

// =============================================
// Transcript Display
// =============================================
function showTranscriptProgress(text) {
    const el = document.getElementById('transcriptProgress');
    document.getElementById('transcriptProgressText').textContent = text;
    el.style.display = '';
    document.getElementById('transcriptResult').style.display = 'none';
}

function hideTranscriptProgress() {
    document.getElementById('transcriptProgress').style.display = 'none';
}

function showTranscriptResult(data) {
    hideTranscriptProgress();

    const result = document.getElementById('transcriptResult');
    document.getElementById('detectedLang').textContent = data.language || 'auto';
    document.getElementById('transcriptFull').textContent = data.text;

    // Build segments
    const segmentsEl = document.getElementById('transcriptSegments');
    segmentsEl.innerHTML = '';

    if (data.segments && data.segments.length > 0) {
        data.segments.forEach(seg => {
            const row = document.createElement('div');
            row.className = 'segment-row';
            row.innerHTML = `
        <span class="segment-time">${formatTime(seg.start)} → ${formatTime(seg.end)}</span>
        <span class="segment-text">${escapeHtml(seg.text)}</span>
      `;
            segmentsEl.appendChild(row);
        });
    }

    result.style.display = '';
}

function switchTranscriptView(view) {
    document.querySelectorAll('.transcript-tab').forEach(t => t.classList.remove('active'));
    if (view === 'full') {
        document.getElementById('transcriptFull').style.display = '';
        document.getElementById('transcriptSegments').style.display = 'none';
        document.querySelectorAll('.transcript-tab')[0].classList.add('active');
    } else {
        document.getElementById('transcriptFull').style.display = 'none';
        document.getElementById('transcriptSegments').style.display = '';
        document.querySelectorAll('.transcript-tab')[1].classList.add('active');
    }
}

// =============================================
// Copy & Download Transcript
// =============================================
function copyTranscript() {
    if (!currentTranscript) return;
    navigator.clipboard.writeText(currentTranscript.text).then(() => {
        showToast('Transkrip berhasil disalin! ✅');
    }).catch(() => {
        showError('Gagal menyalin teks');
    });
}

function downloadTranscript() {
    if (!currentTranscript) return;

    let text = currentTranscript.text + '\n\n';
    if (currentTranscript.segments) {
        text += '--- Timestamps ---\n\n';
        currentTranscript.segments.forEach(seg => {
            text += `[${formatTime(seg.start)} - ${formatTime(seg.end)}] ${seg.text}\n`;
        });
    }

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('File transkrip tersimpan! 📄');
}

// =============================================
// Error & Toast Helpers
// =============================================
function showError(msg) {
    const el = document.getElementById('errorCard');
    document.getElementById('errorText').textContent = msg;
    el.style.display = '';
}

function hideError() {
    document.getElementById('errorCard').style.display = 'none';
}

function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = `toast show ${type}`;
    setTimeout(() => {
        toast.className = 'toast';
    }, 3000);
}

// =============================================
// Utility Functions
// =============================================
function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

function formatDuration(seconds) {
    if (!seconds) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// =============================================
// Enter key shortcut on URL inputs
// =============================================
document.getElementById('downloadUrl')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchInfo();
});

document.getElementById('transcriptUrl')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') transcribeFromUrl();
});

// =============================================
// Boot Animation Tab Logic
// =============================================
let bootAnimFile = null;
const bootAnimUploadZone = document.getElementById('bootAnimUploadZone');
const bootAnimFileInput = document.getElementById('bootAnimFileInput');

if (bootAnimUploadZone) {
    bootAnimUploadZone.addEventListener('click', () => bootAnimFileInput.click());

    bootAnimUploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        bootAnimUploadZone.classList.add('dragover');
    });

    bootAnimUploadZone.addEventListener('dragleave', () => {
        bootAnimUploadZone.classList.remove('dragover');
    });

    bootAnimUploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        bootAnimUploadZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleBootAnimFileSelect(e.dataTransfer.files[0]);
        }
    });
}

if (bootAnimFileInput) {
    bootAnimFileInput.addEventListener('change', () => {
        if (bootAnimFileInput.files.length > 0) {
            handleBootAnimFileSelect(bootAnimFileInput.files[0]);
        }
    });
}

function handleBootAnimFileSelect(file) {
    bootAnimFile = file;
    document.getElementById('bootAnimFileName').textContent = file.name;
    document.getElementById('bootAnimFileSize').textContent = formatFileSize(file.size);
    document.getElementById('bootAnimFileSelected').style.display = 'flex';
    bootAnimUploadZone.style.display = 'none';
}

function removeBootAnimFile() {
    bootAnimFile = null;
    bootAnimFileInput.value = '';
    document.getElementById('bootAnimFileSelected').style.display = 'none';
    bootAnimUploadZone.style.display = '';
}

async function createBootAnimation() {
    if (!bootAnimFile) {
        showError('Pilih file video terlebih dahulu');
        return;
    }

    const name = document.getElementById('bootAnimName').value.trim() || 'CustomBootAnim';
    const width = document.getElementById('bootAnimWidth').value;
    const height = document.getElementById('bootAnimHeight').value;
    const fps = document.getElementById('bootAnimFps').value;
    const loop = document.getElementById('bootAnimLoop').value;

    const progress = document.getElementById('bootAnimProgress');
    const result = document.getElementById('bootAnimResult');

    progress.style.display = '';
    result.style.display = 'none';
    hideError();

    try {
        const formData = new FormData();
        formData.append('file', bootAnimFile);
        formData.append('name', name);
        formData.append('width', width);
        formData.append('height', height);
        formData.append('fps', fps);
        formData.append('loop', loop);

        const res = await fetch('/api/bootanimation', {
            method: 'POST',
            body: formData
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Gagal membuat boot animation');
        }

        progress.style.display = 'none';
        document.getElementById('bootAnimResultInfo').textContent = `Resolusi: ${data.resolution} | FPS: ${data.fps} | Frames: ${data.frames}`;
        document.getElementById('bootAnimDownloadLink').href = data.downloadUrl;
        result.style.display = 'block';
        showToast('Magisk Module berhasil dibuat! 🎁');
    } catch (err) {
        progress.style.display = 'none';
        showError(err.message);
    }
}
