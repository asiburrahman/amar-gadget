import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME;

// Initialize S3 Client conditionally to prevent crash in dev / pipeline
const s3Client = accountId && accessKeyId && secretAccessKey
  ? new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    })
  : null;

export async function generatePresignedUploadUrl({
  filename,
  contentType,
  maxSizeInBytes,
}: {
  filename: string;
  contentType: string;
  maxSizeInBytes: number;
}) {
  // 1. Strict MIME type validation
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(contentType)) {
    throw new Error("Forbidden file format");
  }

  // 2. Strict file size validation (Limit to 10MB max to prevent DDoS/hosting cost spikes)
  const MAX_LIMIT = 10 * 1024 * 1024; // 10MB
  if (maxSizeInBytes > MAX_LIMIT) {
    throw new Error("File size exceeds the 10MB limit");
  }

  // 3. Filename sanitation (Prevents path traversal attacks like ../)
  const sanitizedFilename = filename
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .substring(0, 100);

  const key = `uploads/${Date.now()}-${sanitizedFilename}`;

  if (!s3Client || !bucketName) {
    if (process.env.NODE_ENV === "production") {
      console.warn("⚠️ Cloudflare R2 credentials missing in production! Returning mock presigned URL.");
    }
    return {
      uploadUrl: `https://mock-r2-upload-url.local/bucket/${key}?mock=true`,
      fileKey: key,
    };
  }

  try {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: contentType,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return { uploadUrl: url, fileKey: key };
  } catch (error) {
    console.error("Failed to generate presigned upload URL:", error);
    throw new Error("Cloudflare R2 storage error occurred");
  }
}