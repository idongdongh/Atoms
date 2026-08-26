import { createApp } from "./app.js";

const app = createApp({
  databasePath: process.env.ATOMS_DATABASE_PATH,
  workspaceRoot: process.env.ATOMS_WORKSPACE_ROOT,
  templateRoot: process.env.ATOMS_TEMPLATE_ROOT,
});
const port = Number(process.env.PORT ?? 3000);

try {
  await app.listen({ host: "0.0.0.0", port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
