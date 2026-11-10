import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import socialRouter from "./social";
import mediaRouter from "./media";
import curationRouter from "./curation";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(socialRouter);
router.use(mediaRouter);
router.use(curationRouter);

export default router;
