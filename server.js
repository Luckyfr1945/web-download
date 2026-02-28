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

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const TRANSCRIPTS_DIR = path.join(__dirname, 'transcripts');
[DOWNLOADS_DIR, UPLOADS_DIR, TRANSCRIPTS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${randomUUID()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedExts.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Format file tidak didukung'));
        }
    }
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/downloads', express.static(DOWNLOADS_DIR));

function isValidUrl(str) {
    try {
        const url = new URL(str);
        return ['http:', 'https:'].includes(url.protocol);
    } catch {
        return false;
    }
}

function sanitizeFilename(filename) {
    return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function resolveSecurePath(baseDir, filename) {
    const safeName = path.basename(filename);
    const resolved = path.join(baseDir, safeName);
    if (!resolved.startsWith(path.resolve(baseDir))) {
        return null;
    }
    return resolved;
}

app.post('/api/info', async (req, res) => {
    const { url } = req.body;
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL diperlukan' });
    if (!isValidUrl(url)) return res.status(400).json({ error: 'URL tidak valid' });

    try {
        const info = await getVideoInfo(url);
        res.json(info);
    } catch (err) {
        console.error('Info error:', err.message);
        res.status(500).json({ error: 'Gagal mengambil info video' });
    }
});

app.post('/api/download', async (req, res) => {
    const { url, format, quality } = req.body;
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL diperlukan' });
    if (!isValidUrl(url)) return res.status(400).json({ error: 'URL tidak valid' });

    const allowedFormats = ['mp4', 'mp3'];
    const allowedQualities = ['best', '1080', '720', '480', '360', 'bestaudio'];
    const safeFormat = allowedFormats.includes(format) ? format : 'mp4';
    const safeQuality = allowedQualities.includes(quality) ? quality : 'best';

    try {
        const result = await downloadMedia(url, safeFormat, safeQuality);
        res.json(result);
    } catch (err) {
        console.error('Download error:', err.message);
        res.status(500).json({ error: 'Gagal mendownload' });
    }
});

app.post('/api/transcribe-url', async (req, res) => {
    const { url, language } = req.body;
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL diperlukan' });
    if (!isValidUrl(url)) return res.status(400).json({ error: 'URL tidak valid' });

    try {
        const downloadResult = await downloadMedia(url, 'mp3', 'bestaudio');
        const audioPath = downloadResult.filepath;
        const safeLanguage = sanitizeLanguage(language);
        const transcript = await transcribeAudio(audioPath, safeLanguage);
        res.json(transcript);
    } catch (err) {
        console.error('Transcribe URL error:', err.message);
        res.status(500).json({ error: 'Gagal mentranskrip' });
    }
});

app.post('/api/transcribe-file', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'File diperlukan' });

    try {
        const safeLanguage = sanitizeLanguage(req.body.language);
        const transcript = await transcribeAudio(req.file.path, safeLanguage);
        res.json(transcript);
    } catch (err) {
        console.error('Transcribe file error:', err.message);
        res.status(500).json({ error: 'Gagal mentranskrip' });
    }
});

const BOOTANIM_DIR = path.join(__dirname, 'bootanim_work');
const TEMPLATE_DIR = path.join(__dirname, 'cyberpunkt_cool_modules');
if (!fs.existsSync(BOOTANIM_DIR)) fs.mkdirSync(BOOTANIM_DIR, { recursive: true });

app.post('/api/bootanimation', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'File video diperlukan' });

    const width = Math.min(Math.max(parseInt(req.body.width) || 1080, 100), 3840);
    const height = Math.min(Math.max(parseInt(req.body.height) || 1920, 100), 3840);
    const fps = Math.min(Math.max(parseInt(req.body.fps) || 24, 1), 120);
    const loop = Math.min(Math.max(parseInt(req.body.loop) || 0, 0), 100);
    const moduleName = sanitizeFilename(req.body.name || 'CustomBootAnimation').substring(0, 64);

    const jobId = randomUUID();
    const workDir = path.join(BOOTANIM_DIR, jobId);
    const framesDir = path.join(workDir, 'part0');
    fs.mkdirSync(framesDir, { recursive: true });

    try {
        console.log(`[BootAnim] Starting job ${jobId}: ${width}x${height} @ ${fps}fps`);

        await new Promise((resolve, reject) => {
            const args = [
                '-i', req.file.path,
                '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
                '-r', String(fps),
                '-q:v', '4',
                path.join(framesDir, '%05d.jpg')
            ];

            const proc = spawn('ffmpeg', args, { timeout: 300000 });
            let stderr = '';
            proc.stderr.on('data', d => { stderr += d.toString(); });
            proc.on('close', code => {
                if (code !== 0) return reject(new Error(`ffmpeg failed: ${stderr.slice(-500)}`));
                resolve();
            });
            proc.on('error', err => reject(err));
        });

        const frames = fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg'));
        if (frames.length === 0) {
            throw new Error('Tidak ada frame yang berhasil di-extract dari video');
        }
        console.log(`[BootAnim] Extracted ${frames.length} frames`);

        const descContent = `${width} ${height} ${fps}\np ${loop} 0 part0\n`;
        fs.writeFileSync(path.join(workDir, 'desc.txt'), descContent);

        const bootanimZipPath = path.join(workDir, 'bootanimation.zip');
        await createBootanimZip(workDir, bootanimZipPath);

        const moduleZipPath = path.join(DOWNLOADS_DIR, `${jobId}-bootanimation-module.zip`);
        await createMagiskModuleZip(bootanimZipPath, moduleZipPath, moduleName, width, height, fps);

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
        console.error('[BootAnim] Error:', err.message);
        try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { }
        res.status(500).json({ error: 'Gagal membuat boot animation' });
    }
});

