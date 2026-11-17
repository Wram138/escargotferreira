import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AppStore } from './src/config/store.js';
import { NewsAggregator } from './src/services/aggregator.js';
import { createApiRouter } from './src/routes/api.js';
import { checkLayaHealth } from './src/services/laya.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_TEMPLATE_PATH = path.join(__dirname, 'public', 'index.html');

function serializeInlineJson(data) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function createApp(options = {}) {
  const store = options.store || new AppStore(options.dataDir);
  const aggregator = options.aggregator || new NewsAggregator(store, options.aggregatorDeps);
  const app = express();
  const indexHtmlTemplate = fs.readFileSync(INDEX_TEMPLATE_PATH, 'utf-8');

  app.use(express.json({ limit: '1mb' }));
  app.use('/api', createApiRouter({ store, aggregator, ...options.apiDeps }));
  app.use(
    express.static(path.join(__dirname, 'public'), {
      index: false,
      etag: true,
      setHeaders: (res, filePath) => {
        if (/\.(html|js|css)$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      }
    })
  );

  app.get(['/configuracoes', '/configuracoes.html'], (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, 'public', 'configuracoes.html'));
  });

  app.get('*', (_req, res) => {
    const view = aggregator.getClassifiedView();
    const bulletin = store.getBulletinQueue();
    const bootstrapScript = `<script>window.__INITIAL_NEWS__=${serializeInlineJson(
      view
    )};window.__INITIAL_BULLETIN__=${serializeInlineJson(bulletin)};</script>`;
    const html = indexHtmlTemplate.replace('</head>', `${bootstrapScript}\n</head>`);
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(html);
  });

  app.use((err, _req, res, _next) => {
    console.error('[server]', err);
    res.status(500).json({ error: err.message || 'Erro interno do servidor.' });
  });

  return { app, store, aggregator };
}

async function waitForLayaAndClassify(store, aggregator, child = null) {
  const layaCfg = store.getSettings().laya || {};
  if (!layaCfg.enabled || !layaCfg.endpointUrl) return;

  for (let i = 0; i < 90; i++) {
    if (child && (child.killed || child.exitCode !== null)) break;
    const h = await checkLayaHealth(layaCfg.endpointUrl, layaCfg.apiKey);
    if (h.online) {
      console.log(`[laya] Serviço pronto em ${layaCfg.endpointUrl}! Iniciando classificação das pautas.`);
      aggregator.layaOnline = true;
      aggregator.layaLastError = null;
      await aggregator.classifyPendingWithLaya();
      return;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function ensureLocalLayaService(store, aggregator) {
  const layaCfg = store.getSettings().laya || {};
  if (!layaCfg.enabled) return null;

  let parsedUrl;
  try {
    parsedUrl = new URL(layaCfg.endpointUrl || 'http://127.0.0.1:8001');
  } catch {
    return null;
  }

  const existing = await checkLayaHealth(parsedUrl.origin, layaCfg.apiKey);
  if (existing.online) {
    console.log(`[laya] Serviço já ativo em ${parsedUrl.origin}`);
    aggregator.layaOnline = true;
    aggregator.classifyPendingWithLaya().catch(() => {});
    return null;
  }

  const isLocal = parsedUrl.hostname === '127.0.0.1' || parsedUrl.hostname === 'localhost';
  if (!isLocal || !layaCfg.autoStartLocalService) {
    console.log(`[laya] Aguardando serviço externo em ${parsedUrl.origin}…`);
    waitForLayaAndClassify(store, aggregator).catch(() => {});
    return null;
  }

  const venvPython = path.join(__dirname, '.venv', 'bin', 'python');
  if (!fs.existsSync(venvPython)) {
    console.log('[laya] Ambiente .venv não encontrado; operando com heurística local.');
    return null;
  }

  const port = parsedUrl.port || '8001';
  console.log(`[laya] Iniciando Laya AI (laya-multilingual) em ${parsedUrl.origin}…`);
  const child = spawn(venvPython, ['-m', 'laya.serve'], {
    cwd: __dirname,
    env: {
      ...process.env,
      LAYA_HOST: parsedUrl.hostname,
      LAYA_PORT: String(port),
      LAYA_DEVICE: process.env.LAYA_DEVICE || 'cpu',
      LAYA_MODELS: process.env.LAYA_MODELS || 'multilingual',
      LAYA_DEFAULT_MODEL: process.env.LAYA_DEFAULT_MODEL || 'multilingual',
      LAYA_THREADS: process.env.LAYA_THREADS || '2',
      LAYA_PRELOAD: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line) console.log(`[laya] ${line}`);
  });
  child.stderr.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line && /error|uvicorn running|loaded/i.test(line)) {
      console.log(`[laya] ${line}`);
    }
  });
  child.on('exit', (code) => {
    aggregator.layaOnline = false;
    console.log(`[laya] Processo encerrado (código ${code})`);
  });

  waitForLayaAndClassify(store, aggregator, child).catch(() => {});

  return child;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const PORT = Number(process.env.PORT || 3000);
  const { app, store, aggregator } = createApp();
  let layaChild = null;

  const server = app.listen(PORT, async () => {
    console.log(`Ronda Jornalística Natal/RN rodando em http://localhost:${PORT}`);
    layaChild = await ensureLocalLayaService(store, aggregator);

    // Background initial warm-up if cache is empty or older than refresh interval
    const lastSync = aggregator.cache.lastSyncAt ? new Date(aggregator.cache.lastSyncAt).getTime() : 0;
    const intervalMs = (store.getSettings().editorial.refreshIntervalMinutes || 15) * 60 * 1000;
    if (!lastSync || Date.now() - lastSync > intervalMs) {
      aggregator.refresh({ triggerAutoSend: false }).catch((err) => {
        console.error('[startup-refresh] Erro:', err.message);
      });
    } else {
      aggregator.classifyPendingWithLaya().catch(() => {});
    }
  });

  // Periodic background refresh respecting configured interval
  let timer = null;
  const scheduleNext = () => {
    const mins = store.getSettings().editorial.refreshIntervalMinutes || 15;
    timer = setTimeout(async () => {
      try {
        await aggregator.refresh({ triggerAutoSend: true });
      } catch (err) {
        console.error('[scheduled-refresh] Erro:', err.message);
      }
      scheduleNext();
    }, mins * 60 * 1000);
    timer.unref();
  };
  scheduleNext();

  const shutdown = () => {
    if (timer) clearTimeout(timer);
    if (layaChild && !layaChild.killed) {
      layaChild.kill('SIGTERM');
    }
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
