import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Icon,
  List,
  Toast,
  open,
  showToast,
} from "@raycast/api";
import { useFetch } from "@raycast/utils";
import {
  CxServeUnreachable,
  activateLayout,
  apiUrl,
  authedInit,
  downLayout,
  getApps,
  restartWorkspace,
  startWorkspace,
  stopWorkspace,
  updateWorkspace,
  type LayoutInfo,
  type StatusResponse,
  type WorkspaceInfo,
} from "./api";

const STATUS_COLORS: Record<string, Color> = {
  running: Color.Green,
  stopped: Color.SecondaryText,
  starting: Color.Yellow,
  stopping: Color.Yellow,
  failed: Color.Red,
};

function statusIcon(workspace: WorkspaceInfo) {
  return {
    source: Icon.Circle,
    tintColor: STATUS_COLORS[workspace.status] ?? Color.SecondaryText,
  };
}

function pickLayout(layouts: LayoutInfo[]): LayoutInfo | undefined {
  if (layouts.length === 0) return undefined;
  return [...layouts].sort((a, b) => (a.activeAt > b.activeAt ? -1 : 1))[0];
}

function buildAccessories(
  workspace: WorkspaceInfo,
  layout: LayoutInfo | undefined,
): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [];
  if (layout?.branch) {
    accessories.push({
      tag: { value: layout.branch, color: Color.Blue },
      icon: Icon.CodeBlock,
    });
  }
  if (workspace.sessions.length) {
    accessories.push({
      tag: { value: `${workspace.sessions.length}`, color: Color.Purple },
      icon: Icon.Terminal,
      tooltip: `${workspace.sessions.length} ZMX session${workspace.sessions.length === 1 ? "" : "s"}`,
    });
  }
  if (!workspace.healthy) {
    accessories.push({
      icon: { source: Icon.Warning, tintColor: Color.Red },
      tooltip: "Unhealthy",
    });
  }
  accessories.push({
    tag: {
      value: workspace.status,
      color: STATUS_COLORS[workspace.status] ?? Color.SecondaryText,
    },
  });
  return accessories;
}

