import { Action, ActionPanel, Color, Icon, List, Toast, open, showToast } from "@raycast/api";
import { useFetch } from "@raycast/utils";
import {
  CxServeUnreachable,
  apiUrl,
  getApps,
  restartWorkspace,
  startWorkspace,
  stopWorkspace,
  updateWorkspace,
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
  return { source: Icon.Circle, tintColor: STATUS_COLORS[workspace.status] ?? Color.SecondaryText };
}

function buildAccessories(workspace: WorkspaceInfo): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [
    { tag: { value: workspace.status, color: STATUS_COLORS[workspace.status] ?? Color.SecondaryText } },
  ];
  if (workspace.outdated) {
    accessories.push({ icon: { source: Icon.ExclamationMark, tintColor: Color.Orange }, tooltip: "Outdated" });
  }
  if (!workspace.healthy) {
    accessories.push({ icon: { source: Icon.Warning, tintColor: Color.Red }, tooltip: "Unhealthy" });
  }
  if (workspace.buildAge) {
    accessories.push({ text: workspace.buildAge });
  }
  return accessories;
}

async function runAction(label: string, work: () => Promise<{ ok: boolean; error?: string }>, revalidate: () => void) {
  const toast = await showToast({ style: Toast.Style.Animated, title: `${label}…` });
  try {
    const result = await work();
    if (result.ok) {
      toast.style = Toast.Style.Success;
      toast.title = `${label} done`;
    } else {
      toast.style = Toast.Style.Failure;
      toast.title = `${label} failed`;
      toast.message = result.error;
    }
  } catch (err) {
    toast.style = Toast.Style.Failure;
    toast.title = err instanceof CxServeUnreachable ? "cx serve unreachable" : `${label} failed`;
    toast.message = err instanceof Error ? err.message : String(err);
  } finally {
    revalidate();
  }
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

  const workspaces = data?.workspaces ?? [];

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search Coder workspaces…">
      {workspaces.length === 0 && !isLoading ? (
        <List.EmptyView icon={Icon.Folder} title="No Coder workspaces" />
      ) : null}
      {workspaces.map((ws) => (
        <List.Item
          key={ws.name}
          icon={statusIcon(ws)}
          title={ws.name}
          subtitle={ws.templateName}
          accessories={buildAccessories(ws)}
          actions={
            <ActionPanel>
              {ws.status === "running" ? (
                <Action
                  title="Stop Workspace"
                  icon={Icon.Pause}
                  onAction={() => runAction("Stop", () => stopWorkspace(ws.name).then((r) => r), revalidate)}
                />
              ) : (
                <Action
                  title="Start Workspace"
                  icon={Icon.Play}
                  onAction={() => runAction("Start", () => startWorkspace(ws.name).then((r) => r), revalidate)}
                />
              )}
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
                      message: err instanceof Error ? err.message : String(err),
                    });
                  }
                }}
              />
              <ActionPanel.Section title="Lifecycle">
                <Action
                  title="Restart Workspace"
                  icon={Icon.RotateClockwise}
                  shortcut={{ modifiers: ["cmd"], key: "r" }}
                  onAction={() => runAction("Restart", () => restartWorkspace(ws.name), revalidate)}
                />
                <Action
                  title="Update Workspace"
                  icon={Icon.ArrowUp}
                  shortcut={{ modifiers: ["cmd"], key: "u" }}
                  onAction={() => runAction("Update", () => updateWorkspace(ws.name), revalidate)}
                />
              </ActionPanel.Section>
              <ActionPanel.Section title="Open">
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
                        message: err instanceof Error ? err.message : String(err),
                      });
                    }
                  }}
                />
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
