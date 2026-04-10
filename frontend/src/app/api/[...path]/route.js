export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const express = require('express');
const cors = require('cors');

let app = null;

async function getApp() {
  if (app) return app;

  const { initDB } = require('../../../lib/server/db');
  const authRoutes = require('../../../lib/server/routes/auth');
  const productRoutes = require('../../../lib/server/routes/products');
  const orderRoutes = require('../../../lib/server/routes/orders');
  const categoryRoutes = require('../../../lib/server/routes/categories');
  const bundleRoutes = require('../../../lib/server/routes/bundles');

  app = express();
  app.use(cors({ origin: '*', credentials: true }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/api/admin', authRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/categories', categoryRoutes);
  app.use('/api/bundles', bundleRoutes);
  app.get('/api/health', (req, res) => res.json({ status: 'OK' }));

  await initDB();
  return app;
}

async function handler(request) {
  try {
    const expressApp = await getApp();
    const { ServerResponse } = require('http');
    const { Readable } = require('stream');

    const url = new URL(request.url);
    const bodyText =
      request.method !== 'GET' && request.method !== 'DELETE'
        ? await request.text()
        : '';

    const req = Object.assign(Readable.from([Buffer.from(bodyText)]), {
      method: request.method,
      url: url.pathname + url.search,
      headers: Object.fromEntries(request.headers),
    });

    return new Promise((resolve) => {
      const chunks = [];
      const res = new ServerResponse(req);
      res.write = (chunk) => { chunks.push(Buffer.from(chunk)); return true; };
      res.end = (chunk) => {
        if (chunk) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks);
        const rawHeaders = res.getHeaders();
        const headers = Object.fromEntries(
          Object.entries(rawHeaders).map(([k, v]) => [k, String(v)])
        );
        resolve(new Response(body, { status: res.statusCode, headers }));
      };
      expressApp(req, res);
    });
  } catch (error) {
    console.error('API Error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request) { return handler(request); }
export async function POST(request) { return handler(request); }
export async function PUT(request) { return handler(request); }
export async function DELETE(request) { return handler(request); }
