import { Icon, Image, MenuBarExtra, launchCommand, LaunchType, openExtensionPreferences } from "@raycast/api";
import { useFetch } from "@raycast/utils";
import { apiUrl, type StatusResponse } from "./api";

export default function Command() {
  const { isLoading, data, error } = useFetch<StatusResponse>(apiUrl("/api/status"), {
    keepPreviousData: true,
  });

  if (error) {
    return (
      <MenuBarExtra icon={Icon.WifiDisabled} title="cx ?" tooltip="cx serve unreachable">
        <MenuBarExtra.Item title="cx serve unreachable" />
        <MenuBarExtra.Item title="Open Extension Preferences" onAction={() => openExtensionPreferences()} />
      </MenuBarExtra>
    );
  }

  const workspaces = data?.workspaces ?? [];
  const layouts = data?.layouts ?? [];
  const running = workspaces.filter((w) => w.status === "running");

  const icon: Image.ImageLike = running.length > 0
    ? { source: Icon.Circle, tintColor: "#3fb950" }
    : { source: Icon.Circle, tintColor: "#8b949e" };

  return (
    <MenuBarExtra icon={icon} title={`${running.length}`} isLoading={isLoading}>
      <MenuBarExtra.Section title={`${running.length} running · ${workspaces.length} total`}>
        {running.map((ws) => (
          <MenuBarExtra.Item
            key={ws.name}
            title={ws.name}
            subtitle={ws.templateName}
            onAction={() => launchCommand({ name: "list-workspaces", type: LaunchType.UserInitiated })}
          />
        ))}
      </MenuBarExtra.Section>
      <MenuBarExtra.Section title="Layouts">
        {layouts.slice(0, 10).map((layout) => (
          <MenuBarExtra.Item
            key={layout.name}
            title={layout.name}
            subtitle={layout.branch ?? layout.template ?? undefined}
            onAction={() =>
              launchCommand({
                name: "find-layout",
                type: LaunchType.UserInitiated,
                arguments: { query: layout.name },
              })
            }
          />
        ))}
      </MenuBarExtra.Section>
      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          title="Open List Layouts"
          onAction={() => launchCommand({ name: "list-layouts", type: LaunchType.UserInitiated })}
        />
        <MenuBarExtra.Item
          title="Open List Workspaces"
          onAction={() => launchCommand({ name: "list-workspaces", type: LaunchType.UserInitiated })}
        />
        <MenuBarExtra.Item title="Preferences…" onAction={() => openExtensionPreferences()} />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
