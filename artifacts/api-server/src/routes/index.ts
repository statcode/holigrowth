import { Router, type IRouter } from "express";
import healthRouter from "./health";
import zodiacOrdersRouter from "./zodiac-orders/index";
import stripeRouter from "./stripe";
import settingsRouter from "./settings";
import subscribeRouter from "./subscribe";
import adminRouter from "./admin";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(zodiacOrdersRouter);
router.use(stripeRouter);
router.use(settingsRouter);
router.use(subscribeRouter);
router.use(adminRouter);
router.use(storageRouter);

export default router;
