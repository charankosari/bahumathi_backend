import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";

const s3Client = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});

export class Uploader {
  async uploadPublicFile(fileName, fileBuffer) {
    const folderName = "public";
    try {
      const upload = new Upload({
        client: s3Client,
        params: {
          Bucket: process.env.S3_BUCKET,
          ACL: "public-read",
          Body: fileBuffer,
          Key: `${folderName}/${fileName}`,
        },
      });

      await upload.done();

      return `${process.env.S3_URL}/bahumati/${folderName}/${fileName}`;
    } catch (err) {
      console.error("❌ Error during public file upload:", err);
      throw err;
    }
  }

  async uploadPrivateFile(fileName, fileBuffer) {
    const folderName = "private";
    try {
      const upload = new Upload({
        client: s3Client,
        params: {
          Bucket: process.env.S3_BUCKET,
          ACL: "private",
          Body: fileBuffer,
          Key: `${folderName}/${fileName}`,
        },
      });

      await upload.done();

      return `${folderName}/${fileName}`;
    } catch (err) {
      console.error("❌ Error during private file upload:", err);
      throw err;
    }
  }

  static async generatePresignedUrl(fileKey) {
    try {
      const command = new GetObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: fileKey,
      });

      const signedUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 3600,
      });
      return signedUrl;
    } catch (err) {
      console.error("❌ Error generating presigned URL:", err);
      throw err;
    }
  }
}
