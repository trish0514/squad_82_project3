const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
// Middleware must come before routes that use req.body
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.set('view engine', 'ejs');

// PostgreSQL connection pool
const isLocal = ['localhost', '127.0.0.1'].includes(process.env.PSQL_HOST);

const pool = new Pool({
  user: process.env.PSQL_USER,
  host: process.env.PSQL_HOST,
  database: process.env.PSQL_DATABASE,
  password: process.env.PSQL_PASSWORD,
  port: process.env.PSQL_PORT,
  ssl: (isLocal || process.env.PSQL_SSL === 'false') ? false : { rejectUnauthorized: false }
});

app.set('trust proxy', 1); // Render sits behind a proxy
app.use(session({
  store: new PgStore({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

// Create the menu table if it does not already exist
pool.query(`
  CREATE TABLE IF NOT EXISTS menu_items (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price NUMERIC(6,2) NOT NULL CHECK (price >= 0)
  )
`).catch(err => {
  console.error('Could not create menu_items table:', err);
});

pool.query(`
  CREATE TABLE IF NOT EXISTS kiosk_customers (
    id SERIAL PRIMARY KEY,
    phone TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL
  )
`).catch(err => {
  console.error('Could not create kiosk_customers table:', err);
});

pool.query(`
  CREATE TABLE IF NOT EXISTS kiosk_orders (
    id SERIAL PRIMARY KEY,
    customer_id INT REFERENCES kiosk_customers(id),  -- NULL = guest
    source TEXT DEFAULT 'kiosk',
    subtotal NUMERIC(8,2),
    tax NUMERIC(8,2),
    total NUMERIC(8,2),
    order_time TIMESTAMP DEFAULT NOW()
  )
`).then(() => pool.query(`
  CREATE TABLE IF NOT EXISTS kiosk_order_items (
    id SERIAL PRIMARY KEY,
    order_id INT NOT NULL REFERENCES kiosk_orders(id) ON DELETE CASCADE,
    menu_item_id INT NOT NULL REFERENCES menu_items(id),
    size TEXT,
    sugar TEXT,
    ice TEXT,
    toppings TEXT[] DEFAULT '{}',
    price NUMERIC(8,2),
    is_reward BOOLEAN DEFAULT FALSE
  )
`)).catch(err => console.error('Could not create kiosk order tables:', err));

// Gracefully close the PostgreSQL pool when stopping the app
process.on('SIGINT', async () => {
  await pool.end();
  console.log('Application successfully shut down');
  process.exit(0);
});

// -------------------- HOME / OTHER PAGES --------------------

app.get('/', (req, res) => {
  res.render('hub');
});

app.get('/user', async (req, res) => {
  try {
    const queryRes = await pool.query('SELECT * FROM teammembers;');

    res.render('user', {
      teammembers: queryRes.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Database error');
  }
});

const normPhone = p => (p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');

app.get('/login', (req, res) => {
  res.render('login', { error: null, phone: '', needName: false });
});

app.post('/login', async (req, res, next) => {
  try {
    const phone = normPhone(req.body.phone);
    const name = (req.body.name || '').trim();

    if (phone.length !== 10) {
      return res.status(400).render('login', {
        error: 'Enter a 10-digit phone number.', phone: req.body.phone || '', needName: false });
    }

    let { rows } = await pool.query('SELECT id, name FROM kiosk_customers WHERE phone = $1', [phone]);
    let customer = rows[0];

    if (!customer) {
      if (!name) return res.render('login', { error: null, phone, needName: true });
      ({ rows } = await pool.query(
        'INSERT INTO kiosk_customers (phone, name) VALUES ($1, $2) RETURNING id, name', [phone, name]));
      customer = rows[0];
    }

    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.customer = { id: customer.id, name: customer.name };
      res.redirect('/kiosk');
    });
  } catch (e) { next(e); }
});

app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

app.get('/kiosk', (req, res) => {
  res.render('kiosk', { customer: req.session.customer || null });
});

app.get('/cashier', (req, res) => {
  res.render('cashier');
});

app.get('/kitchen', (req, res) => {
  res.render('kitchen');
});

// -------------------- MANAGER PAGE --------------------

app.get('/manager', async (req, res) => {
  try {
    const { rows: items } = await pool.query(
      'SELECT * FROM menu_items ORDER BY id'
    );

    // This creates the choices for the sales-report dropdown.
    const menuChoices = [
      'All',
      ...items.map(item => item.name)
    ];

    res.render('manager', {
      // Menu
      items,
      message: null,

      // Inventory — empty until you build inventory table/routes
      ingredients: [],

      // Employees — empty until you build employees table/routes
      employees: [],

      // Sales report defaults
      menuChoices,
      salesStart: '',
      salesEnd: '',
      salesItem: 'All',
      salesRows: null,

      // X-report defaults
      xDate: '',
      xReportTotalsLabel: '',
      xReportRows: null,

      // Restock report defaults
      restockRows: null,

      // Product usage report defaults
      usageStart: '',
      usageEnd: '',
      usageRows: null
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Database error');
  }
});

// Add a menu item
app.post('/manager/add', async (req, res) => {
  const { name, category, price } = req.body;

  try {
    await pool.query(
      `INSERT INTO menu_items (name, category, price)
       VALUES ($1, $2, $3)`,
      [name, category, price]
    );

    res.redirect('/manager');
  } catch (err) {
    console.error(err);
    res.status(500).send('Could not add menu item');
  }
});

// Update a menu item
app.post('/manager/update/:id', async (req, res) => {
  const { name, category, price } = req.body;
  const { id } = req.params;

  try {
    await pool.query(
      `UPDATE menu_items
       SET name = $1, category = $2, price = $3
       WHERE id = $4`,
      [name, category, price, id]
    );

    res.redirect('/manager');
  } catch (err) {
    console.error(err);
    res.status(500).send('Could not update menu item');
  }
});

app.get('/api/menu', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, category, price FROM menu_items ORDER BY id');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load menu' });
  }
});

app.post('/api/orders', async (req, res) => {
  const { source, items, subtotal, tax, total } = req.body;
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Empty order' });
  }
  const customerId = req.session.customer ? req.session.customer.id : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const o = await client.query(
      `INSERT INTO kiosk_orders (customer_id, source, subtotal, tax, total)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [customerId, source || 'kiosk', subtotal, tax, total]);
    const orderId = o.rows[0].id;

    for (const i of items) {
      await client.query(
        `INSERT INTO kiosk_order_items (order_id, menu_item_id, size, sugar, ice, toppings, price)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [orderId, i.id, i.size, i.sugar, i.ice, i.toppings, i.price]);
    }
    await client.query('COMMIT');
    res.json({ orderNumber: orderId });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Could not place order' });
  } finally {
    client.release();
  }
});

// Start server
app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
