import { Router, type IRouter, type Request, type Response } from "express";
import {
  readLocalUploadStream,
  LocalUploadNotFoundError,
} from "../lib/objectStorage";

const router: IRouter = Router();

/**
 * GET /storage/objects/uploads/:id
 *
 * Serve a previously stored object (PDF, image, etc.). Wildcard form preserved
 * for URL compatibility, but only `uploads/<id>` is a valid shape.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  const raw = req.params.path;
  const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;

  const match = /^uploads\/([^/]+)$/.exec(wildcardPath);
  if (!match) {
    res.status(404).json({ error: "Object not found" });
    return;
  }

  try {
    const { stream, size, contentType } = await readLocalUploadStream(match[1]);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(size));
    res.setHeader("Cache-Control", "private, max-age=3600");
    stream.on("error", (err) => {
      req.log.error({ err }, "Error streaming local upload");
      if (!res.headersSent) res.status(500).end();
      else res.destroy(err);
    });
    stream.pipe(res);
  } catch (error) {
    if (error instanceof LocalUploadNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error reading local upload");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
