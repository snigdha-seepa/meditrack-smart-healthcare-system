require("dotenv").config();

const { Pool } = require("pg");
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const server = http.createServer(app);

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

pool.on("error", (error) => {
  console.error("PostgreSQL error:", error.message);
});

const PORT = Number(process.env.PORT || 5000);
const FRONTEND_URL =
  process.env.FRONTEND_URL || "http://localhost:5173";
const JWT_SECRET = process.env.JWT_SECRET;

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
  },
});

app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json({ limit: "20kb" }));

const WAITING = ["Waiting", "Booked"];
const CONSULTING = ["In-Consultation", "In Consultation"];

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function makeToken(user) {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is missing from .env");
  }

  return jwt.sign(
    {
      userId: user.user_id,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
}

function safeUser(user) {
  return {
    id: user.user_id,
    name: user.full_name,
    email: user.email,
    role: user.role,
  };
}

function authenticate(req, res, next) {
  const authorization = req.headers.authorization || "";
  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({
      message: "Please log in first.",
    });
  }

  if (!JWT_SECRET) {
    return res.status(500).json({
      message: "Authentication is not configured.",
    });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      message: "Login expired or invalid. Please log in again.",
    });
  }
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        message: "You do not have permission to do this.",
      });
    }

    next();
  };
}

// Public queue never includes patient names.
function formatPublic(row) {
  let status = row.status;

  if (WAITING.includes(status)) status = "Waiting";
  if (CONSULTING.includes(status)) status = "In Consultation";

  return {
    token: `A-${String(row.appointment_id).padStart(3, "0")}`,
    appointmentId: row.appointment_id,
    status,
  };
}

function formatStaff(row) {
  return {
    ...formatPublic(row),
    patient: row.patient_name,
    doctor: row.doctor_name,
    department: row.department,
    appointmentAt: row.appointment_at,
  };
}

async function getQueueData(db = pool, staff = false) {
  const result = await db.query(
    `SELECT appointment_id, patient_name, doctor_name,
            department, appointment_at, status
     FROM meditrack.appointments
     WHERE status = ANY($1::text[])
        OR status = ANY($2::text[])
     ORDER BY appointment_at ASC NULLS LAST, appointment_id ASC`,
    [WAITING, CONSULTING]
  );

  const queue = result.rows.map(
    staff ? formatStaff : formatPublic
  );

  const current = queue.find(
    (p) => p.status === "In Consultation"
  );

  return {
    queue,
    currentToken: current?.token || null,
    waitingCount: queue.filter(
      (p) => p.status === "Waiting"
    ).length,
  };
}

async function broadcastQueue() {
  try {
    io.emit("queue:update", await getQueueData(pool, false));
  } catch (error) {
    console.error("Queue broadcast failed:", error.message);
  }
}

// Create authentication table and safely link new bookings to accounts.
async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meditrack.users (
      user_id BIGSERIAL PRIMARY KEY,
      full_name VARCHAR(120) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'patient'
        CHECK (role IN ('patient', 'doctor', 'admin')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE meditrack.appointments
    ADD COLUMN IF NOT EXISTS booked_by_user_id BIGINT
    REFERENCES meditrack.users(user_id) ON DELETE SET NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_appointments_booked_by
    ON meditrack.appointments(booked_by_user_id)
  `);

  // Create an initial admin only when configured and not already present.
  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (adminEmail && adminPassword) {
    if (adminPassword.length < 12) {
      throw new Error(
        "ADMIN_PASSWORD must have at least 12 characters."
      );
    }

    const existing = await pool.query(
      "SELECT user_id FROM meditrack.users WHERE email = $1",
      [adminEmail]
    );

    if (existing.rowCount === 0) {
      const hash = await bcrypt.hash(adminPassword, 12);

      await pool.query(
        `INSERT INTO meditrack.users
          (full_name, email, password_hash, role)
         VALUES ($1, $2, $3, 'admin')`,
        [
          process.env.ADMIN_NAME || "MediTrack Admin",
          adminEmail,
          hash,
        ]
      );

      console.log("Initial admin account created.");
    }
  }
}

app.get("/", (req, res) => {
  res.json({ message: "MediTrack backend is running!" });
});

app.get("/api/db-test", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT current_database() AS database_name,
        EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'meditrack'
            AND table_name = 'appointments'
        ) AS appointments_table_exists
    `);

    res.json({
      message: "PostgreSQL connection successful!",
      ...result.rows[0],
    });
  } catch (error) {
    console.error("Database test failed:", error.message);
    res.status(500).json({
      message: "PostgreSQL connection failed.",
    });
  }
});

