
require("dotenv").config();

const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function resetAdminPassword() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error("ADMIN_EMAIL or ADMIN_PASSWORD missing in .env");
  }

  if (password.length < 12) {
    throw new Error("Use an admin password with at least 12 characters.");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const result = await pool.query(
    `UPDATE meditrack.users
     SET password_hash = $1
     WHERE LOWER(email) = LOWER($2)
       AND role = 'admin'
     RETURNING user_id, full_name, email, role`,
    [passwordHash, email]
  );

  if (result.rowCount === 0) {
    console.log("No matching admin found. Nothing was changed.");
  } else {
    console.log("Admin password reset successfully:");
    console.log(result.rows[0]);
  }
}

resetAdminPassword()
  .catch((error) => {
    console.error("Password reset failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
