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
  const expressApp = await getApp();

  const url = new URL(request.url);
  const bodyBuffer =
    request.method !== 'GET' && request.method !== 'DELETE'
      ? Buffer.from(await request.arrayBuffer())
      : Buffer.alloc(0);

  return new Promise((resolve) => {
    const { IncomingMessage, ServerResponse } = require('http');
    const { Socket } = require('net');

    const socket = new Socket();
    const req = new IncomingMessage(socket);
    req.method = request.method;
    req.url = url.pathname + url.search;

    // Copy all headers
    request.headers.forEach((value, key) => {
      req.headers[key] = value;
    });
    req.headers['content-length'] = String(bodyBuffer.length);

    const res = new ServerResponse(req);
    const chunks = [];

    res.write = (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    };

    res.end = (chunk) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const rawHeaders = res.getHeaders();
      const headers = {};
      for (const [k, v] of Object.entries(rawHeaders)) {
        headers[k] = String(v);
      }
      resolve(new Response(body, { status: res.statusCode, headers }));
    };

    expressApp(req, res);

    // Push body into the request stream
    if (bodyBuffer.length > 0) {
      req.push(bodyBuffer);
    }
    req.push(null);
  });
}

export async function GET(request) { return handler(request); }
export async function POST(request) { return handler(request); }
export async function PUT(request) { return handler(request); }
export async function DELETE(request) { return handler(request); }