// Patient registration only. Role cannot be selected by the requester.
app.post("/api/auth/register", async (req, res) => {
  const fullName = String(req.body.full_name || "").trim();
  const email = normalizeEmail(req.body.email);
  const password = req.body.password;

  if (
    fullName.length < 2 ||
    fullName.length > 120 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 128
  ) {
    return res.status(400).json({
      message:
        "Enter a valid name and email. Password must be 8–128 characters.",
    });
  }

  try {
    const hash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO meditrack.users
        (full_name, email, password_hash, role)
       VALUES ($1, $2, $3, 'patient')
       RETURNING user_id, full_name, email, role`,
      [fullName, email, hash]
    );

    const user = result.rows[0];

    res.status(201).json({
      message: "Patient account created.",
      user: safeUser(user),
      token: makeToken(user),
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        message: "An account with this email already exists.",
      });
    }

    console.error("Registration failed:", error.message);
    res.status(500).json({
      message: "Could not create account.",
    });
  }
});

// Login for any previously authorized account.
app.post("/api/auth/login", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = req.body.password;

  if (!email || typeof password !== "string") {
    return res.status(400).json({
      message: "Email and password are required.",
    });
  }

  try {
    const result = await pool.query(
      `SELECT user_id, full_name, email, password_hash, role
       FROM meditrack.users
       WHERE email = $1`,
      [email]
    );

    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({
        message: "Invalid email or password.",
      });
    }

    res.json({
      message: "Login successful.",
      user: safeUser(user),
      token: makeToken(user),
    });
  } catch (error) {
    console.error("Login failed:", error.message);
    res.status(500).json({ message: "Could not log in." });
  }
});

app.get("/api/auth/me", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT user_id, full_name, email, role
       FROM meditrack.users WHERE user_id = $1`,
      [req.user.userId]
    );

    if (!result.rows[0]) {
      return res.status(401).json({
        message: "Account no longer exists.",
      });
    }

    res.json({ user: safeUser(result.rows[0]) });
  } catch (error) {
    console.error("Profile lookup failed:", error.message);
    res.status(500).json({ message: "Could not load profile." });
  }
});

// Public queue contains tokens and statuses only.
app.get("/api/queue", async (req, res) => {
  try {
    res.json(await getQueueData(pool, false));
  } catch (error) {
    console.error("Queue retrieval failed:", error.message);
    res.status(500).json({ message: "Could not retrieve queue." });
  }
});

// Staff queue includes patient details.
app.get(
  "/api/queue/staff",
  authenticate,
  allowRoles("admin", "doctor"),
  async (req, res) => {
    try {
      res.json(await getQueueData(pool, true));
    } catch (error) {
      console.error("Staff queue failed:", error.message);
      res.status(500).json({ message: "Could not retrieve staff queue." });
    }
  }
);

// Authenticated patient booking.
app.post(
  "/api/appointments",
  authenticate,
  allowRoles("patient"),
  async (req, res) => {
    const { doctor_name, department, appointment_at } = req.body;

    if (
      typeof doctor_name !== "string" ||
      !doctor_name.trim() ||
      doctor_name.trim().length > 120 ||
      typeof department !== "string" ||
      !department.trim() ||
      department.trim().length > 120 ||
      !appointment_at
    ) {
      return res.status(400).json({
        message: "Please fill all appointment fields.",
      });
    }

    const date = new Date(appointment_at);

    if (Number.isNaN(date.getTime()) || date <= new Date()) {
      return res.status(400).json({
        message: "Choose a valid future appointment time.",
      });
    }

    let client;

    try {
      client = await pool.connect();
      await client.query("BEGIN");

      const account = await client.query(
        `SELECT full_name FROM meditrack.users
         WHERE user_id = $1 AND role = 'patient'`,
        [req.user.userId]
      );

      if (!account.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(401).json({
          message: "Patient account not found.",
        });
      }

      const result = await client.query(
        `INSERT INTO meditrack.appointments
          (patient_name, doctor_name, department, appointment_at,
           status, booked_by_user_id)
         VALUES ($1, $2, $3, $4, 'Waiting', $5)
         RETURNING appointment_id, patient_name, doctor_name,
                   department, appointment_at, status`,
        [
          account.rows[0].full_name,
          doctor_name.trim(),
          department.trim(),
          date,
          req.user.userId,
        ]
      );

      const appointment = result.rows[0];

      await client.query(
        `INSERT INTO meditrack.queue_events (appointment_id, event_type)
         VALUES ($1, 'Waiting')`,
        [appointment.appointment_id]
      );

      await client.query("COMMIT");
      await broadcastQueue();

      res.status(201).json({
        message: "Appointment booked and added to the queue!",
        appointment,
        queueEntry: formatPublic(appointment),
      });
    } catch (error) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error("Rollback failed:", rollbackError.message);
        }
      }

      console.error("Booking failed:", error.message);
      res.status(500).json({ message: "Could not book appointment." });
    } finally {
      if (client) client.release();
    }
  }
);

