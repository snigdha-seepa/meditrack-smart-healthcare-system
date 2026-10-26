import { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

const API_URL = "http://localhost:5000";
const TOKEN_KEY = "meditrack_token";

const DOCTORS = [
  "Dr. Priya Sharma",
  "Dr. Demo",
];

const DEPARTMENTS = [
  "General Medicine",
  "Cardiology",
  "Dermatology",
  "Orthopedics",
];

function getLocalDateTimeMin() {
  const date = new Date(Date.now() + 60000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

async function apiRequest(path, options = {}, token = "") {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Something went wrong.");
  }

  return data;
}

function App() {
  const [token, setToken] = useState(
    () => sessionStorage.getItem(TOKEN_KEY) || ""
  );
  const [user, setUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);

  const [selectedRole, setSelectedRole] = useState("patient");
  const [authMode, setAuthMode] = useState("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [authLoading, setAuthLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");

  const [queueData, setQueueData] = useState({
    queue: [],
    currentToken: null,
    waitingCount: 0,
  });
  const [staffQueue, setStaffQueue] = useState([]);
  const [connected, setConnected] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);

  const [doctorName, setDoctorName] = useState(DOCTORS[0]);
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  const [appointmentAt, setAppointmentAt] = useState("");
  const [bookingLoading, setBookingLoading] = useState(false);
  const [appointments, setAppointments] = useState([]);

  const logout = useCallback((message = "") => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken("");
    setUser(null);
    setStaffQueue([]);
    setAppointments([]);
    setPageError("");
    setNotice(message);
    setAuthMode("login");
    setPassword("");
  }, []);

  // Verify an existing session with the backend.
  useEffect(() => {
    let active = true;

    async function verifySession() {
      if (!token) {
        setAuthChecking(false);
        return;
      }

      try {
        const data = await apiRequest("/api/auth/me", {}, token);

        if (active) {
          setUser(data.user);
        }
      } catch {
        if (active) {
          logout("Please log in again.");
        }
      } finally {
        if (active) setAuthChecking(false);
      }
    }

    verifySession();

    return () => {
      active = false;
    };
  }, [token, logout]);

  // The public socket sends only queue tokens and statuses.
  useEffect(() => {
    const socket = io(API_URL);

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("queue:update", (data) => {
      setQueueData({
        queue: data.queue || [],
        currentToken: data.currentToken || null,
        waitingCount: data.waitingCount || 0,
      });
    });

    socket.on("queue:error", (data) => {
      setPageError(data.message || "Unable to load the live queue.");
    });

    return () => socket.disconnect();
  }, []);

  const refreshPublicQueue = useCallback(async () => {
    const data = await apiRequest("/api/queue");

    setQueueData({
      queue: data.queue || [],
      currentToken: data.currentToken || null,
      waitingCount: data.waitingCount || 0,
    });
  }, []);

  const refreshStaffQueue = useCallback(async (activeToken) => {
    const data = await apiRequest(
      "/api/queue/staff",
      {},
      activeToken
    );

    setStaffQueue(data.queue || []);
  }, []);

  const refreshAppointments = useCallback(async (activeToken) => {
    const data = await apiRequest(
      "/api/appointments/mine",
      {},
      activeToken
    );

    setAppointments(data.appointments || []);
  }, []);

  // Load data for the signed-in role.
  useEffect(() => {
    if (!user || !token) return;

    let active = true;

    async function loadDashboard() {
      setPageError("");

      try {
        await refreshPublicQueue();

        if (!active) return;

        if (user.role === "patient") {
          await refreshAppointments(token);
        } else if (
          user.role === "doctor" ||
          user.role === "admin"
        ) {
          await refreshStaffQueue(token);
        }
      } catch (error) {
        if (active) {
          setPageError(error.message);
        }
      }
    }

    loadDashboard();

    return () => {
      active = false;
    };
  }, [
    user,
    token,
    refreshPublicQueue,
    refreshStaffQueue,
    refreshAppointments,
  ]);

  async function handleAuthentication(event) {
    event.preventDefault();
    if (authLoading) return;

    setAuthLoading(true);
    setPageError("");
    setNotice("");

    try {
      let result;

      if (authMode === "register" && selectedRole === "patient") {
        result = await apiRequest("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({
            full_name: fullName,
            email,
            password,
          }),
        });
      } else {
        result = await apiRequest("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
      }

      // A selected portal does not grant a role.
      // The backend's actual account role decides access.
      if (result.user.role !== selectedRole) {
        setPageError(
          `This account belongs to the ${result.user.role} portal. ` +
          "Choose the matching portal and log in again."
        );
        return;
      }

      sessionStorage.setItem(TOKEN_KEY, result.token);
      setUser(result.user);
      setToken(result.token);
      setPassword("");
      setNotice(result.message || "Welcome to MediTrack.");
    } catch (error) {
      setPageError(error.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function bookAppointment(event) {
    event.preventDefault();
    if (bookingLoading) return;

    setBookingLoading(true);
    setPageError("");
    setNotice("");

    try {
      const result = await apiRequest(
        "/api/appointments",
        {
          method: "POST",
          body: JSON.stringify({
            doctor_name: doctorName,
            department,
            appointment_at: appointmentAt,
          }),
        },
        token
      );

      setNotice(
        `${result.message} Your token is ${
          result.queueEntry?.token || "being updated"
        }.`
      );

      setAppointmentAt("");

      await Promise.all([
        refreshAppointments(token),
        refreshPublicQueue(),
      ]);
    } catch (error) {
      setPageError(error.message);

      if (/log in|expired|invalid/i.test(error.message)) {
        logout("Your session has expired. Please log in again.");
      }
    } finally {
      setBookingLoading(false);
    }
  }

  async function callNextPatient() {
    if (queueLoading) return;

    setQueueLoading(true);
    setPageError("");
    setNotice("");

    try {
      const result = await apiRequest(
        "/api/queue/next",
        { method: "POST" },
        token
      );

      setStaffQueue(result.queue || []);
      setQueueData({
        queue: (result.queue || []).map((item) => ({
          token: item.token,
          status: item.status,
          appointmentId: item.appointmentId,
        })),
        currentToken: result.currentToken || null,
        waitingCount: result.waitingCount || 0,
      });

      setNotice(result.message);
      await refreshStaffQueue(token);
    } catch (error) {
      setPageError(error.message);
    } finally {
      setQueueLoading(false);
    }
  }

  function switchRole(role) {
    setSelectedRole(role);
    setAuthMode("login");
    setPageError("");
    setNotice("");
  }

  if (authChecking) {
    return (
      <main className="screen-center">
        <div className="loading-card">
          <div className="brand-mark">M</div>
          <h2>MediTrack</h2>
          <p>Checking your session...</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-intro">
          <div className="brand-lockup">
            <div className="brand-mark">M</div>
            <div>
              <h2>MediTrack</h2>
              <p>Healthcare made simpler</p>
            </div>
          </div>

          <div className="auth-intro-copy">
            <span className="eyebrow">YOUR HEALTH, ORGANIZED</span>
            <h1>Less waiting.<br />More caring.</h1>
            <p>
              Book appointments, follow the live queue and get
              connected with the right healthcare team.
            </p>
            <div className="intro-points">
              <span>✓ Appointment booking</span>
              <span>✓ Live queue tracking</span>
              <span>✓ Dedicated role-based portals</span>
            </div>
          </div>
          <p className="intro-footer">MediTrack · Healthcare management</p>
        </section>

        <section className="auth-panel">
          <form className="auth-card" onSubmit={handleAuthentication}>
            <span className="eyebrow">WELCOME TO MEDITRACK</span>
            <h2>{authMode === "register" ? "Create your account" : "Sign in"}</h2>
            <p className="muted">
              Choose your portal to continue.
            </p>

            <div className="role-picker">
              {[
                { value: "patient", label: "Patient", icon: "♡" },
                { value: "doctor", label: "Doctor", icon: "⚕" },
                { value: "admin", label: "Admin", icon: "⚙" },
              ].map((role) => (
                <button
                  type="button"
                  key={role.value}
                  className={
                    selectedRole === role.value
                      ? "role-option selected"
                      : "role-option"
                  }
                  onClick={() => switchRole(role.value)}
                >
                  <span>{role.icon}</span>
                  {role.label}
                </button>
              ))}
            </div>

            {selectedRole === "patient" && (
              <div className="auth-mode-switch">
                <button
                  type="button"
                  className={authMode === "login" ? "active" : ""}
                  onClick={() => {
                    setAuthMode("login");
                    setPageError("");
                  }}
                >
                  Log in
                </button>
                <button
                  type="button"
                  className={authMode === "register" ? "active" : ""}
                  onClick={() => {
                    setAuthMode("register");
                    setPageError("");
                  }}
                >
                  Register
                </button>
              </div>
            )}

            {selectedRole !== "patient" && (
              <p className="helper-note">
                Staff accounts must be created or approved by an
                authorized administrator.
              </p>
            )}

            {authMode === "register" && selectedRole === "patient" && (
              <label className="field">
                Full name
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Enter your full name"
                  autoComplete="name"
                  minLength={2}
                  maxLength={120}
                  required
                />
              </label>
            )}

            <label className="field">
              Email address
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </label>

            <label className="field">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  authMode === "register"
                    ? "At least 8 characters"
                    : "Enter your password"
                }
                autoComplete={
                  authMode === "register"
                    ? "new-password"
                    : "current-password"
                }
                minLength={authMode === "register" ? 8 : undefined}
                maxLength={128}
                required
              />
            </label>

            {pageError && (
              <div className="alert error" role="alert">
                {pageError}
              </div>
            )}

            {notice && (
              <div className="alert success" role="status">
                {notice}
              </div>
            )}

            <button className="button primary full-width" disabled={authLoading}>
              {authLoading
                ? "Please wait..."
                : authMode === "register" && selectedRole === "patient"
                ? "Create patient account"
                : `Log in as ${selectedRole}`}
            </button>

            <p className="auth-disclaimer">
              Your portal is determined by your authorized account role.
            </p>
          </form>
        </section>
      </main>
    );
  }

  const isPatient = user.role === "patient";
  const isStaff = user.role === "doctor" || user.role === "admin";

  return (
    <div className="portal-shell">
      <aside className="sidebar">
        <div className="brand-lockup sidebar-brand">
          <div className="brand-mark">M</div>
          <div>
            <h2>MediTrack</h2>
            <p>Healthcare platform</p>
          </div>
        </div>

        <div className="sidebar-label">YOUR PORTAL</div>
        <div className="portal-role">
          <span className="role-avatar">
            {user.role === "patient" ? "P" : user.role === "doctor" ? "D" : "A"}
          </span>
          <div>
            <strong>
              {user.role.charAt(0).toUpperCase() + user.role.slice(1)} portal
            </strong>
            <span>{user.full_name || user.name}</span>
          </div>
        </div>

        <div className="sidebar-links">
          {isPatient && (
            <>
              <a href="#overview">Overview</a>
              <a href="#book-appointment">Book appointment</a>
              <a href="#my-appointments">My appointments</a>
              <a href="#live-queue">Live queue</a>
              <a href="#find-care">Find care</a>
            </>
          )}
          {user.role === "doctor" && (
            <>
              <a href="#overview">Overview</a>
              <a href="#doctor-queue">Patient queue</a>
              <a href="#consultations">Consultations</a>
            </>
          )}
          {user.role === "admin" && (
            <>
              <a href="#overview">Overview</a>
              <a href="#admin-queue">Queue overview</a>
              <a href="#admin-management">Management</a>
            </>
          )}
        </div>

        <div className="sidebar-bottom">
          <div className="connection-indicator">
            <span className={connected ? "status-dot online" : "status-dot"} />
            {connected ? "Live connection" : "Reconnecting"}
          </div>
          <button className="button outline full-width" onClick={() => logout()}>
            Log out
          </button>
        </div>
      </aside>

      <main className="portal-main">
        <header className="portal-topbar">
          <div>
            <span className="eyebrow">MEDITRACK WORKSPACE</span>
            <h1>
              {isPatient
                ? "Patient dashboard"
                : user.role === "doctor"
                ? "Doctor dashboard"
                : "Admin dashboard"}
            </h1>
          </div>
          <div className="topbar-user">
            <div className="user-avatar">
              {(user.full_name || user.name || "U").charAt(0).toUpperCase()}
            </div>
            <div>
              <strong>{user.full_name || user.name}</strong>
              <span>{user.email}</span>
            </div>
          </div>
        </header>

        {pageError && (
          <div className="alert error page-alert" role="alert">
            {pageError}
          </div>
        )}
        {notice && (
          <div className="alert success page-alert" role="status">
            {notice}
          </div>
        )}

        {isPatient && (
          <>
            <section className="welcome-banner" id="overview">
              <div>
                <span className="eyebrow">YOUR HEALTH, YOUR TIME</span>
                <h2>Hello, {user.full_name || user.name}!</h2>
                <p>
                  Book your next visit and follow the waiting queue
                  without needing to stand in line.
                </p>
              </div>
              <div className="welcome-icon">♡</div>
            </section>

            <section className="stats-grid">
              <StatCard
                label="My appointments"
                value={appointments.length}
                detail="Your bookings"
                icon="▣"
              />
              <StatCard
                label="Patients waiting"
                value={queueData.waitingCount}
                detail="Across the displayed queue"
                icon="◷"
              />
              <StatCard
                label="Now serving"
                value={queueData.currentToken || "—"}
                detail="Current consultation token"
                icon="➜"
              />
            </section>

            <section className="content-grid">
              <div className="panel" id="book-appointment">
                <PanelHeading
                  eyebrow="PLAN YOUR VISIT"
                  title="Book an appointment"
                  description="Choose a doctor, department and future appointment time."
                />

                <form className="portal-form" onSubmit={bookAppointment}>
                  <label className="field">
                    Doctor
                    <select
                      value={doctorName}
                      onChange={(e) => setDoctorName(e.target.value)}
                    >
                      {DOCTORS.map((doctor) => (
                        <option key={doctor}>{doctor}</option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    Department
                    <select
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                    >
                      {DEPARTMENTS.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    Appointment date and time
                    <input
                      type="datetime-local"
                      min={getLocalDateTimeMin()}
                      value={appointmentAt}
                      onChange={(e) => setAppointmentAt(e.target.value)}
                      required
                    />
                  </label>

                  <button
                    className="button primary"
                    disabled={bookingLoading}
                  >
                    {bookingLoading ? "Booking..." : "Confirm appointment"}
                  </button>
                </form>
              </div>

              <div className="panel" id="live-queue">
                <PanelHeading
                  eyebrow="REAL-TIME STATUS"
                  title="Live queue"
                  description="This queue shows tokens and statuses, not other patients' names."
                  action={<span className="live-pill">● LIVE</span>}
                />

                <div className="queue-highlight">
                  <span>Now serving</span>
                  <strong>{queueData.currentToken || "—"}</strong>
                </div>
                <div className="queue-highlight secondary-highlight">
                  <span>Waiting patients</span>
                  <strong>{queueData.waitingCount}</strong>
                </div>

                <QueueTable queue={queueData.queue} showNames={false} />
              </div>
            </section>

            <section className="panel" id="my-appointments">
              <PanelHeading
                eyebrow="YOUR VISITS"
                title="My appointments"
                description="Only appointments booked through your account appear here."
              />
              {appointments.length === 0 ? (
                <EmptyState text="You don't have any linked appointments yet. Book one above to get started." />
              ) : (
                <div className="appointment-cards">
                  {appointments.map((appointment) => (
                    <article
                      className="appointment-card"
                      key={appointment.appointment_id}
                    >
                      <div className="appointment-card-top">
                        <span className="token-label">
                          A-{String(appointment.appointment_id).padStart(3, "0")}
                        </span>
                        <StatusBadge status={appointment.status} />
                      </div>
                      <h3>{appointment.doctor_name}</h3>
                      <p>{appointment.department}</p>
                      <small>
                        {new Date(appointment.appointment_at).toLocaleString()}
                      </small>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="panel" id="find-care">
              <PanelHeading
                eyebrow="COMING NEXT"
                title="Find doctors and hospitals"
                description="The search and review directory is the next feature to connect to real database records."
              />
              <div className="feature-placeholder-grid">
                <FeatureTile icon="⌕" title="Doctor search" text="Search by specialty, hospital and availability." />
                <FeatureTile icon="＋" title="Hospital directory" text="Explore hospital and department information." />
                <FeatureTile icon="☆" title="Doctor reviews" text="View ratings and verified patient feedback." />
              </div>
            </section>
          </>
        )}

        {user.role === "doctor" && (
          <>
            <section className="welcome-banner" id="overview">
              <div>
                <span className="eyebrow">CLINICAL WORKSPACE</span>
                <h2>Welcome, {user.full_name || user.name}</h2>
                <p>
                  Monitor the active queue and advance the next
                  patient when ready.
                </p>
              </div>
              <div className="welcome-icon">⚕</div>
            </section>

            <section className="stats-grid">
              <StatCard label="Waiting" value={staffQueue.filter((p) => p.status === "Waiting").length} detail="Patients awaiting consultation" icon="◷" />
              <StatCard label="Now serving" value={queueData.currentToken || "—"} detail="Current token" icon="➜" />
              <StatCard label="Live status" value={connected ? "Online" : "Offline"} detail="Queue connection" icon="●" />
            </section>

            <section className="panel" id="doctor-queue">
              <PanelHeading
                eyebrow="PATIENT FLOW"
                title="Today's patient queue"
                description="Patient details are visible in this staff portal."
                action={
                  <button
                    className="button primary"
                    onClick={callNextPatient}
                    disabled={
                      queueLoading ||
                      !staffQueue.some((p) => p.status === "Waiting")
                    }
                  >
                    {queueLoading ? "Updating..." : "Call next patient →"}
                  </button>
                }
              />
              <QueueTable queue={staffQueue} showNames />
            </section>

            <section className="panel" id="consultations">
              <PanelHeading
                eyebrow="CONSULTATION WORKSPACE"
                title="Consultation records"
                description="Consultation notes and patient-history features will be added after the core portal is tested."
              />
              <EmptyState text="Your live queue and Call Next Patient workflow are connected. Detailed clinical records are not implemented yet." />
            </section>
          </>
        )}

        {user.role === "admin" && (
          <>
            <section className="welcome-banner" id="overview">
              <div>
                <span className="eyebrow">SYSTEM MANAGEMENT</span>
                <h2>Welcome, {user.full_name || user.name}</h2>
                <p>
                  Monitor the shared queue and access administrative
                  workspace features.
                </p>
              </div>
              <div className="welcome-icon">⚙</div>
            </section>

            <section className="stats-grid">
              <StatCard label="Active queue" value={queueData.queue.length} detail="Waiting and in consultation" icon="▤" />
              <StatCard label="Waiting" value={queueData.waitingCount} detail="Awaiting consultation" icon="◷" />
              <StatCard label="Live connection" value={connected ? "Online" : "Offline"} detail="Socket.IO status" icon="●" />
            </section>

            <section className="panel" id="admin-queue">
              <PanelHeading
                eyebrow="OPERATIONS"
                title="Queue overview"
                description="Authorized admins can advance the queue."
                action={
                  <button
                    className="button primary"
                    onClick={callNextPatient}
                    disabled={
                      queueLoading ||
                      !staffQueue.some((p) => p.status === "Waiting")
                    }
                  >
                    {queueLoading ? "Updating..." : "Call next patient →"}
                  </button>
                }
              />
              <QueueTable queue={staffQueue} showNames />
            </section>

            <section className="panel" id="admin-management">
              <PanelHeading
                eyebrow="ADMINISTRATION"
                title="Management workspace"
                description="These areas will be connected to dedicated management APIs in the next phase."
              />
              <div className="feature-placeholder-grid">
                <FeatureTile icon="⚕" title="Doctor accounts" text="Approve staff accounts and manage specialties." />
                <FeatureTile icon="♙" title="Patient accounts" text="Review account status and assist with account issues." />
                <FeatureTile icon="＋" title="Hospitals & departments" text="Manage hospitals, departments and services." />
                <FeatureTile icon="▥" title="Reports" text="Track appointments, waiting time and queue activity." />
              </div>
            </section>
          </>
        )}

        <footer className="portal-footer">
          <strong>MediTrack</strong>
          <span>Healthcare appointment and live queue management</span>
        </footer>
      </main>
    </div>
  );
}

function PanelHeading({ eyebrow, title, description, action }) {
  return (
    <div className="panel-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="panel-action">{action}</div>}
    </div>
  );
}

function StatCard({ label, value, detail, icon }) {
  return (
    <article className="stat-card">
      <div className="stat-card-top">
        <span>{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function StatusBadge({ status }) {
  const normalized = String(status || "Unknown")
    .toLowerCase()
    .replaceAll(" ", "-");

  return (
    <span className={`status-badge status-${normalized}`}>
      {status || "Unknown"}
    </span>
  );
}

function QueueTable({ queue, showNames }) {
  if (!queue.length) {
    return <EmptyState text="There are no active queue entries at the moment." />;
  }

  return (
    <div className="table-wrap">
      <table className="queue-table">
        <thead>
          <tr>
            <th>Token</th>
            {showNames && <th>Patient</th>}
            {showNames && <th>Department</th>}
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {queue.map((patient) => (
            <tr key={patient.token}>
              <td><strong className="table-token">{patient.token}</strong></td>
              {showNames && <td>{patient.patient || "—"}</td>}
              {showNames && <td>{patient.department || "—"}</td>}
              <td><StatusBadge status={patient.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>;
}

function FeatureTile({ icon, title, text }) {
  return (
    <article className="feature-tile">
      <span>{icon}</span>
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
    </article>
  );
}

export default App;