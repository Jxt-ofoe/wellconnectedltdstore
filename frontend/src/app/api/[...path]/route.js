export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

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

async function routeRequest(request, params) {
  await ensureDB();
  const db = getDB().db;

  const { path } = await params;
  const route = path.join('/');
  const method = request.method;

  let body = {};
  if (method !== 'GET' && method !== 'DELETE') {
    try { body = await request.json(); } catch {}
  }

  // POST /api/admin/login
  if (route === 'admin/login' && method === 'POST') {
    const { email, password } = body;
    if (!email || !password) return json({ error: 'Email and password required' }, 400);
    const result = await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] });
    if (!result.rows.length) return json({ error: 'Invalid email or password.' }, 401);
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return json({ error: 'Invalid email or password.' }, 401);
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '24h' });
    return json({ message: 'Login successful', token, user: { id: user.id, email: user.email, role: user.role } });
  }

  // POST /api/admin/change-password
  if (route === 'admin/change-password' && method === 'POST') {
    const user = verifyAdmin(request);
    if (!user) return json({ error: 'Unauthorized' }, 401);
    const { currentPassword, newPassword } = body;
    if (!currentPassword || !newPassword) return json({ error: 'Both passwords required' }, 400);
    if (newPassword.length < 6) return json({ error: 'New password must be at least 6 characters' }, 400);
    const result = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [user.id] });
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
    if (!name) return json({ error: 'Product name is required' }, 400);
    const result = await db.execute({
      sql: 'INSERT INTO products (name, price, description, image, stock, category, pack_size, unit_price, sell_individually) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [name, price, description || '', image || '', stock || 0, category || '', pack_size || 1, unit_price || null, sell_individually ? 1 : 0],
    });
    return json({ message: 'Product created successfully', id: Number(result.lastInsertRowid) }, 201);
  }

  // PUT /api/products/:id
  if (route.match(/^products\/\d+$/) && method === 'PUT') {
    if (!verifyAdmin(request)) return json({ error: 'Unauthorized' }, 401);
    const id = route.split('/')[1];
    const { name, price, description, image, stock, category, pack_size, unit_price, sell_individually } = body;
    if (!name) return json({ error: 'Product name is required' }, 400);
    const existing = await db.execute({ sql: 'SELECT id FROM products WHERE id = ?', args: [id] });
    if (!existing.rows.length) return json({ error: 'Product not found.' }, 404);
    await db.execute({
      sql: 'UPDATE products SET name=?, price=?, description=?, image=?, stock=?, category=?, pack_size=?, unit_price=?, sell_individually=? WHERE id=?',
      args: [name, price, description || '', image || '', stock || 0, category || '', pack_size || 1, unit_price || null, sell_individually ? 1 : 0, id],
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
    const { customerName, email, phone, address, items, paymentReference } = body;
    if (!customerName || !phone || !address || !items?.length) return json({ error: 'Missing required fields' }, 400);
    let totalPrice = 0;
    for (const item of items) {
      const result = await db.execute({ sql: 'SELECT * FROM products WHERE id = ?', args: [item.product_id] });
      if (!result.rows.length) return json({ error: `Product ${item.product_id} not found.` }, 400);
      const product = result.rows[0];
      if (product.stock < item.quantity) return json({ error: `Insufficient stock for "${product.name}".` }, 400);
      totalPrice += product.price * item.quantity;
    }
    const orderReference = generateOrderReference();
    const orderResult = await db.execute({
      sql: 'INSERT INTO orders (orderReference, customerName, email, phone, address, totalPrice, status, paymentReference) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      args: [orderReference, customerName, email || null, phone, address, totalPrice, 'pending', paymentReference || null],
    });
    const orderId = Number(orderResult.lastInsertRowid);
    for (const item of items) {
      await db.execute({ sql: 'INSERT INTO order_items (order_id, product_id, quantity) VALUES (?, ?, ?)', args: [orderId, item.product_id, item.quantity] });
      await db.execute({ sql: 'UPDATE products SET stock = stock - ? WHERE id = ?', args: [item.quantity, item.product_id] });
    }
    return json({ message: 'Order placed successfully', orderId, orderReference, totalPrice }, 201);
  }

  // GET /api/orders
  if (route === 'orders' && method === 'GET') {
    if (!verifyAdmin(request)) return json({ error: 'Unauthorized' }, 401);
    const orders = await db.execute('SELECT * FROM orders ORDER BY createdAt DESC');
    const ordersWithItems = await Promise.all(orders.rows.map(async (order) => {
      const items = await db.execute({
        sql: `SELECT oi.*, p.name as productName, p.price as productPrice, p.image as productImage
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
    const id = route.split('/')[1];
    const { reference } = body;
    if (!reference) return json({ error: 'Payment reference is required' }, 400);
    const paystackKey = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackKey) return json({ error: 'Payment verification not configured' }, 500);
    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${paystackKey}` },
    });
    if (!response.data?.data || response.data.data.status !== 'success') return json({ error: 'Payment verification failed.' }, 400);
    const paidAmount = response.data.data.amount / 100;
    const existing = await db.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [id] });
    if (!existing.rows.length) return json({ error: 'Order not found.' }, 404);
    if (Math.abs(paidAmount - existing.rows[0].totalPrice) > 0.01) return json({ error: 'Payment amount mismatch' }, 400);
    await db.execute({ sql: 'UPDATE orders SET status = ?, paymentReference = ? WHERE id = ?', args: ['paid', reference, id] });
    return json({ message: 'Payment confirmed successfully', verified: true });
  }

  // GET /api/categories
  if (route === 'categories' && method === 'GET') {
    return json([]);
  }

  // GET /api/health
  if (route === 'health' && method === 'GET') {
    return json({ status: 'OK' });
  }

  return json({ error: 'Not found' }, 404);
}

export async function GET(request, { params }) {
  try { return await routeRequest(request, params); }
  catch (e) { console.error(e); return NextResponse.json({ error: 'Internal server error' }, { status: 500 }); }
}
export async function POST(request, { params }) {
  try { return await routeRequest(request, params); }
  catch (e) { console.error(e); return NextResponse.json({ error: 'Internal server error' }, { status: 500 }); }
}
export async function PUT(request, { params }) {
  try { return await routeRequest(request, params); }
  catch (e) { console.error(e); return NextResponse.json({ error: 'Internal server error' }, { status: 500 }); }
}
export async function DELETE(request, { params }) {
  try { return await routeRequest(request, params); }
  catch (e) { console.error(e); return NextResponse.json({ error: 'Internal server error' }, { status: 500 }); }
}
