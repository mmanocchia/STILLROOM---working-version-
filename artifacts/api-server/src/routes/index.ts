import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import socialRouter from "./social";
import mediaRouter from "./media";
import curationRouter from "./curation";
import accountRouter from "./account";

const router: IRouter = Router();

router.use(accountRouter);
router.use(healthRouter);
router.use(authRouter);
router.use(socialRouter);
router.use(mediaRouter);
router.use(curationRouter);

export default router;
