import { createServer } from "node:net";
import { createSecureContext, TLSSocket } from "node:tls";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

export async function makeCertificate(directory) {
  const keyPath = join(directory, "server-key.pem"), caPath = join(directory, "local-ca.pem");
  const candidates = process.platform === "win32" ? ["C:/Program Files/Git/usr/bin/openssl.exe", "openssl"] : ["openssl"];
  for (const executable of candidates) {
    const successful = await new Promise((done) => {
      const child = spawn(executable, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", caPath, "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-addext", "basicConstraints=critical,CA:TRUE"], { stdio: "ignore", windowsHide: true });
      child.once("error", () => done(false)); child.once("exit", (code) => done(code === 0));
    });
    if (successful) return { caPath, key: await readFile(keyPath), cert: await readFile(caPath) };
  }
  throw new Error("An installed OpenSSL executable is required for the isolated SMTP TLS fixture");
}

/** Local test protocol only. No production recipient, credential or provider
 * endpoint is accepted. Message capabilities stay in memory and are not logged. */
export async function startSmtpFixture() {
  const directory = await mkdtemp(join(tmpdir(), "amar-newsletter-smtp-"));
  const sockets = new Set(), messages = [], user = `local-${randomBytes(8).toString("hex")}`, password = randomBytes(32).toString("hex");
  let server, rejectRecipients = false, tlsSessions = 0, plaintextAuth = 0;
  const close = async () => {
    for (const socket of sockets) socket.destroy(); sockets.clear();
    if (server?.listening) await new Promise((done) => server.close(done));
    const absolute = resolve(directory), actual = await realpath(directory), parent = await realpath(tmpdir());
    const comparable = (value) => process.platform === "win32" ? value.toLowerCase() : value;
    if (comparable(actual) !== comparable(absolute) || comparable(dirname(actual)) !== comparable(parent) || !/^amar-newsletter-smtp-[A-Za-z0-9]+$/.test(basename(actual))) throw new Error("Refusing to remove an unexpected SMTP fixture directory");
    await rm(absolute, { recursive: true, force: false });
  };
  try {
    const certificate = await makeCertificate(directory), secureContext = createSecureContext({ key: certificate.key, cert: certificate.cert, minVersion: "TLSv1.2" });
    server = createServer((plain) => {
      const state = { secure: false, authenticated: false, input: "", data: false, lines: [], bytes: 0, recipient: null, login: null, loginUser: null };
      function track(socket) { sockets.add(socket); socket.on("error", () => socket.destroy()); socket.once("close", () => sockets.delete(socket)); }
      track(plain); plain.write("220 localhost isolated SMTP fixture\r\n");
      function attach(socket) {
        const authenticated = (suppliedUser, suppliedPassword) => { state.authenticated = suppliedUser === user && suppliedPassword === password; socket.write(state.authenticated ? "235 2.7.0 Authenticated\r\n" : "535 5.7.8 Authentication failed\r\n"); };
        function line(text) {
          if (state.data) {
            if (text === ".") { state.data = false; messages.push({ recipient: state.recipient, raw: state.lines.join("\r\n") }); state.lines = []; socket.write("250 2.0.0 Stored in isolated fixture\r\n"); }
            else { state.lines.push(text.startsWith("..") ? text.slice(1) : text); state.bytes += Buffer.byteLength(text); if (state.bytes > 65536) socket.destroy(); }
            return true;
          }
          if (state.login === "USER") { state.loginUser = Buffer.from(text, "base64").toString("utf8"); state.login = "PASSWORD"; socket.write("334 UGFzc3dvcmQ6\r\n"); return true; }
          if (state.login === "PASSWORD") { state.login = null; authenticated(state.loginUser, Buffer.from(text, "base64").toString("utf8")); return true; }
          const [command] = text.split(" "), upper = command.toUpperCase();
          if (upper === "EHLO" || upper === "HELO") socket.write(state.secure ? "250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 65536\r\n" : "250-localhost\r\n250-STARTTLS\r\n250 SIZE 65536\r\n");
          else if (upper === "STARTTLS" && !state.secure) {
            socket.write("220 2.0.0 Start TLS\r\n"); socket.removeListener("data", receive); state.input = ""; state.secure = true; tlsSessions++;
            const secured = new TLSSocket(socket, { isServer: true, secureContext }); track(secured); attach(secured); return false;
          } else if (upper === "AUTH") {
            if (!state.secure) { plaintextAuth++; socket.write("530 5.7.0 TLS required\r\n"); }
            else if (/^AUTH PLAIN /i.test(text)) { const pieces = Buffer.from(text.split(" ")[2], "base64").toString("utf8").split("\0"); authenticated(pieces.at(-2), pieces.at(-1)); }
            else if (/^AUTH LOGIN$/i.test(text)) { state.login = "USER"; socket.write("334 VXNlcm5hbWU6\r\n"); }
            else socket.write("504 5.5.4 Unsupported authentication\r\n");
          } else if (upper === "MAIL") { state.recipient = null; state.bytes = 0; socket.write(state.authenticated ? "250 2.1.0 Sender accepted\r\n" : "530 5.7.0 Authentication required\r\n"); }
          else if (upper === "RCPT") {
            const recipient = text.match(/^RCPT TO:<([^>]+)>/i)?.[1];
            if (!state.authenticated) socket.write("530 5.7.0 Authentication required\r\n");
            else if (rejectRecipients || !recipient?.endsWith(".invalid")) socket.write("550 5.1.1 Controlled recipient rejection\r\n");
            else { state.recipient = recipient; socket.write("250 2.1.5 Recipient accepted\r\n"); }
          } else if (upper === "DATA") { if (!state.recipient) socket.write("503 5.5.1 Recipient required\r\n"); else { state.data = true; state.lines = []; socket.write("354 End data with a single dot\r\n"); } }
          else if (upper === "QUIT") socket.end("221 2.0.0 Closing\r\n");
          else if (upper === "RSET" || upper === "NOOP") socket.write("250 2.0.0 OK\r\n");
          else socket.write("502 5.5.1 Unsupported command\r\n");
          return true;
        }
        function receive(chunk) {
          state.input += chunk.toString("utf8"); if (state.input.length > 131072) return socket.destroy();
          let end; while ((end = state.input.indexOf("\r\n")) >= 0) { const current = state.input.slice(0, end); state.input = state.input.slice(end + 2); if (!line(current)) break; }
        }
        socket.on("data", receive);
      }
      attach(plain);
    });
    await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
    return { port: server.address().port, host: "127.0.0.1", caPath: certificate.caPath, user, password, messages, rejectRecipients: (value) => { rejectRecipients = Boolean(value); }, counters: () => ({ tlsSessions, plaintextAuth }), close };
  } catch (error) { await close(); throw error; }
}
