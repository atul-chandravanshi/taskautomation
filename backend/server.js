const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || true,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || true,
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Serve static files from frontend/dist (CSS, JS, images, etc.)
// This serves actual files (like assets/index.js, assets/index.css) but passes through for routes
app.use(express.static(path.join(__dirname, "../frontend/dist")));

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// Make io accessible to routes
app.set("io", io);

// Set io instance for scheduler
const scheduler = require("./utils/scheduler");
scheduler.setIoInstance(io);

// Set io instance for certificate scheduler
const certificateScheduler = require("./utils/certificateScheduler");
certificateScheduler.setIoInstance(io);

// Database connection
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB connected successfully"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/excel", require("./routes/excel"));
app.use("/api/templates", require("./routes/templates"));
app.use("/api/emails", require("./routes/emails"));
app.use("/api/certificates", require("./routes/certificates"));
app.use("/api/events", require("./routes/events"));
app.use("/api/analytics", require("./routes/analytics"));
app.use("/api/logs", require("./routes/logs"));
app.use("/api/dashboard", require("./routes/dashboard"));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Server Error",
  });
});

// Serve SPA for all non-API, non-static routes (supports direct links and page refreshes)
// This must be the last route to catch all routes that don't match API or static files
app.get("*", (req, res, next) => {
  // Skip if it's an API route or uploads route
  if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) {
    return next();
  }
  
  // Skip if it's a static file request (has file extension like .js, .css, .png, etc.)
  const hasFileExtension = /\.[^/]+$/.test(req.path);
  if (hasFileExtension) {
    return next();
  }
  
  // Serve index.html for all SPA routes (this allows React Router to handle routing)
  const indexPath = path.join(__dirname, "../frontend/dist", "index.html");
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error("Error sending index.html:", err);
      res.status(500).send("Error loading application");
    }
  });
});

const PORT = Number(process.env.PORT) || 5000;

// Helpful startup logs
console.log(
  `Starting server with config: PORT=${PORT}, FRONTEND_URL=${process.env.FRONTEND_URL || "not set"}`
);

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Either stop the running process on this port or set a different PORT in your environment.`
    );
  } else {
    console.error("Server startup error:", err);
  }
  process.exit(1);
});

server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);

  // Load and reschedule pending emails
  const loadScheduledEmails = require("./utils/loadScheduledEmails");
  await loadScheduledEmails(io);

  // Start certificate scheduler (runs daily at 11:59 PM)
  try {
    certificateScheduler.startDailyScheduler();
  } catch (error) {
    console.error("Failed to start certificate scheduler:", error);
  }
});

module.exports = { app, io };
