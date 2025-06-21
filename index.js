const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  cors: {
    origin: "http://localhost:3000", // Replace with your React app's origin if different
    methods: ["GET", "POST"],
  },
});

app.use(express.json());

// Root route
app.get("/", (req, res) => {
  res.send("Hello, Express with Socket.io!");
});

// POST /api/userprompt endpoint
app.post("/api/userprompt", (req, res) => {
  const { prompt } = req.body;
  // Emit the prompt to all connected clients via socket.io
  io.emit("userprompt", { prompt, status: "acknowledged" });
  res.json({ message: "acknowledged" });
});

io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });

  // Listen for userprompt_response from the client
  socket.on("userprompt", (data) => {
    console.log("Received userprompt_response:", data);
    // Send acknowledgement back to the client
    socket.emit("userprompt", { message: "acknowledged", received: data });
  });

  // Example: Listen for a custom event from the client
  socket.on("sendMessage", (message) => {
    console.log("Message received:", message);
    // Example: Broadcast the message to all connected clients
    io.emit("receiveMessage", message);
  });
});

const PORT = process.env.PORT || 4000;
http.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
