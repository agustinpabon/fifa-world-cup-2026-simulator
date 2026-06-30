import { Router, type IRouter } from "express";
import { sendApiSuccess } from "../lib/api-response";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  return sendApiSuccess(res, { status: "ok" });
});

export default router;
