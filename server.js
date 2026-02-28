import express from 'express';
import multer from 'multer';
import { execFile, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Ensure directories exist
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const TRANSCRIPTS_DIR = path.join(__dirname, 'transcripts');
[DOWNLOADS_DIR, UPLOADS_DIR, TRANSCRIPTS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Multer config for file uploads (transcription)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${randomUUID()}${ext}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
    fileFilter: (req, file, cb) => {
        const allowed = /\.(mp4|mkv|avi|mov|webm|mp3|wav|ogg|m4a|flac|aac)$/i;
        if (allowed.test(path.extname(file.originalname))) {
            cb(null, true);
        } else {
            cb(new Error('Format file tidak didukung'));
        }
    }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/downloads', express.static(DOWNLOADS_DIR));

// ============================================================
// GET VIDEO INFO (for preview before download)
// ============================================================
app.post('/api/info', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL diperlukan' });

    try {
        const info = await getVideoInfo(url);
        res.json(info);
    } catch (err) {
        console.error('Info error:', err);
        res.status(500).json({ error: err.message || 'Gagal mengambil info video' });
    }
});

// ============================================================
// DOWNLOAD VIDEO
// ============================================================
app.post('/api/download', async (req, res) => {
    const { url, format, quality } = req.body;
    if (!url) return res.status(400).json({ error: 'URL diperlukan' });

    try {
        const result = await downloadMedia(url, format || 'mp4', quality || 'best');
        res.json(result);
    } catch (err) {
        console.error('Download error:', err);
        res.status(500).json({ error: err.message || 'Gagal mendownload' });
    }
});

// ============================================================
// TRANSCRIBE FROM URL
// ============================================================
app.post('/api/transcribe-url', async (req, res) => {
    const { url, language } = req.body;
    if (!url) return res.status(400).json({ error: 'URL diperlukan' });

    try {
        // First download the audio
        const downloadResult = await downloadMedia(url, 'mp3', 'bestaudio');
        const audioPath = downloadResult.filepath;

        // Then transcribe
        const transcript = await transcribeAudio(audioPath, language || 'auto');
        res.json(transcript);
    } catch (err) {
        console.error('Transcribe URL error:', err);
        res.status(500).json({ error: err.message || 'Gagal mentranskrip' });
    }
});

// ============================================================
// TRANSCRIBE FROM FILE UPLOAD
// ============================================================
app.post('/api/transcribe-file', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'File diperlukan' });

    try {
        const language = req.body.language || 'auto';
        const transcript = await transcribeAudio(req.file.path, language);
        res.json(transcript);
    } catch (err) {
        console.error('Transcribe file error:', err);
        res.status(500).json({ error: err.message || 'Gagal mentranskrip' });
    }
});

// ============================================================
// CREATE BOOT ANIMATION (from uploaded video)
// ============================================================
const BOOTANIM_DIR = path.join(__dirname, 'bootanim_work');
const TEMPLATE_DIR = path.join(__dirname, 'cyberpunkt_cool_modules');
if (!fs.existsSync(BOOTANIM_DIR)) fs.mkdirSync(BOOTANIM_DIR, { recursive: true });

