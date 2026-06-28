import express from "express";
import cors from "cors";
import "dotenv/config";
import routes from "./src/routes/index.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "30mb" }));

const PORT = process.env.PORT || 8787;

app.use("/api", routes);

app.listen(PORT, () => console.log(`[ForenseDoc] backend ouvindo em http://localhost:${PORT}`));
