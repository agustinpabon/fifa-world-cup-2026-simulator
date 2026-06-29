import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import oracleRouter from "./oracle.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(oracleRouter);

export default router;
