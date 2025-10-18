// Import axios to perform HTTP requests to Lark's open APIs.
const axios = require('axios');
// Import FormData to upload binary files to the Lark file API.
const FormData = require('form-data');
// Import the logger helper for consistent logging.
const logger = require('./logger');

// Define the base URL for Lark Open Platform API endpoints.
const LARK_API_BASE = 'https://open.larksuite.com/open-apis';

// Helper function to pause execution for retry backoff.
const delay = (ms) =>
  // Return a promise that resolves after the specified milliseconds.
  new Promise((resolve) => setTimeout(resolve, ms));

// Build a reusable axios instance configured with default headers and timeouts.
const httpClient = axios.create({
  // Set the base URL so individual requests can specify relative paths.
  baseURL: LARK_API_BASE,
  // Define a timeout to avoid hanging requests.
  timeout: 10000,
});

// Apply a response interceptor to log errors and unwrap data payloads.
httpClient.interceptors.response.use(
  // When a response succeeds, return the data portion directly for convenience.
  (response) => response.data,
  // When a response fails, log details and rethrow for upstream handling.
  async (error) => {
    // Log the error with response details if available.
    logger.error('Lark API request failed', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
    // Rethrow the error to trigger retry or user notification logic.
    throw error;
  }
);

// Fetch an app access token using the lark-oauth library or direct API call.
const fetchTenantAccessToken = async () => {
  // Compose the request body with the app ID and app secret pulled from environment variables.
  const body = {
    app_id: process.env.LARK_APP_ID,
    app_secret: process.env.LARK_APP_SECRET,
  };
  // Send the request to Lark's authentication endpoint.
  const response = await httpClient.post('/auth/v3/tenant_access_token/internal', body);
  // Return the access token value used for authenticated requests.
  return response.tenant_access_token;
};

// Execute an API call with automatic retries on recoverable error codes.
const callLarkApi = async (config, correlationId, attempt = 1) => {
  // Determine the maximum number of retry attempts allowed.
  const maxAttempts = 3;
  try {
    // Ensure the Authorization header includes the tenant access token.
    const token = await fetchTenantAccessToken();
    // Construct headers merging existing ones with the bearer token.
    const headers = {
      Authorization: `Bearer ${token}`,
      ...config.headers,
    };
    // Execute the HTTP request with the combined configuration.
    return await httpClient({ ...config, headers });
  } catch (error) {
    // Capture the HTTP status code for decision making.
    const status = error.response?.status;
    // Determine whether the error is retriable (rate limit, auth refresh, server error).
    const retriable = [401, 403, 429, 500].includes(status) && attempt < maxAttempts;
    // Log the failure along with attempt counts and correlation ID.
    logger.warn('Lark API call failed', { status, attempt, correlationId, retriable });
    if (retriable) {
      // Wait with exponential backoff before retrying.
      await delay(500 * attempt);
      // Recursively retry the request with incremented attempt count.
      return callLarkApi(config, correlationId, attempt + 1);
    }
    // If not retriable, propagate the error to notify the user.
    throw error;
  }
};

// Send a text message to a chat to report errors or confirm actions.
const sendTextMessage = async (chatId, text, correlationId) => {
  // Prepare the API configuration for sending a text message.
  const config = {
    method: 'post',
    url: '/im/v1/messages',
    data: {
      receive_id_type: 'chat_id',
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    },
  };
  try {
    // Execute the API call with retry support.
    await callLarkApi(config, correlationId);
  } catch (error) {
    // Log the failure and rethrow so the caller can decide on fallback behavior.
    logger.error('Failed to send text message', { correlationId, error });
    throw error;
  }
};

// Send an interactive card message to a chat for album display.
const sendCardMessage = async (chatId, card, correlationId) => {
  // Prepare the API request configuration for card messages.
  const config = {
    method: 'post',
    url: '/im/v1/messages',
    data: {
      receive_id_type: 'chat_id',
      receive_id: chatId,
      msg_type: 'interactive',
      content: JSON.stringify(card),
    },
  };
  try {
    // Execute the API call with automatic retries.
    await callLarkApi(config, correlationId);
  } catch (error) {
    // Log the error and rethrow for higher-level handling.
    logger.error('Failed to send card message', { correlationId, error });
    throw error;
  }
};

// Download an image asset using the image key and return the binary data buffer.
const downloadImage = async (imageKey, correlationId) => {
  try {
    // Configure the GET request to download the image content as an array buffer.
    const config = {
      method: 'get',
      url: `/im/v1/images/${imageKey}`,
      responseType: 'arraybuffer',
    };
    // Execute the API call and return the binary data.
    const response = await callLarkApi(config, correlationId);
    return Buffer.from(response);
  } catch (error) {
    // Log the download failure for diagnostics and rethrow.
    logger.error('Failed to download image', { imageKey, correlationId, error });
    throw error;
  }
};

// Upload a file to Lark Drive to create a shareable download link.
const uploadFile = async (fileName, buffer, correlationId) => {
  try {
    // Create a form data payload required by the file upload endpoint.
    const form = new FormData();
    // Append the file buffer with the desired file name and MIME type.
    form.append('file', buffer, { filename: fileName });
    // Compose the HTTP request configuration including headers from FormData.
    const config = {
      method: 'post',
      url: '/drive/v1/files/upload_all',
      headers: form.getHeaders(),
      data: form,
    };
    // Execute the API call and return the uploaded file metadata.
    return await callLarkApi(config, correlationId);
  } catch (error) {
    // Log the upload failure and rethrow to notify the user.
    logger.error('Failed to upload file', { fileName, correlationId, error });
    throw error;
  }
};

// Create a public share link for a file stored in Lark Drive.
const createShareLink = async (fileToken, correlationId) => {
  try {
    // Prepare the POST request body to create a shareable link.
    const config = {
      method: 'post',
      url: '/drive/v1/files/share',
      data: {
        file_token: fileToken,
        share_type: 2,
        need_notify: false,
      },
    };
    // Execute the API request and return the share link data.
    return await callLarkApi(config, correlationId);
  } catch (error) {
    // Log the failure and rethrow to allow fallback strategies.
    logger.error('Failed to create share link', { fileToken, correlationId, error });
    throw error;
  }
};

// Create a new empty Lark Doc to host the album overview.
const createAlbumDocument = async (title, correlationId) => {
  try {
    // Prepare the request configuration for creating a new docx document.
    const config = {
      method: 'post',
      url: '/docx/v1/documents',
      data: {
        title,
      },
    };
    // Execute the API call and return the response with doc token information.
    return await callLarkApi(config, correlationId);
  } catch (error) {
    // Log and rethrow the creation error for upstream handling.
    logger.error('Failed to create album document', { correlationId, error });
    throw error;
  }
};

// Populate a Lark Doc with album metadata and image references.
const populateAlbumDocument = async (docToken, images, zipLink, correlationId) => {
  try {
    // Map each image into a paragraph containing its position and message metadata.
    const paragraphs = images.map((image, index) => ({
      insert: {
        location: `doc://${docToken}/blocks/0`,
        content: {
          elements: [
            {
              type: 'paragraph',
              paragraph: {
                elements: [
                  {
                    type: 'text_run',
                    text_run: {
                      text: `รูปที่ ${index + 1} จากผู้ใช้ ${image.senderId}`,
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    }));
    // Add a paragraph at the top linking to the downloadable archive.
    paragraphs.unshift({
      insert: {
        location: `doc://${docToken}/blocks/0`,
        content: {
          elements: [
            {
              type: 'paragraph',
              paragraph: {
                elements: [
                  {
                    type: 'text_run',
                    text_run: {
                      text: `ดาวน์โหลด ZIP: ${zipLink}`,
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    });
    // Prepare the batch update request body according to the docx API specification.
    const config = {
      method: 'post',
      url: `/docx/v1/documents/${docToken}/content/batch_update`,
      data: {
        requests: paragraphs,
      },
    };
    // Execute the API call to populate the document content.
    await callLarkApi(config, correlationId);
  } catch (error) {
    // Log the failure and rethrow to allow fallback messaging.
    logger.error('Failed to populate album document', { correlationId, error });
    throw error;
  }
};

// Create a share link for the generated album document.
const shareAlbumDocument = async (docToken, correlationId) => {
  try {
    // Prepare the request configuration to share the document publicly within the tenant.
    const config = {
      method: 'post',
      url: '/docx/v1/documents/share',
      data: {
        doc_token: docToken,
        share_type: 2,
        need_notify: false,
      },
    };
    // Execute the API call and return the share link information.
    return await callLarkApi(config, correlationId);
  } catch (error) {
    // Log and rethrow the error for upstream handling.
    logger.error('Failed to share album document', { correlationId, error });
    throw error;
  }
};

// Notify the chat about an error while masking internal details.
const safeNotifyError = async (chatId, error, correlationId) => {
  // If no chat ID is provided (for example due to earlier validation), skip notification.
  if (!chatId) {
    // Log the skip for visibility.
    logger.warn('Cannot notify error because chatId is missing', { correlationId });
    return;
  }
  try {
    // Compose a user-friendly error message in Thai per requirements.
    const text = `เกิดข้อผิดพลาด: ${error.message || 'ไม่ทราบสาเหตุ'}`;
    // Attempt to send the error message via Lark text message.
    await sendTextMessage(chatId, text, correlationId);
  } catch (notifyError) {
    // Log the failure of the notification attempt for later review.
    logger.error('Failed to notify user about error', { correlationId, notifyError });
  }
};

// Export all helper functions for use in other modules.
module.exports = {
  sendTextMessage,
  sendCardMessage,
  downloadImage,
  uploadFile,
  createShareLink,
  createAlbumDocument,
  populateAlbumDocument,
  shareAlbumDocument,
  safeNotifyError,
};
