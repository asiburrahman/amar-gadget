const http = require("http");

const payload = JSON.stringify({
  email: "admin@amargadget.com",
  password: "AdminPassword123!"
});

const req = http.request("http://localhost:3000/api/auth/login", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload)
  }
}, (res) => {
  let data = "";
  res.on("data", chunk => data += chunk);
  res.on("end", () => {
    console.log("Status Code:", res.statusCode);
    console.log("Headers:", res.headers);
    console.log("Response Body:", data);
  });
});

req.on("error", (err) => {
  console.error("HTTP Request Error:", err.message);
});

req.write(payload);
req.end();
