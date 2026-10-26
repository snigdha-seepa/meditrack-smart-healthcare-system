
require("dotenv").config();

const { Pool } = require("pg");
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

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
  console.error("Unexpected PostgreSQL error:", error.message);
});

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

const PORT = 5000;

// Database status values used by this application.
const WAITING_STATUSES = ["Waiting", "Booked"];
const CONSULTING_STATUSES = ["In-Consultation", "In Consultation"];

// Convert a database appointment into the frontend queue format.
function formatPatient(row) {
  let status = row.status;

  if (WAITING_STATUSES.includes(status)) {
    status = "Waiting";
  } else if (CONSULTING_STATUSES.includes(status)) {
    status = "In Consultation";
  }

  return {
    token: `A-${String(row.appointment_id).padStart(3, "0")}`,
    patient: row.patient_name,
    status,
    appointmentId: row.appointment_id,
  };
}

// Read the active queue directly from PostgreSQL.
// This also restores the queue after a server restart.
async function getQueueData(db = pool) {
  const result = await db.query(
    `SELECT appointment_id, patient_name, status, appointment_at
     FROM meditrack.appointments
     WHERE status = ANY($1::text[])
        OR status = ANY($2::text[])
     ORDER BY appointment_at ASC NULLS LAST, appointment_id ASC`,
    [WAITING_STATUSES, CONSULTING_STATUSES]
  );

  const queue = result.rows.map(formatPatient);

  const currentPatient = queue.find(
    (patient) => patient.status === "In Consultation"
  );

  return {
    queue,
    currentToken: currentPatient?.token || null,
    waitingCount: queue.filter(
      (patient) => patient.status === "Waiting"
    ).length,
  };
}

async function broadcastQueue() {
  try {
    const data = await getQueueData();
    io.emit("queue:update", data);
  } catch (error) {
    console.error("Could not broadcast queue:", error.message);
  }
}

// Root route
app.get("/", (req, res) => {
  res.json({ message: "MediTrack backend is running!" });
});

// PostgreSQL connection test
app.get("/api/db-test", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database_name,
        EXISTS (
          SELECT 1
          FROM information_schema.tables
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
      error: error.message,
    });
  }
});

// Book an appointment and add it to the persistent queue.
app.post("/api/appointments", async (req, res) => {
  const {
    patient_name,
    doctor_name,
    department,
    appointment_at,
  } = req.body;

  if (
    typeof patient_name !== "string" ||
    !patient_name.trim() ||
    typeof doctor_name !== "string" ||
    !doctor_name.trim() ||
    typeof department !== "string" ||
    !department.trim() ||
    !appointment_at
  ) {
    return res.status(400).json({
      message: "Please fill all appointment fields.",
    });
  }

  const date = new Date(appointment_at);

  if (Number.isNaN(date.getTime()) || date <= new Date()) {
    return res.status(400).json({
      message: "Please select a valid future appointment time.",
    });
  }

  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO meditrack.appointments
        (patient_name, doctor_name, department, appointment_at, status)
       VALUES ($1, $2, $3, $4, 'Waiting')
       RETURNING appointment_id, patient_name, doctor_name,
                 department, appointment_at, status`,
      [
        patient_name.trim(),
        doctor_name.trim(),
        department.trim(),
        date,
      ]
    );

    const appointment = result.rows[0];

    await client.query(
      `INSERT INTO meditrack.queue_events
        (appointment_id, event_type)
       VALUES ($1, $2)`,
      [appointment.appointment_id, "Waiting"]
    );

    await client.query("COMMIT");

    await broadcastQueue();

    res.status(201).json({
      message: "Appointment booked and added to the queue!",
      appointment,
      queueEntry: formatPatient(appointment),
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

    res.status(500).json({
      message: "Could not book appointment.",
      error: error.message,
    });
  } finally {
    if (client) client.release();
  }
});

// Get current queue from PostgreSQL.
app.get("/api/queue", async (req, res) => {
  try {
    res.json(await getQueueData());
  } catch (error) {
    console.error("Queue retrieval failed:", error.message);

    res.status(500).json({
      message: "Could not retrieve the queue.",
      error: error.message,
    });
  }
});

// Call next waiting patient and save all changes in one transaction.
app.post("/api/queue/next", async (req, res) => {
  let client;
  let transactionStarted = false;

  try {
    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // Lock the current consultation, if one exists.
    const currentResult = await client.query(
      `SELECT appointment_id
       FROM meditrack.appointments
       WHERE status = ANY($1::text[])
       ORDER BY appointment_at ASC NULLS LAST, appointment_id ASC
       LIMIT 1
       FOR UPDATE`,
      [CONSULTING_STATUSES]
    );

    // Lock the next waiting appointment.
    const nextResult = await client.query(
      `SELECT appointment_id
       FROM meditrack.appointments
       WHERE status = ANY($1::text[])
       ORDER BY appointment_at ASC NULLS LAST, appointment_id ASC
       LIMIT 1
       FOR UPDATE`,
      [WAITING_STATUSES]
    );

    const currentId = currentResult.rows[0]?.appointment_id;
    const nextId = nextResult.rows[0]?.appointment_id;

    // Complete the previous consultation.
    if (currentId !== undefined) {
      await client.query(
        `UPDATE meditrack.appointments
         SET status = 'Completed'
         WHERE appointment_id = $1`,
        [currentId]
      );

      await client.query(
        `INSERT INTO meditrack.queue_events
          (appointment_id, event_type)
         VALUES ($1, $2)`,
        [currentId, "Completed"]
      );
    }

    // Start the next consultation.
    if (nextId !== undefined) {
      await client.query(
        `UPDATE meditrack.appointments
         SET status = 'In-Consultation'
         WHERE appointment_id = $1`,
        [nextId]
      );

      await client.query(
        `INSERT INTO meditrack.queue_events
          (appointment_id, event_type)
         VALUES ($1, $2)`,
        [nextId, "Consultation-Started"]
      );
    }

    await client.query("COMMIT");
    transactionStarted = false;

    const data = await getQueueData();
    io.emit("queue:update", data);

    res.json({
      message:
        nextId !== undefined
          ? "Next patient called and saved to PostgreSQL."
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

    res.status(500).json({
      message: "Could not update the queue.",
      error: error.message,
    });
  } finally {
    if (client) client.release();
  }
});

// Socket.IO connection
io.on("connection", async (socket) => {
  console.log("Client connected:", socket.id);

  try {
    socket.emit("queue:update", await getQueueData());
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

// Start server
server.listen(PORT, () => {
  console.log(
    `MediTrack backend running on http://localhost:${PORT}`
  );
});
