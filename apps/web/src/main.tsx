import { render } from "@solidjs/web";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/instrument-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles/tokens.css";
import "./styles/base.css";
import { App } from "./App";

render(() => <App />, document.getElementById("root")!);

// Local only: a panel for simulating Cloudflare's free-tier limits.
if (import.meta.env.DEV) void import("./dev/SimulatePanel").then((m) => m.mountSimulatePanel());
