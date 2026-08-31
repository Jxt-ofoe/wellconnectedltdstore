export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { checkRateLimit } from '../../../lib/server/rateLimit';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');

let _mod = null;
function getDB() {
  if (!_mod) _mod = require('../../../lib/server/db');
  return _mod;
}

let dbReady = false;
async function ensureDB() {
  if (!dbReady) {
    await getDB().initDB();
    dbReady = true;
  }
}

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

function getClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') || '127.0.0.1';
}

function verifyAdmin(request) {
  const auth = request.headers.get('authorization');
  const token = auth ? auth.split(' ')[1] : null;
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.role === 'admin' ? decoded : null;
  } catch {
    return null;
  }
}

function generateOrderReference() {
  const d = new Date();
  const ts = d.getTime().toString().slice(-6);
  const rand = Math.floor(Math.random() * 100).toString().padStart(2, '0');
  return `WC-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${ts}${rand}`;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[+]?[\d\s-]{7,20}$/;

async function routeRequest(request, params) {
  await ensureDB();
  const db = getDB().db;

  const { path } = await params;
  const route = path.join('/');
  const method = request.method;
  const clientIp = getClientIp(request);

  let body = {};
  if (method !== 'GET' && method !== 'DELETE') {
    try { body = await request.json(); } catch {}
  }

  // POST /api/admin/login
  if (route === 'admin/login' && method === 'POST') {
    // Rate limit: 5 attempts per 15 minutes per IP
    const rl = checkRateLimit(`login:${clientIp}`, { limit: 5, windowMs: 15 * 60 * 1000 });
    if (!rl.allowed) {
      return json({ error: `Too many login attempts. Please try again in ${rl.retryAfterSeconds} seconds.` }, 429);
    }

    const { email, password } = body;
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return json({ error: 'Valid email and password required' }, 400);
    }

    const trimmedEmail = email.trim().toLowerCase();
    const result = await db.execute({ 
      sql: 'SELECT id, email, password, role FROM users WHERE email = ?', 
      args: [trimmedEmail] 
    });

    if (!result.rows.length) {
      return json({ error: 'Invalid email or password.' }, 401);
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return json({ error: 'Invalid email or password.' }, 401);
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    return json({ 
      message: 'Login successful', 
      token, 
      user: { id: user.id, email: user.email, role: user.role } 
    });
  }

  // POST /api/admin/change-password
  if (route === 'admin/change-password' && method === 'POST') {
    const user = verifyAdmin(request);
    if (!user) return json({ error: 'Unauthorized' }, 401);
    
    const { currentPassword, newPassword } = body;
    if (!currentPassword || !newPassword) return json({ error: 'Both passwords required' }, 400);
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return json({ error: 'New password must be at least 8 characters' }, 400);
    }

    const result = await db.execute({ sql: 'SELECT id, password FROM users WHERE id = ?', args: [user.id] });
    if (!result.rows.length) return json({ error: 'User not found' }, 404);

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password);
    if (!valid) return json({ error: 'Current password is incorrect' }, 401);

    const hashed = await bcrypt.hash(newPassword, 10);
    await db.execute({ sql: 'UPDATE users SET password = ? WHERE id = ?', args: [hashed, user.id] });
    return json({ message: 'Password changed successfully' });
  }

  // GET /api/products
  if (route === 'products' && method === 'GET') {
    const result = await db.execute('SELECT * FROM products ORDER BY id DESC');
    return json(result.rows);
  }

  // GET /api/products/:id
  if (route.match(/^products\/\d+$/) && method === 'GET') {
    const id = route.split('/')[1];
    const result = await db.execute({ sql: 'SELECT * FROM products WHERE id = ?', args: [id] });
    if (!result.rows.length) return json({ error: 'Product not found.' }, 404);
    return json(result.rows[0]);
  }

  // POST /api/products
  if (route === 'products' && method === 'POST') {
    if (!verifyAdmin(request)) return json({ error: 'Unauthorized' }, 401);
    const { name, price, description, image, stock, category, pack_size, unit_price, sell_individually } = body;
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return json({ error: 'Product name is required' }, 400);
    }
    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice < 0) return json({ error: 'Price must be non-negative' }, 400);
    const numStock = Number(stock || 0);
    if (isNaN(numStock) || numStock < 0) return json({ error: 'Stock must be non-negative' }, 400);

    const result = await db.execute({
      sql: 'INSERT INTO products (name, price, description, image, stock, category, pack_size, unit_price, sell_individually) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [name.trim().slice(0, 200), numPrice, (description || '').slice(0, 1000), (image || '').slice(0, 500), numStock, (category || '').slice(0, 100), Number(pack_size) || 1, unit_price ? Number(unit_price) : null, sell_individually ? 1 : 0],
    });
    return json({ message: 'Product created successfully', id: Number(result.lastInsertRowid) }, 201);
  }

  // PUT /api/products/:id
  if (route.match(/^products\/\d+$/) && method === 'PUT') {
    if (!verifyAdmin(request)) return json({ error: 'Unauthorized' }, 401);
    const id = route.split('/')[1];
    const { name, price, description, image, stock, category, pack_size, unit_price, sell_individually } = body;
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return json({ error: 'Product name is required' }, 400);
    }
    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice < 0) return json({ error: 'Price must be non-negative' }, 400);
    const numStock = Number(stock || 0);
    if (isNaN(numStock) || numStock < 0) return json({ error: 'Stock must be non-negative' }, 400);

    const existing = await db.execute({ sql: 'SELECT id FROM products WHERE id = ?', args: [id] });
    if (!existing.rows.length) return json({ error: 'Product not found.' }, 404);

    await db.execute({
      sql: 'UPDATE products SET name=?, price=?, description=?, image=?, stock=?, category=?, pack_size=?, unit_price=?, sell_individually=? WHERE id=?',
      args: [name.trim().slice(0, 200), numPrice, (description || '').slice(0, 1000), (image || '').slice(0, 500), numStock, (category || '').slice(0, 100), Number(pack_size) || 1, unit_price ? Number(unit_price) : null, sell_individually ? 1 : 0, id],
    });
    return json({ message: 'Product updated successfully' });
  }

  // DELETE /api/products/:id
  if (route.match(/^products\/\d+$/) && method === 'DELETE') {
    if (!verifyAdmin(request)) return json({ error: 'Unauthorized' }, 401);
    const id = route.split('/')[1];
    const existing = await db.execute({ sql: 'SELECT id FROM products WHERE id = ?', args: [id] });
    if (!existing.rows.length) return json({ error: 'Product not found.' }, 404);
    await db.execute({ sql: 'DELETE FROM products WHERE id = ?', args: [id] });
    return json({ message: 'Product deleted successfully' });
  }

  // POST /api/orders
  if (route === 'orders' && method === 'POST') {
    // Rate limit: 10 orders per 15 minutes per IP
    const rl = checkRateLimit(`order:${clientIp}`, { limit: 10, windowMs: 15 * 60 * 1000 });
    if (!rl.allowed) {
      return json({ error: `Too many order attempts. Please try again in ${rl.retryAfterSeconds} seconds.` }, 429);
    }

    const { customerName, email, phone, address, items, paymentReference, website_verification } = body;
    
    // Honeypot check for bots
    if (website_verification) {
      return json({ error: 'Invalid submission detected' }, 400);
    }

    if (!customerName || !phone || !address || !Array.isArray(items) || items.length === 0) {
      return json({ error: 'Missing required customer and item fields' }, 400);
    }

    const trimmedName = String(customerName).trim().slice(0, 100);
    const trimmedPhone = String(phone).trim().slice(0, 25);
    const trimmedAddress = String(address).trim().slice(0, 300);
    const trimmedEmail = email ? String(email).trim().slice(0, 100) : null;

    if (trimmedName.length < 2) return json({ error: 'Valid customer name is required' }, 400);
    if (!PHONE_REGEX.test(trimmedPhone)) return json({ error: 'Valid phone number is required' }, 400);
    if (trimmedEmail && !EMAIL_REGEX.test(trimmedEmail)) return json({ error: 'Valid email format required' }, 400);

    let totalPrice = 0;
    for (const item of items) {
      const pId = Number(item.product_id);
      const qty = Number(item.quantity);
      if (!pId || !qty || qty <= 0 || !Number.isInteger(qty)) {
        return json({ error: 'Invalid item quantity or product ID.' }, 400);
      }

      const result = await db.execute({ sql: 'SELECT id, name, price, stock FROM products WHERE id = ?', args: [pId] });
      if (!result.rows.length) return json({ error: `Product ${pId} not found.` }, 400);
      const product = result.rows[0];
      if (product.stock < qty) return json({ error: `Insufficient stock for "${product.name}".` }, 400);
      totalPrice += product.price * qty;
    }

    const orderReference = generateOrderReference();
    const orderResult = await db.execute({
      sql: 'INSERT INTO orders (orderReference, customerName, email, phone, address, totalPrice, status, paymentReference) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      args: [orderReference, trimmedName, trimmedEmail, trimmedPhone, trimmedAddress, totalPrice, 'pending', paymentReference ? String(paymentReference).slice(0, 100) : null],
    });
    const orderId = Number(orderResult.lastInsertRowid);

    for (const item of items) {
      const pId = Number(item.product_id);
      const qty = Number(item.quantity);
      await db.execute({ sql: 'INSERT INTO order_items (order_id, product_id, quantity) VALUES (?, ?, ?)', args: [orderId, pId, qty] });
      await db.execute({ sql: 'UPDATE products SET stock = stock - ? WHERE id = ?', args: [qty, pId] });
    }

    return json({ message: 'Order placed successfully', orderId, orderReference, totalPrice }, 201);
  }

  // GET /api/orders
  if (route === 'orders' && method === 'GET') {
    if (!verifyAdmin(request)) return json({ error: 'Unauthorized' }, 401);
    const orders = await db.execute('SELECT * FROM orders ORDER BY createdAt DESC');
    const ordersWithItems = await Promise.all(orders.rows.map(async (order) => {
      const items = await db.execute({
        sql: `SELECT oi.id, oi.order_id, oi.product_id, oi.quantity, p.name as productName, p.price as productPrice, p.image as productImage
              FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?`,
        args: [order.id],
      });
      return { ...order, items: items.rows };
    }));
    return json(ordersWithItems);
  }

  // PUT /api/orders/:id
  if (route.match(/^orders\/\d+$/) && method === 'PUT') {
    if (!verifyAdmin(request)) return json({ error: 'Unauthorized' }, 401);
    const id = route.split('/')[1];
    const { status } = body;
    if (!['pending', 'paid', 'delivered'].includes(status)) return json({ error: 'Invalid status' }, 400);
    const existing = await db.execute({ sql: 'SELECT id FROM orders WHERE id = ?', args: [id] });
    if (!existing.rows.length) return json({ error: 'Order not found.' }, 404);
    await db.execute({ sql: 'UPDATE orders SET status = ? WHERE id = ?', args: [status, id] });
    return json({ message: 'Order status updated successfully' });
  }

  // DELETE /api/orders/:id
  if (route.match(/^orders\/\d+$/) && method === 'DELETE') {
    if (!verifyAdmin(request)) return json({ error: 'Unauthorized' }, 401);
    const id = route.split('/')[1];
    const existing = await db.execute({ sql: 'SELECT id FROM orders WHERE id = ?', args: [id] });
    if (!existing.rows.length) return json({ error: 'Order not found.' }, 404);
    const items = await db.execute({ sql: 'SELECT product_id, quantity FROM order_items WHERE order_id = ?', args: [id] });
    for (const item of items.rows) {
      await db.execute({ sql: 'UPDATE products SET stock = stock + ? WHERE id = ?', args: [item.quantity, item.product_id] });
    }
    await db.execute({ sql: 'DELETE FROM order_items WHERE order_id = ?', args: [id] });
    await db.execute({ sql: 'DELETE FROM orders WHERE id = ?', args: [id] });
    return json({ message: 'Order deleted successfully and stock restored' });
  }

  // POST /api/orders/:id/confirm-payment
  if (route.match(/^orders\/\d+\/confirm-payment$/) && method === 'POST') {
    // Rate limit: 20 payment confirmations per 15 min per IP
    const rl = checkRateLimit(`payment:${clientIp}`, { limit: 20, windowMs: 15 * 60 * 1000 });
    if (!rl.allowed) {
      return json({ error: 'Too many verification attempts. Please try again later.' }, 429);
    }

    const id = route.split('/')[1];
    const { reference } = body;
    if (!reference || typeof reference !== 'string') return json({ error: 'Payment reference is required' }, 400);
    const paystackKey = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackKey) return json({ error: 'Payment verification not configured' }, 500);

    const cleanRef = encodeURIComponent(reference.trim());
    const response = await axios.get(`https://api.paystack.co/transaction/verify/${cleanRef}`, {
      headers: { Authorization: `Bearer ${paystackKey}` },
      timeout: 10000,
    });
    if (!response.data?.data || response.data.data.status !== 'success') {
      return json({ error: 'Payment verification failed.' }, 400);
    }
    const paidAmount = response.data.data.amount / 100;
    const existing = await db.execute({ sql: 'SELECT id, totalPrice, status FROM orders WHERE id = ?', args: [id] });
    if (!existing.rows.length) return json({ error: 'Order not found.' }, 404);
    if (Math.abs(paidAmount - existing.rows[0].totalPrice) > 0.01) {
      return json({ error: 'Payment amount mismatch' }, 400);
    }
    await db.execute({ sql: 'UPDATE orders SET status = ?, paymentReference = ? WHERE id = ?', args: ['paid', reference.trim(), id] });
    return json({ message: 'Payment confirmed successfully', verified: true });
  }

  // GET /api/categories
  if (route === 'categories' && method === 'GET') {
    return json([]);
  }

  // GET /api/health
  if (route === 'health' && method === 'GET') {
    return json({ status: 'OK', timestamp: new Date().toISOString() });
  }

  return json({ error: 'Not found' }, 404);
}

export async function GET(request, { params }) {
  try { return await routeRequest(request, params); }
  catch (e) { 
    console.error('Route error:', e); 
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 }); 
  }
}
export async function POST(request, { params }) {
  try { return await routeRequest(request, params); }
  catch (e) { 
    console.error('Route error:', e); 
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 }); 
  }
}
export async function PUT(request, { params }) {
  try { return await routeRequest(request, params); }
  catch (e) { 
    console.error('Route error:', e); 
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 }); 
  }
}
export async function DELETE(request, { params }) {
  try { return await routeRequest(request, params); }
  catch (e) { 
    console.error('Route error:', e); 
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 }); 
  }
}