function createBootanimZip(workDir, outputPath) {
    return new Promise((resolve, reject) => {
        const script = `
import zipfile, os, sys
work_dir = sys.argv[1]
output = sys.argv[2]
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
    prop = f"""id=CustomBootanimation
name={module_name}
version=v1.0
versionCode=1
author=MediaKit
description=Custom Boot Animation - {module_name}
"""
    zf.writestr('module.prop', prop)

    meta_inf = os.path.join(template_dir, 'META-INF')
    if os.path.exists(meta_inf):
        for root, dirs, files in os.walk(meta_inf):
            for f in files:
                full = os.path.join(root, f)
                arc = os.path.relpath(full, template_dir)
                zf.write(full, arc)

    customize_src = os.path.join(template_dir, 'customize.sh')
    if os.path.exists(customize_src):
        zf.write(customize_src, 'customize.sh')

    uninstall_src = os.path.join(template_dir, 'uninstall.sh')
    if os.path.exists(uninstall_src):
        zf.write(uninstall_src, 'uninstall.sh')

    func_src = os.path.join(template_dir, 'common', 'functions.sh')
    if os.path.exists(func_src):
        zf.write(func_src, 'common/functions.sh')

    install_src = os.path.join(template_dir, 'common', 'install.sh')
    if os.path.exists(install_src):
        zf.write(install_src, 'common/install.sh')

    coolboot_src = os.path.join(template_dir, 'common', 'COOLBOOT')
    if os.path.exists(coolboot_src):
        zf.write(coolboot_src, 'common/COOLBOOT')

    zf.write(bootanim_zip, 'common/cool_modules/bootanimation.zip')

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

app.get('/api/file/:filename', (req, res) => {
    const filepath = resolveSecurePath(DOWNLOADS_DIR, req.params.filename);
    if (!filepath || !fs.existsSync(filepath)) {
        return res.status(404).json({ error: 'File tidak ditemukan' });
    }
    res.download(filepath);
});

setInterval(() => {
    const maxAge = 60 * 60 * 1000;
    [DOWNLOADS_DIR, UPLOADS_DIR, TRANSCRIPTS_DIR].forEach(dir => {
        if (!fs.existsSync(dir)) return;
        fs.readdirSync(dir).forEach(file => {
            try {
                const filepath = path.join(dir, file);
                const stat = fs.statSync(filepath);
                if (Date.now() - stat.mtimeMs > maxAge) {
                    if (stat.isFile()) {
                        fs.unlinkSync(filepath);
                    }
                }
            } catch { }
        });
    });
}, 60 * 60 * 1000);

function sanitizeLanguage(lang) {
    const allowedLangs = ['auto', 'id', 'en', 'ja', 'ko', 'zh', 'ar', 'es', 'fr', 'de', 'pt', 'ru', 'hi', 'th', 'vi'];
    if (!lang || typeof lang !== 'string') return 'auto';
    return allowedLangs.includes(lang) ? lang : 'auto';
}

function getVideoInfo(url) {
    return new Promise((resolve, reject) => {
        const args = [
            '--dump-json',
            '--no-download',
            '--no-warnings',
            '--no-exec',
            url
        ];

        execFile('yt-dlp', args, { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }, (err, stdout, stderr) => {
            if (err) {
                return reject(new Error('Gagal mengambil info video'));
            }

            try {
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

                if (data.entries || data._type === 'playlist') {
                    info.is_photo = true;
                }

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
        const args = ['--no-warnings', '--no-playlist', '--no-exec'];

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

        console.log('yt-dlp starting download...');

        const proc = spawn('yt-dlp', args, { timeout: 300000 });

        let stderr = '';
        let stdout = '';

        proc.stdout.on('data', d => { stdout += d.toString(); });
        proc.stderr.on('data', d => { stderr += d.toString(); });

        proc.on('close', code => {
            if (code !== 0) {
                return reject(new Error('Download gagal'));
            }

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
            reject(new Error('Gagal menjalankan yt-dlp'));
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

        console.log('Starting transcription...');

        const proc = spawn('python', args, { timeout: 600000 });

        let stderr = '';
        let stdout = '';

        proc.stdout.on('data', d => {
            stdout += d.toString();
        });

        proc.stderr.on('data', d => {
            stderr += d.toString();
        });

        proc.on('close', code => {
            if (code !== 0) {
                return reject(new Error('Transcription gagal'));
            }

            const baseName = path.basename(audioPath, path.extname(audioPath));
            const jsonPath = path.join(TRANSCRIPTS_DIR, `${baseName}.json`);

            if (!fs.existsSync(jsonPath)) {
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
            reject(new Error('Gagal menjalankan Whisper'));
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

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'Ukuran file terlalu besar (max 500MB)' });
        }
        return res.status(400).json({ error: 'Upload error' });
    }
    if (err) {
        return res.status(400).json({ error: err.message || 'Terjadi kesalahan' });
    }
    next();
});

app.listen(PORT, () => {
    console.log(`\n🚀 Media Toolkit running at http://localhost:${PORT}\n`);
});
