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

app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`);
});
