class AppError extends Error {
  constructor(statusCode, errorCode, message, options = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = options.details ?? null;
    this.req_id = options.req_id ?? null;
  }
}

module.exports = { AppError };
