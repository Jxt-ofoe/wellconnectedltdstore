const express = require('express');
const rateLimit = require('express-rate-limit');
const { createOrder, getAllOrders, updateOrderStatus, deleteOrder, confirmPayment } = require('../controllers/orderController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validateOrder, validateOrderStatus } = require('../middleware/validate');

const router = express.Router();

const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many orders created. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many payment attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/', orderLimiter, validateOrder, createOrder);
router.post('/:id/confirm-payment', paymentLimiter, confirmPayment);
router.get('/', authenticateToken, requireAdmin, getAllOrders);
router.put('/:id', authenticateToken, requireAdmin, validateOrderStatus, updateOrderStatus);
router.delete('/:id', authenticateToken, requireAdmin, deleteOrder);

module.exports = router;
