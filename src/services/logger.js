// Import the Winston logging library for structured logging output.
const { createLogger, format, transports } = require('winston');

// Create a Winston logger instance configured for JSON logs.
const logger = createLogger({
  // Define the minimum log level based on the environment variable or default to info.
  level: process.env.LOG_LEVEL || 'info',
  // Combine timestamp and JSON formatting for easy ingestion by log platforms.
  format: format.combine(format.timestamp(), format.json()),
  // Configure log transports to write to console by default for container environments.
  transports: [new transports.Console()],
});

// Export the logger so other modules can write consistent logs.
module.exports = logger;
