# Lark Mini App: Line-Style Photo Album

This project implements a Lark Mini App bot that detects multiple images in a chat conversation and automatically groups them into an album experience similar to LINE's photo albums. The solution is built with Node.js and Express and demonstrates how to combine Lark Open Platform capabilities, interactive cards, and serverless deployment strategies.

## Features

- Automatically buffers chat images until at least two are available, then generates an album grid preview.
- Displays the total number of images with a date stamp (e.g., `📸 7 รูป | 17/10/25`).
- Provides interactive buttons for viewing all images, downloading the ZIP archive, and sharing the album link.
- Handles uploads to Lark Drive to create downloadable archives and shareable links.
- Implements structured logging, automatic retries, and user-friendly error notifications in Thai.

## Architecture Overview

```
Lark Chat → Event Subscription → /webhook (Express) → Image Buffer → Image Processor → Lark APIs
```

1. **Lark Bot**: Subscribed to `message.image` events and sends them to the webhook.
2. **Webhook Handler**: Validates events, buffers images per chat, and triggers album creation.
3. **Image Processor**: Downloads images, creates grid thumbnails with `sharp`, and builds ZIP archives using `archiver`.
4. **Lark APIs**: Uploads assets to Drive, creates share links, and posts interactive cards back to the chat.
5. **Error Handling**: Logs errors, retries recoverable API failures, and informs users of issues.

## Project Structure

```
src/
  server.js            # Express webhook handler with end-to-end flow
  services/
    imageProcessor.js  # Thumbnail, grid, and ZIP generation
    larkClient.js      # Lark API helper with retries and error notifications
    logger.js          # Winston-based logger
    storage.js         # In-memory image buffering per chat
  cards/
    albumCard.js       # Interactive card builder
```

## Prerequisites

- Node.js 18+
- Lark Developer account with a custom app created
- Lark API credentials: `LARK_APP_ID`, `LARK_APP_SECRET`

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Export environment variables:
   ```bash
   export LARK_APP_ID=cli_xxx
   export LARK_APP_SECRET=xxx
   export LOG_LEVEL=debug
   export PORT=3000
   ```
3. Start the server:
   ```bash
   npm run dev
   ```
4. Expose `http://localhost:3000/webhook` to Lark using a tunneling tool such as `ngrok`.

## Deployment on Lark Developer Platform

1. Package the application into a Docker container or deploy to a serverless platform (e.g., Lark Cloud Functions, AWS Lambda, or Vercel serverless functions).
2. For Lark Cloud Functions:
   - Create a new function in the Lark Developer Console.
   - Upload the project (excluding `node_modules`) and configure the handler to execute `src/server.js` using an Express-compatible adapter.
   - Set environment variables (`LARK_APP_ID`, `LARK_APP_SECRET`, `LOG_LEVEL`).
3. Configure the Event Subscription in the Lark Developer Console:
   - Enable `message.receive` and specifically subscribe to `im.message.receive_v1`.
   - Set the request URL to `<YOUR_DEPLOYED_URL>/webhook` and verify the token.
4. Publish the app and add it to the target chat groups.

## Testing Instructions

1. **Unit-style testing (local):**
   - Mock the Lark APIs by replacing the implementations in `src/services/larkClient.js` with stubs returning sample buffers.
   - Send POST requests to `/webhook` with example image message payloads.
2. **End-to-end testing (Lark sandbox):**
   - Deploy the app to a staging environment.
   - Invite the bot to a group chat.
   - Upload two or more images quickly; observe that the bot posts an album card with working buttons.
   - Click "ดาวน์โหลดอัลบั้ม" to confirm the ZIP file downloads.
   - Use "แชร์อัลบั้ม" to verify the generated share link opens in Lark Docs/Drive.
3. **Error handling validation:**
   - Revoke the app's Drive permission temporarily to trigger a 403 error and observe the user-facing error message in chat.
   - Check logs to ensure retries and error details are recorded.

## Notes

- The in-memory buffer is intended for demonstration. For production, replace it with a persistent store (Redis or database) to support horizontal scaling.
- Clean up temporary files if deploying to long-lived servers; ephemeral environments (serverless) clean automatically.
- Ensure the app has Drive and Docs scopes in the Lark Developer Console to upload and share files.
