import { Action, ActionPanel, Color, Icon, List, Toast, open, showToast } from "@raycast/api";
import { useFetch } from "@raycast/utils";
import {
  apiUrl,
  getApps,
  type AppsResponse,
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

function statusIcon(ws: WorkspaceInfo) {
  return { source: Icon.Circle, tintColor: STATUS_COLORS[ws.status] ?? Color.SecondaryText };
}

interface AppEntry {
  slug: string;
  label: string;
  url: string;
  icon: Icon;
}

function buildAppList(apps: AppsResponse): AppEntry[] {
  const entries: AppEntry[] = [
    { slug: "dashboard", label: "Dashboard", url: apps.dashboard, icon: Icon.Globe },
    { slug: "terminal", label: "Web Terminal", url: apps.terminal, icon: Icon.Terminal },
  ];
  for (const app of apps.apps) {
    if (app.slug === "dashboard") continue;
    entries.push({
      slug: app.slug,
      label: app.label,
      url: `${apps.dashboard}/apps/${app.slug}/`,
      icon: Icon.AppWindow,
    });
  }
  return entries;
}

function AppsView({ workspace }: { workspace: string }) {
  const { isLoading, data, error, revalidate } = useFetch<AppsResponse>(
    apiUrl(`/api/apps?workspace=${encodeURIComponent(workspace)}`),
    { keepPreviousData: true },
  );

  if (error) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.WifiDisabled}
          title="Failed to load apps"
          description={error.message}
        />
      </List>
    );
  }

  const apps = data ? buildAppList(data) : [];

  return (
    <List
      isLoading={isLoading}
      navigationTitle={`Open ${workspace}`}
      searchBarPlaceholder={`Apps for ${workspace}…`}
    >
      {apps.length === 0 && !isLoading ? (
        <List.EmptyView icon={Icon.AppWindow} title="No apps for this workspace" />
      ) : null}
      {apps.map((app) => (
        <List.Item
          key={app.slug}
          icon={app.icon}
          title={app.label}
          subtitle={app.slug}
          actions={
            <ActionPanel>
              <Action
                title="Open in Browser"
                icon={Icon.Globe}
                onAction={async () => {
                  try {
                    await open(app.url);
                  } catch (err) {
                    await showToast({
                      style: Toast.Style.Failure,
                      title: "Failed to open",
                      message: err instanceof Error ? err.message : String(err),
                    });
                  }
                }}
              />
              <Action.CopyToClipboard
                title="Copy URL"
                content={app.url}
                shortcut={{ modifiers: ["cmd"], key: "." }}
              />
              <Action
                title="Reload Apps"
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
  const running = workspaces.filter((w) => w.status === "running");
  const other = workspaces.filter((w) => w.status !== "running");

  const renderItem = (ws: WorkspaceInfo) => (
    <List.Item
      key={ws.name}
      icon={statusIcon(ws)}
      title={ws.name}
      subtitle={ws.templateName}
      accessories={[
        { tag: { value: ws.status, color: STATUS_COLORS[ws.status] ?? Color.SecondaryText } },
      ]}
      actions={
        <ActionPanel>
          {ws.status === "running" ? (
            <Action.Push
              title="Pick App"
              icon={Icon.ArrowRight}
              target={<AppsView workspace={ws.name} />}
            />
          ) : (
            <Action
              title="Workspace Not Running"
              icon={Icon.XMarkCircle}
              onAction={() =>
                showToast({
                  style: Toast.Style.Failure,
                  title: "Workspace not running",
                  message: "Start the workspace from List Workspaces.",
                })
              }
            />
          )}
          <Action
            title="Reload"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={() => revalidate()}
          />
        </ActionPanel>
      }
    />
  );

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search workspaces to open…">
      {workspaces.length === 0 && !isLoading ? (
        <List.EmptyView icon={Icon.Folder} title="No Coder workspaces" />
      ) : null}
      {running.length > 0 ? (
        <List.Section title={`Running · ${running.length}`}>{running.map(renderItem)}</List.Section>
      ) : null}
      {other.length > 0 ? (
        <List.Section title="Stopped">{other.map(renderItem)}</List.Section>
      ) : null}
    </List>
  );
}
