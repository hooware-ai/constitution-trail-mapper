// Serves the built artifact (dist/) with the production header set. For preview and smoke tests only: it binds to
// loopback, refuses to start if the port is taken (never reuses another tree's server) and is not a hosting choice.
import { listenDistServer } from "./lib/dist-server.mjs";
import { distDir } from "./lib/provenance.mjs";
import { browserPort } from "./lib/browser-port.mjs";

const portArg = process.argv.indexOf("--port");
let port;
try {
  port = browserPort(
    portArg > 0
      ? process.argv[portArg + 1]
      : (process.env.TRAIL_TEST_PORT ?? 4173),
    portArg > 0 ? "--port" : "TRAIL_TEST_PORT",
  );
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

try {
  const server = await listenDistServer({ port, directory: distDir });
  server.on("error", (error) => {
    console.error(
      `serve-dist listener failed on 127.0.0.1:${port}: ${error.message}`,
    );
    process.exit(1);
  });
  console.log(`Serving dist/ on http://127.0.0.1:${port}`);
} catch (error) {
  console.error(
    `serve-dist could not listen on 127.0.0.1:${port}: ${error.message}`,
  );
  process.exit(1);
}
