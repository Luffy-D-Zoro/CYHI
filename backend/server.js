require("dotenv").config();

const http = require("http");
const cors = require("cors");
const express = require("express");
const { Server } = require("socket.io");
const connectDB = require("./config/db");
const collaborationsRouter = require("./routes/collaborations");
const joinRouter = require("./routes/join");
const formsRouter = require("./routes/forms");
const errorHandler = require("./middleware/errorHandler");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ message: "CYHI backend is running" });
});

app.use("/api/collaborations", collaborationsRouter);
app.use("/api/join", joinRouter);
app.use("/api/forms", formsRouter);

app.use(errorHandler);

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on("disconnect", (reason) => {
    console.log(`Socket disconnected: ${socket.id} (${reason})`);
  });
});

async function start() {
  await connectDB();

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Backend listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err.message);
  process.exit(1);
});