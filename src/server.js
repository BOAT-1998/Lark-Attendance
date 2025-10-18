// Import the Express web framework to create the HTTP server.
const express = require('express');
// Import the JSON body parser included with Express to read webhook payloads.
const bodyParser = require('body-parser');
// Import the UUID helper to generate identifiers for albums and correlation IDs.
const { v4: uuidv4 } = require('uuid');
// Import the custom logger helper to centralize log formatting and storage.
const logger = require('./services/logger');
// Import the Lark client helper that wraps API calls with retry and error handling.
const larkClient = require('./services/larkClient');
// Import the storage helper that groups incoming images into album buffers.
const storage = require('./services/storage');
// Import the image processor that creates thumbnails and grid layouts.
const imageProcessor = require('./services/imageProcessor');
// Import the card builder that produces interactive Lark cards for albums.
const buildAlbumCard = require('./cards/albumCard');

// Create a new Express application instance.
const app = express();
// Configure the application to parse JSON request bodies for webhook events.
app.use(bodyParser.json({ limit: '10mb' }));

// Define a health check endpoint that Lark or monitoring tools can ping.
app.get('/healthz', (req, res) => {
  // Respond with a simple JSON payload confirming the service is alive.
  res.status(200).json({ status: 'ok' });
});

// Define the webhook endpoint that receives events from the Lark platform.
app.post('/webhook', async (req, res) => {
  // Generate a correlation ID to trace logs across asynchronous operations.
  const correlationId = uuidv4();
  // Log the incoming request with the correlation ID for observability.
  logger.info('Webhook received', { correlationId, body: req.body });

  try {
    // Extract the event data from the request body following Lark's schema.
    const event = req.body?.event;
    // Validate that an event exists; otherwise report a malformed request.
    if (!event) {
      // Log the failure and respond with an error message to Lark.
      logger.warn('Missing event payload', { correlationId });
      res.status(400).json({ message: 'Missing event payload' });
      return;
    }

    // Check whether the event type is a message containing an image.
    if (event?.message?.message_type !== 'image') {
      // Respond quickly when the event is not relevant to prevent retries from Lark.
      res.status(200).json({ message: 'Event ignored' });
      return;
    }

    // Extract core identifiers for the chat and sender to scope albums per conversation.
    const chatId = event.message?.chat_id;
    const senderId = event.sender?.sender_id?.open_id;
    const messageId = event.message?.message_id;
    const createTime = event.message?.create_time;

    // Guard against missing identifiers by returning a descriptive error message.
    if (!chatId || !senderId || !messageId) {
      // Log the error with context for debugging.
      logger.error('Missing identifiers on message event', { correlationId, event });
      res.status(400).json({ message: 'Invalid message payload' });
      return;
    }

    // Obtain the image key from the message content to download the asset.
    const imageKey = JSON.parse(event.message?.content || '{}')?.image_key;
    // Validate that the image key is present to proceed with album aggregation.
    if (!imageKey) {
      // Log the failure and notify the user with an error card message.
      logger.warn('Image key missing from message content', { correlationId });
      await larkClient.sendTextMessage(chatId, 'เกิดข้อผิดพลาด: ไม่พบข้อมูลรูปภาพ', correlationId);
      res.status(200).json({ message: 'Image key missing' });
      return;
    }

    // Add the image metadata to the temporary storage buffer for the chat.
    const albumContext = storage.addImageToBuffer(chatId, {
      imageKey,
      messageId,
      senderId,
      createTime,
    });

    // If fewer than two images are accumulated, acknowledge without creating an album.
    if (albumContext.images.length < 2) {
      res.status(200).json({ message: 'Image buffered' });
      return;
    }

    // Process the buffered images into album assets, including thumbnails and ZIP archive.
    const processedAlbum = await imageProcessor.buildAlbumAssets(albumContext, correlationId);

    // Clear the buffer so subsequent images start a fresh album.
    storage.clearBuffer(chatId);

    // Build the interactive card payload with album metadata and actionable buttons.
    const cardPayload = buildAlbumCard(processedAlbum);

    // Send the interactive card back into the chat so users can view the album summary.
    await larkClient.sendCardMessage(chatId, cardPayload, correlationId);

    // Respond to Lark indicating the webhook succeeded.
    res.status(200).json({ message: 'Album created' });
  } catch (error) {
    // Log the unexpected error with stack trace for investigation.
    logger.error('Unhandled error while processing webhook', { correlationId, error });

    // Attempt to notify the user with an error message while hiding sensitive details.
    await larkClient.safeNotifyError(req.body?.event?.message?.chat_id, error, correlationId);

    // Return a generic error to Lark to allow for automatic retries if appropriate.
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Start the HTTP server when executed directly, using PORT from environment or default.
const port = process.env.PORT || 3000;
// Begin listening for incoming HTTP requests on the configured port.
app.listen(port, () => {
  // Log the startup message for operational visibility.
  logger.info(`Server listening on port ${port}`);
});
