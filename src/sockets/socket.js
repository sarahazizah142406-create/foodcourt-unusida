// Singleton instance Socket.IO — hindari circular import antara server.js dan routes/controllers
let _io = null;

export function setIO(ioInstance) {
  _io = ioInstance;
}

export function getIO() {
  if (!_io) throw new Error("Socket.io belum di-init. Pastikan setIO() dipanggil di server.js");
  return _io;
}

// Helper: kirim event ke room khusus 1 kantin (kasir kantin itu doang yang nerima)
export function emitToTenant(tenantId, event, payload) {
  getIO().to(`tenant_${tenantId}`).emit(event, payload);
}

// Helper: kirim event ke room khusus 1 order (customer yang lagi nunggu status)
export function emitToOrder(orderId, event, payload) {
  getIO().to(`order_${orderId}`).emit(event, payload);
}
