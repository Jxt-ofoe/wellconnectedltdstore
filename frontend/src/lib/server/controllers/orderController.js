const { db } = require('../db');
const axios = require('axios');

function generateOrderReference() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const timestamp = date.getTime().toString().slice(-6);
  const random = Math.floor(Math.random() * 100).toString().padStart(2, '0');
  return `WC-${year}${month}${day}-${timestamp}${random}`;
}

const createOrder = async (req, res) => {
  try {
    const { customerName, email, phone, address, items, paymentReference } = req.body;
    let totalPrice = 0;

    for (const item of items) {
      const result = await db.execute({ sql: 'SELECT * FROM products WHERE id = ?', args: [item.product_id] });
      if (result.rows.length === 0) return res.status(400).json({ error: `Product with ID ${item.product_id} not found.` });
      const product = result.rows[0];
      if (product.stock < item.quantity) return res.status(400).json({ error: `Insufficient stock for "${product.name}".` });
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

    res.status(201).json({ message: 'Order placed successfully', orderId, orderReference, totalPrice });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

const confirmPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ error: 'Payment reference is required' });

    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecretKey) return res.status(500).json({ error: 'Payment verification not configured' });

    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${paystackSecretKey}` },
    });

    if (!response.data || response.data.status !== true || response.data.data.status !== 'success') {
      return res.status(400).json({ error: 'Payment verification failed. Please contact support.' });
    }

    const paidAmount = response.data.data.amount / 100;
    const existing = await db.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [id] });
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Order not found.' });

    const order = existing.rows[0];
    if (Math.abs(paidAmount - order.totalPrice) > 0.01) {
      return res.status(400).json({ error: 'Payment amount does not match order total' });
    }

    await db.execute({ sql: 'UPDATE orders SET status = ?, paymentReference = ? WHERE id = ?', args: ['paid', reference, id] });
    res.json({ message: 'Payment confirmed successfully', verified: true });
  } catch (error) {
    console.error('Confirm payment error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

const getAllOrders = async (req, res) => {
  try {
    const orders = await db.execute('SELECT * FROM orders ORDER BY createdAt DESC');
    const ordersWithItems = await Promise.all(
      orders.rows.map(async (order) => {
        const items = await db.execute({
          sql: `SELECT oi.*, p.name as productName, p.price as productPrice, p.image as productImage
                FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?`,
          args: [order.id],
        });
        return { ...order, items: items.rows };
      })
    );
    res.json(ordersWithItems);
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const existing = await db.execute({ sql: 'SELECT id FROM orders WHERE id = ?', args: [id] });
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Order not found.' });
    await db.execute({ sql: 'UPDATE orders SET status = ? WHERE id = ?', args: [status, id] });
    res.json({ message: 'Order status updated successfully' });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

const deleteOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.execute({ sql: 'SELECT id FROM orders WHERE id = ?', args: [id] });
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Order not found.' });

    const items = await db.execute({ sql: 'SELECT product_id, quantity FROM order_items WHERE order_id = ?', args: [id] });
    for (const item of items.rows) {
      await db.execute({ sql: 'UPDATE products SET stock = stock + ? WHERE id = ?', args: [item.quantity, item.product_id] });
    }
    await db.execute({ sql: 'DELETE FROM order_items WHERE order_id = ?', args: [id] });
    await db.execute({ sql: 'DELETE FROM orders WHERE id = ?', args: [id] });
    res.json({ message: 'Order deleted successfully and stock restored' });
  } catch (error) {
    console.error('Delete order error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

module.exports = { createOrder, getAllOrders, updateOrderStatus, deleteOrder, confirmPayment };
