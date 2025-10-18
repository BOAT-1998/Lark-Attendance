// Import the Node.js path module to manage temporary file paths.
const path = require('path');
// Import the Node.js file system promises API to work with files asynchronously.
const fs = require('fs').promises;
// Import the Sharp library to generate thumbnails and resize images.
const sharp = require('sharp');
// Import the Archiver library to create ZIP archives.
const archiver = require('archiver');
// Import the UUID helper to generate unique filenames for temporary artifacts.
const { v4: uuidv4 } = require('uuid');
// Import the Lark client helper to download and upload files.
const larkClient = require('./larkClient');
// Import the logger for structured log output.
const logger = require('./logger');

// Helper function to create a temporary directory for storing processing artifacts.
const createTempDir = async () => {
  // Generate a unique directory path inside the system temporary folder.
  const tempDir = path.join(require('os').tmpdir(), `album-${uuidv4()}`);
  // Create the directory on disk.
  await fs.mkdir(tempDir, { recursive: true });
  // Return the path so callers can store files inside it.
  return tempDir;
};

// Helper function to build a grid thumbnail image from individual thumbnails.
const buildGridThumbnail = async (thumbnails, columns, tempDir) => {
  // Compute the number of rows needed given the number of columns.
  const rows = Math.ceil(thumbnails.length / columns);
  // Define the size of each thumbnail cell in pixels.
  const cellSize = 256;
  // Calculate the total canvas size for the grid image.
  const width = columns * cellSize;
  const height = rows * cellSize;
  // Create a blank image buffer filled with a neutral background color.
  const background = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 248, g: 249, b: 250 },
    },
  })
    .png()
    .toBuffer();
  // Initialize an array of composite operations specifying placement of each thumbnail.
  const composite = thumbnails.map((buffer, index) => {
    // Determine the X coordinate by modulus with the number of columns.
    const x = (index % columns) * cellSize;
    // Determine the Y coordinate by dividing by columns and flooring the result.
    const y = Math.floor(index / columns) * cellSize;
    // Return the composite configuration for Sharp.
    return { input: buffer, left: x, top: y };
  });
  // Combine the background and thumbnails into a single grid image.
  const gridBuffer = await sharp(background).composite(composite).png().toBuffer();
  // Persist the grid image to disk for uploading.
  const gridPath = path.join(tempDir, 'grid.png');
  await fs.writeFile(gridPath, gridBuffer);
  // Return both the buffer and file path for downstream use.
  return { gridBuffer, gridPath };
};

// Build an album ZIP archive containing all original images.
const buildZipArchive = async (images, tempDir) => {
  // Create a path for the archive file.
  const zipPath = path.join(tempDir, 'album.zip');
  // Create a writable stream to the ZIP file.
  const output = require('fs').createWriteStream(zipPath);
  // Initialize archiver with ZIP format and maximum compression level.
  const archive = archiver('zip', { zlib: { level: 9 } });
  // Wrap the stream operations in a promise to await completion.
  const archivePromise = new Promise((resolve, reject) => {
    // Resolve the promise when the archive stream closes successfully.
    output.on('close', resolve);
    // Reject the promise if an error occurs on the stream.
    archive.on('error', reject);
  });
  // Pipe the archive data into the file output stream.
  archive.pipe(output);
  // Append each image buffer to the archive with a sequential file name.
  images.forEach((image, index) => {
    archive.append(image.buffer, { name: `image-${index + 1}.jpg` });
  });
  // Finalize the archive to start the compression process.
  archive.finalize();
  // Await completion of the archive operation.
  await archivePromise;
  // Read the archive back into memory to upload to Lark.
  const zipBuffer = await fs.readFile(zipPath);
  // Return both buffer and path to allow cleanup and uploads.
  return { zipBuffer, zipPath };
};

// Download images, generate thumbnails, and create album metadata.
const buildAlbumAssets = async (albumContext, correlationId) => {
  // Create a temporary directory for storing intermediate assets.
  const tempDir = await createTempDir();
  // Initialize an array to hold downloaded image buffers.
  const downloadedImages = [];

  // Iterate over each buffered image metadata entry.
  for (const [index, imageMeta] of albumContext.images.entries()) {
    try {
      // Download the original image from Lark using the image key.
      const buffer = await larkClient.downloadImage(imageMeta.imageKey, correlationId);
      // Store the buffer along with metadata for later use.
      downloadedImages.push({ ...imageMeta, buffer });
    } catch (error) {
      // Log the download failure and continue processing the remaining images.
      logger.error('Skipping image due to download failure', {
        imageKey: imageMeta.imageKey,
        correlationId,
        error,
      });
    }
  }

  // Abort processing if every download failed to avoid empty albums.
  if (downloadedImages.length === 0) {
    // Throw an error so the caller can notify the user to retry.
    throw new Error('ไม่สามารถประมวลผลรูปภาพได้');
  }

  // Generate thumbnails for each downloaded image using Sharp.
  const thumbnails = await Promise.all(
    downloadedImages.map(async (image) => {
      // Resize the image to the defined cell size and convert to PNG.
      return sharp(image.buffer).resize(256, 256, { fit: 'cover' }).png().toBuffer();
    })
  );

  // Determine the grid layout based on the number of images.
  const imageCount = thumbnails.length;
  const columns = imageCount <= 4 ? 2 : imageCount <= 9 ? 3 : 4;

  // Build the composite grid image for the card preview.
  const { gridBuffer } = await buildGridThumbnail(thumbnails, columns, tempDir);

  // Create the ZIP archive for downloading original images.
  const { zipBuffer } = await buildZipArchive(downloadedImages, tempDir);

  // Upload the grid thumbnail to obtain a shareable file token.
  const gridUpload = await larkClient.uploadFile('album-grid.png', gridBuffer, correlationId);
  // Upload the ZIP archive to allow downloading through Lark.
  const zipUpload = await larkClient.uploadFile('album.zip', zipBuffer, correlationId);
  // Create a share link for the ZIP archive to power the download button.
  const zipShare = await larkClient.createShareLink(zipUpload.data?.file?.token, correlationId);

  // Create a document that lists all images for a full-screen viewing experience.
  const docCreate = await larkClient.createAlbumDocument('อัลบั้มภาพใหม่', correlationId);
  // Populate the document with image metadata and download link.
  await larkClient.populateAlbumDocument(
    docCreate.data?.document?.doc_token,
    downloadedImages,
    zipShare.data?.share_url,
    correlationId
  );
  // Share the document so users can open it from the card.
  const docShare = await larkClient.shareAlbumDocument(
    docCreate.data?.document?.doc_token,
    correlationId
  );

  // Compose the album metadata object returned to the webhook handler.
  const album = {
    id: uuidv4(),
    createdAt: new Date(),
    imageCount,
    columns,
    gridImageToken: gridUpload.data?.file?.token,
    zipFileToken: zipUpload.data?.file?.token,
    zipShareLink: zipShare.data?.share_url,
    docShareLink: docShare.data?.share_url,
    images: downloadedImages,
  };

  // Log the successful album assembly for diagnostics.
  logger.info('Album assets built', { correlationId, albumId: album.id, imageCount });

  // Return the album payload for card rendering.
  return album;
};

// Export the buildAlbumAssets function for external use.
module.exports = {
  buildAlbumAssets,
};
