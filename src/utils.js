// Error yang membawa HTTP status, supaya controller bisa `throw new HttpError(400, "...")`
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Bungkus handler async: error otomatis diteruskan ke error handler di server.js
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const toInt = (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : NaN;
};
