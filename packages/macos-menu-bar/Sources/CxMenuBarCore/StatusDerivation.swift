import Foundation

public enum StatusIndicator: String, Equatable, Sendable {
    case healthy
    case unhealthy
    case inactive
}

public struct StatusBarState: Equatable, Sendable {
    public var title: String
    public var tooltip: String
    public var indicator: StatusIndicator
    public var runningCount: Int
    public var unhealthyCount: Int

    public init(
        title: String,
        tooltip: String,
        indicator: StatusIndicator,
        runningCount: Int,
        unhealthyCount: Int
    ) {
        self.title = title
        self.tooltip = tooltip
        self.indicator = indicator
        self.runningCount = runningCount
        self.unhealthyCount = unhealthyCount
    }

    public static func degraded(_ title: String, tooltip: String) -> StatusBarState {
        StatusBarState(
            title: title,
            tooltip: tooltip,
            indicator: .inactive,
            runningCount: 0,
            unhealthyCount: 0
        )
    }
}

public enum WorkspaceIndicator: String, Equatable, Sendable {
    case runningHealthy
    case runningUnhealthy
    case busy
    case failed
    case inactive
}

/// A human label for a resource URL. Coder agent status carries only a bare URI
/// (no title), so the label is derived from the URL itself.
public func linkLabel(for link: String?) -> String {
    guard let link, let url = URL(string: link) else {
        return "Open Link"
    }

    let segments = url.path.split(separator: "/").map(String.init)
    let prKeywords: Set<String> = ["pull", "pulls", "pull-requests", "merge_requests"]
    if let index = segments.firstIndex(where: { prKeywords.contains($0.lowercased()) }) {
        let next = index + 1 < segments.count ? segments[index + 1] : nil
        if let next, next.allSatisfy(\.isNumber) {
            return "Open PR #\(next)"
        }
        return "Open PR"
    }

    if var host = url.host {
        if host.hasPrefix("www.") { host.removeFirst(4) }
        if !host.isEmpty { return "Open \(host)" }
    }

    return "Open Link"
}

public extension TaskInfo {
    var resourceLinkLabel: String { linkLabel(for: resourceLink) }
}

public extension AppStatus {
    var resourceLinkLabel: String { linkLabel(for: resourceLink) }
}

public extension WorkspaceInfo {
    var isRunning: Bool {
        status == "running"
    }

    var isFavorite: Bool {
        favorite ?? false
    }

    var sortedApps: [WorkspaceApp] {
        (apps ?? []).sorted { left, right in
            let labelOrder = menuStringCompare(left.label, right.label)
            if labelOrder == .orderedSame {
                return left.slug < right.slug
            }
            return labelOrder == .orderedAscending
        }
    }

    var indicator: WorkspaceIndicator {
        if status == "running", !healthy {
            return .runningUnhealthy
        }

        switch status {
        case "running":
            return .runningHealthy
        case "starting", "stopping":
            return .busy
        case "failed":
            return .failed
        default:
            return .inactive
        }
    }
}

public extension StatusResponse {
    var sortedWorkspaces: [WorkspaceInfo] {
        workspaces.sorted { left, right in
            // Pinned (Coder favorite) workspaces float to the top.
            let leftFav = left.isFavorite ? 0 : 1
            let rightFav = right.isFavorite ? 0 : 1
            if leftFav != rightFav {
                return leftFav < rightFav
            }

            let leftRunning = left.isRunning ? 0 : 1
            let rightRunning = right.isRunning ? 0 : 1
            if leftRunning != rightRunning {
                return leftRunning < rightRunning
            }

            if left.lastBuildAt != right.lastBuildAt {
                return left.lastBuildAt > right.lastBuildAt
            }

            return menuStringCompare(left.name, right.name) == .orderedAscending
        }
    }

    var runningWorkspaces: [WorkspaceInfo] {
        sortedWorkspaces.filter(\.isRunning)
    }

    /// Workspaces surfaced in the menu: everything running, plus pinned
    /// workspaces regardless of status so a pin always stays visible.
    var menuWorkspaces: [WorkspaceInfo] {
        sortedWorkspaces.filter { $0.isRunning || $0.isFavorite }
    }

    /// Menu workspaces that back a Coder task, surfaced under the Tasks group.
    var taskWorkspaces: [WorkspaceInfo] {
        menuWorkspaces.filter { $0.task != nil }
    }

    /// Menu workspaces with no associated task, surfaced under the Workspaces group.
    var plainWorkspaces: [WorkspaceInfo] {
        menuWorkspaces.filter { $0.task == nil }
    }

    var unhealthyRunningCount: Int {
        runningWorkspaces.filter { !$0.healthy }.count
    }

    var layoutsByWorkspace: [String: [LayoutInfo]] {
        var grouped: [String: [LayoutInfo]] = [:]
        for layout in layouts {
            grouped[layout.coderWs, default: []].append(layout)
        }

        for workspace in grouped.keys {
            grouped[workspace]?.sort { $0.activeAt > $1.activeAt }
        }

        return grouped
    }

    var activeLayout: LayoutInfo? {
        Self.pickActiveLayout(layouts)
    }

    func activeLayout(for workspace: String) -> LayoutInfo? {
        Self.pickActiveLayout(layoutsByWorkspace[workspace] ?? [])
    }

    func isActiveLayout(_ layout: LayoutInfo) -> Bool {
        activeLayout?.name == layout.name
    }

    var statusBarState: StatusBarState {
        let running = runningWorkspaces
        let unhealthy = unhealthyRunningCount
        let indicator: StatusIndicator

        indicator = running.isEmpty ? .inactive : .healthy

        let title = "\(running.count)"
        var tooltip = "cx · \(running.count) running"
        if unhealthy > 0 {
            tooltip += " · \(unhealthy) unhealthy"
        }

        return StatusBarState(
            title: title,
            tooltip: tooltip,
            indicator: indicator,
            runningCount: running.count,
            unhealthyCount: unhealthy
        )
    }

    static func pickActiveLayout(_ layouts: [LayoutInfo]) -> LayoutInfo? {
        layouts.max { $0.activeAt < $1.activeAt }
    }
}

private func menuStringCompare(_ left: String, _ right: String) -> ComparisonResult {
    let localized = left.localizedCaseInsensitiveCompare(right)
    if localized != .orderedSame {
        return localized
    }

    return left.compare(right)
}