app.post('/api/bootanimation', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'File video diperlukan' });

    const width = parseInt(req.body.width) || 1080;
    const height = parseInt(req.body.height) || 1920;
    const fps = parseInt(req.body.fps) || 24;
    const loop = parseInt(req.body.loop) || 0; // 0 = infinite
    const moduleName = req.body.name || 'CustomBootAnimation';

    const jobId = randomUUID();
    const workDir = path.join(BOOTANIM_DIR, jobId);
    const framesDir = path.join(workDir, 'part0');
    fs.mkdirSync(framesDir, { recursive: true });

    try {
        console.log(`[BootAnim] Starting job ${jobId}: ${width}x${height} @ ${fps}fps`);

        // Step 1: Extract frames from video using ffmpeg
        await new Promise((resolve, reject) => {
            const args = [
                '-i', req.file.path,
                '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
                '-r', String(fps),
                '-q:v', '4', // Sedikit diturunkan kualitasnya (2 -> 4) biar sizenya jauh lebih kecil
                path.join(framesDir, '%05d.jpg')
            ];

            console.log('[BootAnim] ffmpeg args:', args);
            const proc = spawn('ffmpeg', args, { timeout: 300000 });
            let stderr = '';
            proc.stderr.on('data', d => { stderr += d.toString(); });
            proc.on('close', code => {
                if (code !== 0) return reject(new Error(`ffmpeg failed: ${stderr.slice(-500)}`));
                resolve();
            });
            proc.on('error', err => reject(err));
        });

        // Count extracted frames
        const frames = fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg'));
        if (frames.length === 0) {
            throw new Error('Tidak ada frame yang berhasil di-extract dari video');
        }
        console.log(`[BootAnim] Extracted ${frames.length} frames`);

        // Step 2: Create desc.txt
        const descContent = `${width} ${height} ${fps}\np ${loop} 0 part0\n`;
        fs.writeFileSync(path.join(workDir, 'desc.txt'), descContent);

        // Step 3: Create bootanimation.zip (Now with compression)
        const bootanimZipPath = path.join(workDir, 'bootanimation.zip');
        await createBootanimZip(workDir, bootanimZipPath);

        // Step 4: Create Magisk module ZIP
        const moduleZipPath = path.join(DOWNLOADS_DIR, `${jobId}-bootanimation-module.zip`);
        await createMagiskModuleZip(bootanimZipPath, moduleZipPath, moduleName, width, height, fps);

        // Cleanup work directory
        fs.rmSync(workDir, { recursive: true, force: true });

        const stat = fs.statSync(moduleZipPath);
        const filename = path.basename(moduleZipPath);

        console.log(`[BootAnim] Module created: ${filename} (${stat.size} bytes)`);

        res.json({
            filename,
            size: stat.size,
            frames: frames.length,
            resolution: `${width}x${height}`,
            fps,
            downloadUrl: `/api/file/${encodeURIComponent(filename)}`
        });
    } catch (err) {
        console.error('[BootAnim] Error:', err);
        // Cleanup on error
        try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { }
        res.status(500).json({ error: err.message || 'Gagal membuat boot animation' });
    }
});

// Helper: Create bootanimation.zip using Python zipfile (Now with compression)
function createBootanimZip(workDir, outputPath) {
    return new Promise((resolve, reject) => {
        const script = `
import zipfile, os, sys
work_dir = sys.argv[1]
output = sys.argv[2]
# Using ZIP_DEFLATED for compression
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as zf:
    zf.write(os.path.join(work_dir, 'desc.txt'), 'desc.txt')
    part0 = os.path.join(work_dir, 'part0')
    frames = sorted([f for f in os.listdir(part0) if f.endswith('.jpg')])
    for f in frames:
        zf.write(os.path.join(part0, f), f'part0/{f}')
print(f'OK: {len(frames)} frames zipped with compression')
`;
        const proc = spawn('python', ['-c', script, workDir, outputPath], { timeout: 120000 });
        let stderr = '';
        proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.stdout.on('data', d => { console.log('[BootAnim zip]', d.toString().trim()); });
        proc.on('close', code => {
            if (code !== 0) return reject(new Error(`Zip creation failed: ${stderr}`));
            resolve();
        });
        proc.on('error', err => reject(err));
    });
}

// Helper: Create full Magisk module ZIP
function createMagiskModuleZip(bootanimZipPath, outputPath, moduleName, width, height, fps) {
    return new Promise((resolve, reject) => {
        const templateDir = TEMPLATE_DIR;
        const script = `
import zipfile, os, sys, shutil

bootanim_zip = sys.argv[1]
output = sys.argv[2]
template_dir = sys.argv[3]
module_name = sys.argv[4]

with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as zf:
    # module.prop
    prop = f"""id=CustomBootanimation
name={module_name}
version=v1.0
versionCode=1
author=MediaKit
description=Custom Boot Animation - {module_name}
"""
    zf.writestr('module.prop', prop)

    # META-INF (required for Magisk)
    meta_inf = os.path.join(template_dir, 'META-INF')
    if os.path.exists(meta_inf):
        for root, dirs, files in os.walk(meta_inf):
            for f in files:
                full = os.path.join(root, f)
                arc = os.path.relpath(full, template_dir)
                zf.write(full, arc)

    # customize.sh
    customize_src = os.path.join(template_dir, 'customize.sh')
    if os.path.exists(customize_src):
        zf.write(customize_src, 'customize.sh')

    # uninstall.sh
    uninstall_src = os.path.join(template_dir, 'uninstall.sh')
    if os.path.exists(uninstall_src):
        zf.write(uninstall_src, 'uninstall.sh')

    # common/functions.sh
    func_src = os.path.join(template_dir, 'common', 'functions.sh')
    if os.path.exists(func_src):
        zf.write(func_src, 'common/functions.sh')

    # common/install.sh
    install_src = os.path.join(template_dir, 'common', 'install.sh')
    if os.path.exists(install_src):
        zf.write(install_src, 'common/install.sh')

    # common/COOLBOOT binary
    coolboot_src = os.path.join(template_dir, 'common', 'COOLBOOT')
    if os.path.exists(coolboot_src):
        zf.write(coolboot_src, 'common/COOLBOOT')

    # common/cool_modules/bootanimation.zip (our custom one)
    zf.write(bootanim_zip, 'common/cool_modules/bootanimation.zip')

    # common/cool_modules/bootaudio.mp3 (from template if exists)
    audio_src = os.path.join(template_dir, 'common', 'cool_modules', 'bootaudio.mp3')
    if os.path.exists(audio_src):
        zf.write(audio_src, 'common/cool_modules/bootaudio.mp3')

print('OK: Magisk module created')
`;
        const proc = spawn('python', ['-c', script, bootanimZipPath, outputPath, templateDir, moduleName], { timeout: 120000 });
        let stderr = '';
        proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.stdout.on('data', d => { console.log('[BootAnim module]', d.toString().trim()); });
        proc.on('close', code => {
            if (code !== 0) return reject(new Error(`Module creation failed: ${stderr}`));
            resolve();
        });
        proc.on('error', err => reject(err));
    });
}

