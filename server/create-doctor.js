
require("dotenv").config();

const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const readline = require("readline");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function createDoctor() {
  const email = "doctor@meditrack.com";
  const name = "Test Doctor";

  const password = await ask("Enter a strong password for the doctor: ");

  if (password.length < 12) {
    throw new Error("Password must be at least 12 characters.");
  }

  const existing = await pool.query(
    `SELECT user_id, role
     FROM meditrack.users
     WHERE LOWER(email) = LOWER($1)`,
    [email]
  );

  if (existing.rowCount > 0) {
    throw new Error(
      `This email already exists with role '${existing.rows[0].role}'. No changes made.`
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const result = await pool.query(
    `INSERT INTO meditrack.users
       (full_name, email, password_hash, role)
     VALUES ($1, $2, $3, 'doctor')
     RETURNING user_id, full_name, email, role`,
    [name, email, passwordHash]
  );

  console.log("\nDoctor account created successfully:");
  console.log(result.rows[0]);
}

createDoctor()
  .catch((error) => {
    console.error("\nCould not create doctor:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await pool.end();
  });
