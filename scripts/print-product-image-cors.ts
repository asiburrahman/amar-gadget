import "dotenv/config";
import { readApplicationOrigin } from "../config/runtime";

try {
  console.log(JSON.stringify([{ AllowedOrigins: [readApplicationOrigin()], AllowedMethods: ["PUT", "GET", "HEAD"], AllowedHeaders: ["content-type", "content-length", "if-none-match", "cache-control"], ExposeHeaders: ["ETag"], MaxAgeSeconds: 300 }], null, 2));
} catch { console.error("Set a valid canonical APP_URL before generating bucket CORS."); process.exitCode = 1; }