// ============================================================
// SERVE DOWNLOADED FILE
// ============================================================
app.get('/api/file/:filename', (req, res) => {
    const filepath = path.join(DOWNLOADS_DIR, req.params.filename);
    if (!fs.existsSync(filepath)) {
        return res.status(404).json({ error: 'File tidak ditemukan' });
    }
    res.download(filepath);
});

// ============================================================
// CLEANUP old files (runs every hour)
// ============================================================
setInterval(() => {
    const maxAge = 60 * 60 * 1000; // 1 hour
    [DOWNLOADS_DIR, UPLOADS_DIR, TRANSCRIPTS_DIR].forEach(dir => {
        if (!fs.existsSync(dir)) return;
        fs.readdirSync(dir).forEach(file => {
            const filepath = path.join(dir, file);
            const stat = fs.statSync(filepath);
            if (Date.now() - stat.mtimeMs > maxAge) {
                fs.unlinkSync(filepath);
            }
        });
    });
}, 60 * 60 * 1000);

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getVideoInfo(url) {
    return new Promise((resolve, reject) => {
        const args = [
            '--dump-json',
            '--no-download',
            '--no-warnings',
            url
        ];

        execFile('yt-dlp', args, { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }, (err, stdout, stderr) => {
            if (err) {
                return reject(new Error(stderr || err.message));
            }

            try {
                // Handle playlists / multiple entries - take the first one
                const lines = stdout.trim().split('\n');
                const data = JSON.parse(lines[0]);

                const info = {
                    title: data.title || 'Untitled',
                    thumbnail: data.thumbnail || data.thumbnails?.[data.thumbnails.length - 1]?.url || '',
                    duration: data.duration || 0,
                    uploader: data.uploader || data.channel || 'Unknown',
                    platform: detectPlatform(url),
                    formats: [],
                    description: (data.description || '').substring(0, 300),
                    is_photo: false
                };

                // Check if it's TikTok slideshow / photo
                if (data.entries || data._type === 'playlist') {
                    info.is_photo = true;
                }

                // Extract useful formats
                if (data.formats) {
                    const seen = new Set();
                    data.formats
                        .filter(f => f.ext && f.format_note)
                        .forEach(f => {
                            const key = `${f.ext}-${f.format_note}`;
                            if (!seen.has(key)) {
                                seen.add(key);
                                info.formats.push({
                                    format_id: f.format_id,
                                    ext: f.ext,
                                    quality: f.format_note,
                                    filesize: f.filesize || f.filesize_approx || 0,
                                    resolution: f.resolution || `${f.width || '?'}x${f.height || '?'}`,
                                    has_audio: f.acodec !== 'none',
                                    has_video: f.vcodec !== 'none'
                                });
                            }
                        });
                }

                resolve(info);
            } catch (e) {
                reject(new Error('Gagal parse info video'));
            }
        });
    });
}

