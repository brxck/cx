import { Action, ActionPanel, Color, Icon, List, Toast, open, showToast } from "@raycast/api";
import { useFetch } from "@raycast/utils";
import {
  CxServeUnreachable,
  activateLayout,
  apiUrl,
  downLayout,
  getApps,
  stopWorkspace,
  type LayoutInfo,
  type StatusResponse,
} from "./api";

function statusAccessory(layout: LayoutInfo, runningWorkspaces: Set<string>): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [];
  if (layout.branch) {
    accessories.push({ tag: { value: layout.branch, color: Color.Blue }, icon: Icon.CodeBlock });
  }
  if (layout.sessions.length) {
    accessories.push({ tag: { value: `${layout.sessions.length}`, color: Color.Purple }, icon: Icon.Terminal });
  }
  accessories.push({
    icon: runningWorkspaces.has(layout.coderWs)
      ? { source: Icon.Circle, tintColor: Color.Green }
      : { source: Icon.Circle, tintColor: Color.SecondaryText },
    tooltip: runningWorkspaces.has(layout.coderWs) ? "Workspace running" : "Workspace stopped",
  });
  return accessories;
}

export default function Command() {
  const { isLoading, data, error, revalidate } = useFetch<StatusResponse>(apiUrl("/api/status"), {
    keepPreviousData: true,
  });

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

  const layouts = data?.layouts ?? [];
  const runningWorkspaces = new Set((data?.workspaces ?? []).filter((w) => w.status === "running").map((w) => w.name));

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search layouts by name, branch, template…">
      {layouts.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Layers}
          title="No layouts"
          description="Use `cx up` or the Up From Template command to create one."
        />
      ) : null}
      {layouts.map((layout) => (
        <List.Item
          key={layout.name}
          icon={{ source: Icon.Layers, tintColor: Color.Yellow }}
          title={layout.name}
          subtitle={layout.template ?? undefined}
          accessories={statusAccessory(layout, runningWorkspaces)}
          actions={
            <ActionPanel>
              <Action
                title="Activate Layout"
                icon={Icon.ArrowRight}
                onAction={async () => {
                  const toast = await showToast({ style: Toast.Style.Animated, title: "Activating…" });
                  try {
                    await activateLayout(layout.name);
                    toast.style = Toast.Style.Success;
                    toast.title = `Activated ${layout.name}`;
                    revalidate();
                  } catch (err) {
                    toast.style = Toast.Style.Failure;
                    toast.title = err instanceof CxServeUnreachable ? "cx serve unreachable" : "Activate failed";
                    toast.message = err instanceof Error ? err.message : String(err);
                  }
                }}
              />
              <Action
                title="Open Coder Dashboard"
                icon={Icon.Globe}
                shortcut={{ modifiers: ["cmd"], key: "d" }}
                onAction={async () => {
                  const toast = await showToast({ style: Toast.Style.Animated, title: "Opening dashboard…" });
                  try {
                    const apps = await getApps(layout.coderWs);
                    await open(apps.dashboard);
                    toast.style = Toast.Style.Success;
                    toast.title = "Dashboard opened";
                  } catch (err) {
                    toast.style = Toast.Style.Failure;
                    toast.title = "Failed to open dashboard";
                    toast.message = err instanceof Error ? err.message : String(err);
                  }
                }}
              />
              <ActionPanel.Section title="Layout">
                <Action
                  title="Detach Layout"
                  icon={Icon.Eject}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ["cmd"], key: "backspace" }}
                  onAction={async () => {
                    const toast = await showToast({ style: Toast.Style.Animated, title: "Detaching…" });
                    try {
                      await downLayout(layout.name, false);
                      toast.style = Toast.Style.Success;
                      toast.title = "Detached";
                      revalidate();
                    } catch (err) {
                      toast.style = Toast.Style.Failure;
                      toast.title = "Detach failed";
                      toast.message = err instanceof Error ? err.message : String(err);
                    }
                  }}
                />
                <Action
                  title="Detach and Stop Workspace"
                  icon={Icon.Stop}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "backspace" }}
                  onAction={async () => {
                    const toast = await showToast({ style: Toast.Style.Animated, title: "Stopping workspace…" });
                    try {
                      await downLayout(layout.name, true);
                      toast.style = Toast.Style.Success;
                      toast.title = "Detached and stopped";
                      revalidate();
                    } catch (err) {
                      toast.style = Toast.Style.Failure;
                      toast.title = "Operation failed";
                      toast.message = err instanceof Error ? err.message : String(err);
                    }
                  }}
                />
              </ActionPanel.Section>
              <ActionPanel.Section title="Workspace">
                <Action
                  title="Stop Coder Workspace"
                  icon={Icon.Pause}
                  shortcut={{ modifiers: ["cmd"], key: "s" }}
                  onAction={async () => {
                    const toast = await showToast({ style: Toast.Style.Animated, title: "Stopping…" });
                    try {
                      await stopWorkspace(layout.coderWs);
                      toast.style = Toast.Style.Success;
                      toast.title = `Stopped ${layout.coderWs}`;
                      revalidate();
                    } catch (err) {
                      toast.style = Toast.Style.Failure;
                      toast.title = "Stop failed";
                      toast.message = err instanceof Error ? err.message : String(err);
                    }
                  }}
                />
              </ActionPanel.Section>
              <Action
                title="Reload"
                icon={Icon.ArrowClockwise}
                shortcut={{ modifiers: ["cmd"], key: "r" }}
                onAction={() => revalidate()}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
