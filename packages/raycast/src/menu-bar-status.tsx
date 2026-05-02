import {
  Color,
  Icon,
  Image,
  LaunchType,
  MenuBarExtra,
  Toast,
  launchCommand,
  openExtensionPreferences,
  showHUD,
  showToast,
} from "@raycast/api";
import { useFetch } from "@raycast/utils";
import {
  apiUrl,
  activateLayout,
  authedInit,
  restartWorkspace,
  startWorkspace,
  stopWorkspace,
  updateWorkspace,
  type LayoutInfo,
  type StatusResponse,
  type WorkspaceInfo,
} from "./api";

function pickStatusIcon(workspaces: WorkspaceInfo[]): Image.ImageLike {
  const running = workspaces.filter((w) => w.status === "running");
  if (running.length === 0)
    return { source: Icon.Circle, tintColor: Color.SecondaryText };
  if (running.some((w) => !w.healthy))
    return { source: Icon.Circle, tintColor: Color.Red };
  return { source: Icon.Circle, tintColor: Color.Green };
}

function workspaceIcon(ws: WorkspaceInfo): Image.ImageLike {
  if (!ws.healthy && ws.status === "running") {
    return { source: Icon.Circle, tintColor: Color.Red };
  }
  switch (ws.status) {
    case "running":
      return { source: Icon.Circle, tintColor: Color.Green };
    case "starting":
    case "stopping":
      return { source: Icon.Circle, tintColor: Color.Yellow };
    case "failed":
      return { source: Icon.Circle, tintColor: Color.Red };
    default:
      return { source: Icon.Circle, tintColor: Color.SecondaryText };
  }
}

function pickActiveLayout(layouts: LayoutInfo[]): LayoutInfo | undefined {
  if (layouts.length === 0) return undefined;
  return [...layouts].sort((a, b) => (a.activeAt > b.activeAt ? -1 : 1))[0];
}

async function runHud<
  T extends { ok: boolean; error?: string } | { ok: boolean },
>(label: string, fn: () => Promise<T>) {
  await showHUD(`${label}…`);
  try {
    const result = await fn();
    const errored = "error" in result && result.error;
    if (result.ok && !errored) {
      await showHUD(`${label} done`);
    } else {
      const message =
        "error" in result && result.error ? result.error : "Failed";
      await showToast({
        style: Toast.Style.Failure,
        title: `${label} failed`,
        message,
      });
    }
  } catch (err) {
    await showToast({
      style: Toast.Style.Failure,
      title: `${label} failed`,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export default function Command() {
  const { isLoading, data, error, revalidate } = useFetch<StatusResponse>(
    apiUrl("/api/status"),
    authedInit({ keepPreviousData: true }),
  );

  if (error) {
    return (
      <MenuBarExtra
        icon={Icon.WifiDisabled}
        title="cx ?"
        tooltip="cx serve unreachable"
      >
        <MenuBarExtra.Item title="cx serve unreachable" />
        <MenuBarExtra.Item
          title="Retry"
          icon={Icon.ArrowClockwise}
          onAction={() => revalidate()}
        />
        <MenuBarExtra.Item
          title="Open Extension Preferences"
          onAction={() => openExtensionPreferences()}
        />
      </MenuBarExtra>
    );
  }

  const workspaces = data?.workspaces ?? [];
  const layouts = data?.layouts ?? [];
  const layoutsByWs = new Map<string, LayoutInfo[]>();
  for (const layout of layouts) {
    const list = layoutsByWs.get(layout.coderWs) ?? [];
    list.push(layout);
    layoutsByWs.set(layout.coderWs, list);
  }

  const running = workspaces.filter((w) => w.status === "running");
  const stopped = workspaces.filter((w) => w.status !== "running");
  const unhealthy = running.filter((w) => !w.healthy).length;
  const title = unhealthy > 0 ? `${running.length}!` : `${running.length}`;
  const tooltip =
    `cx · ${running.length}/${workspaces.length} running` +
    (unhealthy ? ` · ${unhealthy} unhealthy` : "");
  const activeLayout = pickActiveLayout(layouts);

  const renderWorkspace = (ws: WorkspaceInfo) => {
    const wsLayouts = layoutsByWs.get(ws.name) ?? [];
    const layout = pickActiveLayout(wsLayouts);
    const isRunning = ws.status === "running";
    const isActive =
      activeLayout && layout && activeLayout.name === layout.name;
    const titleSuffix = layout ? ` · ${layout.name}` : "";
    return (
      <MenuBarExtra.Submenu
        key={ws.name}
        icon={
          isActive
            ? { source: Icon.Eye, tintColor: Color.Blue }
            : workspaceIcon(ws)
        }
        title={`${ws.name}${titleSuffix}`}
      >
        {layout ? (
          <MenuBarExtra.Item
            title="Activate Layout"
            icon={Icon.ArrowRight}
            onAction={async () => {
              await runHud(`Activating ${layout.name}`, () =>
                activateLayout(layout.name),
              );
              revalidate();
            }}
          />
        ) : null}
        {isRunning ? (
          <MenuBarExtra.Item
            title="Stop"
            icon={{ source: Icon.Stop, tintColor: Color.Red }}
            onAction={async () => {
              await runHud(`Stopping ${ws.name}`, () => stopWorkspace(ws.name));
              revalidate();
            }}
          />
        ) : (
          <MenuBarExtra.Item
            title="Start"
            icon={{ source: Icon.Play, tintColor: Color.Green }}
            onAction={async () => {
              await runHud(`Starting ${ws.name}`, () =>
                startWorkspace(ws.name),
              );
              revalidate();
            }}
          />
        )}
        <MenuBarExtra.Item
          title="Restart"
          icon={Icon.RotateClockwise}
          onAction={async () => {
            await runHud(`Restarting ${ws.name}`, () =>
              restartWorkspace(ws.name),
            );
            revalidate();
          }}
        />
        <MenuBarExtra.Item
          title="Update"
          icon={Icon.ArrowUp}
          onAction={async () => {
            await runHud(`Updating ${ws.name}`, () => updateWorkspace(ws.name));
            revalidate();
          }}
        />
        <MenuBarExtra.Item
          title="Open in List Workspaces"
          icon={Icon.AppWindow}
          onAction={() =>
            launchCommand({
              name: "list-workspaces",
              type: LaunchType.UserInitiated,
            })
          }
        />
      </MenuBarExtra.Submenu>
    );
  };

  return (
    <MenuBarExtra
      icon={pickStatusIcon(workspaces)}
      title={title}
      tooltip={tooltip}
      isLoading={isLoading}
    >
      {running.length > 0 ? (
        <MenuBarExtra.Section title={`Running · ${running.length}`}>
          {running.map(renderWorkspace)}
        </MenuBarExtra.Section>
      ) : null}

      {stopped.length > 0 ? (
        <MenuBarExtra.Section title={`Stopped · ${stopped.length}`}>
          {stopped.map(renderWorkspace)}
        </MenuBarExtra.Section>
      ) : null}

      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          title="Refresh"
          icon={Icon.ArrowClockwise}
          shortcut={{ modifiers: ["cmd"], key: "r" }}
          onAction={() => revalidate()}
        />
        <MenuBarExtra.Item
          title="Open List Workspaces"
          icon={Icon.AppWindow}
          onAction={() =>
            launchCommand({
              name: "list-workspaces",
              type: LaunchType.UserInitiated,
            })
          }
        />
        <MenuBarExtra.Item
          title="Preferences…"
          icon={Icon.Cog}
          onAction={() => openExtensionPreferences()}
        />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
