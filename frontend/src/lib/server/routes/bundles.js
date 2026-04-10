const express = require('express');
const router = express.Router();
const { db } = require('../db');

router.post('/', async (req, res) => {
  try {
    const { name, description, price, discount, productIds } = req.body;
    if (!name || !Array.isArray(productIds) || productIds.length === 0)
      return res.status(400).json({ error: 'Name and productIds required' });

    const result = await db.execute({
      sql: 'INSERT INTO bundles (name, description, price, discount) VALUES (?, ?, ?, ?)',
      args: [name, description || '', price || null, discount || null],
    });
    const bundleId = Number(result.lastInsertRowid);
    for (const pid of productIds) {
      await db.execute({ sql: 'INSERT INTO bundle_products (bundle_id, product_id) VALUES (?, ?)', args: [bundleId, pid] });
    }
    res.status(201).json({ message: 'Bundle created', id: bundleId });
  } catch (error) {
    console.error('Create bundle error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const bundles = (await db.execute('SELECT * FROM bundles WHERE is_active = 1')).rows;
    for (const bundle of bundles) {
      bundle.products = (await db.execute({
        sql: 'SELECT p.* FROM products p JOIN bundle_products bp ON p.id = bp.product_id WHERE bp.bundle_id = ?',
        args: [bundle.id],
      })).rows;
    }
    res.json(bundles);
  } catch (error) {
    console.error('Get bundles error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const rows = (await db.execute({ sql: 'SELECT * FROM bundles WHERE id = ?', args: [req.params.id] })).rows;
    if (!rows.length) return res.status(404).json({ error: 'Bundle not found' });
    const bundle = rows[0];
    bundle.products = (await db.execute({
      sql: 'SELECT p.* FROM products p JOIN bundle_products bp ON p.id = bp.product_id WHERE bp.bundle_id = ?',
      args: [req.params.id],
    })).rows;
    res.json(bundle);
  } catch (error) {
    console.error('Get bundle error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, description, price, discount, productIds } = req.body;
    if (!name || !Array.isArray(productIds) || productIds.length === 0)
      return res.status(400).json({ error: 'Name and productIds required' });

    await db.execute({
      sql: 'UPDATE bundles SET name = ?, description = ?, price = ?, discount = ? WHERE id = ?',
      args: [name, description || '', price || null, discount || null, req.params.id],
    });
    await db.execute({ sql: 'DELETE FROM bundle_products WHERE bundle_id = ?', args: [req.params.id] });
    for (const pid of productIds) {
      await db.execute({ sql: 'INSERT INTO bundle_products (bundle_id, product_id) VALUES (?, ?)', args: [req.params.id, pid] });
    }
    res.json({ message: 'Bundle updated' });
  } catch (error) {
    console.error('Update bundle error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM bundle_products WHERE bundle_id = ?', args: [req.params.id] });
    await db.execute({ sql: 'DELETE FROM bundles WHERE id = ?', args: [req.params.id] });
    res.json({ message: 'Bundle deleted' });
  } catch (error) {
    console.error('Delete bundle error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
