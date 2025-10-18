// Import the logger helper to trace album buffer operations.
const logger = require('./logger');

// Initialize an in-memory map to buffer images per chat temporarily.
const albumBuffers = new Map();

// Define the maximum time (in milliseconds) to keep buffered images before cleanup.
const BUFFER_TTL_MS = 5 * 60 * 1000;

// Add an image to the buffer associated with a specific chat.
const addImageToBuffer = (chatId, image) => {
  // Attempt to retrieve an existing buffer entry for the chat.
  let entry = albumBuffers.get(chatId);
  // If no entry exists, initialize a new one.
  if (!entry) {
    // Create a new buffer record with a creation timestamp and empty image array.
    entry = {
      createdAt: Date.now(),
      images: [],
    };
    // Store the new buffer in the map for future images.
    albumBuffers.set(chatId, entry);
  }
  // Append the new image metadata to the buffer array.
  entry.images.push(image);
  // Log the addition for observability.
  logger.info('Image added to buffer', { chatId, size: entry.images.length });
  // Trigger cleanup of expired buffers to avoid memory leaks.
  cleanupBuffers();
  // Return the current buffer state for further processing.
  return entry;
};

// Remove buffers that have exceeded the TTL to prevent stale state.
const cleanupBuffers = () => {
  // Iterate over each buffer entry in the map.
  for (const [chatId, entry] of albumBuffers.entries()) {
    // Check whether the buffer age exceeds the configured TTL.
    if (Date.now() - entry.createdAt > BUFFER_TTL_MS) {
      // Delete the expired buffer and log the cleanup action.
      albumBuffers.delete(chatId);
      logger.info('Expired buffer removed', { chatId });
    }
  }
};

// Export helper functions for use across the application.
const clearBuffer = (chatId) => {
  // Remove the buffer entry for the provided chat ID.
  albumBuffers.delete(chatId);
  // Log the cleanup action for traceability.
  logger.info('Buffer cleared', { chatId });
};

module.exports = {
  addImageToBuffer,
  clearBuffer,
};