// Patients can see only their own bookings.
app.get(
  "/api/appointments/mine",
  authenticate,
  allowRoles("patient"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT appointment_id, doctor_name, department,
                appointment_at, status
         FROM meditrack.appointments
         WHERE booked_by_user_id = $1
         ORDER BY appointment_at DESC, appointment_id DESC`,
        [req.user.userId]
      );

      res.json({
        appointments: result.rows.map((row) => ({
          ...row,
          token: `A-${String(row.appointment_id).padStart(3, "0")}`,
        })),
      });
    } catch (error) {
      console.error("Appointments lookup failed:", error.message);
      res.status(500).json({
        message: "Could not retrieve appointments.",
      });
    }
  }
);

// Only doctors and admins may advance the queue.
app.post(
  "/api/queue/next",
  authenticate,
  allowRoles("admin", "doctor"),
  async (req, res) => {
    let client;
    let transactionStarted = false;

    try {
      client = await pool.connect();
      await client.query("BEGIN");
      transactionStarted = true;

      const currentResult = await client.query(
        `SELECT appointment_id
         FROM meditrack.appointments
         WHERE status = ANY($1::text[])
         ORDER BY appointment_at ASC NULLS LAST, appointment_id ASC
         LIMIT 1 FOR UPDATE`,
        [CONSULTING]
      );

      const currentId = currentResult.rows[0]?.appointment_id;

      if (currentId !== undefined) {
        await client.query(
          `UPDATE meditrack.appointments
           SET status = 'Completed' WHERE appointment_id = $1`,
          [currentId]
        );

        await client.query(
          `INSERT INTO meditrack.queue_events (appointment_id, event_type)
           VALUES ($1, 'Completed')`,
          [currentId]
        );
      }

      const nextResult = await client.query(
        `SELECT appointment_id
         FROM meditrack.appointments
         WHERE status = ANY($1::text[])
         ORDER BY appointment_at ASC NULLS LAST, appointment_id ASC
         LIMIT 1 FOR UPDATE`,
        [WAITING]
      );

      const nextId = nextResult.rows[0]?.appointment_id;

      if (nextId !== undefined) {
        await client.query(
          `UPDATE meditrack.appointments
           SET status = 'In-Consultation' WHERE appointment_id = $1`,
          [nextId]
        );

        await client.query(
          `INSERT INTO meditrack.queue_events (appointment_id, event_type)
           VALUES ($1, 'Consultation-Started')`,
          [nextId]
        );
      }

      await client.query("COMMIT");
      transactionStarted = false;

      const data = await getQueueData(pool, true);
      await broadcastQueue();

      res.json({
        message: nextId !== undefined
          ? "Next patient called and saved."
          : "No patients waiting.",
        ...data,
      });
    } catch (error) {
      if (client && transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error("Rollback failed:", rollbackError.message);
        }
      }

      console.error("Queue update failed:", error.message);
      res.status(500).json({ message: "Could not update queue." });
    } finally {
      if (client) client.release();
    }
  }
);

// Socket.IO exposes only the privacy-safe queue to all clients.
io.on("connection", async (socket) => {
  console.log("Client connected:", socket.id);

  try {
    socket.emit("queue:update", await getQueueData(pool, false));
  } catch (error) {
    console.error("Initial queue load failed:", error.message);
    socket.emit("queue:error", {
      message: "Could not load the queue.",
    });
  }

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

initializeDatabase()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`MediTrack backend running at http://localhost:${PORT}`);

      if (!JWT_SECRET) {
        console.error("WARNING: Add JWT_SECRET to your .env file.");
      }
    });
  })
  .catch((error) => {
    console.error("MediTrack startup failed:", error.message);
    process.exit(1);
  });