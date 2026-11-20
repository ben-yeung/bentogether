import { Match, Switch, createMemo } from "solid-js";
import { matchRoute, navigate, path } from "./lib/router";
import { Home } from "./pages/Home";
import { BoxPage } from "./pages/BoxPage";
import { HomeLink, Mark } from "./brand/Logo";
import styles from "./pages/pages.module.css";

export function App() {
  const route = createMemo(() => matchRoute(path()));
  return (
    <Switch>
      <Match when={route().name === "home"}>
        <Home />
      </Match>
      <Match when={route().name === "box" && route()}>
        {(r) => <BoxPage id={(r() as { id: string }).id} />}
      </Match>
      <Match when={route().name === "missing"}>
        <div class={styles.center}>
          <HomeLink>
            <Mark size={44} />
          </HomeLink>
          <h1 class={styles.heading}>Wrong bento.</h1>
          <p>There's nothing at this address.</p>
          <button type="button" class="btn btn-primary" onClick={() => navigate("/")}>
            Go home
          </button>
        </div>
      </Match>
    </Switch>
  );
}
