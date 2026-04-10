const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');

const db = createClient({
  url: 'file:local.db'
});

async function seedLocal() {
  // Initialize tables
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'admin'
    )
  `);
  
  await db.execute(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      description TEXT,
      image TEXT,
      stock INTEGER DEFAULT 0,
      category TEXT,
      pack_size INTEGER DEFAULT 1,
      unit_price REAL,
      sell_individually INTEGER DEFAULT 0
    )
  `);

  // Create admin user
  const hashedPassword = await bcrypt.hash('admin123', 10);
  try {
    await db.execute({
      sql: 'INSERT OR IGNORE INTO users (email, password, role) VALUES (?, ?, ?)',
      args: ['admin@wellconnected.com', hashedPassword, 'admin'],
    });
    console.log('✅ Admin user created');
  } catch (error) {
    console.log('Admin user exists');
  }

  // Clear existing products
  await db.execute('DELETE FROM products');

  // Sample products
  const products = [
    { name: 'Jasmine Rice (5kg)', price: 85, description: 'Premium long-grain jasmine rice', image: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=500', stock: 40, category: 'Rice' },
    { name: 'Frytol Vegetable Oil (3L)', price: 75, description: 'Premium refined vegetable oil', image: 'https://images.unsplash.com/photo-1474979266404-7eadf1f34de6?w=500', stock: 40, category: 'Cooking Oil' },
    { name: 'Indomie Instant Noodles (Box of 40)', price: 95, description: 'Box of 40 packs of Indomie', image: 'https://images.unsplash.com/photo-1612929633738-8fe44f7ec841?w=500', stock: 30, category: 'Noodles & Pasta' },
    { name: 'Peak Powdered Milk (900g)', price: 75, description: 'Full cream powdered milk', image: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=500', stock: 35, category: 'Dairy & Beverages' },
    { name: 'Maggi Star (Box of 100)', price: 20, description: 'Seasoning cubes', image: 'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=500', stock: 80, category: 'Seasoning & Spices' },
    { name: 'Golden Penny Flour (2kg)', price: 25, description: 'All-purpose wheat flour', image: 'https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?w=500', stock: 50, category: 'Flour & Baking' }
  ];

  for (const product of products) {
    await db.execute({
      sql: 'INSERT INTO products (name, price, description, image, stock, category) VALUES (?, ?, ?, ?, ?, ?)',
      args: [product.name, product.price, product.description, product.image, product.stock, product.category],
    });
  }

  console.log(`✅ ${products.length} products seeded`);
  console.log('🎉 Local database seeding complete!');
}

seedLocal().catch(console.error);