// server.js
require("dotenv").config(); // Load .env
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function serveFile(filePath, contentType, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      return res.end("Error loading file.");
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  // Provide Supabase config
  if (req.url === "/config") {
    const configData = {
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(configData));
  }

  // Serve static files
  if (req.url === "/") {
    serveFile(path.join(__dirname, "index.html"), "text/html", res);
  } else if (req.url === "/script.js") {
    serveFile(path.join(__dirname, "script.js"), "text/javascript", res);
  } else if (req.url === "/style.css") {
    serveFile(path.join(__dirname, "style.css"), "text/css", res);
  } else {
    // 404
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
