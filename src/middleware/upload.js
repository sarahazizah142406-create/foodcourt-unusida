import multer from "multer";

// Upload gambar ke memori (maks 5 MB). Dipakai foto menu, foto kantin, dan QRIS.
const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 2, fields: 12, fieldSize: 2048 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
      return cb(new Error("FILE_BUKAN_GAMBAR"));
    }
    cb(null, true);
  }
});

// fields: array nama field file, contoh ["foto"] atau ["foto", "qris"]
export function parseImages(fields) {
  const mw = uploader.fields(fields.map((name) => ({ name, maxCount: 1 })));
  return (req, res, next) => {
    mw(req, res, (error) => {
      if (!error) {
        // rapikan: req.file -> file pertama per field
        req.files = req.files || {};
        return next();
      }
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ message: "Ukuran gambar maksimal 5 MB" });
      }
      if (error.message === "FILE_BUKAN_GAMBAR") {
        return res.status(400).json({ message: "File harus berupa gambar JPG, PNG, atau WebP" });
      }
      if (error instanceof multer.MulterError) {
        return res.status(400).json({ message: "Data upload tidak valid" });
      }
      next(error);
    });
  };
}

export const fileOf = (req, name) => req.files?.[name]?.[0] || null;
