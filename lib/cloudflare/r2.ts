import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { readStorageConfig } from "@/config/runtime";


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
  if (!Number.isFinite(maxSizeInBytes) || maxSizeInBytes <= 0) {
    throw new Error("File size must be a positive number.");
  }

  // 3. Filename sanitation (Prevents path traversal attacks like ../)
  const sanitizedFilename = filename
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .substring(0, 100);

  const key = `uploads/${Date.now()}-${sanitizedFilename}`;

  const config = readStorageConfig();
  const bucketName = config.R2_BUCKET_NAME;
  const s3Client = new S3Client({
    region: "auto", endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.R2_ACCESS_KEY_ID, secretAccessKey: config.R2_SECRET_ACCESS_KEY },
  });

  try {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: contentType,
      ContentLength: maxSizeInBytes,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return { uploadUrl: url, fileKey: key };
  } catch (error) {
    console.error("Failed to generate presigned upload URL:", error);
    throw new Error("Cloudflare R2 storage error occurred");
  }
}