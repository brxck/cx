import Foundation

public struct WorkspaceApp: Codable, Equatable, Sendable {
    public var slug: String
    public var label: String
    public var url: String
    public var icon: String?

    public init(slug: String, label: String, url: String, icon: String? = nil) {
        self.slug = slug
        self.label = label
        self.url = url
        self.icon = icon
    }
}

public struct WorkspaceInfo: Codable, Equatable, Identifiable, Sendable {
    public var id: String { name }

    public var name: String
    public var status: String
    public var healthy: Bool
    public var outdated: Bool
    public var buildAge: String
    public var lastBuildAt: String
    public var templateName: String
    public var sessions: [String]
    public var dashboard: String?
    public var terminal: String?
    public var apps: [WorkspaceApp]?

    public init(
        name: String,
        status: String,
        healthy: Bool,
        outdated: Bool,
        buildAge: String,
        lastBuildAt: String,
        templateName: String,
        sessions: [String],
        dashboard: String? = nil,
        terminal: String? = nil,
        apps: [WorkspaceApp]? = nil
    ) {
        self.name = name
        self.status = status
        self.healthy = healthy
        self.outdated = outdated
        self.buildAge = buildAge
        self.lastBuildAt = lastBuildAt
        self.templateName = templateName
        self.sessions = sessions
        self.dashboard = dashboard
        self.terminal = terminal
        self.apps = apps
    }
}

public struct LayoutInfo: Codable, Equatable, Identifiable, Sendable {
    public var id: String { name }

    public var name: String
    public var cmuxId: String
    public var coderWs: String
    public var template: String?
    public var type: String
    public var branch: String?
    public var path: String?
    public var activeAt: String
    public var sessions: [String]

    public init(
        name: String,
        cmuxId: String,
        coderWs: String,
        template: String?,
        type: String,
        branch: String?,
        path: String?,
        activeAt: String,
        sessions: [String]
    ) {
        self.name = name
        self.cmuxId = cmuxId
        self.coderWs = coderWs
        self.template = template
        self.type = type
        self.branch = branch
        self.path = path
        self.activeAt = activeAt
        self.sessions = sessions
    }
}

public struct StatusResponse: Codable, Equatable, Sendable {
    public var workspaces: [WorkspaceInfo]
    public var layouts: [LayoutInfo]

    public init(workspaces: [WorkspaceInfo], layouts: [LayoutInfo]) {
        self.workspaces = workspaces
        self.layouts = layouts
    }
}

public struct ActionResponse: Codable, Equatable, Sendable {
    public var ok: Bool
    public var error: String?

    public init(ok: Bool, error: String? = nil) {
        self.ok = ok
        self.error = error
    }
}

public struct ActivateLayoutResponse: Codable, Equatable, Sendable {
    public var ok: Bool
    public var layout: String?
    public var error: String?

    public init(ok: Bool, layout: String? = nil, error: String? = nil) {
        self.ok = ok
        self.layout = layout
        self.error = error
    }
}

struct ErrorResponse: Codable {
    var error: String?
}