function workspaceDetailMarkdown(
  ws: WorkspaceInfo,
  layouts: LayoutInfo[],
): string {
  const lines: string[] = [];
  lines.push(`# ${ws.name}`, "");
  lines.push(`**Template:** ${ws.templateName}`);
  lines.push(`**Status:** ${ws.status}`);
  lines.push(`**Healthy:** ${ws.healthy ? "yes" : "no"}`);
  lines.push(`**Outdated:** ${ws.outdated ? "yes" : "no"}`);
  lines.push(`**Build age:** ${ws.buildAge}`);
  if (ws.sessions.length) {
    lines.push(`**Sessions:** ${ws.sessions.join(", ")}`);
  }
  if (layouts.length) {
    lines.push("", "## Layouts", "");
    for (const layout of layouts) {
      lines.push(`### ${layout.name}`);
      if (layout.template) lines.push(`- Template: ${layout.template}`);
      lines.push(`- Type: ${layout.type}`);
      if (layout.branch) lines.push(`- Branch: \`${layout.branch}\``);
      if (layout.path) lines.push(`- Path: \`${layout.path}\``);
      if (layout.sessions.length)
        lines.push(`- Sessions: ${layout.sessions.join(", ")}`);
      lines.push(`- Last activated: ${layout.activeAt}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

function WorkspaceDetail({
  ws,
  layouts,
}: {
  ws: WorkspaceInfo;
  layouts: LayoutInfo[];
}) {
  return (
    <Detail
      markdown={workspaceDetailMarkdown(ws, layouts)}
      navigationTitle={ws.name}
    />
  );
}

async function runAction(
  label: string,
  work: () => Promise<{ ok: boolean; error?: string } | { ok: boolean }>,
  revalidate: () => void,
) {
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: `${label}…`,
  });
  try {
    const result = await work();
    const errored = "error" in result && result.error;
    if (result.ok && !errored) {
      toast.style = Toast.Style.Success;
      toast.title = `${label} done`;
    } else {
      toast.style = Toast.Style.Failure;
      toast.title = `${label} failed`;
      if ("error" in result) toast.message = result.error;
    }
  } catch (err) {
    toast.style = Toast.Style.Failure;
    toast.title =
      err instanceof CxServeUnreachable
        ? "cx serve unreachable"
        : `${label} failed`;
    toast.message = err instanceof Error ? err.message : String(err);
  } finally {
    revalidate();
  }
}

export default function Command() {
  const { isLoading, data, error, revalidate } = useFetch<StatusResponse>(
    apiUrl("/api/status"),
    authedInit({ keepPreviousData: true }),
  );

  if (error) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.WifiDisabled}
          title="Cannot reach cx serve"
          description={`Run \`cx serve\` and try again. (${error.message})`}
        />
      </List>
    );
  }

  const workspaces = data?.workspaces ?? [];
  const layoutsByWs = new Map<string, LayoutInfo[]>();
  for (const layout of data?.layouts ?? []) {
    const list = layoutsByWs.get(layout.coderWs) ?? [];
    list.push(layout);
    layoutsByWs.set(layout.coderWs, list);
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search workspaces…">
      {workspaces.length === 0 && !isLoading ? (
        <List.EmptyView icon={Icon.Folder} title="No Coder workspaces" />
      ) : null}
      {workspaces.map((ws) => {
        const wsLayouts = layoutsByWs.get(ws.name) ?? [];
        const layout = pickLayout(wsLayouts);
        const isRunning = ws.status === "running";
        return (
          <List.Item
            key={ws.name}
            icon={statusIcon(ws)}
            title={ws.name}
            subtitle={layout?.name ?? ws.templateName}
            accessories={buildAccessories(ws, layout)}
            actions={
              <ActionPanel>
                {layout ? (
                  <Action
                    title="Activate Layout"
                    icon={Icon.ArrowRight}
                    onAction={async () => {
                      const toast = await showToast({
                        style: Toast.Style.Animated,
                        title: "Activating…",
                      });
                      try {
                        await activateLayout(layout.name);
                        toast.style = Toast.Style.Success;
                        toast.title = `Activated ${layout.name}`;
                        revalidate();
                      } catch (err) {
                        toast.style = Toast.Style.Failure;
                        toast.title =
                          err instanceof CxServeUnreachable
                            ? "cx serve unreachable"
                            : "Activate failed";
                        toast.message =
                          err instanceof Error ? err.message : String(err);
                      }
                    }}
                  />
                ) : isRunning ? (
                  <Action
                    title="Stop Workspace"
                    icon={Icon.Pause}
                    onAction={() =>
                      runAction(
                        "Stop",
                        () => stopWorkspace(ws.name),
                        revalidate,
                      )
                    }
                  />
                ) : (
                  <Action
                    title="Start Workspace"
                    icon={Icon.Play}
                    onAction={() =>
                      runAction(
                        "Start",
                        () => startWorkspace(ws.name),
                        revalidate,
                      )
                    }
                  />
                )}

                <Action.Push
                  title="Show Details"
                  icon={Icon.Info}
                  shortcut={{ modifiers: ["cmd"], key: "i" }}
                  target={<WorkspaceDetail ws={ws} layouts={wsLayouts} />}
                />

                <ActionPanel.Section title="Lifecycle">
                  {isRunning ? (
                    <Action
                      title="Stop Workspace"
                      icon={Icon.Pause}
                      shortcut={{ modifiers: ["cmd"], key: "s" }}
                      onAction={() =>
                        runAction(
                          "Stop",
                          () => stopWorkspace(ws.name),
                          revalidate,
                        )
                      }
                    />
                  ) : (
                    <Action
                      title="Start Workspace"
                      icon={Icon.Play}
                      shortcut={{ modifiers: ["cmd"], key: "s" }}
                      onAction={() =>
                        runAction(
                          "Start",
                          () => startWorkspace(ws.name),
                          revalidate,
                        )
                      }
                    />
                  )}
                  <Action
                    title="Restart Workspace"
                    icon={Icon.RotateClockwise}
                    shortcut={{ modifiers: ["cmd"], key: "r" }}
                    onAction={() =>
                      runAction(
                        "Restart",
                        () => restartWorkspace(ws.name),
                        revalidate,
                      )
                    }
                  />
                  <Action
                    title="Update Workspace"
                    icon={Icon.ArrowUp}
                    shortcut={{ modifiers: ["cmd"], key: "u" }}
                    onAction={() =>
                      runAction(
                        "Update",
                        () => updateWorkspace(ws.name),
                        revalidate,
                      )
                    }
                  />
                </ActionPanel.Section>

                {layout ? (
                  <ActionPanel.Section title="Layout">
                    <Action
                      title="Detach Layout"
                      icon={Icon.Eject}
                      style={Action.Style.Destructive}
                      shortcut={{ modifiers: ["cmd"], key: "backspace" }}
                      onAction={() =>
                        runAction(
                          "Detach",
                          () => downLayout(layout.name, false),
                          revalidate,
                        )
                      }
                    />
                    <Action
                      title="Detach and Stop Workspace"
                      icon={Icon.Stop}
                      style={Action.Style.Destructive}
                      shortcut={{
                        modifiers: ["cmd", "shift"],
                        key: "backspace",
                      }}
                      onAction={() =>
                        runAction(
                          "Detach + stop",
                          () => downLayout(layout.name, true),
                          revalidate,
                        )
                      }
                    />
                  </ActionPanel.Section>
                ) : null}

                <ActionPanel.Section title="Open">
                  <Action
                    title="Open Coder Dashboard"
                    icon={Icon.Globe}
                    shortcut={{ modifiers: ["cmd"], key: "d" }}
                    onAction={async () => {
                      try {
                        const apps = await getApps(ws.name);
                        await open(apps.dashboard);
                      } catch (err) {
                        await showToast({
                          style: Toast.Style.Failure,
                          title: "Failed to open dashboard",
                          message:
                            err instanceof Error ? err.message : String(err),
                        });
                      }
                    }}
                  />
                  <Action
                    title="Open Web Terminal"
                    icon={Icon.Terminal}
                    shortcut={{ modifiers: ["cmd"], key: "t" }}
                    onAction={async () => {
                      try {
                        const apps = await getApps(ws.name);
                        await open(apps.terminal);
                      } catch (err) {
                        await showToast({
                          style: Toast.Style.Failure,
                          title: "Failed to open terminal",
                          message:
                            err instanceof Error ? err.message : String(err),
                        });
                      }
                    }}
                  />
                </ActionPanel.Section>

                <Action
                  title="Reload"
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
                  onAction={() => revalidate()}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
