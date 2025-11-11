const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");

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

// Serve uploads directory
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Serve static assets from frontend/dist
const distPath = path.join(__dirname, "../frontend/dist");

// Serve assets folder (JS, CSS files)
app.use("/assets", express.static(path.join(distPath, "assets")));

// Serve root-level static files (images like logo.png, task-logo.webp)
app.get("/logo.png", (req, res) => {
  res.sendFile(path.join(distPath, "logo.png"));
});
app.get("/task-logo.webp", (req, res) => {
  res.sendFile(path.join(distPath, "task-logo.webp"));
});

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

// Serve SPA - This MUST be the absolute last route
// This catches all routes that don't match API, uploads, or static files
// and serves index.html so React Router can handle client-side routing
app.get("*", (req, res) => {
  // Don't serve index.html for API routes (should have been handled already)
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ success: false, message: "API route not found" });
  }
  
  // Don't serve index.html for uploads (should have been handled already)
  if (req.path.startsWith("/uploads")) {
    return res.status(404).json({ success: false, message: "File not found" });
  }
  
  // Don't serve index.html for assets (should have been handled already)
  if (req.path.startsWith("/assets")) {
    return res.status(404).send("Asset not found");
  }
  
  // Don't serve index.html for static files with extensions (except .html)
  if (/\.[^/]+$/.test(req.path) && !req.path.endsWith(".html")) {
    return res.status(404).send("File not found");
  }
  
  // Try multiple possible paths for index.html (for different deployment environments)
  const possiblePaths = [
    path.join(__dirname, "../frontend/dist", "index.html"),
    path.join(__dirname, "../frontend/dist/index.html"),
    path.join(process.cwd(), "frontend/dist/index.html"),
    path.join(process.cwd(), "frontend/dist", "index.html"),
  ];
  
  let indexPath = null;
  for (const possiblePath of possiblePaths) {
    if (fs.existsSync(possiblePath)) {
      indexPath = possiblePath;
      break;
    }
  }
  
  if (!indexPath) {
    console.error(`index.html not found. Tried paths:`, possiblePaths);
    console.error(`Current __dirname: ${__dirname}`);
    console.error(`Current process.cwd(): ${process.cwd()}`);
    return res.status(500).send("Application not built. Please run 'npm run build' in the frontend directory.");
  }
  
  // Serve index.html for all SPA routes (like /logs, /templates, /participants, etc.)
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error("Error sending index.html:", err);
      if (!res.headersSent) {
        res.status(500).send("Error loading application");
      }
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
