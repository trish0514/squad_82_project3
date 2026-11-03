const express = require('express');
const { Pool } = require('pg');
const dotenv = require('dotenv').config();

// Create express app
const app = express();
const port = 3000;

// Create pool
const pool = new Pool({
    user: process.env.PSQL_USER,
    host: process.env.PSQL_HOST,
    database: process.env.PSQL_DATABASE,
    password: process.env.PSQL_PASSWORD,
    port: process.env.PSQL_PORT,
    ssl: {rejectUnauthorized: false}
});

process.on('SIGINT', function() {
    pool.end();
    console.log('Application successfully shutdown');
    process.exit(0);
});
	 	 	 	
app.set("view engine", "ejs");

app.get('/', (req, res) => {
    res.render('hub');
});
	 	 	 	
app.get('/user', (req, res) => {
    pool
        .query('SELECT * FROM teammembers;')
        .then(query_res => {
            res.render('user', { teammembers: query_res.rows });
        })
        .catch(err => {
            console.error(err);
            res.status(500).send('Database error');
        });
});

app.get('/kiosk', (req, res) => {
  res.render('kiosk');
});

app.get('/cashier', (req, res) => {
  res.render('cashier');
});

app.get('/kitchen', (req, res) => {
	res.render('kitchen');
});


app.use(express.urlencoded({ extended: false}));

pool.query(`CREATE TABLE IF NOT EXISTS menu_items (
    id SERIAL PRIMARY KEY, name TEXT NOT null, category TEXT NOT NULL, 
    price NUMERIC(6,2) NOT NULL CHECK (price >=0))`).catch(console.error);

app.get('/manager', async(req, res) => {
    try{
        const { rows } = await pool.query('SELECT * FROM menu_items ORDER BY id');
        res.render('manager', {items: rows });
    } catch (err) { console.error(err); res.status(500).send('Database error'); }
});

app.post('/manager/add', async(req, res) => {
    const { name, category, price } = req.body;
    await pool.query('INSERT INTO menu_items (name, category, price) VALUES ($1, $2, $3)',
        [name, category, price]).catch(console.error);
    res.redirect('/manager');
    });

app.post('/manager/update/:id', async(req,res) => {
    const {name, category,price}=req.body;
    await pool.query('UPDATE menu_items SET name = $1, category = $2, price = $3 WHERE id = $4',
        [name, category, price, req.params.id]).catch(console.error);
    res.redirect('/manager');
});

    

app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`);
});
