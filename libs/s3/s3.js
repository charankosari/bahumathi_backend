const {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { Upload } = require("@aws-sdk/lib-storage");

const sharp = require("sharp");

const s3Client = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});

class Uploader {
  async compressImage(fileBuffer, quality) {
    if (quality === "low") {
      try {
        return await sharp(fileBuffer)
          .resize({ width: 1024, withoutEnlargement: true }) // Resize to max width 1024px
          .jpeg({ quality: 70 }) // Compress to 70% quality
          .toBuffer();
      } catch (error) {
        console.error("Error compressing image:", error);
        return fileBuffer; // Return original if compression fails
      }
    }
    return fileBuffer;
  }

  async uploadPublicFile(fileName, fileBuffer, quality = "low") {
    const folderName = "public";
    try {
      const processedBuffer = await this.compressImage(fileBuffer, quality);
      
      const upload = new Upload({
        client: s3Client,
        params: {
          Bucket: process.env.S3_BUCKET,
          ACL: "public-read",
          Body: processedBuffer,
          Key: `${folderName}/${fileName}`,
        },
      });

      await upload.done();

      return `${process.env.S3_URL}/${folderName}/${fileName}`;
    } catch (err) {
      console.error("❌ Error during public file upload:", err);
      throw err;
    }
  }

  async uploadPrivateFile(fileName, fileBuffer, quality = "low") {
    const folderName = "private";
    try {
      const processedBuffer = await this.compressImage(fileBuffer, quality);

      const upload = new Upload({
        client: s3Client,
        params: {
          Bucket: process.env.S3_BUCKET,
          ACL: "private",
          Body: processedBuffer,
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
        expiresIn: 3600, // 1 hour
      });

      return signedUrl;
    } catch (err) {
      console.error("❌ Error generating presigned URL:", err);
      throw err;
    }
  }
  static async deleteFile(fileKey) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: fileKey,
      });

      await s3Client.send(command);

      console.log(`✅ Deleted file: ${fileKey}`);
      return { success: true, key: fileKey };
    } catch (err) {
      console.error("❌ Error deleting file:", err);
      throw err;
    }
  }
}
module.exports = { Uploader };