function downloadMedia(url, format, quality) {
    return new Promise((resolve, reject) => {
        const id = randomUUID();
        let outputTemplate;
        const args = ['--no-warnings', '--no-playlist'];

        if (format === 'mp3') {
            outputTemplate = path.join(DOWNLOADS_DIR, `${id}.%(ext)s`);
            args.push(
                '-x',
                '--audio-format', 'mp3',
                '--audio-quality', '0',
                '-o', outputTemplate,
                url
            );
        } else {
            outputTemplate = path.join(DOWNLOADS_DIR, `${id}.%(ext)s`);

            if (quality === 'best') {
                args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
            } else if (quality === '1080') {
                args.push('-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best');
            } else if (quality === '720') {
                args.push('-f', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best');
            } else if (quality === '480') {
                args.push('-f', 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best');
            } else if (quality === '360') {
                args.push('-f', 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360][ext=mp4]/best');
            } else if (quality === 'bestaudio') {
                args.push('-f', 'bestaudio', '-x', '--audio-format', 'mp3', '--audio-quality', '0');
            } else {
                args.push('-f', 'best');
            }

            args.push(
                '--merge-output-format', 'mp4',
                '-o', outputTemplate,
                url
            );
        }

        console.log('yt-dlp args:', args);

        const proc = spawn('yt-dlp', args, { timeout: 300000 });

        let stderr = '';
        let stdout = '';

        proc.stdout.on('data', d => { stdout += d.toString(); });
        proc.stderr.on('data', d => { stderr += d.toString(); });

        proc.on('close', code => {
            if (code !== 0) {
                return reject(new Error(stderr || `yt-dlp exited with code ${code}`));
            }

            // Find the actual downloaded file
            const files = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.startsWith(id));
            if (files.length === 0) {
                return reject(new Error('File download tidak ditemukan'));
            }

            const filename = files[0];
            const filepath = path.join(DOWNLOADS_DIR, filename);
            const stat = fs.statSync(filepath);

            resolve({
                filename,
                filepath,
                size: stat.size,
                downloadUrl: `/api/file/${encodeURIComponent(filename)}`
            });
        });

        proc.on('error', err => {
            reject(new Error(`Gagal menjalankan yt-dlp: ${err.message}`));
        });
    });
}

function transcribeAudio(audioPath, language) {
    return new Promise((resolve, reject) => {
        const args = [
            '-m', 'whisper',
            audioPath,
            '--model', 'base',
            '--output_format', 'json',
            '--output_dir', TRANSCRIPTS_DIR,
            '--verbose', 'False'
        ];

        if (language && language !== 'auto') {
            args.push('--language', language);
        }

        console.log('Whisper args:', args);

        const proc = spawn('python', args, { timeout: 600000 });

        let stderr = '';
        let stdout = '';

        proc.stdout.on('data', d => {
            stdout += d.toString();
            console.log('Whisper stdout:', d.toString());
        });

        proc.stderr.on('data', d => {
            stderr += d.toString();
            // Whisper logs progress to stderr
            console.log('Whisper:', d.toString().trim());
        });

        proc.on('close', code => {
            if (code !== 0) {
                return reject(new Error(stderr || `Whisper exited with code ${code}`));
            }

            // Find transcript JSON file
            const baseName = path.basename(audioPath, path.extname(audioPath));
            const jsonPath = path.join(TRANSCRIPTS_DIR, `${baseName}.json`);

            if (!fs.existsSync(jsonPath)) {
                // Try to find any matching file
                const files = fs.readdirSync(TRANSCRIPTS_DIR).filter(f => f.includes(baseName) && f.endsWith('.json'));
                if (files.length > 0) {
                    const data = JSON.parse(fs.readFileSync(path.join(TRANSCRIPTS_DIR, files[0]), 'utf-8'));
                    return resolve(formatTranscript(data));
                }
                return reject(new Error('File transkrip tidak ditemukan'));
            }

            try {
                const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
                resolve(formatTranscript(data));
            } catch (e) {
                reject(new Error('Gagal membaca transkrip'));
            }
        });

        proc.on('error', err => {
            reject(new Error(`Gagal menjalankan Whisper: ${err.message}`));
        });
    });
}

function formatTranscript(data) {
    const segments = data.segments || [];
    const fullText = data.text || segments.map(s => s.text).join(' ');

    return {
        text: fullText.trim(),
        language: data.language || 'unknown',
        segments: segments.map(s => ({
            start: s.start,
            end: s.end,
            text: s.text.trim()
        }))
    };
}

function detectPlatform(url) {
    if (/tiktok\.com/i.test(url)) return 'tiktok';
    if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
    if (/instagram\.com/i.test(url)) return 'instagram';
    if (/twitter\.com|x\.com/i.test(url)) return 'twitter';
    if (/facebook\.com|fb\.watch/i.test(url)) return 'facebook';
    return 'other';
}

function formatDuration(seconds) {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
    console.log(`\n🚀 Media Toolkit running at http://localhost:${PORT}\n`);
});
